/** Native inbox receipts and committed delivery states must describe the same activation. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { EventSystemSnapshot } from './types.ts'
import { assertSnapshotIntegrity } from './ledger.ts'

/** Cordis invariant companion name. */
export const name = 'event-system-invariant'
/** Registry required to own this contribution. */
export const inject = ['invariants']
const install: InvariantInstaller = (ctx, fail) => {
  const receipts = new Map<SessionId, Set<string>>()
  const endings = new Map<SessionId, Set<number>>()
  const previous = new Map<string, EventSystemSnapshot>()
  ctx.on(
    'session/event',
    (session, event) => {
      if (event.type === 'user/message') {
        const ids = receipts.get(session.id) ?? new Set<string>()
        ids.add(event.data.id)
        receipts.set(session.id, ids)
      } else if (event.type === 'turn/end') {
        const turns = endings.get(session.id) ?? new Set<number>()
        turns.add(event.data.turn)
        endings.set(session.id, turns)
      }
    },
    { global: true },
  )
  ctx.on(
    'agent/disposed',
    ({ agent }) => {
      receipts.delete(agent.id)
      endings.delete(agent.id)
    },
    { global: true },
  )
  ctx.on(
    'domain/changed',
    (change) => {
      if (change.domain !== 'event_systems' || change.table !== 'systems' || change.operation !== 'put') return
      const state = change.value as EventSystemSnapshot
      try {
        assertSnapshotIntegrity(state)
      } catch (error) {
        fail(String(error))
      }
      const prior = previous.get(change.key)
      previous.set(change.key, state)
      if (!prior) return
      for (const delivery of state.deliveries) {
        const old = prior.deliveries.find(item => item.id === delivery.id)
        if (!old || old.state === delivery.state) continue
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
        const member = state.members.find(item => item.id === delivery.target)!
        if (delivery.state === 'accepted' && !receipts.get(member.sessionId)?.has(delivery.messageId))
          fail('Delivery accepted without its native user/message receipt')
        if (
          delivery.state === 'completed' &&
          (delivery.turn === null || !endings.get(member.sessionId)?.has(delivery.turn))
        )
          fail('Delivery completed without its native turn/end')
      }
    },
    { global: true },
  )
}
/**
 * Own the delivery/native-execution observation through companion disposal.
 * @param ctx - context carrying the invariant registry.
 */
export const apply = (ctx: Context): void => {
  ctx.effect(async () => {
    const registration = ctx.invariants.register('@deepseek-ai/dsh-event-system', install) as
      (() => Promise<void>) & PromiseLike<void>
    // Cordis effect registrations await setup and preserve asynchronous teardown.
    await registration
    return () => registration()
  })
}
