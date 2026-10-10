/** Flow controls and status copy. */
export const zh = {
  heading: '流程',
  result: '结果',
  pending: '等待响应',
  pause: '暂停',
  resume: '恢复',
  cancel: '取消',
  running: '执行中',
  waiting: '等待决定',
  paused: '已暂停',
  'needs-resume': '需要恢复',
  'needs-reconcile': '需要确认执行结果',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}
/** Accepted flow status and control translation keys. */
export type FlowKey = keyof typeof zh
/** English flow status and control strings. */
export const en = {
  heading: 'Flow',
  result: 'Result',
  pending: 'Waiting for a response',
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel',
  running: 'Running',
  waiting: 'Waiting for a decision',
  paused: 'Paused',
  'needs-resume': 'Resume required',
  'needs-reconcile': 'Result reconciliation required',
  succeeded: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
} satisfies Record<FlowKey, string>
