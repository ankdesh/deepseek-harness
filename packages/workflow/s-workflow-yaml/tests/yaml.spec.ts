import { describe, expect, it } from 'vitest'
import { parseSWorkflowYaml } from '../src/index.ts'

const workflow = `apiVersion: dsh.deepseek.ai/v1
kind: WorkflowDefinition
metadata:
  id: prepare-reviewed-change
  version: 1.0.0
service: spec
presets: [focused, goal, orchestrated]
steps:
  - id: prepare
    kind: model
    description: Prepare a complete replacement proposal.
  - id: review
    kind: review
    description: Wait for explicit user review.
`

describe('s-workflow YAML', () => {
  it('parses a no-code definition', () => {
    expect(parseSWorkflowYaml(workflow).kind).toBe('WorkflowDefinition')
  })
  it.each([
    `${workflow}executable: javascript\n`,
    workflow.replace('description: Prepare', 'description: &shared Prepare').replace('description: Wait', 'description: *shared\n    ignored: Wait'),
    workflow.replace('metadata:', 'metadata:\n  unknown: true'),
  ])('rejects fields, aliases, and anchors', (value) => {
    expect(() => parseSWorkflowYaml(value)).toThrow()
  })
})
