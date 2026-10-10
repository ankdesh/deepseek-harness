/** Small read shared by remote and product UI consumers. */
import type { FlowSummary, FlowView } from './types.ts'
/** Crop private drafts and definitions from progress reads.
 * @param view - Committed execution view.
 * @returns Status, exact revision, controls and final result.
 */
export function summarizeFlow(view: FlowView): FlowSummary {
  return {
    id: view.id,
    revision: view.revision,
    title: view.definition.description,
    status: view.status,
    sourceSessionId: view.sourceSessionId,
    conversations: view.conversations,
    completedNodes: view.nodes.filter(n => n.state === 'succeeded').length,
    allowed_actions: view.allowed_actions,
    ...(view.error ? { error: view.error } : {}),
    ...(view.pending ? { pending: { id: view.pending.id, request: view.pending.request } } : {}),
    ...(view.result === undefined ? {} : { result: view.result }),
  }
}
