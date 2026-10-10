import { reserveRequestTokens, reportedRequestTokens } from '@deepseek-ai/dsh-token-meter/request-accounting'
/** Result-only native model phases with durable message and tool-result correlation. */
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { Context } from '@deepseek-ai/cordis'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-token-meter'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  attachStructuredRuntime,
  STRUCTURED_OUTPUT_INSTRUCTION,
  STRUCTURED_OUTPUT_TOOL,
} from '@deepseek-ai/dsh-subagent-in-process-driver'
import { assertFlowValue, FlowInterruptedError, FlowModelAttemptError } from '@deepseek-ai/dsh-flow'
import type {
  FlowModelNode,
  FlowModelProvider,
  FlowModelResult,
  FlowOperationContext,
  FlowLimits,
} from '@deepseek-ai/dsh-flow'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Bind host policies to one phase scope.
     * @param payload - Exact native phase and source.
     * @mode serial
     */
    'flow/model-phase'(payload: {
      agent: Agent
      executionId: FlowOperationContext['executionId']
      sourceSessionId: SessionId
      instructions: string
      scope: Context
    }): void | Promise<void>
    /** A native phase inbox receipt has been persisted.
     * @param payload - Exact execution and destination.
     * @mode serial
     */
    'flow/model-input-accepted'(payload: {
      executionId: FlowOperationContext['executionId']
      agent: Agent
    }): void | Promise<void>
  }
}
export const name = 'flow-model-native'
export const inject = ['flows', 'agents', 'sessions', 'sessionPersistence', 'systemPrompt', 'tools']
/** Stable phase inbox identity.
 * @param context - Recorded operation identity.
 * @returns Identified native message.
 */
export function flowPhaseMessageId(context: FlowOperationContext): string {
  return 'flow-phase:' + context.operationId
}
/** Inspect a committed native phase; idle is never treated as a result.
 * @param events - Events read from native persistence.
 * @param node - Pinned phase schema.
 * @param context - Recorded operation.
 * @returns Committed structured result, if present.
 */
export function readFlowPhaseResult(
  events: readonly SessionEvent[],
  node: FlowModelNode,
  context: FlowOperationContext,
): FlowModelResult | undefined {
  let turn: number | undefined,
    currentTurn: number | undefined,
    call: { id: string; value: JsonValue } | undefined,
    accepted = false,
    tokens: number | undefined,
    invalidUsage = false
  for (const e of events) {
    if (e.type === 'turn/start') currentTurn = e.data.turn
    if (e.type === 'user/message' && e.data.id === flowPhaseMessageId(context)) turn = currentTurn
    if (turn === undefined) continue
    if (e.type === 'assistant/message' && e.data.turn === turn && e.data.usage) {
      const u = e.data.usage
      const actual = reportedRequestTokens(u)
      if (actual === undefined) invalidUsage = true
      else tokens = (tokens ?? 0) + actual
    }
    if (e.type === 'tool/call' && e.data.turn === turn && e.data.name === STRUCTURED_OUTPUT_TOOL)
      call = { id: String(e.data.callId), value: JSON.parse(e.data.arguments) as JsonValue }
    if (e.type === 'tool/result' && e.data.turn === turn)
      for (const block of e.data.message.content)
        if (String(block.toolCallId) === call?.id) accepted = !block.isError
    if (e.type === 'turn/end' && e.data.turn === turn) {
      if (e.data.reason.kind !== 'completed' || !accepted || !call) return undefined
      assertFlowValue(node.outputSchema, call.value, 'model phase result')
      return { value: call.value, ...(tokens === undefined || invalidUsage ? {} : { tokens }) }
    }
  }
  return undefined
}
function phaseUsage(events: readonly SessionEvent[], context: FlowOperationContext): number | undefined {
  let current: number | undefined,
    turn: number | undefined,
    tokens: number | undefined,
    invalidUsage = false
  for (const event of events) {
    if (event.type === 'turn/start') current = event.data.turn
    if (event.type === 'user/message' && event.data.id === flowPhaseMessageId(context)) turn = current
    if (
      turn !== undefined &&
      event.type === 'assistant/message' &&
      event.data.turn === turn &&
      event.data.usage
    ) {
      const usage = event.data.usage
      const actual = reportedRequestTokens(usage)
      if (actual === undefined) invalidUsage = true
      else tokens = (tokens ?? 0) + actual
    }
  }
  return invalidUsage ? undefined : tokens
}
/** Read committed native events without synchronous historical Session access.
 * @param ctx - Native persistence composition.
 * @param conversation - Exact recorded conversation.
 * @returns Validated committed event sequence for receipt correlation.
 */
