/** Real native execution for HTTP observations, correlated waiting, and safe recovery. */
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { once } from 'node:events'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { normalizeSessionSnapshot, redactSessionSnapshotIds } from '@deepseek-ai/dsh-session-snapshot'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as GoalTools from '@deepseek-ai/dsh-tool-goal'
import HttpSources from '@deepseek-ai/dsh-event-system-http'
import * as HttpInvariant from '@deepseek-ai/dsh-event-system-http/invariant'
import { InvariantError } from '@deepseek-ai/dsh-invariants'
import type { Config } from '@deepseek-ai/dsh-event-system-http'
import type { EventSystemDefinition } from '../src/types.ts'
import { assertSnapshotIntegrity } from '../src/ledger.ts'
import { boot, definition, limits } from './fixture.ts'

const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() =>{  resolve() }))
  }
})
const schema: EventSystemDefinition['events'][string] = {
  type: 'object',
  properties: Object.fromEntries(
    ['trigger_id', 'url', 'value_json', 'previous_digest', 'current_digest'].map(key => [key, { type: 'string' as const }]),
  ),
  required: ['trigger_id', 'url', 'value_json', 'previous_digest', 'current_digest'],
  additionalProperties: false,
}
const monitored: EventSystemDefinition = {
  ...definition,
  events: { ...definition.events, 'source.changed': schema },
  subscriptions: [...definition.subscriptions, { id: 'monitor', event: 'source.changed', target: 'primary' }],
}
async function endpoint() {
  let revision = 1
  let reads = 0
  let body: string | undefined
  let status = 200
  const server = createServer((_req, res) => {
    reads++
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(body ?? JSON.stringify({ revision }))
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture listener')
  return {
    url: `http://127.0.0.1:${address.port}`,
    get reads() {
      return reads
    },
    change(value: number) {
      revision = value
    },
    fail(value: string, code = 200) {
      body = value
      status = code
    },
  }
}
function config(origin: string): Config {
  return {
    allowedOrigins: [origin],
    tickMillis: 5,
    minIntervalMillis: 10,
    maxIntervalMillis: 1000,
    timeoutMillis: 100,
    maxResponseBytes: 1024,
    maxSourcesPerConversation: 2,
    maxTotalSources: 4,
    maxConcurrentChecks: 2,
    maxFailures: 2,
  }
}
function source(url: string) {
  return {
    url,
    eventType: 'source.changed',
    pointer: '/revision',
    condition: 'changed' as const,
    intervalMillis: 20,
    debounceMillis: 0,
    emitInitial: false,
  }
}
async function composed() {
  const runtime = await boot()
  const primary = await runtime.ctx.agents.create({
    sessionId: SessionId(randomUUID()),
    agentOptions: { provider: 'mock', model: 'mock' },
  })
  await runtime.ctx.eventSystems.attach(primary.agent, 'orchestrated', monitored, limits)
  const http = await endpoint()
  await runtime.ctx.plugin(HttpSources, config(http.url))
  const httpInvariant = await runtime.ctx.plugin(HttpInvariant)
  await runtime.ctx.eventHttpSources.ready
  return { ...runtime, primary, http, httpInvariant }
}

describe('approved HTTP observations', () => {
  it('keeps unchanged checks model-free, debounces bursts, and wakes only the pinned conversation', async () => {
    const { ctx, adapter, primary, http } = await composed()
    const other = await ctx.agents.create({
      sessionId: SessionId(randomUUID()),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await ctx.eventSystems.attach(other.agent, 'orchestrated', monitored, limits)
    const entry = await ctx.eventHttpSources.add(primary.agent.id, { ...source(http.url), debounceMillis: 60 })
    await vi.waitFor(() =>{  expect(ctx.eventHttpSources.list(primary.agent.id)[0]?.observed?.valueJson).toBe('1') })
    const initial = http.reads
    await vi.waitFor(() =>{  expect(http.reads).toBeGreaterThan(initial + 1) })
    expect(adapter.requests).toHaveLength(0)
    http.change(2)
    await vi.waitFor(() =>{  expect(ctx.eventHttpSources.list(primary.agent.id)[0]?.candidate?.valueJson).toBe('2') })
    http.change(3)
    await vi.waitFor(() =>{  expect(ctx.eventHttpSources.list(primary.agent.id)[0]?.sequence).toBe(1) })
    await vi.waitFor(() =>{
      expect(
        ctx.eventSystems.get(primary.agent.id)?.deliveries.filter(item => item.state === 'completed'),
      ).toHaveLength(1) },
    )
    expect(
      ctx.eventSystems.get(primary.agent.id)?.events.filter(event => event.type === 'source.changed'),
    ).toHaveLength(1)
    expect(ctx.eventSystems.get(other.agent.id)?.events).toHaveLength(0)
    const current = ctx.eventHttpSources.list(primary.agent.id)[0]
    if (!current) throw new Error('Missing source')
    await ctx.eventHttpSources.control(primary.agent.id, entry.id, current.revision, false)
    const after = http.reads
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(http.reads).toBe(after)
  })
  it('detects a cursor acknowledgement without a committed event and removes its observation on disposal', async () => {
    const { ctx, primary, http, httpInvariant } = await composed()
    const entry = await ctx.eventHttpSources.add(primary.agent.id, source(http.url))
    const invalid = { domain: 'event_http_sources', table: 'sources', operation: 'put' as const,
      value: { ...entry, sequence: 1 } }
    expect(() =>{  ctx.emit('domain/changed', invalid as never) }).toThrow(InvariantError)
    await httpInvariant.dispose()
    expect(() =>{  ctx.emit('domain/changed', invalid as never) }).not.toThrow()
    await ctx.plugin(HttpInvariant)
    expect(() =>{  ctx.emit('domain/changed', invalid as never) }).toThrow(InvariantError)
  })
  it('retains cursors across restart and waits for human Resume before observing changes', async () => {
    const { ctx, primary, http, directory } = await composed()
    await ctx.eventHttpSources.add(primary.agent.id, source(http.url))
    await vi.waitFor(() =>{  expect(ctx.eventHttpSources.list(primary.agent.id)[0]?.observed).not.toBeNull() })
    const requests = ctx.eventSystems.get(primary.agent.id)?.requests.length
    await ctx.fiber.dispose()
    http.change(2)
    const restarted = await boot(directory)
    await restarted.ctx.plugin(HttpSources, config(http.url))
    await restarted.ctx.eventHttpSources.ready
    expect(restarted.ctx.eventSystems.get(primary.agent.id)?.status).toBe('needs-resume')
    const before = http.reads
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(http.reads).toBe(before)
    expect(restarted.adapter.requests).toHaveLength(0)
    const state = restarted.ctx.eventSystems.get(primary.agent.id)
    if (!state) throw new Error('Missing recovered system')
    await restarted.ctx.eventSystems.control(primary.agent.id, state.revision, 'resume')
    await vi.waitFor(() =>{  expect(restarted.ctx.eventHttpSources.list(primary.agent.id)[0]?.sequence).toBe(1) })
    expect(restarted.ctx.eventSystems.get(primary.agent.id)?.requests.length).toBeGreaterThanOrEqual(requests ?? 0)
  })
  it('recovers a committed publication with an unacknowledged source outbox without delivering twice', async () => {
    const { ctx,primary,http,directory }=await composed()
    const original=ctx.eventSystems.publishTrigger.bind(ctx.eventSystems)
    vi.spyOn(ctx.eventSystems,'publishTrigger').mockImplementationOnce(async(id,input)=>{await original(id,input);throw new Error('Crash after event commit')})
    await ctx.eventHttpSources.add(primary.agent.id,{ ...source(http.url),intervalMillis:500,emitInitial:true })
    await vi.waitFor(()=>{ expect(ctx.eventHttpSources.list(primary.agent.id)[0]?.pending).not.toBeNull() })
    await vi.waitFor(()=>{ expect(ctx.eventSystems.get(primary.agent.id)?.deliveries[0]?.state).toBe('completed') })
    await ctx.fiber.dispose()
    const next=await boot(directory);await next.ctx.plugin(HttpSources,config(http.url));await next.ctx.eventHttpSources.ready
    const recovered=next.ctx.eventSystems.get(primary.agent.id);if(!recovered)throw new Error('Missing recovered conversation')
    await next.ctx.eventSystems.control(primary.agent.id,recovered.revision,'resume')
    await vi.waitFor(()=>{ expect(next.ctx.eventHttpSources.list(primary.agent.id)[0]?.sequence).toBe(1) },{ timeout:3000 })
    expect(next.ctx.eventSystems.get(primary.agent.id)?.events.filter(event=>event.type==='source.changed')).toHaveLength(1)
    expect(next.adapter.requests).toHaveLength(0)
  })
  it('rejects foreign URLs and source capacity races, and suspends invalid or oversized responses without model calls', async () => {
    const { ctx, adapter, primary, http } = await composed()
    await expect(ctx.eventHttpSources.add(primary.agent.id, source('http://127.0.0.1:1'))).rejects.toThrow('approved')
    await expect(
      ctx.eventHttpSources.add(primary.agent.id, { ...source(http.url), eventType: 'analysis.ready' }),
    ).rejects.toThrow('schema')
    http.fail('x'.repeat(2048))
    const results = await Promise.allSettled([
      ctx.eventHttpSources.add(primary.agent.id, source(http.url)),
      ctx.eventHttpSources.add(primary.agent.id, source(http.url)),
      ctx.eventHttpSources.add(primary.agent.id, source(http.url)),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2)
    await vi.waitFor(() =>{
      expect(ctx.eventHttpSources.list(primary.agent.id).every(item => !item.enabled)).toBe(true) },
    )
    expect(ctx.eventHttpSources.list(primary.agent.id)[0]?.error).toContain('byte limit')
    expect(adapter.requests).toHaveLength(0)
  })
  it('reports malformed JSON and equality conditions without firing on every matching check', async () => {
    const { ctx, adapter, primary, http } = await composed()
    const entry = await ctx.eventHttpSources.add(primary.agent.id, {
      ...source(http.url),
      condition: 'equals',
      expectedJson: '2',
      emitInitial: true,
    })
    await vi.waitFor(() =>{  expect(ctx.eventHttpSources.list(primary.agent.id)[0]?.observed).not.toBeNull() })
    expect(adapter.requests).toHaveLength(0)
    http.change(2)
    await vi.waitFor(() =>{  expect(ctx.eventHttpSources.list(primary.agent.id)[0]?.sequence).toBe(1) })
    const before = http.reads
    await vi.waitFor(() =>{  expect(http.reads).toBeGreaterThan(before + 1) })
    expect(ctx.eventHttpSources.list(primary.agent.id)[0]?.sequence).toBe(1)
    http.fail('{bad')
    await vi.waitFor(() =>{  expect(ctx.eventHttpSources.list(primary.agent.id)[0]?.enabled).toBe(false) })
    const latest = ctx.eventHttpSources.list(primary.agent.id)[0]
    if (!latest) throw new Error('Missing source')
    await expect(ctx.eventHttpSources.control(SessionId('foreign'), entry.id, latest.revision, true)).rejects.toThrow(
      'belong',
    )
  })
})

describe('durable waiting and replay policy', () => {
  it('blocks native goal continuation until its exact human response, then completes with the remaining budget', async () => {
    const { ctx, adapter, directory } = await boot()
    const primary = await ctx.agents.create({
      sessionId: SessionId(randomUUID()),
      agentOptions: { provider: 'mock', model: 'mock' },
      setup: async (child) => {
        await child.plugin(GoalTools, { blockedAfterConsecutiveRounds: 1 })
      },
    })
    const goalDefinition = {
      ...definition,
      agents: [{ ...definition.agents[0]!, tools: ['wait_for_event', 'get_event_system', 'get_goal', 'update_goal'] }],
      subscriptions: [],
    }
    await ctx.eventSystems.attach(primary.agent, 'goal', goalDefinition, {
      ...limits,
      maxMembers: 1,
      maxConcurrency: 1,
    })
    const fixture = await readFile(new URL('./fixtures/human-wait.session.jsonl', import.meta.url), 'utf8')
    const recording = process.env.DSH_EVENT_SNAPSHOT === 'record'
    const recordedEvents = recording ? [] : parseSessionLog(fixture)
    const recordedGoal = recordedEvents.find(event => event.type === 'goal/change')
    const recordedGoalId = recordedGoal?.type === 'goal/change' && 'goal' in recordedGoal.data ? recordedGoal.data.goal.id : undefined
    if (!recording && !recordedGoalId) throw new Error('Missing recorded goal identity')
    const replay = process.env.DSH_EVENT_SNAPSHOT === 'record' ? [] : deriveReplayScript(recordedEvents)
    let requestIndex = 0
    const original = adapter.stream.bind(adapter)
    let waited = false
    vi.spyOn(adapter, 'stream').mockImplementation(async function* (
      options: GenerateOptions,
    ): AsyncIterable<StreamChunk> {
      const current = ctx.goals.get(primary.agent)
      if (process.env.DSH_EVENT_SNAPSHOT !== 'record') {
        const entry = replay[requestIndex++]
        if (!entry || entry.kind !== 'chunks') throw new Error('Native wait replay exceeded its recorded model calls')
        for (const chunk of entry.chunks) {
          const text = JSON.stringify(chunk).replaceAll(recordedGoalId ?? '', current?.id ?? '')
          const live = JSON.parse(text) as StreamChunk
          if (live.type === 'block-end' && live.block.type === 'tool-call') live.block.id = ToolCallId(randomUUID())
          yield live
        }
        return
      }
      const answered = ctx.eventSystems.get(primary.agent.id)?.waits?.some(wait => wait.state === 'resolved')
      if (!waited || (answered && current?.phase === 'active' && options.messages.at(-1)?.source.kind === 'goal')) {
        waited = true
        const call =
          answered && current
            ? {
              name: 'update_goal',
              arguments: { goal_id: current.id, revision: current.revision, action: 'complete' },
            }
            : { name: 'wait_for_event', arguments: { kind: 'human', reason: 'Which timer period?' } }
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield {
          type: 'block-end',
          index: 0,
          block: {
            type: 'tool-call',
            id: ToolCallId(randomUUID()),
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else yield* original(options)
    })
    ctx.goals.create(primary.agent, { objective: 'Choose the requested timer period.', maxGoalRounds: 8 })
    primary.agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'Choose a timer period.' }], source: { kind: 'user' } }),
    )
    await vi.waitFor(() =>{  expect(ctx.eventSystems.get(primary.agent.id)?.waits?.[0]?.state).toBe('waiting') })
    await primary.agent.whenIdle()
    expect(ctx.goals.get(primary.agent)?.phase).toBe('blocked')
    const held = ctx.eventSystems.get(primary.agent.id)!
    const count = held.requests.length
    await new Promise(resolve => setTimeout(resolve, 70))
    expect(ctx.eventSystems.get(primary.agent.id)?.requests).toHaveLength(count)
    await expect(ctx.eventSystems.answerWait(primary.agent.id, held.revision, 'wrong' as never, '10')).rejects.toThrow(
      'human wait',
    )
    const wait = held.waits?.[0]
    if (!wait) throw new Error('Missing wait')
    await ctx.eventSystems.answerWait(primary.agent.id, held.revision, wait.id, '10 cycles')
    await vi.waitFor(() =>{  expect(ctx.goals.get(primary.agent)?.phase).toBe('complete') }, { timeout: 5000 })
    const completed = ctx.eventSystems.get(primary.agent.id)!
    expect(completed.requests.length).toBeGreaterThan(count)
    expect(completed.requests.length).toBeLessThan(limits.maxRequests)
    expect(() =>{  assertSnapshotIntegrity({ ...completed, waits: completed.waits?.map(item => ({ ...item, afterEvents: completed.events.length })) }) }).toThrow('wait')
    expect(() =>{  assertSnapshotIntegrity({ ...completed, waits: completed.waits?.map(item => ({ ...item, reason: 'x'.repeat(limits.maxPayloadBytes) })) }) }).toThrow('wait')
    await expect(ctx.eventSystems.answerWait(primary.agent.id, completed.revision, wait.id, '20')).rejects.toThrow(
      'human wait',
    )
    await primary.agent.whenIdle()
    if (process.env.DSH_EVENT_SNAPSHOT !== 'record') expect(requestIndex).toBe(replay.length)
    await ctx.fiber.dispose()
    const files = await readdir(join(directory, 'sessions'), { recursive: true })
    const log = files.find(file => file.endsWith('.jsonl'))
    if (!log) throw new Error('Missing recorded native session')
    const raw = await readFile(join(directory, 'sessions', log), 'utf8')
    // These IDs belong to the event adapter, not the native Session identity normalizer.
    const replacements = [...completed.events.map((event, index) => [event.id, `{{event:${index}}}`]),
      ...completed.deliveries.map((delivery, index) => [delivery.activationId, `{{activation:${index}}}`]),
      [wait.id, '{{wait:0}}']]
    let recorded = raw
    for (const event of completed.events)
      recorded = recorded.replaceAll(String.raw`\"createdAt\":${event.createdAt}`, String.raw`\"createdAt\":0`)
    for (const [id, token] of replacements) if (id && token) recorded = recorded.replaceAll(id, token)
    await expect(redactSessionSnapshotIds([normalizeSessionSnapshot(recorded, { sessionIds: [primary.agent.id], cwd: directory }, { identityMode: 'preserve' })])[0])
      .toMatchFileSnapshot('./fixtures/human-wait.session.jsonl')
  })
  it('retries explicitly replay-safe failures with bounded durable backoff and separate native receipts', async () => {
    const { ctx, adapter } = await boot()
    let attempts = 0
    vi.spyOn(adapter, 'stream').mockImplementation(async function* (): AsyncIterable<StreamChunk> {
      attempts++
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'TRANSIENT', message: 'Temporary read failure' } },
      }
    })
    const primary = await ctx.agents.create({
      sessionId: SessionId(randomUUID()),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const safe = {
      ...definition,
      subscriptions: [
        {
          id: 'read',
          event: 'user.requested',
          target: 'analyst',
          retry: { replaySafe: true as const, maxAttempts: 3, initialBackoffMillis: 40, maxBackoffMillis: 80 },
        },
      ],
    }
    await ctx.eventSystems.attach(primary.agent, 'orchestrated', safe, limits)
    await ctx.eventSystems.publishHost(primary.agent.id, {
      type: 'user.requested',
      payload: { text: 'Read safely.' },
      producer: 'human',
      dedupeKey: 'safe',
    })
    await vi.waitFor(() =>{  expect(ctx.eventSystems.get(primary.agent.id)?.deliveries).toHaveLength(3) }, {
      timeout: 5000,
    })
    await vi.waitFor(() =>{
      expect(ctx.eventSystems.get(primary.agent.id)?.deliveries.every(item => item.state === 'failed')).toBe(true) },
    )
    const state = ctx.eventSystems.get(primary.agent.id)!
    expect(attempts).toBe(3)
    expect(new Set(state.deliveries.map(item => item.activationId)).size).toBe(3)
    expect(state.deliveries[1]?.notBefore).toBeGreaterThan(0)
    expect(state.requests).toHaveLength(3)
  })
})
