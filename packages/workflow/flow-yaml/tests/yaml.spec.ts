import { describe, expect, it } from 'vitest'
import { parseFlowYaml } from '../src/index.ts'
const data = {
  id: 'example',
  version: '1',
  description: 'Read',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  nodes: [{ id: 'wait', kind: 'wait', request: {}, outputSchema: { type: 'object' } }],
  outputs: {},
}
describe('flow YAML admission', () => {
  it('accepts JSON-compatible YAML and pins instruction content', () => {
    expect(parseFlowYaml(JSON.stringify(data), 'example', 10000).id).toBe('example')
    const model = {
      ...data,
      nodes: [
        {
          id: 'model',
          kind: 'model',
          instructionsFile: 'prompt.md',
          inputs: {},
          outputSchema: { type: 'object' },
        },
      ],
    }
    expect(
      parseFlowYaml(JSON.stringify(model), 'example', 10000, () => 'Return JSON.').nodes[0],
    ).toMatchObject({ instructions: 'Return JSON.' })
  })
  it('rejects tags, aliases, duplicate keys, directives, expressions and oversized files', () => {
    for (const text of [
      'id: !!js evil()',
      'id: &x one\nversion: *x',
      'id: one\nid: two',
      '%YAML 1.2\n---\nid: one',
    ])
      expect(() => parseFlowYaml(text, 'example', 10000)).toThrow()
    expect(() => parseFlowYaml(JSON.stringify({ ...data, expression: 'eval()' }), 'example', 10000)).toThrow(
      /unknown/,
    )
    expect(() => parseFlowYaml(JSON.stringify(data), 'example', 1)).toThrow(/bound/)
  })
})