export async function persistedFlowEvents(
  ctx: Context,
  conversation: SessionId,
): Promise<readonly SessionEvent[]> {
  const agents = ctx.get('agents'),
    sessions = ctx.get('sessions'),
    persistence = ctx.get('sessionPersistence')
  if (!agents || !sessions || !persistence) throw new Error('Native receipt services unavailable')
  const live = agents.get(conversation)
  if (live && !(await sessions.flush(live.session))) throw new Error('Native receipt could not be persisted')
  const handle = await persistence.open(conversation, 'read')
  try {
    return (await handle.read()).events
  } finally {
    await handle.close()
  }
}
function discardQueuedFlowPhases(agent: Agent): void {
  // Persisted notices are requests to the flow executor, never autonomous
  // conversation input after restoration. Completed receipts remain in the log.
  for (const message of [...agent.inbox.nextTurn, ...agent.inbox.nextStep])
    if (message.source.kind === 'plugin' && message.source.plugin === 'flow-model-native')
      agent.inbox.remove(message.id)
}
async function waitForIdle(agent: Agent, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  let cancel!: () => void
  const interrupted = new Promise<never>((_resolve, reject) => {
    cancel = () => {
      reject(
        signal.reason instanceof Error ? signal.reason : new FlowInterruptedError('Flow phase interrupted'),
      )
    }
    signal.addEventListener('abort', cancel, { once: true })
  })
  try {
    await Promise.race([agent.whenIdle(), interrupted])
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}
/** Native phase provider; only the result-reporting tool may execute. */
export class NativeFlowModelProvider implements FlowModelProvider {
  /** Mount this service in the native composition.
   * @param ctx - Native Harness composition.
   */
  constructor(private readonly ctx: Context) {}
  async reconcile(
    node: FlowModelNode,
    conversation: SessionId,
    context: FlowOperationContext,
  ): Promise<FlowModelResult | undefined> {
    return readFlowPhaseResult(await persistedFlowEvents(this.ctx, conversation), node, context)
  }

  async execute(
    node: FlowModelNode,
    inputs: JsonValue,
    conversation: SessionId,
    context: FlowOperationContext,
    limits: FlowLimits,
  ): Promise<FlowModelResult> {
    const live = this.ctx.agents.get(conversation)
    if (live && (live.status !== 'idle' || live.inbox.nextTurn.length || live.inbox.nextStep.length))
      throw new FlowInterruptedError('Ordinary conversation input pauses the flow phase')
    const restored = live
      ? undefined
      : await this.ctx.agents.resume({
        resumeSessionId: conversation,
        signal: context.signal,
        setup(_scope, restoredAgent) {
          discardQueuedFlowPhases(restoredAgent)
          if (restoredAgent.inbox.nextTurn.length || restoredAgent.inbox.nextStep.length)
            throw new FlowInterruptedError('Queued designer input pauses the flow phase')
        },
      })
    // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
    const agent = live ?? restored!.agent
    let retainRestored = false
    try {
      await waitForIdle(agent, context.signal)
      context.signal.throwIfAborted()
      if (agent.inbox.nextTurn.length || agent.inbox.nextStep.length)
        throw new Error('Conversation has competing input')
      const abort = new AbortController(),
        signal = AbortSignal.any([context.signal, abort.signal])
      const messageId = MessageId(flowPhaseMessageId(context))
      let entered = false,
        completed = false,
        failed: string | undefined,
        requests = 0
      let streamedTokens: number | undefined
      const heldInput: UserMessage[] = []
      const host = this.ctx
      const plugin = await agent.ctx.plugin({
        name: 'flow-native-phase',
        async apply(scope: Context) {
          await host.serial('flow/model-phase', {
            agent,
            executionId: context.executionId,
            sourceSessionId: context.sourceSessionId,
            instructions: node.instructions + '\n\n' + STRUCTURED_OUTPUT_INSTRUCTION,
            scope,
          })
          attachStructuredRuntime(scope, node.outputSchema)
          scope.systemPrompt.suppressRuntimeContext()
          if (scope.tools.modeFor(agent) !== 'native')
            throw new Error('Native flow model phases require native tool presentation')
          scope.tools.guard(
            exec =>
              failed ??
              (exec.name === STRUCTURED_OUTPUT_TOOL
                ? undefined
                : 'Flow model phases can only report their typed result'),
          )
          scope.on('agent/inbox/inserted', ({ agent: subject, message }) => {
            if (subject === agent && message.id !== messageId) {
              if (agent.inbox.remove(message.id)) heldInput.push(message)
              failed = 'Designer input interrupted the flow phase'
              abort.abort()
            }
          })
          scope.on('agent/pre-step', async ({ agent: subject, step }, next) => {
            if (subject === agent && (failed || step > 1)) return { kind: 'reject' }
            return next()
          })
          scope.on('system-prompt/assemble', async (_assembly, assembleContext, next) => {
            const assembled = await next()
            return assembleContext.scope === agent
              ? {
                ...assembled,
                tools: assembled.tools.filter(tool => tool.name === STRUCTURED_OUTPUT_TOOL),
              }
              : assembled
          })
          scope.on('agent/request', async (payload, next) => {
            const options = await next()
            if (payload.agent !== agent) return options
            const route = host.flows.get(context.executionId, {
              kind: 'host',
              sessionId: context.sourceSessionId,
            }).modelOptions
            const pinned = route && typeof route === 'object' && !Array.isArray(route) ? route : {}
            return {
              ...options,
              ...(typeof pinned.provider === 'string' ? { provider: pinned.provider } : {}),
              ...(typeof pinned.model === 'string' ? { model: pinned.model } : {}),
              ...(typeof pinned.reasoningEffort === 'string'
                ? {
                  reasoningEffort:
                      pinned.reasoningEffort as import('@deepseek-ai/dsh-llm').ReasoningEffortId,
                }
                : {}),
              maxTokens: limits.maxOutputTokens,
            }
          })
          scope.on('llm/stream', async function* (options, next) {
            try {
              if (scope.agents.currentInitiator() === agent) {
                if (++requests > 1) throw new Error('Flow phase permits one model request')
                await host.flows.reserveModelEnvelope(
                  context.executionId,
                  context.operationId,
                  reserveRequestTokens(
                    { messages: options.messages, system: options.system, tools: options.tools },
                    options.maxTokens ?? limits.maxOutputTokens,
                    host.get('tokenMeter')?.measure(agent.session).totalTokens ?? 0,
                  ),
                )
              }
              for await (const chunk of next()) {
                if (scope.agents.currentInitiator() === agent && chunk.type === 'usage')
                  streamedTokens = reportedRequestTokens(chunk.usage)
                if (chunk.type === 'finish' && ['error', 'aborted'].includes(chunk.reason.kind)) {
                  failed = 'Flow model provider failed'
                  abort.abort()
                }
                yield chunk
              }
            } catch (error) {
              failed = String(error)
              abort.abort()
              throw error
            }
          })
          scope.on('tools/result', (exec, result) => {
            if (exec.agent === agent && result.isError) {
              failed = result.error.message
              abort.abort()
            }
          })
          scope.systemPrompt.section({
            name: 'flow:phase',
            order: 190,
            interpolate: false,
            text: node.instructions,
          })
        },
      })
      const cancel = (): void => {
        agent.cancel({ kind: 'parent' }, { keepInbox: true })
        agent.inbox.remove(messageId)
      }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        signal.throwIfAborted()
        agent.followup(
          freezeMessage({
            role: 'user',
            id: messageId,
            content: [
              {
                type: 'text',
                text: JSON.stringify({ flow_execution: context.executionId, phase: context.nodeId, inputs }),
              },
            ],
            source: {
              kind: 'plugin',
              plugin: 'flow-model-native',
              form: 'notice',
              summary: 'Flow model phase',
            },
          }),
        )
        entered = true
        if (!(await this.ctx.sessions.flush(agent.session)))
          throw new Error('Flow model input could not be persisted')
        await this.ctx.serial('flow/model-input-accepted', { executionId: context.executionId, agent })
        await agent.whenIdle()
        if (!(await this.ctx.sessions.flush(agent.session)))
          throw new Error('Flow model result could not be persisted')
        if (heldInput.length)
          throw new FlowInterruptedError(
            failed ?? 'Designer input interrupted the phase',
            phaseUsage(await persistedFlowEvents(this.ctx, conversation), context) ?? streamedTokens,
          )
        if (failed) throw new Error(failed)
        const result = readFlowPhaseResult(await persistedFlowEvents(this.ctx, conversation), node, context)
        if (!result) throw new Error('Flow model phase has no committed typed result')
        completed = true
        return result
      } catch (error) {
        if (error instanceof FlowInterruptedError) throw error
        throw new FlowModelAttemptError(
          error instanceof Error ? error.message : String(error),
          phaseUsage(await persistedFlowEvents(this.ctx, conversation), context) ?? streamedTokens,
        )
      } finally {
        signal.removeEventListener('abort', cancel)
        if (entered && !completed) {
          cancel()
          await agent.whenIdle()
        }
        await plugin.dispose()
        for (const message of heldInput) agent.followup(message)
        retainRestored = heldInput.length > 0
      }
    } finally {
      if (restored && !retainRestored) await restored.dispose()
    }
  }
}
/** Register the native phase provider as a reversible effect.
 * @param ctx - Native composition.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.flows.registerModelProvider(new NativeFlowModelProvider(ctx)))
  ctx.on('agent/created', ({ agent }) => {
    discardQueuedFlowPhases(agent)
  })
}
