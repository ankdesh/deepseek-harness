/** Model-facing, non-authoritative workflow progress tools. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SWorkflowRunRef, SWorkflowSnapshot } from '@deepseek-ai/dsh-s-workflow'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

export const name = 'tool-s-workflow'
export const inject = ['agents', 'sWorkflow', 'tools', 'systemPrompt']
const MAX_DRAFT_JSON_BYTES = 128 * 1024

const POLICY = 'Workflow tools report progress inside an already-started deployment workflow. '
  + 'Call get_workflow before every change and copy its exact run_id and revision. You may update '
  + 'the review draft, record a checkpoint, request missing human input, or request completion review. '
  + 'You cannot start, pause, resume, cancel, raise budgets, approve completion, apply an artifact, or send it elsewhere.'

interface WorkflowToolValue {
  workflow: null | {
    runId: string
    revision: number
    status: SWorkflowSnapshot['status']
    preset: SWorkflowSnapshot['preset']
    service: string
    objective: string
    hasDraft: boolean
    pending?: { kind: 'input' | 'completion'; prompt: string }
  }
}

const OUTPUT = {
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      workflow: {
        oneOf: [
          { type: 'null' },
          {
            type: 'object', additionalProperties: false,
            properties: {
              runId: { type: 'string', required: true }, revision: { type: 'integer', required: true },
              status: { type: 'string', required: true }, preset: { type: 'string', required: true },
              service: { type: 'string', required: true }, objective: { type: 'string', required: true },
              hasDraft: { type: 'boolean', required: true },
              pending: {
                type: 'object', additionalProperties: false,
                properties: { kind: { type: 'string', required: true }, prompt: { type: 'string', required: true } },
              },
            },
          },
        ],
        required: true,
      },
    },
  } as const,
  render: (_args: unknown, value: WorkflowToolValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

function callingAgent(ctx: Context, exec: ToolRunContext): Agent {
  const agent = exec.agent
  if (agent === undefined || ctx.agents.get(agent.id) !== agent || agent.status !== 'running'
    || ctx.agents.currentInitiator() !== agent) {
    throw new Error('workflow tools require the exact live calling agent inside its active driver')
  }
  return agent
}

function ref(runId: string, revision: number): SWorkflowRunRef {
  if (runId.trim() === '' || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('run_id and revision must identify an exact workflow revision')
  }
  return { runId, revision }
}

function parseDraft(text: string): JsonValue {
  if (Buffer.byteLength(text) > MAX_DRAFT_JSON_BYTES) throw new Error('workflow draft JSON is too large')
  let value: unknown
  try { value = JSON.parse(text) }
  catch { throw new Error('draft_json must be valid JSON') }
  if (value === undefined) throw new Error('draft_json must contain a JSON value')
  return value as JsonValue
}

function value(workflow: SWorkflowSnapshot | null): WorkflowToolValue {
  if (workflow === null) return { workflow: null }
  return {
    workflow: {
      runId: workflow.runId, revision: workflow.revision, status: workflow.status,
      preset: workflow.preset, service: workflow.service, objective: workflow.objective,
      hasDraft: workflow.draft !== undefined,
      ...workflow.pending === undefined ? {} : {
        pending: { kind: workflow.pending.kind, prompt: workflow.pending.prompt },
      },
    },
  }
}

/** Register workflow progress tools; lifecycle authority remains host-only. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:s-workflow', order: ctx.systemPrompt.getSectionOrder('TOOL_WORKFLOW'), text: POLICY,
  })
  ctx.tools.register(defineTool({
    name: 'get_workflow', description: 'Read the current deployment-owned workflow and its exact revision.',
    parameters: {}, output: OUTPUT,
    execute(_args, exec) { return Promise.resolve(value(ctx.sWorkflow.get(callingAgent(ctx, exec)))) },
  }))
  ctx.tools.register(defineTool({
    name: 'update_workflow_draft',
    description: 'Replace the current workflow review draft with one complete JSON value. This does not apply it.',
    parameters: {
      run_id: { type: 'string', required: true }, revision: { type: 'number', required: true },
      draft_json: { type: 'string', required: true, description: 'Complete replacement draft encoded as JSON.' },
      summary: { type: 'string', required: true },
    },
    output: OUTPUT,
    execute(args, exec) {
      const next = ctx.sWorkflow.updateDraft(
        callingAgent(ctx, exec), ref(args.run_id, args.revision), parseDraft(args.draft_json), args.summary,
      )
      return Promise.resolve(value(next))
    },
  }))
  ctx.tools.register(defineTool({
    name: 'checkpoint_workflow',
    description: 'Record durable progress and resource usage for the current workflow revision.',
    parameters: {
      run_id: { type: 'string', required: true }, revision: { type: 'number', required: true },
      step_id: { type: 'string', required: true }, note: { type: 'string', required: true },
      rounds: { type: 'number' }, requests: { type: 'number' }, tokens: { type: 'number' },
      active_millis: { type: 'number' }, children: { type: 'number' },
    },
    output: OUTPUT,
    execute(args, exec) {
      const next = ctx.sWorkflow.checkpoint(callingAgent(ctx, exec), ref(args.run_id, args.revision), args.step_id, args.note, {
        ...args.rounds === undefined ? {} : { rounds: args.rounds },
        ...args.requests === undefined ? {} : { requests: args.requests },
        ...args.tokens === undefined ? {} : { tokens: args.tokens },
        ...args.active_millis === undefined ? {} : { activeMillis: args.active_millis },
        ...args.children === undefined ? {} : { children: args.children },
      })
      return Promise.resolve(value(next))
    },
  }))
  ctx.tools.register(defineTool({
    name: 'request_workflow_input', description: 'Pause workflow progress and ask the human for one required input.',
    parameters: {
      run_id: { type: 'string', required: true }, revision: { type: 'number', required: true },
      prompt: { type: 'string', required: true },
    },
    output: OUTPUT,
    execute(args, exec) {
      return Promise.resolve(value(ctx.sWorkflow.requestInput(
        callingAgent(ctx, exec), ref(args.run_id, args.revision), args.prompt,
      )))
    },
  }))
  ctx.tools.register(defineTool({
    name: 'request_workflow_completion',
    description: 'Submit the current draft for explicit human completion review. This does not apply the draft.',
    parameters: {
      run_id: { type: 'string', required: true }, revision: { type: 'number', required: true },
      prompt: { type: 'string', required: true },
    },
    output: OUTPUT,
    execute(args, exec) {
      return Promise.resolve(value(ctx.sWorkflow.requestCompletion(
        callingAgent(ctx, exec), ref(args.run_id, args.revision), args.prompt,
      )))
    },
  }))
}
