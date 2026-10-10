/** Register the flow dock through standard slots, locales, and remote controls. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { FlowDock, type FlowInjected } from './FlowDock.tsx'
import { createFlowSource } from './source.ts'
import { en, zh, type FlowKey } from './locales.ts'
export { FlowDock } from './FlowDock.tsx'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    flow: FlowKey
  }
}
export const inject = ['remote', 'remote.flows', 'slots', 'locale']
/** Register a reversible browser contribution.
 * @param ctx - Client composition.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('flow', { en, zh }))
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.dock',
        id: 'flow',
        order: 12,
        locale: 'flow',
        inject: (sessionId): FlowInjected => ({
          hooks: {
            flowProgress: createFlowSource({
              read: () => ctx.remote.flows.list(sessionId),
              subscribeChanged: listener =>
                ctx.remote.$on('flow/summary-changed', (summary) => {
                  if (summary.conversations.includes(sessionId)) listener()
                }),
              subscribeReset: listener => ctx.on('connection/reset', listener),
            }),
          },
          control: (flow, action) => ctx.remote.flows.control(sessionId, flow.id, flow.revision, action),
        }),
      },
      FlowDock,
    ),
  )
}
