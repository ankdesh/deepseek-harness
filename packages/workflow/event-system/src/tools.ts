/** Agent-scoped event tools; no roster, subscription, or budget mutation capabilities. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { isJsonValue } from '@deepseek-ai/dsh-util-values'
import type EventSystemService from './index.ts'

/**
 * Install model-facing consumers in a member's scoped registry.
 * @param ctx - member scoped tool registry.
 * @param systems - owning event service.
 * @param allowed - exact configured member tool names.
 */
export function installEventTools(ctx: Context, systems: EventSystemService, allowed: readonly string[]): void {
  if (allowed.includes('publish_event'))
    ctx.tools.register(
      defineTool({
        name: 'publish_event',
        description:
          'Publish a permitted typed event to the agents subscribed within this conversation. Use a stable dedupe_key for the same result.',
        parameters: {
          type: { type: 'string', required: true },
          payload_json: { type: 'string', required: true },
          dedupe_key: { type: 'string', required: true },
        },
        output: {
          schema: {
            type: 'object',
            properties: { event_id: { type: 'string', required: true } },
            additionalProperties: false,
          },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        async execute(args, exec) {
          if (!exec.agent) throw new Error('Event tools require an agent')
          const membership = systems.membership(exec.agent.id)
          if (
            !membership ||
            // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
            Buffer.byteLength(args.payload_json) > systems.get(membership.conversationId)!.limits.maxPayloadBytes
          )
            throw new Error('Event payload exceeds byte limit')
          const payload: unknown = JSON.parse(args.payload_json)
          if (!isJsonValue(payload)) throw new Error('Event payload must be lossless JSON')
          return { event_id: await systems.publishAgent(exec.agent, args.type, payload as JsonValue, args.dedupe_key) }
        },
      }),
    )
  if (allowed.includes('wait_for_event'))
    ctx.tools.register(
      defineTool({
        name: 'wait_for_event',
        description:
          'Wait without more model rounds for a future correlated event, owner review, or human answer. Use get_event_system to inspect the wait. Human answers use a host-generated wait identity.',
        parameters: {
          kind: { type: 'string', enum: ['human', 'event', 'review'], required: true },
          reason: { type: 'string', required: true },
          event_type: { type: 'string' },
          match_key: { type: 'string' },
          match_value: { type: 'string' },
        },
        output: {
          schema: {
            type: 'object',
            properties: { wait_id: { type: 'string', required: true } },
            additionalProperties: false,
          },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        async execute(args, exec) {
          if (!exec.agent) throw new Error('Waiting requires an agent')
          const wait = await systems.wait(exec.agent, {
            kind: args.kind,
            reason: args.reason,
            ...(args.event_type ? { eventType: args.event_type } : {}),
            ...(args.match_key ? { matchKey: args.match_key } : {}),
            ...(args.match_value !== undefined ? { matchValue: args.match_value } : {}),
          })
          return { wait_id: wait.id }
        },
      }),
    )
  if (allowed.includes('get_event_system'))
    ctx.tools.register(
      defineTool({
        name: 'get_event_system',
        description:
          'Read the members, pending deliveries, and available event types for this conversation. This does not change execution.',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            properties: { state_json: { type: 'string', required: true } },
            additionalProperties: false,
          },
          render: (_args, value) => [{ type: 'text', text: value.state_json }],
        },
        execute(_args, exec) {
          if (!exec.agent) throw new Error('Event tools require an agent')
          const membership = systems.membership(exec.agent.id)
          if (!membership) throw new Error('Agent is not an event-system member')
          // oxlint-disable-next-line typescript/no-non-null-assertion -- Owned references exist in the validated immutable ledger.
          const state = systems.get(membership.conversationId)!
          return Promise.resolve({
            state_json: JSON.stringify({
              member: membership.member,
              status: state.status,
              events: state.definition.events,
              deliveries: state.deliveries,
              waits: state.waits ?? [],
              limits: state.limits,
              rounds: state.rounds.length,
              requests: state.requests.length,
            }),
          })
        },
      }),
    )
}
