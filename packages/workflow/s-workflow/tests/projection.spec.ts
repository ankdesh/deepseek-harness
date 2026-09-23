import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SWorkflowService, { applySWorkflowProjection, DEFAULT_WORKFLOW_BUDGETS } from '../src/index.ts'
import type { SWorkflowSnapshot } from '../src/index.ts'

const workflow = {
  runId: 'workflow-1', revision: 1,
  definition: { id: 'prepare-reviewed-change', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` as const },
  adapter: { id: 'spec-editor', version: '1.0.0', digest: `sha256:${'b'.repeat(64)}` as const },
  preset: 'focused' as const, service: 'spec', objective: 'change it', contract: {}, status: 'active' as const,
  budget: DEFAULT_WORKFLOW_BUDGETS.focused,
  usage: { rounds: 0, requests: 0, tokens: 0, activeMillis: 0, children: 0 },
  createdAt: 1, updatedAt: 1,
}

function event(value: SWorkflowSnapshot = workflow): SessionEvent {
  return { seq: 0, type: 's-workflow/change', data: { kind: 's-workflow/change', version: 1, operation: 'start', workflow: value } } as SessionEvent
}

describe('s-workflow projection', () => {
  it('folds a full state snapshot', () => {
    const state = applySWorkflowProjection({ current: null, failure: null }, event())
    expect(state.current).toEqual(workflow)
  })
  it('retains the first replay failure', () => {
    const first = applySWorkflowProjection({ current: null, failure: null }, event())
    const failed = applySWorkflowProjection(first, event({ ...workflow, revision: 3 }))
    expect(failed.failure).toMatch(/revision/)
  })
  it('rejects malformed event envelopes and noninitial replacement revisions', () => {
    const malformed = applySWorkflowProjection(
      { current: null, failure: null },
      { ...event(), data: { ...event().data, version: 2 } } as SessionEvent,
    )
    expect(malformed.failure).toBeTruthy()
    const terminal = applySWorkflowProjection(
      { current: null, failure: null },
      event({ ...workflow, status: 'complete' }),
    )
    const replaced = applySWorkflowProjection(
      terminal,
      event({ ...workflow, runId: 'workflow-2', revision: 2 }),
    )
    expect(replaced.failure).toMatch(/revision 1/)
  })
  it('rejects a persisted run when exact catalog content changes', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SWorkflowService)
    const session = Session.create(SessionId('workflow-catalog-digest'))
    const agent = { id: session.id, session, status: 'idle', ctx } as Agent
    await ctx.agents.register(agent)
    const unregisterDefinition = ctx.sWorkflow.registerDefinition({
      apiVersion: 'dsh.deepseek.ai/v1', kind: 'WorkflowDefinition',
      metadata: { id: 'prepare-reviewed-change', version: '1.0.0' },
      service: 'generic', presets: ['goal'],
      steps: [{ id: 'prepare', kind: 'model', description: 'Prepare a draft.' }],
    })
    ctx.sWorkflow.registerAdapter({
      apiVersion: 'dsh.deepseek.ai/v1', kind: 'ServiceAdapter',
      metadata: { id: 'spec-editor', version: '1.0.0' }, service: 'spec',
      promptBundles: [], toolPackages: [], skillPackages: [], reviewKind: 'spec-proposal',
    })
    ctx.sWorkflow.start(agent, {
      definition: { id: 'prepare-reviewed-change', version: '1.0.0' },
      adapter: { id: 'spec-editor', version: '1.0.0' },
      preset: 'goal', objective: 'Prepare a safe change.', contract: {},
    })
    unregisterDefinition()
    ctx.sWorkflow.registerDefinition({
      apiVersion: 'dsh.deepseek.ai/v1', kind: 'WorkflowDefinition',
      metadata: { id: 'prepare-reviewed-change', version: '1.0.0' },
      service: 'generic', presets: ['goal'],
      steps: [{ id: 'prepare', kind: 'model', description: 'Changed catalog content.' }],
    })
    expect(() => ctx.sWorkflow.get(agent)).toThrow(/catalog content digest changed/)
    await ctx.fiber.dispose()
  })
})
