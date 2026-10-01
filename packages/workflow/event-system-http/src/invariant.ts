/** A source acknowledgement must identify its independently committed event. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-event-system'
import type { HttpSourceRecord } from './types.ts'
/** Cordis companion identity. */
export const name = 'event-http-source-invariant'
/** Native observation owners required by the companion. */
export const inject = ['invariants', 'eventSystems']
const install: InvariantInstaller = Object.assign((ctx: Context, fail: Parameters<InvariantInstaller>[1]) => {
  ctx.on(
    'domain/changed',
    (change) => {
      if (change.domain !== 'event_http_sources' || change.table !== 'sources' || change.operation !== 'put') return
      const source = change.value as HttpSourceRecord
      if (!source.sequence) return
      const event = ctx.eventSystems
        .get(source.conversationId)
        ?.events.find(item => item.producer === `http:${source.id}` && item.dedupeKey === String(source.sequence))
      if (!event) fail('HTTP source acknowledged without its committed publication')
    },
    { global: true },
  )
}, { inject: ['eventSystems'] })
/**
 * Own the cursor/publication observation through companion disposal.
 * @param ctx - native invariant registry and event-system owner.
 */
export const apply = (ctx: Context): void => {
  ctx.effect(async () => {
    const registration = ctx.invariants.register('@deepseek-ai/dsh-event-system-http', install) as
      (() => Promise<void>) & PromiseLike<void>
    // Cordis effect registrations await setup and preserve asynchronous teardown.
    await registration
    return () => registration()
  })
}
