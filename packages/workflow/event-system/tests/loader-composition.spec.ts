/** Real Loader and AgentLoop execution with only the provider scripted. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, { LlmAdapter, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import Invariants from '@deepseek-ai/dsh-invariants'
import * as EventInvariant from '../src/invariant.ts'
import Goals from '@deepseek-ai/dsh-goal'
import * as GoalDriver from '@deepseek-ai/dsh-goal-round-driver'
import EventSystems from '../src/index.ts'
import type { EventSystemDefinition, ExecutionLimits } from '../src/types.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const limits: ExecutionLimits = {
  maxRounds: 20,
  maxRequests: 50,
  maxTokens: 1000000,
  maxActiveMillis: 60000,
  maxMembers: 3,
  maxConcurrency: 2,
  maxPending: 50,
  maxEvents: 100,
  maxPayloadBytes: 8192,
  maxDepth: 8,
  maxOutputTokens: 128,
}
const exampleRoot = new URL('../examples/analysis-review/', import.meta.url)
const example = JSON.parse(readFileSync(new URL('system.yml', exampleRoot), 'utf8')) as EventSystemDefinition
const definition: EventSystemDefinition = {
  ...example,
  agents: example.agents.map(member => ({
    ...member,
    prompt: readFileSync(new URL(member.prompt, exampleRoot), 'utf8'),
    provider: 'mock',
    model: 'mock',
  })),
}

class CollaborationAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const last = options.messages.at(-1)
    let input: { event?: { id: string; type: string } } = {}
    if (last?.source?.kind === 'plugin') {
      const text = last.content.find(block => block.type === 'text')
      if (text?.type === 'text') input = JSON.parse(text.text) as typeof input
    }
    const type = input.event?.type
    if (type === 'user.requested' || type === 'analysis.ready') {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield {
        type: 'block-end',
        index: 0,
        block: {
          type: 'tool-call',
          id: ToolCallId(randomUUID()),
          name: 'publish_event',
          arguments: JSON.stringify({
            type: type === 'user.requested' ? 'analysis.ready' : 'review.ready',
            payload_json: JSON.stringify(
              type === 'user.requested' ? { findings: 'Analysis complete.' } : { result: 'Review passed.' },
            ),
            dedupe_key: input.event!.id,
          }),
        },
      }
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'text', text: type === 'review.ready' ? 'Review accepted.' : 'Request accepted.' },
      }
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

async function boot(root?: string) {
  const directory = root ?? (await mkdtemp(join(tmpdir(), 'dsh-events-loader-')))
  if (!root) roots.push(directory)
  const configPath = join(directory, 'cordis.yml')
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', Llm],
    ['@deepseek-ai/dsh-session', Sessions],
    ['@deepseek-ai/dsh-session-projection', Projections],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', Tools],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlPersistence],
    ['@deepseek-ai/dsh-token-meter', TokenMeter],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-sqlite', StorageSqlite],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-event-system', EventSystems],
    ['@deepseek-ai/dsh-invariants', Invariants],
    ['@deepseek-ai/dsh-event-system/invariant', EventInvariant],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-goal', Goals],
    ['@deepseek-ai/dsh-goal-round-driver', GoalDriver],
  ])
  const rows = [...modules.keys()].map((name) => {
    const config = name.endsWith('session-persistence-jsonl')
      ? { root: join(directory, 'sessions'), compression: 'none' }
      : name.endsWith('storage-sqlite')
        ? { path: join(directory, 'state.sqlite3') }
        : name.endsWith('storage-domain')
          ? { backend: 'sqlite' }
          : name.endsWith('agent-loop')
            ? { agents: [] }
            : name.endsWith('dsh-goal')
              ? { defaultMaxGoalRounds: 8 }
              : undefined
    return `- name: '${name}'${config ? '\n  config: ' + JSON.stringify(config) : ''}`
  })
  await writeFile(configPath, rows.join('\n') + '\n')
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(directory).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected import ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  await ctx.eventSystems.ready
  const adapter = new CollaborationAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter, directory }
}

describe('persistent event collaboration through Loader', () => {
  it('routes real model publications, logs delivery input, and reuses specialist sessions', async () => {
    const { ctx, adapter } = await boot()
    const primary = await ctx.agents.create({
      sessionId: SessionId('event-conversation'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await ctx.eventSystems.attach(primary.agent, 'orchestrated', definition, limits)
    primary.agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'Analyze the design.' }], source: { kind: 'user' } }),
    )
    await vi.waitFor(
      () => {
        const state = ctx.eventSystems.get(primary.agent.id)!
        expect(state.deliveries).toHaveLength(3)
        expect(state.deliveries.every(delivery => delivery.state === 'completed')).toBe(true)
      },
      { timeout: 10000 },
    )
    const first = ctx.eventSystems.get(primary.agent.id)!
    expect(first.events.map(event => event.type)).toContain('analysis.ready')
    expect(first.events.map(event => event.type)).toContain('review.ready')
    expect(
      adapter.requests.some(request =>
        request.messages.some(
          message =>
            message.source.kind === 'plugin' &&
            message.content.some(block => block.type === 'text' && block.text.includes('activation_id')),
        ),
      ),
    ).toBe(true)
    expect(first.requests.length).toBe(adapter.requests.length)
    expect(first.requests.reduce((sum, request) => sum + request.tokens, 0)).toBe(680)
    const members = first.members
    primary.agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'Analyze another design.' }], source: { kind: 'user' } }),
    )
    await vi.waitFor(
      () => {
        expect(
          ctx.eventSystems.get(primary.agent.id)!.deliveries.filter(delivery => delivery.state === 'completed'),
        ).toHaveLength(6)
      },
      { timeout: 10000 },
    )
    expect(ctx.eventSystems.get(primary.agent.id)!.members).toEqual(members)
  }, 20000)

  it('requires human Resume after a process reload without restoring the budget', async () => {
    const first = await boot()
    const id = SessionId('resumed-conversation')
    const primary = await first.ctx.agents.create({ sessionId: id, agentOptions: { provider: 'mock', model: 'mock' } })
    await first.ctx.eventSystems.attach(primary.agent, 'orchestrated', definition, limits)
    primary.agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'Analyze the design.' }], source: { kind: 'user' } }),
    )
    await vi.waitFor(
      () => {
        expect(
          first.ctx.eventSystems.get(id)!.deliveries.filter(delivery => delivery.state === 'completed'),
        ).toHaveLength(3)
      },
      { timeout: 10000 },
    )
    const saved = first.ctx.eventSystems.get(id)!
    await first.ctx.fiber.dispose()
    const second = await boot(first.directory)
    const restored = second.ctx.eventSystems.get(id)!
    expect(restored.status).toBe('needs-resume')
    expect(restored.requests).toEqual(saved.requests)
    expect(second.adapter.requests).toHaveLength(0)
    const loaded = await second.ctx.agents.resume({
      resumeSessionId: id,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await second.ctx.eventSystems.attach(
      loaded.agent,
      'orchestrated',
      { ...definition, id: 'changed-template' },
      limits,
    )
    expect(second.ctx.eventSystems.get(id)!.definition.id).toBe(definition.id)
    await second.ctx.eventSystems.control(id, restored.revision, 'resume')
    loaded.agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'Analyze after restart.' }], source: { kind: 'user' } }),
    )
    await vi.waitFor(
      () => {
        expect(
          second.ctx.eventSystems.get(id)!.deliveries.filter(delivery => delivery.state === 'completed'),
        ).toHaveLength(6)
      },
      { timeout: 10000 },
    )
    expect(second.ctx.eventSystems.get(id)!.members).toEqual(saved.members)
    expect(second.ctx.eventSystems.get(id)!.requests.length).toBeGreaterThan(saved.requests.length)
  }, 20000)
})

describe('bounded native continuation and human controls', () => {
  it('runs native goal rounds on the primary and stops at the aggregate round limit', async () => {
    const { ctx, adapter } = await boot()
    const primary = await ctx.agents.create({
      sessionId: SessionId('goal-budget'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const goalDefinition = { ...definition, id: 'native-goal', agents: [definition.agents[0]!], subscriptions: [] }
    await ctx.eventSystems.attach(primary.agent, 'goal', goalDefinition, {
      ...limits,
      maxMembers: 1,
      maxConcurrency: 1,
      maxRounds: 2,
    })
    ctx.goals.create(primary.agent, { objective: 'Continue examining the design.', maxGoalRounds: 8 })
    await vi.waitFor(
      () => {
        expect(ctx.eventSystems.get(primary.agent.id)!.status).toBe('exhausted')
      },
      { timeout: 10000 },
    )
    await primary.agent.whenIdle()
    const state = ctx.eventSystems.get(primary.agent.id)!
    expect(state.rounds).toHaveLength(2)
    expect(state.requests).toHaveLength(2)
    expect(adapter.requests).toHaveLength(2)
    expect(state.deliveries).toHaveLength(0)
    expect(state.members).toHaveLength(1)
    expect(
      adapter.requests.every(request => request.messages.some(message => message.source.kind === 'goal')),
    ).toBe(true)
    await expect(ctx.eventSystems.control(primary.agent.id, state.revision, 'resume')).rejects.toThrow(
      'Budget exhausted',
    )
  }, 15000)

  it('queues paused events, rejects stale controls, and stops without running queued members', async () => {
    const { ctx, adapter } = await boot()
    const primary = await ctx.agents.create({
      sessionId: SessionId('paused-queue'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const initial = await ctx.eventSystems.attach(primary.agent, 'orchestrated', definition, limits)
    const paused = await ctx.eventSystems.control(primary.agent.id, initial.revision, 'pause')
    await ctx.eventSystems.publishHost(primary.agent.id, {
      type: 'user.requested',
      payload: { text: 'Queued request' },
      producer: 'human',
      dedupeKey: 'queued',
    })
    expect(adapter.requests).toHaveLength(0)
    expect(ctx.eventSystems.get(primary.agent.id)!.deliveries[0]!.state).toBe('pending')
    await expect(ctx.eventSystems.control(primary.agent.id, paused.revision, 'resume')).rejects.toThrow('changed')
    const current = ctx.eventSystems.get(primary.agent.id)!
    const stopped = await ctx.eventSystems.control(primary.agent.id, current.revision, 'stop')
    expect(stopped.deliveries[0]!.state).toBe('cancelled')
    await expect(ctx.eventSystems.control(primary.agent.id, stopped.revision, 'resume')).rejects.toThrow('Stopped')
    expect(adapter.requests).toHaveLength(0)
  })

  it('requires acknowledgement for manual retry and retains the previous attempt', async () => {
    const { ctx, adapter } = await boot()
    const primary = await ctx.agents.create({
      sessionId: SessionId('retry-attempt'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await ctx.eventSystems.attach(primary.agent, 'orchestrated', definition, limits)
    await ctx.eventSystems.control(
      primary.agent.id,
      ctx.eventSystems.get(primary.agent.id)!.revision,
      'pause',
    )
    await ctx.eventSystems.publishHost(primary.agent.id, {
      type: 'user.requested',
      payload: { text: 'Retry request' },
      producer: 'human',
      dedupeKey: 'retry',
    })
    // A persisted dispatch interrupted before a native receipt is an uncertain attempt.
    const domain = ctx.storage.form('domain').get('event_systems')!
    await domain.table('systems').update(primary.agent.id, (current: unknown) => {
      const state = current as import('../src/types.ts').EventSystemSnapshot
      return {
        ...state,
        status: 'active',
        revision: state.revision + 1,
        deliveries: state.deliveries.map(item => ({ ...item, state: 'interrupted', error: 'Interrupted' })),
      }
    })
    const current = ctx.eventSystems.get(primary.agent.id)!
    const delivery = current.deliveries[0]!
    await expect(ctx.eventSystems.retry(primary.agent.id, current.revision, delivery.id, false)).rejects.toThrow(
      'acknowledgement',
    )
    const retried = await ctx.eventSystems.retry(primary.agent.id, current.revision, delivery.id, true)
    expect(retried.deliveries[0]).toEqual(delivery)
    expect(retried.deliveries[1]).toMatchObject({ attempt: 2, retryOf: delivery.id, state: 'pending' })
    expect(retried.deliveries[1]!.activationId).not.toBe(delivery.activationId)
    await vi.waitFor(
      () => {
        expect(
          ctx.eventSystems.get(primary.agent.id)!.deliveries.filter(item => item.state === 'completed'),
        ).toHaveLength(3)
      },
      { timeout: 10000 },
    )
    expect(adapter.requests.length).toBeGreaterThan(0)
  }, 15000)
})

describe('active request cancellation', () => {
  it('accounts overlapping model time and cancels every active member at exhaustion', async () => {
    const { ctx, adapter } = await boot()
    vi.spyOn(adapter, 'stream').mockImplementation(async function* (
      options: GenerateOptions,
    ): AsyncIterable<StreamChunk> {
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) resolve()
        else
          options.signal?.addEventListener(
            'abort',
            () => {
              resolve()
            },
            { once: true },
          )
      })
      yield { type: 'finish', reason: { kind: 'aborted', failure: { code:'ABORTED',message:'Cancelled by the active time budget' } } }
    })
    const primary = await ctx.agents.create({
      sessionId: SessionId('time-bound'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const fanout = {
      ...definition,
      subscriptions: [
        { id: 'analyze', event: 'user.requested', target: 'analyst' },
        { id: 'review', event: 'user.requested', target: 'reviewer' },
      ],
    }
    await ctx.eventSystems.attach(primary.agent, 'orchestrated', fanout, { ...limits, maxActiveMillis: 300 })
    await ctx.eventSystems.publishHost(primary.agent.id, {
      type: 'user.requested',
      payload: { text: 'Two requests' },
      producer: 'human',
      dedupeKey: 'parallel',
    })
    await vi.waitFor(
      () => {
        const state = ctx.eventSystems.get(primary.agent.id)!
        expect(state.status).toBe('exhausted')
        expect(state.requests).toHaveLength(2)
        expect(state.requests.every(request => request.settled)).toBe(true)
      },
      { timeout: 10000 },
    )
    const elapsed = ctx.eventSystems
      .get(primary.agent.id)!
      .requests.reduce((sum, request) => sum + request.activeMillis, 0)
    expect(elapsed).toBeGreaterThanOrEqual(250)
    expect(elapsed).toBeLessThan(600)
    for (const member of ctx.eventSystems.get(primary.agent.id)!.members)
      expect(ctx.agents.get(member.sessionId)?.status).not.toBe('running')
  }, 15000)
})
