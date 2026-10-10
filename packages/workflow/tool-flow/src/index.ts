/** Named composite model tools generated from developer flow definitions. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FlowExecutionId, FlowRuntime } from '@deepseek-ai/dsh-flow'
import { assertFlowValue, summarizeFlow } from '@deepseek-ai/dsh-flow'
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
export const name = 'tool-flow'
export const inject = ['flows', 'agents']
/** Generate scoped tools; authority and context come from the host, not arguments.
 * @param agent - Live conversation.
 * @param flows - Executor.
 * @param context - Host-selected publication context.
 * @returns All registration disposers.
 */
export function registerFlowTools(agent: Agent, flows: FlowRuntime, context: string): () => void {
  const disposers: Array<() => void> = []
  const pending = new Set<FlowExecutionId>()
  disposers.push(
    agent.ctx.tools.register({
      name: 'get_flow',
      description:
        'Read progress for a flow in this conversation. Acceptance is not completion. Human decisions and lifecycle controls are outside this tool.',
      parameters: {
        type: 'object',
        properties: { execution_id: { oneOf: [{ type: 'string' }, { type: 'null' }] } },
        required: ['execution_id'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { flow: { oneOf: [{ type: 'object' }, { type: 'null' }] } },
          required: ['flow'],
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec) {
        await flows.ready
        if (exec.agent !== agent) throw new Error('Flow inspection requires the exact conversation')
        const input = args as { execution_id: string | null },
          actor = { kind: 'model' as const, sessionId: agent.id }
        const record =
          input.execution_id === null
            ? flows.list(actor).at(-1)
            : flows.get(input.execution_id as FlowExecutionId, actor)
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
        return { flow: record ? snapshotJsonValue(summarizeFlow(record))! : null }
      },
    }),
  )
  disposers.push(
    agent.ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      for (const id of pending) {
        pending.delete(id)
        void agent.ctx.sessions
          .flush(agent.session)
          .then(async (saved) => {
            if (saved) {
              flows.advance(id)
              return
            }
            const record = flows.get(id, { kind: 'host', sessionId: agent.id })
            await flows.control(id, record.revision, 'pause', { kind: 'host', sessionId: agent.id })
          })
          .catch((error: unknown) => {
            agent.ctx.logger.warn('Flow acceptance could not settle: ' + String(error))
          })
      }
    }),
  )
  for (const definition of flows.catalog(context))
    disposers.push(
      agent.ctx.tools.register({
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
        name: definition.publication!.toolName,
        description: definition.description,
        parameters: definition.inputSchema as unknown as Record<string, unknown>,
        output: {
          schema: {
            type: 'object',
            properties: {
              execution_id: { type: 'string' },
              revision: { type: 'integer' },
              status: { type: 'string' },
            },
            required: ['execution_id', 'revision', 'status'],
            additionalProperties: false,
          },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        async execute(args, exec) {
          if (exec.agent !== agent || agent.status !== 'running')
            throw new Error('Flow requires the exact calling conversation')
          assertFlowValue(definition.inputSchema, args, 'inputs')
          const record = await flows.start({
            definition,
            inputs: snapshotJsonValue(args) as JsonValue,
            actor: { kind: 'model', sessionId: agent.id },
            context,
            requestId: String(exec.callId),
            deferred: true,
          })
          pending.add(record.id)
          exec.concludeTurn()
          return { execution_id: record.id, revision: record.revision, status: record.status }
        },
      }),
    )
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
/** Generic profiles use an explicit context; product integrations register scoped tools directly. */
export interface Config {
  /** Host-selected publication context for this deployment. */
  context: string
}
/** Host-selected publication context; the model cannot override it. */
export const Config: z<Config> = z.object({ context: z.string().required() })
/** Mount named tools into future conversations and remove them on teardown.
 * @param ctx - Composition.
 * @param config - Explicit publication context.
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.context) throw new Error('tool-flow requires context')
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.effect(() => registerFlowTools(agent, ctx.flows, config.context))
  })
}
