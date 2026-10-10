/** Flow progress and exact revision controls. */
import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { FlowSummary, FlowControl } from '@deepseek-ai/dsh-flow/types'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import css from './FlowDock.module.css'
/** Registrant-private progress source and human commands. */
export interface FlowInjected {
  readonly hooks: { readonly flowProgress: HostObservable<readonly FlowSummary[]> }
  control(flow: FlowSummary, action: FlowControl): Promise<RemoteResult<FlowSummary>>
}
/** Framework slot props derive their injected hook and locale seats. */
export type FlowDockProps = PropsRuntime<'conversation.input.dock'> &
  InjectFace<FlowInjected> &
  PropsLocale<'flow'>
/** Render only authoritative status and allowed controls.
 * @param props - Injected read, command, and locale seats.
 * @returns Progress strip or no contribution.
 */
export function FlowDock({ useFlowProgress, control, t }: FlowDockProps) {
  const flows = useFlowProgress(value => value)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const flow = flows.at(-1)
  if (!flow) return null
  return (
    <section className={css.flow} aria-label={t('heading')}>
      <span>{flow.title}</span>
      <span>{t(flow.status)}</span>
      {flow.allowed_actions.map(action => (
        <button
          key={action}
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError('')
            void control(flow, action)
              .then((result) => {
                if (!result.ok) setError(result.error.message)
              })
              .catch((e: unknown) => {
                setError(String(e))
              })
              .finally(() => {
                setBusy(false)
              })
          }}
        >
          {t(action)}
        </button>
      ))}
      {flow.result !== undefined && (
        <details>
          <summary>{t('result')}</summary>
          <pre>{JSON.stringify(flow.result, null, 2)}</pre>
        </details>
      )}
      {flow.pending && (
        <details>
          <summary>{t('pending')}</summary>
          <pre>{JSON.stringify(flow.pending.request, null, 2)}</pre>
        </details>
      )}
      {(error || flow.error) && <span role="alert">{error || flow.error}</span>}
    </section>
  )
}
