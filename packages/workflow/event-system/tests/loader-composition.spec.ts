import { describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { boot, definition, limits } from './fixture.ts'

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
    await ctx.eventSystems.control(primary.agent.id, ctx.eventSystems.get(primary.agent.id)!.revision, 'pause')
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
      yield {
        type: 'finish',
        reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'Cancelled by the active time budget' } },
      }
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
