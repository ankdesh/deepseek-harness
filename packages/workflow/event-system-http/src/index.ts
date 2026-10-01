/** Read-only HTTP polling, durable cursors, debounce, and idempotent event outboxes. */
import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-event-system'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { sourceSchema, recordSchema } from './schema.ts'
import type { HttpSourceId, HttpSourceInput, HttpSourceRecord } from './types.ts'
export type * from './types.ts'

/** Host-owned network and traffic bounds. */
export interface Config {
  /** Exact approved origins; redirects and URL credentials are forbidden. */
  allowedOrigins: string[]
  /** Scheduler tick; unchanged checks invoke no model. */
  tickMillis: number
  /** Minimum accepted source interval. */
  minIntervalMillis: number
  /** Maximum backoff and accepted source interval. */
  maxIntervalMillis: number
  /** Deadline covering headers and the entire response body. */
  timeoutMillis: number
  /** Complete response byte limit before JSON parsing. */
  maxResponseBytes: number
  /** Maximum number of retained sources per conversation. */
  maxSourcesPerConversation: number
  /** Maximum number of retained sources across the process. */
  maxTotalSources: number
  /** Concurrent network checks; at most one per source. */
  maxConcurrentChecks: number
  /** Consecutive failures before human re-enable is required. */
  maxFailures: number
}
export const Config: z<Config> = z.object({
  allowedOrigins: z.array(z.string()).required(),
  tickMillis: z.number().step(1).min(1).required(),
  minIntervalMillis: z.number().step(1).min(1).required(),
  maxIntervalMillis: z.number().step(1).min(1).required(),
  timeoutMillis: z.number().step(1).min(1).required(),
  maxResponseBytes: z.number().step(1).min(1).required(),
  maxSourcesPerConversation: z.number().step(1).min(1).required(),
  maxTotalSources: z.number().step(1).min(1).required(),
  maxConcurrentChecks: z.number().step(1).min(1).required(),
  maxFailures: z.number().step(1).min(1).required(),
})
const spec = defineDomain({
  name: 'event_http_sources',
  version: 1,
  tables: { sources: domainTable<HttpSourceId, HttpSourceRecord>(recordSchema) },
})
declare module '@deepseek-ai/cordis' {
  interface Context {
    eventHttpSources: HttpSourceService
  }
}

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical(value[key] as JsonValue)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
function select(value: JsonValue, pointer: string): JsonValue {
  let selected = value
  if (pointer === '') return selected
  if (!pointer.startsWith('/')) throw new Error('JSON pointer must be empty or start with /')
  for (const part of pointer.slice(1).split('/')) {
    if (/~(?![01])/u.test(part)) throw new Error('Invalid JSON pointer escape')
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~')
    if (selected === null || typeof selected !== 'object' || !Object.hasOwn(selected, key))
      throw new Error('JSON pointer does not identify a response value')
    selected = (selected as Record<string, JsonValue>)[key] as JsonValue
  }
  return selected
}

