// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FlowSummary } from '@deepseek-ai/dsh-flow/types'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { FlowDock, type FlowDockProps } from '../src/client/FlowDock.tsx'
import { en } from '../src/client/locales.ts'
import type {} from '../src/client/index.ts'
afterEach(cleanup)
const execution: FlowSummary = { id: 'flow-one' as FlowSummary['id'], title: 'Analyze text', revision: 3, status: 'waiting', sourceSessionId: 'source' as FlowSummary['sourceSessionId'], conversations: [], completedNodes: 0, allowed_actions: ['pause', 'cancel'], pending: { id: 'decision-one', request: { question: 'Continue?' } } }
function props(flows: readonly FlowSummary[], control: FlowDockProps['control'] = () => Promise.resolve({ ok: true, value: execution })): FlowDockProps {
  const injected: Pick<FlowDockProps, 'useFlowProgress' | 'control' | 't'> = { useFlowProgress: selector => selector(flows), control, t: key => key in en ? en[key as keyof typeof en] : key }
  // The dock does not read the framework's session and input seats.
  return injected as unknown as FlowDockProps
}
describe('flow progress controls', () => {
  it('renders no contribution before an execution exists', () => {
    expect(render(<FlowDock {...props([])} />).container.firstChild).toBeNull()
  })
  it('renders the latest committed wait and only its allowed controls', () => {
    render(<FlowDock {...props([{ ...execution, title: 'Previous execution' }, execution])} />)
    expect(screen.queryByText('Previous execution')).toBeNull()
    expect(screen.getByText('Analyze text')).toBeTruthy()
    expect(screen.getByText('Waiting for a decision')).toBeTruthy()
    expect(screen.getByText(/Continue\?/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    expect(screen.queryByText('Result')).toBeNull()
  })
  it('shows the authoritative result and diagnostic', () => {
    const { pending, ...settled } = execution
    render(<FlowDock {...props([{ ...settled, status: 'failed', result: { saved: true }, error: 'Revision changed', allowed_actions: ['cancel'] }])} />)
    expect(screen.getByText('Result')).toBeTruthy()
    expect(screen.queryByText('Waiting for a response')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('Revision changed')
  })
  it('sends the observed execution and revision and holds controls until settlement', async () => {
    let resolve!: (result: RemoteResult<FlowSummary>) => void
    const control = vi.fn<FlowDockProps['control']>(() => new Promise((done) => { resolve = done }))
    render(<FlowDock {...props([execution], control)} />)
    const pause = screen.getByRole<HTMLButtonElement>('button', { name: 'Pause' })
    fireEvent.click(pause)
    expect(control).toHaveBeenCalledWith(execution, 'pause')
    expect(pause.disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true)
    await act(async () => { resolve({ ok: true, value: { ...execution, status: 'paused', revision: 4 } }) })
    expect(pause.disabled).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('displays a rejected revision without claiming the control succeeded', async () => {
    const control: FlowDockProps['control'] = () => Promise.resolve({ ok: false, error: { message: 'Stale flow revision' } } as RemoteResult<FlowSummary>)
    render(<FlowDock {...props([execution], control)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('Stale flow revision') })
    expect(screen.getByText('Waiting for a decision')).toBeTruthy()
  })
  it('displays a transport failure and permits a later control', async () => {
    const control = vi.fn<FlowDockProps['control']>().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ ok: true, value: execution })
    render(<FlowDock {...props([execution], control)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Offline') })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    expect(control).toHaveBeenCalledTimes(2)
  })
})
