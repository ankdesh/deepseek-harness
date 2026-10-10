import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import {
  MemoryMediaPool,
  MemoryStorageBackend,
} from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { DurableFlowRuntime, FlowOperationError, transitionFlow } from '../src/index.ts'
import { flowKey } from '@deepseek-ai/dsh-flow'
import type { FlowActor, FlowDefinition, FlowExecution, FlowOperation } from '@deepseek-ai/dsh-flow'
import { SessionId } from '@deepseek-ai/dsh-session'
const limits = {
  maxRequests: 3,
  maxTokens: 100000,
  maxActiveMillis: 10000,
  maxOutputTokens: 1000,
  maxRetainedBytes: 100000,
  maxExpandedNodes: 20,
}
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(c => c.fiber.dispose()))
})
const any = { type: 'object', additionalProperties: true } as const
const actor: FlowActor = { kind: 'human', sessionId: SessionId('source') }
const root: FlowDefinition = {
  id: 'root',
  version: '1',
  description: 'Generic example',
  inputSchema: any,
  outputSchema: any,
  publication: { toolName: 'example_flow', contexts: ['example'] },
  nodes: [{ id: 'read', kind: 'call', operation: { id: 'read', version: '1' }, inputs: { $ref: 'inputs' } }],
  outputs: { $ref: 'nodes.read' },
}
async function setup(pool?: MemoryMediaPool) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(DurableFlowRuntime, limits)
  await ctx.flows.ready
  return ctx.flows
}
describe('durable flows', () => {
  it('runs typed operations and subflows once, and rejects changed duplicate starts', async () => {
    const flows = await setup()
    let calls = 0
    flows.registerOperation({
      id: 'read',
      version: '1',
      inputSchema: any,
      outputSchema: any,
      effect: 'read',
      cancellation: 'cooperative',
      recovery: 'repeat',
      execute: async (input) => {
        calls++
        return input
      },
    })
    flows.registerDefinition(root)
    const sub = { ...root, id: 'sub', publication: undefined }
    const { publication: _publication, ...unpublished } = sub
    flows.registerDefinition(unpublished)
    const definition: FlowDefinition = {
      ...root,
      id: 'outer',
      publication: { toolName: 'outer_flow', contexts: ['example'] },
      nodes: [
        {
          id: 'nested',
          kind: 'flow',
          flow: { id: unpublished.id, version: unpublished.version },
          inputs: { $ref: 'inputs' },
        },
      ],
      outputs: { $ref: 'nodes.nested' },
    }
    flows.registerDefinition(definition)
    const started = await flows.start({
      definition,
      inputs: { count: 3 },
      actor,
      context: 'example',
      requestId: 'one',
    })
    expect((await flows.settled(started.id)).result).toEqual({ count: 3 })
    expect(calls).toBe(1)
    expect(
      (await flows.start({ definition, inputs: { count: 3 }, actor, context: 'example', requestId: 'one' }))
        .id,
    ).toBe(started.id)
    await expect(
      flows.start({ definition, inputs: { count: 4 }, actor, context: 'example', requestId: 'one' }),
    ).rejects.toThrow(/changed/)
    expect(flows.trace(started.id, actor).nodes).toHaveLength(2)
    expect(() => flows.get(started.id, { kind: 'human', sessionId: SessionId('foreign') })).toThrow(/another/)
  })
  it('answers correlated waits exactly once and rejects model controls', async () => {
    const flows = await setup()
    const definition: FlowDefinition = {
      ...root,
      nodes: [{ id: 'approval', kind: 'wait', request: { question: 'Continue?' }, outputSchema: any }],
      outputs: { $ref: 'nodes.approval' },
    }
    flows.registerDefinition(definition)
    const start = await flows.start({ definition, inputs: {}, actor, context: 'example', requestId: 'wait' })
    const waiting = await flows.settled(start.id)
    expect(waiting.status).toBe('waiting')
    await expect(
      flows.control(start.id, waiting.revision, 'cancel', { ...actor, kind: 'model' }),
    ).rejects.toThrow(/human/)
    await expect(
      flows.answer(start.id, waiting.revision - 1, waiting.pending!.id, 'answer', {}, actor),
    ).rejects.toThrow(/Stale/)
    await flows.answer(start.id, waiting.revision, waiting.pending!.id, 'answer', { approved: true }, actor)
    expect((await flows.settled(start.id)).result).toEqual({ approved: true })
    await flows.answer(start.id, waiting.revision, waiting.pending!.id, 'answer', { approved: true }, actor)
    await expect(
      flows.answer(start.id, waiting.revision, waiting.pending!.id, 'answer', { approved: false }, actor),
    ).rejects.toThrow(/changed/)
  })
  it('requires explicit Resume after restart and skips committed effects', async () => {
    const pool = new MemoryMediaPool(),
      flows = await setup(pool)
    let calls = 0
    const operation: FlowOperation = {
      id: 'read',
      version: '1',
      inputSchema: any,
      outputSchema: any,
      effect: 'read',
      cancellation: 'cooperative',
      recovery: 'repeat',
      execute: async () => {
        calls++
        return { count: 1 }
      },
    }
    const definition: FlowDefinition = {
      ...root,
      nodes: [...root.nodes, { id: 'approval', kind: 'wait', request: {}, outputSchema: any }],
      outputs: { $ref: 'nodes.read' },
    }
    flows.registerOperation(operation)
    flows.registerDefinition(definition)
    const start = await flows.start({
      definition,
      inputs: {},
      actor,
      context: 'example',
      requestId: 'restart',
    })
    await flows.settled(start.id)
    await contexts.pop()!.fiber.dispose()
    const recovered = await setup(pool)
    recovered.registerOperation(operation)
    recovered.registerDefinition(definition)
    const record = recovered.get(start.id, actor)
    expect(record.status).toBe('needs-resume')
    expect(calls).toBe(1)
    const waiting = await recovered.control(start.id, record.revision, 'resume', actor)
    expect(waiting.status).toBe('waiting')
    await recovered.answer(start.id, waiting.revision, waiting.pending!.id, 'approved', {}, actor)
    expect((await recovered.settled(start.id)).status).toBe('succeeded')
    expect(calls).toBe(1)
  })
  it('uses receipt recovery without invoking a second write', async () => {
    const flows = await setup()
    let writes = 0
    const operation: FlowOperation = {
      id: 'read',
      version: '1',
      inputSchema: any,
      outputSchema: any,
      effect: 'write',
      cancellation: 'await-settlement',
      recovery: 'receipt',
      execute: async () => {
        writes++
        throw new FlowOperationError('Connection lost', true)
      },
      reconcile: async () => ({ saved: true }),
    }
    flows.registerOperation(operation)
    flows.registerDefinition(root)
    const start = await flows.start({
      definition: root,
      inputs: {},
      actor,
      context: 'example',
      requestId: 'write',
    })
    const uncertain = await flows.settled(start.id)
    expect(uncertain.status).toBe('needs-reconcile')
    await flows.control(start.id, uncertain.revision, 'resume', actor)
    expect((await flows.settled(start.id)).result).toEqual({ saved: true })
    expect(writes).toBe(1)
  })
  it('stops after the first malformed model result and bounds spending', async () => {
    const flows = await setup()
    let requests = 0
    flows.registerModelProvider({
      execute: async () => {
        requests++
        return { value: { wrong: true } }
      },
    })
    const definition: FlowDefinition = {
      ...root,
      nodes: [
        {
          id: 'model',
          kind: 'model',
          instructions: 'Return count.',
          inputs: {},
          outputSchema: {
            type: 'object',
            properties: { count: { type: 'integer' } },
            required: ['count'],
            additionalProperties: false,
          },
        },
      ],
      outputs: { $ref: 'nodes.model' },
    }
    flows.registerDefinition(definition)
    const start = await flows.start({ definition, inputs: {}, actor, context: 'example', requestId: 'model' })
    const result = await flows.settled(start.id)
    expect(result.status).toBe('failed')
    expect(requests).toBe(1)
    expect(result.usage.requests).toBe(1)
  })
  it('rejects invalid lifecycle transitions and removes registry contributions', async () => {
    const flows = await setup()
    const dispose = flows.registerDefinition(root)
    expect(flows.catalog('example')).toHaveLength(1)
    dispose()
    expect(flows.catalog('example')).toHaveLength(0)
    expect(() =>
      transitionFlow({ status: 'succeeded', revision: 3 } as FlowExecution, 3, 'resume', 0),
    ).toThrow(/does not permit/)
    expect(() => transitionFlow({ status: 'paused', revision: 3 } as FlowExecution, 2, 'resume', 0)).toThrow(
      /Stale/,
    )
    expect(flowKey(root)).toBe('root@1')
  })
  it('rejects competing starts and preserves confirmed writes on Cancel', async () => {
    const flows = await setup()
    let enter!: () => void,
      release!: () => void,
      writes = 0
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    flows.registerOperation({
      id: 'read',
      version: '1',
      inputSchema: any,
      outputSchema: any,
      effect: 'write',
      cancellation: 'await-settlement',
      recovery: 'receipt',
      execute: async () => {
        enter()
        await gate
        writes++
        return { saved: true }
      },
      reconcile: async () => ({ saved: true }),
    })
    flows.registerDefinition({ ...root, nodes: [...root.nodes, { ...root.nodes[0]!, id: 'second' }] })
    const start = await flows.start({
      definition: root,
      inputs: {},
      actor,
      context: 'example',
      requestId: 'cancel-write',
    })
    await entered
    await expect(
      flows.start({ definition: root, inputs: {}, actor, context: 'example', requestId: 'competing' }),
    ).rejects.toThrow(/active flow/)
    const cancellation = flows.control(start.id, flows.get(start.id, actor).revision, 'cancel', actor)
    release()
    const cancelled = await cancellation
    expect(cancelled.status).toBe('cancelled')
    expect(writes).toBe(1)
    expect(cancelled.nodes.find(n => n.id === 'read')?.output).toEqual({ saved: true })
    expect(cancelled.nodes.some(n => n.id === 'second')).toBe(false)
  })
  it('pins accepted definitions across catalog disposal and refuses version reuse', async () => {
    const pool = new MemoryMediaPool(),
      flows = await setup(pool)
    const definition: FlowDefinition = {
      ...root,
      nodes: [{ id: 'approval', kind: 'wait', request: {}, outputSchema: any }],
      outputs: { $ref: 'nodes.approval' },
    }
    flows.registerDefinition(definition)
    const start = await flows.start({
      definition,
      inputs: {},
      actor,
      context: 'example',
      requestId: 'pinned',
    })
    await flows.settled(start.id)
    await contexts.pop()!.fiber.dispose()
    const recovered = await setup(pool)
    recovered.registerDefinition({ ...definition, description: 'Changed under the same version' })
    expect(() => recovered.compile(definition)).toThrow(/version identity/)
    const saved = recovered.get(start.id, actor)
    await recovered.control(start.id, saved.revision, 'resume', actor)
    const waiting = recovered.get(start.id, actor)
    await recovered.answer(start.id, waiting.revision, waiting.pending!.id, 'receipt', { saved: true }, actor)
    expect((await recovered.settled(start.id)).result).toEqual({ saved: true })
  })
  it('keeps a conservative token charge when provider usage is missing', async () => {
    const flows = await setup()
    flows.registerModelProvider({ execute: async () => ({ value: {} }) })
    const definition: FlowDefinition = {
      ...root,
      nodes: [
        { id: 'model', kind: 'model', instructions: 'Return typed JSON.', inputs: {}, outputSchema: any },
      ],
      outputs: { $ref: 'nodes.model' },
    }
    flows.registerDefinition(definition)
    const start = await flows.start({ definition, inputs: {}, actor, context: 'example', requestId: 'usage' })
    const finished = await flows.settled(start.id)
    expect(finished.status).toBe('succeeded')
    expect(finished.usage.requests).toBe(1)
    expect(finished.usage.tokens).toBeGreaterThanOrEqual(limits.maxOutputTokens)
  })

  it('retains interrupted dispatch time through restart and does not charge it twice', async () => {
    const pool = new MemoryMediaPool(),
      flows = await setup(pool)
    flows.registerDefinition(root)
    flows.registerOperation({
      id: 'read',
      version: '1',
      inputSchema: any,
      outputSchema: any,
      effect: 'read',
      cancellation: 'cooperative',
      recovery: 'repeat',
      execute: async input => input,
    })
    const start = await flows.start({
      definition: root,
      inputs: {},
      actor,
      context: 'example',
      requestId: 'loss',
      deferred: true,
    })
    // Record the exact boundary after committed dispatch, before a result. Storage
    // is the external boundary; the restarted runtime uses the real domain decoder.
    const table = (flows as unknown as { table: { put(id: string, value: FlowExecution): Promise<void> } })
      .table
    const { allowed_actions: _actions, ...record } = flows.get(start.id, actor),
      now = Date.now()
    await table.put(start.id, {
      ...record,
      nodes: [
        {
          id: 'read',
          kind: 'call',
          operationId: start.id + '/read/1',
          attempt: 1,
          state: 'running',
          inputs: {},
          startedAt: now - 100,
          activeStartedAt: now - 100,
        },
      ],
    })
    await contexts.pop()!.fiber.dispose()
    const recovered = await setup(pool)
    const after = recovered.get(start.id, actor)
    expect(after.status).toBe('needs-resume')
    expect(after.usage.activeMillis).toBeGreaterThanOrEqual(100)
    expect(after.nodes[0]!.activeStartedAt).toBeUndefined()
    await contexts.pop()!.fiber.dispose()
    const again = await setup(pool)
    expect(again.get(start.id, actor).usage.activeMillis).toBe(after.usage.activeMillis)
  })
  it('retries a pending control delivery using its committed identity', async () => {
    const pool = new MemoryMediaPool(),
      flows = await setup(pool)
    const definition: FlowDefinition = {
      ...root,
      nodes: [{ id: 'approval', kind: 'wait', request: {}, outputSchema: any }],
      outputs: { $ref: 'nodes.approval' },
    }
    flows.registerDefinition(definition)
    const start = await flows.start({
      definition,
      inputs: {},
      actor,
      context: 'example',
      requestId: 'control-outbox',
    })
    const waiting = await flows.settled(start.id)
    contexts.at(-1)!.on('flow/control-accepted', () => {
      throw new Error('Product delivery unavailable')
    })
    await expect(flows.control(start.id, waiting.revision, 'pause', actor)).rejects.toThrow(/unavailable/)
    const pending = Object.keys(flows.trace(start.id, actor).deliveries!)[0]!
    await contexts.pop()!.fiber.dispose()
    const recovered = await setup(pool),
      observed: string[] = []
    contexts.at(-1)!.on('flow/control-accepted', ({ commandId }) => {
      observed.push(commandId)
    })
    const record = recovered.get(start.id, actor)
    await recovered.control(start.id, record.revision, 'resume', actor)
    await recovered.settled(start.id)
    expect(observed[0]).toBe(pending)
    expect(recovered.trace(start.id, actor).deliveries![pending]!.state).toBe('delivered')
  })

  it('does not confuse conversation and request IDs containing separators', async () => {
    const flows = await setup()
    const definition: FlowDefinition = {
      ...root,
      nodes: [{ id: 'approval', kind: 'wait', request: {}, outputSchema: any }],
      outputs: { $ref: 'nodes.approval' },
    }
    flows.registerDefinition(definition)
    const one = await flows.start({
      definition,
      inputs: {},
      actor: { kind: 'human', sessionId: SessionId('source:part') },
      context: 'example',
      requestId: 'one',
    })
    const two = await flows.start({
      definition,
      inputs: {},
      actor: { kind: 'human', sessionId: SessionId('source') },
      context: 'example',
      requestId: 'part:one',
    })
    expect(two.id).not.toBe(one.id)
    expect(two.sourceSessionId).toBe('source')
    await expect(
      flows.start({ definition, inputs: {}, actor, context: 'example', requestId: '' }),
    ).rejects.toThrow(/stable request/)
  })

  it('resumes a committed undispatched write without requiring manual reconciliation', async () => {
    const pool = new MemoryMediaPool(),
      flows = await setup(pool)
    let writes = 0
    const operation: FlowOperation = {
      id: 'read',
      version: '1',
      inputSchema: any,
      outputSchema: any,
      effect: 'write',
      cancellation: 'await-settlement',
      recovery: 'manual',
      execute: async () => {
        writes++
        return { saved: true }
      },
    }
    flows.registerDefinition(root)
    flows.registerOperation(operation)
    const start = await flows.start({
      definition: root,
      inputs: {},
      actor,
      context: 'example',
      requestId: 'before-dispatch',
      deferred: true,
    })
    const table = (flows as unknown as { table: { put(id: string, value: FlowExecution): Promise<void> } })
      .table
    const { allowed_actions: _actions, ...record } = flows.get(start.id, actor)
    await table.put(start.id, {
      ...record,
      nodes: [
        {
          id: 'read',
          kind: 'call',
          operationId: start.id + '/read/1',
          attempt: 1,
          state: 'running',
          dispatchState: 'pending',
          inputs: {},
          startedAt: Date.now(),
        },
      ],
    })
    await contexts.pop()!.fiber.dispose()
    const recovered = await setup(pool)
    recovered.registerOperation(operation)
    const saved = recovered.get(start.id, actor)
    expect(saved.status).toBe('needs-resume')
    expect(saved.nodes[0]!.state).toBe('running')
    expect(writes).toBe(0)
    await recovered.control(start.id, saved.revision, 'resume', actor)
    const complete = await recovered.settled(start.id)
    expect(complete.status).toBe('succeeded')
    expect(complete.result).toEqual({ saved: true })
    expect(writes).toBe(1)
    expect(complete.nodes[0]!.operationId).toBe(start.id + '/read/1')
    expect(complete.nodes[0]!.dispatchState).toBe('dispatched')
  })
})
