import { describe, expect, it } from 'vitest'
import {
  compileFlow,
  defineFlow,
  defineOperation,
  flowDigest,
  flowKey,
  resolveFlowValue,
} from '../src/index.ts'
import type { FlowDefinition, FlowOperation } from '../src/index.ts'
const object: import('@deepseek-ai/dsh-tools').ObjectJsonSchema = {
  type: 'object',
  properties: { count: { type: 'integer' } },
  required: ['count'],
  additionalProperties: false,
}
const op: FlowOperation = defineOperation({
  id: 'count',
  version: '1',
  inputSchema: object,
  outputSchema: object,
  effect: 'read',
  cancellation: 'cooperative',
  recovery: 'repeat',
  execute: async value => value,
})
const base: FlowDefinition = {
  id: 'example',
  version: '1',
  description: 'Count',
  inputSchema: object,
  outputSchema: object,
  publication: { toolName: 'count_text', contexts: ['example'] },
  nodes: [
    { id: 'count', kind: 'call', operation: { id: op.id, version: op.version }, inputs: { $ref: 'inputs' } },
  ],
  outputs: { $ref: 'nodes.count' },
}
const compile = (flow: FlowDefinition) =>
  compileFlow(flow, new Map([[flowKey(flow), flow]]), new Map([[flowKey(op), op]]), 20)
describe('flow compiler', () => {
  it('compiles without invoking effects and preserves typed references', () => {
    const result = compile(base)
    expect(result.expandedNodes).toBe(1)
    expect(
      resolveFlowValue({ values: [{ $ref: 'inputs.count' }], enabled: false }, { count: 12 }, {}),
    ).toEqual({ values: [12], enabled: false })
    expect(result.digest).toBe(compile({ ...base }).digest)
    expect(flowDigest({ a: 1, b: 2 })).toBe(flowDigest({ b: 2, a: 1 }))
  })
  it('rejects expressions, unknown nodes, missing operations and dangling destinations', () => {
    expect(() => defineFlow({ ...base, expression: 'eval()' } as FlowDefinition)).toThrow(/unknown field/)
    expect(() => compile({ ...base, nodes: [{ ...base.nodes[0]!, next: 'absent' }] })).toThrow(/destination/)
    expect(() => compileFlow(base, new Map(), new Map(), 5)).toThrow(/Missing operation/)
    expect(() => resolveFlowValue({ $ref: 'inputs.absent' }, {}, {})).toThrow(/Unresolved/)
  })
  it('rejects reference type mismatches, cycles, recursion and size overflow', () => {
    expect(() =>
      compile({
        ...base,
        inputSchema: { type: 'object', properties: { count: { type: 'string' } }, required: ['count'] },
        nodes: [
          {
            id: 'count',
            kind: 'call',
            operation: { id: op.id, version: op.version },
            inputs: { count: { $ref: 'inputs.count' } },
          },
        ],
      }),
    ).toThrow(/Incompatible/)
    expect(() => compile({ ...base, nodes: [{ ...base.nodes[0]!, next: 'count' }] })).toThrow(/cyclic/)
    const recursive: FlowDefinition = {
      ...base,
      nodes: [
        {
          id: 'again',
          kind: 'flow',
          flow: { id: base.id, version: base.version },
          inputs: { $ref: 'inputs' },
        },
      ],
    }
    expect(() => compile(recursive)).toThrow(/Recursive/)
    expect(() => compileFlow(base, new Map(), new Map([[flowKey(op), op]]), 0)).toThrow(/bound/)
  })
  it('rejects outputs from a skipped branch and validates operation recovery', () => {
    const branched: FlowDefinition = {
      ...base,
      nodes: [
        { id: 'choose', kind: 'branch', value: true, equals: true, then: 'count', otherwise: null },
        base.nodes[0]!,
      ],
    }
    expect(() => compile(branched)).toThrow(/dominate/)
    expect(() => defineOperation({ ...op, effect: 'write' })).toThrow(/Writes/)
  })
  it('checks nested required fields and rejects incomplete branch declarations', () => {
    expect(() =>
      compile({ ...base, inputSchema: { type: 'object', properties: {}, additionalProperties: false } }),
    ).toThrow(/Incompatible/)
    expect(() =>
      defineFlow({
        ...base,
        nodes: [{ id: 'choice', kind: 'branch', value: true, equals: true, then: null } as never],
      }),
    ).toThrow(/missing field/)
    const incompatible: FlowDefinition = {
      ...base,
      inputSchema: {
        type: 'object',
        properties: { count: { type: 'integer' } },
        additionalProperties: false,
      },
    }
    expect(() => compile(incompatible)).toThrow(/Incompatible/)
  })

  it('rejects optional fields used as unconditional references', () => {
    expect(() =>
      compile({
        ...base,
        inputSchema: { ...object, required: [] },
        nodes: [
          {
            id: 'count',
            kind: 'call',
            operation: { id: op.id, version: op.version },
            inputs: { count: { $ref: 'inputs.count' } },
          },
        ],
      }),
    ).toThrow(/not guaranteed/)
  })

  it('rejects an equality value outside the referenced field schema', () => {
    const definition: FlowDefinition = {
      ...base,
      nodes: [
        {
          id: 'choose',
          kind: 'branch',
          value: { $ref: 'inputs.count' },
          equals: 'one',
          then: 'count',
          otherwise: null,
          result: { count: { $ref: 'inputs.count' } },
        },
        base.nodes[0]!,
      ],
    }
    expect(() => compile(definition)).toThrow(/branch equality/)
  })
})
