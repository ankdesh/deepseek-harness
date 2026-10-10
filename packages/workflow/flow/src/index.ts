/** Generic flow capability and its typed authoring API. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  CompiledFlow,
  FlowActor,
  FlowControl,
  FlowDefinition,
  FlowExecutionId,
  FlowModelProvider,
  FlowOperation,
  FlowRef,
  FlowStart,
  FlowView,
} from './types.ts'
export type * from './types.ts'
export {
  defineFlow,
  defineOperation,
  compileFlow,
  resolveFlowValue,
  flowDigest,
  flowKey,
  assertFlowValue,
} from './compiler.ts'
declare module '@deepseek-ai/cordis' {
  interface Context {
    flows: FlowRuntime
  }
  interface Events {
    /** Catalog contributions changed.
     * @mode emit
     */
    'flow/catalog-changed'(): void
    /** A durable execution revision committed.
     * @param value - Committed execution.
     * @mode parallel
     */
    'flow/changed'(value: FlowView): void | Promise<void>
    /** A committed control awaits trusted host delivery.
     * @param payload - Pinned command identity and caller.
     * @mode serial
     */
    'flow/control-accepted'(payload: {
      flow: FlowView
      command: FlowControl
      commandId: string
      actor: FlowActor
    }): void | Promise<void>
  }
}
/** Swappable executor; consumers never select arbitrary next states. */
export abstract class FlowRuntime extends Service {
  /** Provider startup and recovery barrier. */
  abstract readonly ready: Promise<void>
  /** Mount this service in the native composition.
   * @param ctx - Plugin context.
   */
  constructor(ctx: Context) {
    super(ctx, 'flows')
  }
  /** Register an immutable developer definition.
   * @param definition - Developer-authored definition.
   * @returns Registration disposer.
   */
  abstract registerDefinition(definition: FlowDefinition): () => void
  /** Register a versioned typed operation.
   * @param operation - Registered operation.
   * @returns Registration disposer.
   */
  abstract registerOperation(operation: FlowOperation): () => void
  /** Register the native model phase provider.
   * @param provider - Model phase executor.
   * @returns Registration disposer.
   */
  abstract registerModelProvider(provider: FlowModelProvider): () => void
  /** Read definitions published for the selected caller context.
   * @param context - Caller domain context.
   * @returns Published exact definitions.
   */
  abstract catalog(context: string): readonly FlowDefinition[]
  /** Validate and pin a definition without external effects.
   * @param ref - Exact definition.
   * @returns Validated compiled graph.
   */
  abstract compile(ref: FlowRef): CompiledFlow
  /** Record an authorized execution and return acceptance.
   * @param request - Authorized invocation.
   * @returns Accepted durable execution.
   */
  abstract start(request: FlowStart): Promise<FlowView>
  /** Read an execution in the caller conversation.
   * @param id - Execution.
   * @param actor - Derived caller.
   * @returns Current authorized state.
   */
  abstract get(id: FlowExecutionId, actor: FlowActor): FlowView
  /** List recent executions in the caller conversation.
   * @param actor - Derived caller.
   * @returns Executions in the caller's conversations.
   */
  abstract list(actor: FlowActor): readonly FlowView[]
  /** Check whether a flow claims this conversation.
   * @param session - Participant.
   * @returns Whether a nonterminal execution claims it.
   */
  abstract active(session: SessionId): boolean
  /** Await a decision or terminal result.
   * @param id - Accepted execution.
   * @returns Settles at the first wait or terminal result.
   */
  abstract settled(id: FlowExecutionId): Promise<FlowView>
  /** Reserve actual native request bytes before provider access.
   * @param id - Execution.
   * @param operationId - Exact model attempt.
   * @param tokens - Conservative input/output capacity.
   */
  abstract reserveModelEnvelope(id: FlowExecutionId, operationId: string, tokens: number): Promise<void>
  /** Advance an accepted execution after its initiating turn settles.
   * @param id - Accepted execution whose initiating turn committed.
   */
  abstract advance(id: FlowExecutionId): void
  /** Apply a revision-checked human or trusted host control.
   * @param id - Execution.
   * @param revision - Observed revision.
   * @param command - Human command.
   * @param actor - Caller.
   * @returns Committed state.
   */
  abstract control(
    id: FlowExecutionId,
    revision: number,
    command: FlowControl,
    actor: FlowActor,
  ): Promise<FlowView>
  /** Commit the typed response to an exact pending wait.
   * @param id - Execution.
   * @param revision - Observed revision.
   * @param waitId - Exact wait.
   * @param deliveryId - Stable decision.
   * @param value - Typed decision.
   * @param actor - Caller.
   * @returns Committed state.
   */
  abstract answer(
    id: FlowExecutionId,
    revision: number,
    waitId: string,
    deliveryId: string,
    value: JsonValue,
    actor: FlowActor,
  ): Promise<FlowView>
  /** Report a correlated wait's current diagnostic without changing progress.
   * @param id - Execution.
   * @param revision - Observed revision.
   * @param waitId - Exact wait.
   * @param message - Current read failure, or undefined when resolved.
   * @param actor - Trusted caller.
   * @returns Committed view.
   */
  abstract reportWaitDiagnostic(
    id: FlowExecutionId,
    revision: number,
    waitId: string,
    message: string | undefined,
    actor: FlowActor,
  ): Promise<FlowView>
  /** Read an offline trace without invoking external effects.
   * @param id - Execution.
   * @param actor - Caller.
   * @returns Offline trace without invoking effects.
   */
  abstract trace(id: FlowExecutionId, actor: FlowActor): FlowView
}
export default FlowRuntime

export { summarizeFlow } from './summary.ts'

/** A native human input interrupted a phase; explicit Resume may start a new attempt. */
export class FlowModelAttemptError extends Error {
  /** Mount this service in the native composition.
   * @param message - First attempt failure.
   * @param tokens - Correlated provider usage, when recorded.
   */
  constructor(
    message: string,
    readonly tokens?: number,
  ) {
    super(message)
  }
}
/** Ordinary input pauses a phase and retains its recorded spending. */
export class FlowInterruptedError extends FlowModelAttemptError {}
