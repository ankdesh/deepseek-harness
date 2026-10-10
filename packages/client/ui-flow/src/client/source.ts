/** Progress read that refreshes on committed host events and connection reset. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { FlowSummary } from '@deepseek-ai/dsh-flow/types'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
/** Authoritative read and matching event notification. */
export interface FlowSourceInputs {
  read(): Promise<RemoteResult<FlowSummary[]>>
  subscribeChanged(listener: () => void): () => void
  subscribeReset(listener: () => void): () => void
}
/** Subscribe only while the framework observes this source.
 * @param inputs - Remote readers and notifications.
 * @returns Stable observable.
 */
export function createFlowSource(inputs: FlowSourceInputs): HostObservable<readonly FlowSummary[]> {
  let snapshot: readonly FlowSummary[] = [],
    epoch = 0,
    observing = false
  const listeners = new Set<() => void>()
  let cleanup: (() => void)[] = []
  const refresh = (): void => {
    const request = ++epoch
    void inputs
      .read()
      .then((result) => {
        if (!observing || request !== epoch || !result.ok) return
        snapshot = result.value
        for (const listener of listeners) listener()
      })
      .catch(() => {
        /* Transport errors retain the last committed read. */
      })
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      if (!observing) {
        observing = true
        cleanup = [inputs.subscribeChanged(refresh), inputs.subscribeReset(refresh)]
        refresh()
      }
      return () => {
        listeners.delete(listener)
        if (!listeners.size) {
          observing = false
          epoch++
          for (const dispose of cleanup) dispose()
          cleanup = []
        }
      }
    },
  }
}