/** Owns read-only network requests, cursor storage, and the publication outbox. */
export default class HttpSourceService extends Service {
  static inject = ['eventSystems', 'storageDomain']
  static Config = Config
  /** Resolves after persisted definitions and cursors are validated. */
  readonly ready: Promise<void>
  private domain: Domain<typeof spec> | undefined
  private stopping = false
  private readonly adding = new Map<SessionId, number>()
  private readonly jobs = new Map<HttpSourceId, Promise<void>>()
  private readonly aborts = new Map<HttpSourceId, AbortController>()
  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx, 'eventHttpSources')
    if (
      config.maxIntervalMillis < config.minIntervalMillis ||
      config.maxTotalSources < config.maxSourcesPerConversation
    )
      throw new Error('HTTP source bounds are inconsistent')
    for (const origin of config.allowedOrigins) {
      const url = new URL(origin)
      if (!['http:', 'https:'].includes(url.protocol) || origin !== url.origin)
        throw new Error('HTTP allowlist entries must be exact HTTP(S) origins')
    }
    this.ready = (async () => {
      await ctx.eventSystems.ready
      this.domain = await ctx.storageDomain.open(spec)
      for (const [, source] of this.domain.table('sources').entries())
        this.validate(source.conversationId, source.definition, true)
    })()
    const timer = setInterval(() => void this.tick().catch((error: unknown) =>{  ctx.logger.error(error) }), config.tickMillis)
    ctx.effect(() => async () => {
      this.stopping = true
      clearInterval(timer)
      for (const abort of this.aborts.values()) abort.abort()
      await Promise.allSettled(this.jobs.values())
      await this.ready.catch(() => undefined)
      await this.domain?.close()
    })
  }
  private get records() {
    if (!this.domain) throw new Error('HTTP sources are not ready')
    return this.domain.table('sources')
  }
  private validate(id: SessionId, input: HttpSourceInput, allowStopped = false): void {
    const definition = sourceSchema.parse(input)
    if (Buffer.byteLength(JSON.stringify(definition)) > this.config.maxResponseBytes) throw new Error('HTTP source definition byte limit exceeded')
    const url = new URL(definition.url)
    if (!this.config.allowedOrigins.includes(url.origin) || url.username || url.password || url.hash)
      throw new Error('HTTP source URL is not approved or contains credentials/fragment')
    if (
      definition.intervalMillis < this.config.minIntervalMillis ||
      definition.intervalMillis > this.config.maxIntervalMillis ||
      definition.debounceMillis > this.config.maxIntervalMillis
    )
      throw new Error('HTTP source interval/debounce exceeds configured bounds')
    const state = this.ctx.eventSystems.get(id)
    if (
      !state ||
      (!allowStopped && state.status === 'stopped') ||
      !(definition.eventType in state.definition.events) ||
      definition.eventType.startsWith('system.')
    )
      throw new Error('HTTP source requires a live owning conversation and declared event')
    if (definition.pointer !== '' && (!definition.pointer.startsWith('/') || /~(?![01])/u.test(definition.pointer)))
      throw new Error('Invalid JSON pointer')
    if (definition.condition === 'equals') {
      if (definition.expectedJson === undefined) throw new Error('Equality condition requires expectedJson')
      zod.json().parse(JSON.parse(definition.expectedJson))
    }
    if (
      validateJsonSchemaValue(
        state.definition.events[definition.eventType] ?? {},
        { trigger_id: '', url: definition.url, value_json: 'null', previous_digest: '', current_digest: '' },
        'payload',
      ).length
    )
      throw new Error('HTTP event schema must accept the source observation fields')
    if (definition.authorizationEnv && !process.env[definition.authorizationEnv])
      throw new Error('HTTP authorization environment variable is unavailable')
  }
  /**
   * Read source configuration, cursors, errors, and enabled state for one conversation.
   * @param id - owning conversation.
   * @returns committed source records, with credential values excluded.
   */
  list(id: SessionId): HttpSourceRecord[] {
    return this.domain
      ? [...this.records.entries()].map(([, value]) => value).filter(source => source.conversationId === id)
      : []
  }
  /**
   * Register one immutable human-approved source; the first unchanged observation is a baseline.
   * @param id - owning conversation; routing is pinned to its declared event subscriptions.
   * @param input - explicit URL, condition, and traffic settings.
   * @returns committed source identity and initial cursor.
   */
  async add(id: SessionId, input: HttpSourceInput): Promise<HttpSourceRecord> {
    await this.ready
    this.validate(id, input)
    if (
      [...this.records.entries()].length + [...this.adding.values()].reduce((sum, count) => sum + count, 0) >=
        this.config.maxTotalSources ||
      this.list(id).length + (this.adding.get(id) ?? 0) >= this.config.maxSourcesPerConversation
    )
      throw new Error('HTTP source capacity exceeded')
    const source: HttpSourceRecord = {
      id: randomUUID() as HttpSourceId,
      conversationId: id,
      revision: 1,
      definition: sourceSchema.parse(input),
      enabled: true,
      sequence: 0,
      observed: null,
      candidate: null,
      pending: null,
      nextCheckAt: Date.now(),
      failures: 0,
      error: '',
    }
    this.adding.set(id, (this.adding.get(id) ?? 0) + 1)
    try {
      await this.records.put(source.id, source)
      return source
    } finally {
      const remaining = (this.adding.get(id) ?? 1) - 1
      if (remaining) this.adding.set(id, remaining)
      else this.adding.delete(id)
    }
  }
  /**
   * Human enable/disable with the observed source revision; enabling retains cursors and outboxes.
   * @param conversationId - exact owning conversation.
   * @param id - source identity.
   * @param revision - observed source revision.
   * @param enabled - human polling authority.
   * @returns committed source state.
   */
  async control(
    conversationId: SessionId,
    id: HttpSourceId,
    revision: number,
    enabled: boolean,
  ): Promise<HttpSourceRecord> {
    await this.ready
    const current = this.records.get(id)
    if (!current || current.conversationId !== conversationId)
      throw new Error('HTTP source does not belong to this conversation')
    if (enabled) this.validate(conversationId, current.definition)
    const result = await this.records.update(id, (source) => {
      if (source.revision !== revision) throw new Error('HTTP source changed; reload before acting')
      return { ...source, revision: source.revision + 1, enabled, failures: 0, error: '', nextCheckAt: Date.now() }
    })
    if (!enabled) this.aborts.get(id)?.abort()
    return result
  }
  private async tick(): Promise<void> {
    await this.ready
    if (this.stopping) return
    for (const [, source] of this.records.entries()) {
      if (this.jobs.size >= this.config.maxConcurrentChecks) break
      if (
        !source.enabled ||
        this.jobs.has(source.id) ||
        source.nextCheckAt > Date.now() ||
        this.ctx.eventSystems.get(source.conversationId)?.status !== 'active'
      )
        continue
      const job = this.check(source)
        .catch((error: unknown) =>{  this.ctx.logger.error(error) })
        .finally(() => this.jobs.delete(source.id))
      this.jobs.set(source.id, job)
    }
  }
  private async acknowledge(source: HttpSourceRecord): Promise<void> {
    const pending = source.pending
    if (!pending) return
    await this.ctx.eventSystems.publishTrigger(source.conversationId, {
      type: source.definition.eventType,
      producer: `http:${source.id}`,
      dedupeKey: String(pending.sequence),
      payload: {
        trigger_id: source.id,
        url: source.definition.url,
        value_json: pending.valueJson,
        previous_digest: pending.previousDigest,
        current_digest: pending.digest,
      },
    })
    await this.records.update(source.id, current => ({
      ...current,
      revision: current.revision + 1,
      sequence: pending.sequence,
      observed: { digest: pending.digest, valueJson: pending.valueJson },
      candidate: null,
      pending: null,
      failures: 0,
      error: '',
      nextCheckAt: Date.now() + current.definition.intervalMillis,
    }))
  }
  private async check(source: HttpSourceRecord): Promise<void> {
    const abort = new AbortController()
    this.aborts.set(source.id, abort)
    const timeout = setTimeout(() =>{  abort.abort() }, this.config.timeoutMillis)
    try {
      if (source.pending) {
        await this.acknowledge(source)
        return
      }
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (source.definition.authorizationEnv) {
        const credential = process.env[source.definition.authorizationEnv]
        if (!credential) throw new Error('HTTP authorization environment variable is unavailable')
        headers.Authorization = `Bearer ${credential}`
      }
      const response = await fetch(source.definition.url, { headers, redirect: 'error', signal: abort.signal })
      if (!response.ok || !response.body) throw new Error(`HTTP source returned status ${response.status}`)
      const reader = response.body.getReader()
      const parts: Uint8Array[] = []
      let bytes = 0
      try {
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          bytes += part.value.byteLength
          if (bytes > this.config.maxResponseBytes) {
            abort.abort()
            throw new Error('HTTP response byte limit exceeded')
          }
          parts.push(part.value)
        }
      } finally {
        reader.releaseLock()
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))
      let parsed: JsonValue
      try { parsed = zod.json().parse(JSON.parse(text)) }
      catch (_error) { throw new Error('HTTP response contains invalid JSON or unsupported numbers') }
      const selected = select(parsed, source.definition.pointer)
      const valueJson = canonical(selected)
      const digest = createHash('sha256').update(valueJson).digest('hex')
      if (
        this.stopping ||
        !this.records.get(source.id)?.enabled ||
        this.ctx.eventSystems.get(source.conversationId)?.status !== 'active'
      )
        return
      const current = this.records.get(source.id)
      if (!current) return
      const matches =
        source.definition.condition === 'changed' ||
        valueJson === canonical(JSON.parse(source.definition.expectedJson ?? 'null') as JsonValue)
      const emit =
        matches && (current.observed === null ? source.definition.emitInitial : current.observed.digest !== digest)
      if (!emit) {
        await this.records.update(source.id, value => ({
          ...value,
          revision: value.revision + 1,
          observed: { digest, valueJson },
          candidate: null,
          failures: 0,
          error: '',
          nextCheckAt: Date.now() + source.definition.intervalMillis,
        }))
        return
      }
      const since = current.candidate?.digest === digest ? current.candidate.since : Date.now()
      if (Date.now() - since < source.definition.debounceMillis) {
        await this.records.update(source.id, value => ({
          ...value,
          revision: value.revision + 1,
          candidate: { digest, valueJson, since },
          failures: 0,
          error: '',
          nextCheckAt: Date.now() + source.definition.intervalMillis,
        }))
        return
      }
      const pending = {
        digest,
        valueJson,
        previousDigest: current.observed?.digest ?? '',
        sequence: current.sequence + 1,
      }
      const queued = await this.records.update(source.id, value => ({
        ...value,
        revision: value.revision + 1,
        pending,
      }))
      await this.acknowledge(queued)
    } catch (error) {
      if (
        this.stopping ||
        !this.records.get(source.id)?.enabled ||
        this.ctx.eventSystems.get(source.conversationId)?.status !== 'active'
      )
        return
      await this.records.update(source.id, (current) => {
        const failures = current.failures + 1
        return {
          ...current,
          revision: current.revision + 1,
          failures,
          enabled: failures < this.config.maxFailures,
          error: error instanceof Error ? error.message : 'HTTP source failed',
          nextCheckAt:
            Date.now() +
            Math.min(this.config.maxIntervalMillis, current.definition.intervalMillis * 2 ** Math.min(failures, 30)),
        }
      })
    } finally {
      clearTimeout(timeout)
      this.aborts.delete(source.id)
    }
  }
}
