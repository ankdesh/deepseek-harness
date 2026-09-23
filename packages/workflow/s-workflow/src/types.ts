/** Pure, client-safe workflow domain types. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** User-selected execution shape; service adapters never choose this axis. */
export type SWorkflowPreset = 'focused' | 'goal' | 'orchestrated'

/** Exact immutable catalog identity. */
export interface SWorkflowRef {
  readonly id: string
  readonly version: string
}

/** Exact content identity retained in every run. */
export interface SWorkflowResolvedRef extends SWorkflowRef {
  /** Lowercase SHA-256 content identity, validated at the catalog boundary. */
  readonly digest: string
}

/** Resource budgets enforced by the workflow owner. */
export interface SWorkflowBudget {
  readonly maxRounds: number
  readonly maxRequests: number
  readonly maxTokens: number
  readonly maxActiveMinutes: number
  readonly maxChildren: number
  readonly maxConcurrency: number
  readonly maxDelegationDepth: number
}

/** Monotonic resource usage recorded in each full snapshot. */
export interface SWorkflowUsage {
  readonly rounds: number
  readonly requests: number
  readonly tokens: number
  readonly activeMillis: number
  readonly children: number
}

/** Durable workflow phase. */
export type SWorkflowStatus =
  | 'active'
  | 'pause-pending'
  | 'paused'
  | 'awaiting-user-input'
  | 'awaiting-user-completion'
  | 'blocked'
  | 'complete'
  | 'cancelled'

/** Exact compare-and-set identity of a run revision. */
export interface SWorkflowRunRef {
  readonly runId: string
  readonly revision: number
}

/** Pending human-owned decision, if the run is waiting. */
export interface SWorkflowPendingDecision {
  readonly kind: 'input' | 'completion'
  readonly prompt: string
  readonly requestedAt: number
}

/** Full post-change workflow state written to every owned event. */
export interface SWorkflowSnapshot extends SWorkflowRunRef {
  readonly definition: SWorkflowResolvedRef
  readonly adapter: SWorkflowResolvedRef
  readonly preset: SWorkflowPreset
  readonly service: string
  readonly objective: string
  readonly contract: JsonValue
  readonly status: SWorkflowStatus
  readonly budget: SWorkflowBudget
  readonly usage: SWorkflowUsage
  readonly draft?: JsonValue
  readonly draftSummary?: string
  readonly checkpoint?: { readonly stepId: string; readonly note: string }
  readonly pending?: SWorkflowPendingDecision
  readonly blockedReason?: string
  readonly createdAt: number
  readonly updatedAt: number
}

/** Projection value exposed to host and client consumers. */
export type SWorkflowProjection = SWorkflowSnapshot | null

/** Strict projection checkpoint state. */
export interface SWorkflowProjectionState {
  readonly current: SWorkflowProjection
  readonly failure: string | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { sWorkflow: SWorkflowProjectionState }
  interface SessionProjectionMap { sWorkflow: SWorkflowProjection }
}
