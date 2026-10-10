/** Real Loader composition; only model responses are scripted. */
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PassThrough } from 'node:stream'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { HarnessSdkJsonRpcServer } from '@deepseek-ai/dsh-sdk-jsonrpc-server'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, {
  LlmAdapter,
  resolveRetryPolicy,
  ToolCallId,
  MessageId,
  freezeMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Flows, { FlowController } from '../../flow-runtime/src/index.ts'
import Typert from '@deepseek-ai/dsh-typert-registry'
import * as Native from '../src/index.ts'
import * as FlowTools from '../../tool-flow/src/index.ts'
import * as Example from '../../flow-yaml/src/example.ts'
import Invariants from '@deepseek-ai/dsh-invariants'
import * as NativeInvariant from '../src/invariant.ts'
import Goals from '@deepseek-ai/dsh-goal'
import * as Retry from '@deepseek-ai/dsh-llm-retry'
const contexts: Context[] = [],
  roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
class Adapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  providerFailure = false
  unexpectedTool = false
  bad = false
  block = false
  entered?: () => void
  override providerRetryPolicy() {
    return resolveRetryPolicy({ mode: 'normal', maxRetries: 1, retryableCodes: ['SERVER'], backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } }, 'native phase test')
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const phase = options.messages.at(-1)?.source.kind === 'plugin'
    if (phase && this.block) {
      this.entered?.()
      await new Promise<void>((resolve) => {
        options.signal!.addEventListener(
          'abort',
          () => {
            resolve()
          },
          { once: true },
        )
      })
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    if (phase && this.providerFailure) {
      yield { type: 'usage', usage: { inputTokens: 70, outputTokens: 0 } }
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { message: 'Provider unavailable', code: 'SERVER' } },
      }
      return
    }
    const tool = phase ? (this.unexpectedTool ? 'analyze_text' : 'structured_output') : 'analyze_text'
    const text = options.messages.at(-1)?.content.find(b => b.type === 'text')
    if (!phase && text?.type === 'text' && text.text === 'Steering') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Steering received.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const value = phase
      ? this.bad
        ? { wrong: true }
        : { summary: 'Two text lines.' }
      : { text: 'one two\nthree four', include_summary: true }
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield {
      type: 'block-end',
      index: 0,
      block: {
        type: 'tool-call',
        id: ToolCallId(randomUUID()),
        name: tool,
        arguments: JSON.stringify(value),
      },
    }
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}
async function boot() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-flow-native-'))
  roots.push(directory)
  const ctx = new Context()
  contexts.push(ctx)
  const modules = new Map<string, unknown>([
    ['llm', Llm],
    ['sessions', Sessions],
    ['projections', Projections],
    ['system-prompt', SystemPrompt],
    ['tools', Tools],
    ['agents', AgentRegistry],
    ['persistence', Persistence],
    ['storage', Storage],
    ['sqlite', StorageSqlite],
    ['domains', StorageDomain],
    ['flows', Flows],
    ['invariants', Invariants],
    ['native', Native],
    ['native-invariant', NativeInvariant],
    ['flow-tools', FlowTools],
    ['example', Example],
    ['loop', AgentLoop],
    ['goals', Goals],
    ['retry', Retry],
    ['typert', Typert],
    ['flow-controller', FlowController],
  ])
  const configs: Record<string, unknown> = {
    persistence: { root: join(directory, 'sessions'), compression: 'none' },
    sqlite: { path: join(directory, 'flows.sqlite3') },
    domains: { backend: 'sqlite' },
    loop: { agents: [] },
    flows: {
      maxRequests: 4,
      maxTokens: 100000,
      maxActiveMillis: 20000,
      maxOutputTokens: 1024,
      maxRetainedBytes: 1000000,
      maxExpandedNodes: 30,
    },
    'flow-tools': { context: 'example' },
  }
  const path = join(directory, 'cordis.yml')
  await writeFile(
    path,
    [...modules.keys()]
      .map(
        name => '- name: ' + name + (configs[name] ? '\n  config: ' + JSON.stringify(configs[name]) : ''),
      )
      .join('\n'),
  )
  ctx.baseUrl = pathToFileURL(directory).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('Unexpected module ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
  await ctx.loader.await()
  for (const row of ctx.loader.entries()) await row.fiber?.await()
  await ctx.flows.ready
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const handle = await ctx.agents.create({
    sessionId: SessionId(randomUUID()),
    agentOptions: { provider: 'mock', model: 'mock' },
  })
  return { ctx, adapter, agent: handle.agent, directory, handle }
}
describe('native flows', () => {
  it('selects a named tool and executes a typed model phase with no domain tools', async () => {
    const { ctx, adapter, agent } = await boot()
    agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'Analyze text' }], source: { kind: 'user' } }),
    )
    await agent.whenIdle()
    const execution = ctx.flows.list({ kind: 'human', sessionId: agent.id })[0]!
    const result = await ctx.flows.settled(execution.id)
    expect(result.status, result.error).toBe('succeeded')
    expect(result.result).toEqual({ lines: 2, words: 4, summary: 'Two text lines.' })
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[1]!.tools?.map(tool => tool.name)).toEqual(['structured_output'])
    expect(agent.ctx.tools.get('structured_output', agent)).toBeUndefined()
    expect(result.usage.requests).toBe(1)
    expect(result.usage.tokens).toBe(120)
  })
  it('does not call a model on the counts-only branch', async () => {
    const { ctx, adapter, agent } = await boot()
    const start = await ctx.flows.start({
      definition: { id: 'example.analyze_text', version: '1.0.0' },
      inputs: { text: 'one two\nthree', include_summary: false },
      actor: { kind: 'human', sessionId: agent.id },
      context: 'example',
      requestId: 'count',
    })
    expect((await ctx.flows.settled(start.id)).result).toEqual({ lines: 2, words: 3, summary: null })
    expect(adapter.requests).toHaveLength(0)
  })
  it('stops malformed output without a correction request', async () => {
    const { ctx, adapter, agent } = await boot()
    adapter.bad = true
    const start = await ctx.flows.start({
      definition: { id: 'example.analyze_text', version: '1.0.0' },
      inputs: { text: 'text', include_summary: true },
      actor: { kind: 'human', sessionId: agent.id },
      context: 'example',
      requestId: 'bad',
    })
    const result = await ctx.flows.settled(start.id)
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/wrong|summary|output|schema|typed result/)
    expect(adapter.requests).toHaveLength(1)
    expect(agent.ctx.tools.get('structured_output', agent)).toBeUndefined()
  })
  it('rejects changed committed output against native receipts, including a closed conversation', async () => {
    const { ctx, adapter, agent, handle } = await boot()
    const start = await ctx.flows.start({
      definition: { id: 'example.analyze_text', version: '1.0.0' },
      inputs: { text: 'text', include_summary: true },
      actor: { kind: 'human', sessionId: agent.id },
      context: 'example',
      requestId: 'receipt',
    })
    const result = await ctx.flows.settled(start.id)
    expect(result.status).toBe('succeeded')
    const changed = { ...result, nodes: result.nodes.map(node => node.kind === 'model' ? { ...node, output: { summary: 'Changed outside the model receipt.' } } : node) }
    await expect(ctx.parallel('flow/changed', changed)).rejects.toMatchObject({ errors: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('native structured-result receipt') })]) })
    await handle.dispose()
    await expect(ctx.parallel('flow/changed', changed)).rejects.toMatchObject({ errors: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('native structured-result receipt') })]) })
    expect(adapter.requests).toHaveLength(1)
    expect(ctx.flows.get(start.id, { kind: 'human', sessionId: agent.id }).result).toEqual(result.result)
  })
  it('reports a rejected request reservation without provider access or correction', async () => {
    const { ctx, adapter, agent } = await boot()
    vi.spyOn(ctx.flows, 'reserveModelEnvelope').mockRejectedValueOnce(new Error('Native request exceeds flow token budget'))
    const start = await ctx.flows.start({
      definition: { id: 'example.analyze_text', version: '1.0.0' },
      inputs: { text: 'text', include_summary: true },
      actor: { kind: 'human', sessionId: agent.id },
      context: 'example',
      requestId: 'reservation',
    })
    const result = await ctx.flows.settled(start.id)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('Native request exceeds flow token budget')
    expect(adapter.requests).toHaveLength(0)
    expect(agent.ctx.tools.get('structured_output', agent)).toBeUndefined()
  })
  it('pauses on ordinary input and preserves it outside the phase', async () => {
    const { ctx, adapter, agent } = await boot()
    adapter.block = true
    const entered = new Promise<void>((resolve) => {
      adapter.entered = resolve
    })
    const start = await ctx.flows.start({
      definition: { id: 'example.analyze_text', version: '1.0.0' },
      inputs: { text: 'text', include_summary: true },
      actor: { kind: 'human', sessionId: agent.id },
      context: 'example',
      requestId: 'steering',
    })
    await entered
    const input = createUserMessage({
      content: [{ type: 'text', text: 'Steering' }],
      source: { kind: 'user' },
    })
    agent.followup(input)
    await vi.waitFor(() => {
      expect(ctx.flows.get(start.id, { kind: 'human', sessionId: agent.id }).status).toBe('paused')
    })
    await agent.whenIdle()
    expect(
      Array.from({ length: agent.session.seq }, (_, i) => agent.session.eventAt(SessionSeq(i))).some(
        e => e?.type === 'user/message' && e.data.id === input.id,
      ),
    ).toBe(true)
    expect(agent.ctx.tools.get('structured_output', agent)).toBeUndefined()
    adapter.block = false
    const actor = { kind: 'human' as const, sessionId: agent.id },
      paused = ctx.flows.get(start.id, actor)
    await ctx.flows.control(start.id, paused.revision, 'resume', actor)
    const finished = await ctx.flows.settled(start.id)
    expect(finished.status, finished.error).toBe('succeeded')
    const attempts = finished.nodes.filter(node => node.kind === 'model')
    expect(attempts.map(node => node.state)).toEqual(['unknown', 'succeeded'])
    expect(attempts[0]!.output).toBeUndefined()
    expect(finished.usage.requests).toBe(2)
  })
  it.each(['providerFailure', 'unexpectedTool'] as const)(
    'ends %s without another phase request',
    async (fault) => {
      const { ctx, adapter, agent } = await boot()
      adapter[fault] = true
      const start = await ctx.flows.start({
        definition: { id: 'example.analyze_text', version: '1.0.0' },
        inputs: { text: 'text', include_summary: true },
        actor: { kind: 'human', sessionId: agent.id },
        context: 'example',
        requestId: fault,
      })
      const finished = await ctx.flows.settled(start.id)
      expect(finished.status).toBe('failed')
      expect(adapter.requests).toHaveLength(1)
      if (fault === 'providerFailure') expect(finished.usage.tokens).toBe(70)
      expect(agent.ctx.tools.get('structured_output', agent)).toBeUndefined()
    },
  )
  it('controls durable flows through the real SDK JSON-RPC transport', async () => {
    const { ctx, adapter } = await boot()
    const inbound = new PassThrough(),
      outbound = new PassThrough()
    const host = new JsonRpcLineTransport(inbound, outbound),
      client = new JsonRpcLineTransport(outbound, inbound)
    const server = new HarnessSdkJsonRpcServer(ctx, host),
      progress: unknown[] = []
    host.onRequest((method, params) => server.handleRequest(method, params))
    client.onNotification((method, params) => {
      if (method === 'flow.progress') progress.push(params)
    })
    host.start()
    client.start()
    try {
      await client.request('initialize', { cwd: process.cwd(), provider: 'mock', model: 'mock' })
      ctx.flows.registerDefinition({
        id: 'sdk.wait',
        version: '1',
        description: 'Await a typed human decision.',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        publication: { toolName: 'sdk_wait', contexts: ['example'] },
        nodes: [
          {
            id: 'decision',
            kind: 'wait',
            request: { question: 'Continue?' },
            outputSchema: { type: 'object' },
          },
        ],
        outputs: { $ref: 'nodes.decision' },
      })
      const start = (await client.request('flow/start', {
        sessionId: 'sdk-flow-source',
        definition: { id: 'sdk.wait', version: '1' },
        context: 'example',
        inputs: {},
        requestId: 'one',
      })) as { id: import('@deepseek-ai/dsh-flow').FlowExecutionId }
      const pending = await ctx.flows.settled(start.id)
      expect(
        await client.request('flow/get', { sessionId: 'sdk-flow-source', executionId: start.id }),
      ).toMatchObject({ status: 'waiting' })
      await expect(
        client.request('flow/control', {
          sessionId: 'sdk-flow-source',
          executionId: start.id,
          revision: pending.revision - 1,
          command: 'pause',
        }),
      ).rejects.toThrow(/Stale/)
      await expect(
        client.request('flow/get', { sessionId: 'foreign', executionId: start.id }),
      ).rejects.toThrow(/another conversation/)
      const paused = (await client.request('flow/control', {
        sessionId: 'sdk-flow-source',
        executionId: start.id,
        revision: pending.revision,
        command: 'pause',
      })) as { revision: number }
      const waiting = (await client.request('flow/control', {
        sessionId: 'sdk-flow-source',
        executionId: start.id,
        revision: paused.revision,
        command: 'resume',
      })) as { revision: number }
      await client.request('flow/answer', {
        sessionId: 'sdk-flow-source',
        executionId: start.id,
        revision: waiting.revision,
        waitId: pending.pending!.id,
        deliveryId: 'human-one',
        value: { approved: true },
      })
      await ctx.flows.settled(start.id)
      expect(
        await client.request('flow/trace', { sessionId: 'sdk-flow-source', executionId: start.id }),
      ).toMatchObject({ status: 'succeeded', result: { approved: true } })
      expect(await client.request('flow/list', { sessionId: 'sdk-flow-source' })).toHaveLength(1)
      expect(progress.length).toBeGreaterThan(0)
      expect(adapter.requests).toHaveLength(0)
    } finally {
      await server.shutdown()
      host.close()
      client.close()
    }
  })

  it('drops a persisted phase notice before restored conversation work and preserves designer input', async () => {
    const { ctx, adapter } = await boot(),
      id = SessionId(randomUUID())
    // This native session is closed with an unclaimed inbox, the boundary left
    // by process loss before phase dispatch. No Agent or provider stub drives it.
    const session = ctx.sessions.prepare(id, { meta: { cwd: process.cwd() } })
    const detach = ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    const phase = freezeMessage({
      role: 'user',
      id: MessageId('flow-phase:lost/interpret/1'),
      content: [{ type: 'text', text: 'Old phase' }],
      source: { kind: 'plugin', plugin: 'flow-model-native', form: 'notice', summary: 'Old phase' },
    })
    const designer = createUserMessage({
      content: [{ type: 'text', text: 'Steering' }],
      source: { kind: 'user' },
    })
    session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [phase, designer] })
    const writer = await ctx.sessionPersistence.create(session.header)
    await writer.append(Array.from({ length: session.seq }, (_, i) => session.eventAt(SessionSeq(i))!))
    await writer.flush()
    await writer.close()
    detach()
    const restored = await ctx.agents.resume({
      resumeSessionId: id,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    try {
      await restored.agent.whenIdle()
      expect(adapter.requests).toHaveLength(0)
      expect(restored.agent.inbox.nextTurn.map(message => message.id)).toEqual([designer.id])
      restored.agent.followup(
        createUserMessage({ content: [{ type: 'text', text: 'Steering' }], source: { kind: 'user' } }),
      )
      await restored.agent.whenIdle()
      expect(adapter.requests).toHaveLength(2)
      for (const request of adapter.requests) {
        expect(request.messages.at(-1)?.source.kind).toBe('user')
        expect(request.messages.at(-1)?.content).toEqual(designer.content)
      }
      expect(
        Array.from({ length: restored.agent.session.seq }, (_, i) =>
          restored.agent.session.eventAt(SessionSeq(i)),
        ).some(e => e?.type === 'user/message' && e.data.id === phase.id),
      ).toBe(false)
    } finally {
      await restored.dispose()
    }
  })
  it('serves browser controls through the native remote service and shared commands', async () => {
    const { ctx, agent, adapter } = await boot()
    const controller = ctx.get('flowController')!
    ctx.flows.registerDefinition({ id: 'browser.wait', version: '1', description: 'Await a typed decision.', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, publication: { toolName: 'browser_wait', contexts: ['example'] }, nodes: [{ id: 'decision', kind: 'wait', request: { question: 'Continue?' }, outputSchema: { type: 'object' } }], outputs: { $ref: 'nodes.decision' } })
    const accepted = await controller.start(agent, { id: 'browser.wait', version: '1' }, 'example', {}, 'browser-one')
    const waiting = await ctx.flows.settled(accepted.id)
    expect(await controller.get(agent, accepted.id)).toMatchObject({ status: 'waiting' })
    expect(await controller.list(agent)).toHaveLength(1)
    await expect(controller.control(agent, accepted.id, waiting.revision - 1, 'pause')).rejects.toThrow(/Stale/)
    const paused = await controller.control(agent, accepted.id, waiting.revision, 'pause')
    const resumed = await controller.control(agent, accepted.id, paused.revision, 'resume')
    await controller.answer(agent, accepted.id, resumed.revision, waiting.pending!.id, 'browser-decision', { approved: true })
    await ctx.flows.settled(accepted.id)
    expect(await controller.trace(agent, accepted.id)).toMatchObject({ status: 'succeeded', result: { approved: true } })
    expect(adapter.requests).toHaveLength(0)
  })

})
