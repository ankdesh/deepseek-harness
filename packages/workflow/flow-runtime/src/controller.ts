/** Human-facing scoped control over the same flow commands used by model tools. */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { FlowControl, FlowExecutionId, FlowRef, FlowSummary } from '@deepseek-ai/dsh-flow/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import { summarizeFlow as summary } from '@deepseek-ai/dsh-flow'
/** Optional Typert consumer; transport callers cannot set execution state. */
export class FlowController extends TypertRemoteService {
  static inject = ['flows', 'typert']
  /** Mount this service in the native composition.
   * @param ctx - Native remote composition.
   */
  constructor(ctx: Context) {
    super(ctx, 'flowController', { namespace: 'flows' })
  }
  /** Use the declared caller and configuration.
   * @param agent - Resolved caller.
   * @param definition - Published pinned version.
   * @param context - Eligible deployment context.
   * @param inputs - Typed arguments.
   * @param requestId - Stable caller identity.
   * @returns Accepted execution summary.
   */
  @Remote('start')
  async start(
    agent: Agent,
    definition: FlowRef,
    context: string,
    inputs: JsonValue,
    requestId: string,
  ): Promise<FlowSummary> {
    return summary(
      await this.ctx.flows.start({
        definition,
        context,
        inputs,
        requestId,
        actor: { kind: 'human', sessionId: agent.id },
      }),
    )
  }
  /** Use the declared caller and configuration.
   * @param agent - Resolved caller.
   * @param id - Execution identity.
   * @returns Its current summary.
   */
  @Remote('get')
  async get(agent: Agent, id: FlowExecutionId): Promise<FlowSummary> {
    await this.ctx.flows.ready
    return summary(this.ctx.flows.get(id, { kind: 'human', sessionId: agent.id }))
  }
  /** Use the declared caller and configuration.
   * @param agent - Resolved caller conversation.
   * @returns Its recent execution summaries.
   */
  @Remote('list')
  async list(agent: Agent): Promise<FlowSummary[]> {
    await this.ctx.flows.ready
    return this.ctx.flows.list({ kind: 'human', sessionId: agent.id }).slice(-10).map(summary)
  }
  /** Use the declared caller and configuration.
   * @param agent - Resolved caller.
   * @param id - Execution.
   * @param revision - Observed revision.
   * @param command - Human command.
   * @returns Committed summary.
   */
  @Remote('control')
  async control(
    agent: Agent,
    id: FlowExecutionId,
    revision: number,
    command: FlowControl,
  ): Promise<FlowSummary> {
    return summary(
      await this.ctx.flows.control(id, revision, command, { kind: 'human', sessionId: agent.id }),
    )
  }
  /** Use the declared caller and configuration.
   * @param agent - Resolved caller.
   * @param id - Execution.
   * @param revision - Observed revision.
   * @param waitId - Exact wait.
   * @param deliveryId - Stable response.
   * @param value - Typed response.
   * @returns Committed summary.
   */
  @Remote('answer')
  async answer(
    agent: Agent,
    id: FlowExecutionId,
    revision: number,
    waitId: string,
    deliveryId: string,
    value: JsonValue,
  ): Promise<FlowSummary> {
    return summary(
      await this.ctx.flows.answer(id, revision, waitId, deliveryId, value, {
        kind: 'human',
        sessionId: agent.id,
      }),
    )
  }
  /** Use the declared caller and configuration.
   * @param agent - Resolved caller.
   * @param id - Execution.
   * @returns Offline trace, without model or service access.
   */
  @Remote('trace')
  async trace(agent: Agent, id: FlowExecutionId): Promise<JsonValue> {
    await this.ctx.flows.ready
    return snapshotJsonValue(
      this.ctx.flows.trace(id, { kind: 'human', sessionId: agent.id }),
    ) as unknown as JsonValue
  }
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    flowController: FlowController
  }
}
export default FlowController
