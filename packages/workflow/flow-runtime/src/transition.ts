/** Pure lifecycle transitions, separate from effect execution. */
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { FlowControl, FlowExecution, FlowView } from '@deepseek-ai/dsh-flow'
/** Derive permitted human controls.
 * @param record - Durable execution.
 * @returns Read view.
 */
export function flowView(record: FlowExecution): FlowView {
  const actions: FlowControl[] =
    record.status === 'running'
      ? ['pause', 'cancel']
      : record.status === 'waiting'
        ? ['pause', 'cancel']
        : ['paused', 'needs-resume', 'needs-reconcile'].includes(record.status)
          ? ['resume', 'cancel']
          : record.status === 'failed'
            ? ['cancel']
            : []
  return deepFreeze({ ...record, allowed_actions: actions })
}
/** Apply one revision-checked named command without effects.
 * @param record - Current execution.
 * @param revision - Caller observation.
 * @param command - Requested command.
 * @param timestamp - Commit time.
 * @returns New execution.
 */
export function transitionFlow(
  record: FlowExecution,
  revision: number,
  command: FlowControl,
  timestamp: number,
): FlowExecution {
  if (revision !== record.revision) throw new Error('Stale flow revision')
  if (!flowView(record).allowed_actions.includes(command))
    throw new Error('Flow ' + record.status + ' does not permit ' + command)
  const { error: _error, ...cleared } = record
  return {
    ...(command === 'resume' ? cleared : record),
    revision: record.revision + 1,
    updatedAt: timestamp,
    status:
      command === 'cancel'
        ? 'cancelled'
        : command === 'pause'
          ? 'paused'
          : record.pending
            ? 'waiting'
            : 'running',
  }
}
