/** Serializable flow definitions and execution records. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { JsonSchemaNode, ObjectJsonSchema } from '@deepseek-ai/dsh-tools/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Exact registered definition identity. */
export interface FlowRef {
  readonly id: string
  readonly version: string
}
/** Opaque execution identity. */
export type FlowExecutionId = Branded<'FlowExecutionId'>
/** A literal JSON value or a typed reference, recursively composed. */
export type FlowValue = JsonValue
/** Shared node identity and successor; null finishes the local flow. */
export interface FlowNodeBase {
  readonly id: string
  readonly next?: string | null
  readonly result?: FlowValue
}
/** One invocation of a registered operation. */
export interface FlowCallNode extends FlowNodeBase {
  readonly kind: 'call'
  readonly operation: FlowRef
  readonly inputs: FlowValue
}
/** One result-only native model request. */
export interface FlowModelNode extends FlowNodeBase {
  readonly kind: 'model'
  readonly instructions: string
  readonly inputs: FlowValue
  readonly outputSchema: ObjectJsonSchema
  readonly conversation?: FlowValue
}
/** Correlated external decision; the trusted adapter supplies its result. */
export interface FlowWaitNode extends FlowNodeBase {
  readonly kind: 'wait'
  readonly request: FlowValue
  readonly outputSchema: JsonSchemaNode
}
/** Equality selects one declared successor. */
export interface FlowBranchNode extends FlowNodeBase {
  readonly kind: 'branch'
  readonly value: FlowValue
  readonly equals: JsonValue
  readonly then: string | null
  readonly otherwise: string | null
}
/** A reusable definition, resolved at compilation. */
export interface FlowSubflowNode extends FlowNodeBase {
  readonly kind: 'flow'
  readonly flow: FlowRef
  readonly inputs: FlowValue
}
/** Supported acyclic control nodes. */
export type FlowNode = FlowCallNode | FlowModelNode | FlowWaitNode | FlowBranchNode | FlowSubflowNode
/** Developer-authored reusable definition. */
export interface FlowDefinition extends FlowRef {
  readonly description: string
  readonly inputSchema: ObjectJsonSchema
  readonly outputSchema: JsonSchemaNode
  readonly nodes: readonly FlowNode[]
  readonly outputs: FlowValue
  readonly publication?: { readonly toolName: string; readonly contexts: readonly string[] }
}
/** Fully resolved, immutable graph; compilation performs no external work. */
export interface CompiledFlow extends FlowDefinition {
  readonly digest: string
  readonly subflows: Readonly<Record<string, CompiledFlow>>
  readonly operations: Readonly<Record<string, string>>
  readonly expandedNodes: number
}
/** Required deployment bounds, shared by subflows and subsequent attempts. */
export interface FlowLimits {
  readonly maxRequests: number
  readonly maxTokens: number
  readonly maxActiveMillis: number
  readonly maxOutputTokens: number
  readonly maxRetainedBytes: number
  readonly maxExpandedNodes: number
}
/** Durable state independent of product decision states. */
export type FlowStatus =
  | 'running'
  | 'waiting'
  | 'paused'
  | 'needs-resume'
  | 'needs-reconcile'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
