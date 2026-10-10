import { describe, expect, it, vi } from 'vitest'
import { createFlowSource } from '../src/client/source.ts'
import type { FlowSummary } from '@deepseek-ai/dsh-flow/types'
describe('flow progress source', () => {
  it('ignores stale reads and removes both subscriptions on disposal', async () => {
    const pending: ((value: { ok: true; value: FlowSummary[] }) => void)[] = []
    let changed!: () => void
    const stopChanged = vi.fn(),
      stopReset = vi.fn()
    const source = createFlowSource({
      read: () => new Promise(resolve => pending.push(resolve)),
      subscribeChanged: (listener) => {
        changed = listener
        return stopChanged
      },
      subscribeReset: () => stopReset,
    })
    const dispose = source.subscribe(() => {})
    changed()
    pending[1]!({ ok: true, value: [{ revision: 2 } as FlowSummary] })
    await Promise.resolve()
    pending[0]!({ ok: true, value: [{ revision: 1 } as FlowSummary] })
    await Promise.resolve()
    expect(source.getSnapshot()[0]!.revision).toBe(2)
    dispose()
    expect(stopChanged).toHaveBeenCalledOnce()
    expect(stopReset).toHaveBeenCalledOnce()
  })
  it('retains the last committed read after a transport failure', async () => {
    let reset!: () => void
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: [{ revision: 1 }] })
      .mockRejectedValueOnce(new Error('offline'))
    const source = createFlowSource({
      read,
      subscribeChanged: () => () => {},
      subscribeReset: (listener) => {
        reset = listener
        return () => {}
      },
    })
    const dispose = source.subscribe(() => {})
    await Promise.resolve()
    reset()
    await Promise.resolve()
    await Promise.resolve()
    expect(source.getSnapshot()[0]!.revision).toBe(1)
    dispose()
  })
  it('shares one subscription and ignores a read completed after the last observer leaves', async () => {
    let deliver!: (value: { ok: true; value: FlowSummary[] }) => void
    const read = vi.fn(() => new Promise<{ ok: true; value: FlowSummary[] }>((resolve) => { deliver = resolve }))
    const stop = vi.fn(), subscribeChanged = vi.fn(() => stop), subscribeReset = vi.fn(() => stop)
    const source = createFlowSource({ read, subscribeChanged, subscribeReset })
    const first = source.subscribe(() => {}), second = source.subscribe(() => {})
    expect(read).toHaveBeenCalledOnce(); first(); expect(stop).not.toHaveBeenCalled()
    second(); expect(stop).toHaveBeenCalledTimes(2)
    deliver({ ok: true, value: [{ revision: 9 } as FlowSummary] }); await Promise.resolve()
    expect(source.getSnapshot()).toEqual([])
  })
  it('retains the committed snapshot when the remote command returns an error', async () => {
    const source = createFlowSource({ read: () => Promise.resolve({ ok: false, error: { message: 'Unavailable' } } as never), subscribeChanged: () => () => {}, subscribeReset: () => () => {} })
    const dispose = source.subscribe(() => {}); await Promise.resolve()
    expect(source.getSnapshot()).toEqual([]); dispose()
  })

})