/** A durable operation attempt, including the exact submitted arguments. */
export interface FlowNodeRecord {
  readonly id: string
  readonly kind: FlowNode['kind']
  readonly operationId: string
  readonly attempt: number
  readonly state: 'running' | 'waiting' | 'succeeded' | 'failed' | 'unknown'
  readonly inputs: JsonValue
  readonly startedAt: number
  readonly completedAt?: number
  readonly dispatchState?: 'pending' | 'dispatched'
  readonly activeStartedAt?: number
  readonly activeMillis?: number
  readonly output?: JsonValue
  readonly error?: string
  readonly tokens?: number
  readonly usageReported?: boolean
  readonly reservedTokens?: number
  readonly reservationSettled?: boolean
}
/** One local graph frame; subflows share one execution. */
export interface FlowFrame {
  readonly path: string
  readonly definition: CompiledFlow
  readonly inputs: JsonValue
  readonly node: string | null
  readonly outputs: Readonly<Record<string, JsonValue>>
  readonly result?: JsonValue
}
/** Exact external response correlation. */
export interface FlowPending {
  readonly id: string
  readonly nodeId: string
  readonly request: JsonValue
  readonly schema: JsonSchemaNode
}
/** Persisted execution and all data needed for offline inspection. */
export interface FlowExecution {
  readonly id: FlowExecutionId
  readonly revision: number
  readonly definition: CompiledFlow
  readonly sourceSessionId: SessionId
  readonly conversations: readonly SessionId[]
  readonly startKey: string
  readonly inputs: JsonValue
  readonly inputDigest: string
  readonly status: FlowStatus
  readonly frames: readonly FlowFrame[]
  readonly nodes: readonly FlowNodeRecord[]
  readonly pending?: FlowPending
  readonly result?: JsonValue
  readonly error?: string
  readonly limits: FlowLimits
  readonly usage: { readonly requests: number; readonly tokens: number; readonly activeMillis: number }
  readonly decisions: Readonly<Record<string, { readonly digest: string; readonly value: JsonValue }>>
  readonly deliveries?: Readonly<
    Record<
      string,
      {
        readonly command: FlowControl
        readonly actor: FlowActor
        readonly observedRevision: number
        readonly state: 'pending' | 'delivered'
      }
    >
  >
  readonly parentExecutionId?: FlowExecutionId
  readonly callerContext?: JsonValue
  readonly modelOptions?: JsonValue
  readonly createdAt: number
  readonly updatedAt: number
}
/** Read view exposes permitted commands rather than arbitrary state updates. */
export interface FlowView extends FlowExecution {
  readonly allowed_actions: readonly FlowControl[]
}
/** Human or trusted-host lifecycle command. */
export type FlowControl = 'pause' | 'resume' | 'cancel'
/** Live operation context; identities are persisted before invocation. */
export interface FlowOperationContext {
  readonly executionId: FlowExecutionId
  readonly nodeId: string
  readonly operationId: string
  readonly sourceSessionId: SessionId
  readonly signal: AbortSignal
  claimConversation(id: SessionId): Promise<void>
}
/** Typed operation plug-in; recovery never changes the original arguments. */
export interface FlowOperation<I = JsonValue, O = JsonValue> extends FlowRef {
  readonly inputSchema: JsonSchemaNode
  readonly outputSchema: JsonSchemaNode
  readonly cancellation: 'cooperative' | 'await-settlement'
  readonly effect: 'read' | 'write'
  readonly recovery: 'repeat' | 'receipt' | 'manual'
  execute(inputs: I, context: FlowOperationContext): Promise<O>
  reconcile?(inputs: I, context: FlowOperationContext): Promise<O | undefined>
}
/** Native result and actual spending, when the provider reports it. */
export interface FlowModelResult {
  readonly value: JsonValue
  readonly tokens?: number
}
/** Swappable model phase provider; domain tools are unavailable. */
export interface FlowModelProvider {
  execute(
    node: FlowModelNode,
    inputs: JsonValue,
    conversation: SessionId,
    context: FlowOperationContext,
    limits: FlowLimits,
  ): Promise<FlowModelResult>
  reconcile?(
    node: FlowModelNode,
    conversation: SessionId,
    context: FlowOperationContext,
  ): Promise<FlowModelResult | undefined>
}
/** Trusted caller identity, derived by tool or transport consumers. */
export interface FlowActor {
  readonly sessionId: SessionId
  readonly kind: 'model' | 'human' | 'host'
}
/** Start admission supplies explicit caller context and request identity. */
export interface FlowStart {
  readonly definition: FlowRef
  readonly inputs: JsonValue
  readonly actor: FlowActor
  readonly context: string
  readonly requestId: string
  readonly deferred?: boolean
  readonly parentExecutionId?: FlowExecutionId
  readonly parentRevision?: number
}

/** Cropped GUI and SDK read, without private drafts or compiled definitions. */
export interface FlowSummary {
  readonly id: FlowExecutionId
  readonly revision: number
  readonly title: string
  readonly status: FlowStatus
  readonly sourceSessionId: SessionId
  readonly conversations: readonly SessionId[]
  readonly completedNodes: number
  readonly allowed_actions: readonly FlowControl[]
  readonly error?: string
  readonly pending?: { readonly id: string; readonly request: JsonValue }
  readonly result?: JsonValue
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** A cropped committed execution read.
     * @param value - Progress without private drafts.
     * @mode emit
     */
    'flow/summary-changed'(value: FlowSummary): void
  }
}
