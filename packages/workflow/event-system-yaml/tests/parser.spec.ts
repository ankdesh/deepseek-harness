/** Strict configuration and prompt containment at the deployment file parser. */
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseEventSystemYaml } from '../src/index.ts'
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'event-yaml-'))
  roots.push(root)
  mkdirSync(join(root, 'catalog'))
  writeFileSync(join(root, 'catalog', 'primary.md'), 'Coordinate analysis.')
  const definition = {
    id: 'example',
    version: '1',
    primary: 'primary',
    agents: [{ id: 'primary', prompt: 'primary.md', tools: ['publish_event'], publishes: ['result'] }],
    events: {
      result: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
    },
    subscriptions: [],
  }
  const parse = (text = JSON.stringify(definition), limits = { maxFileBytes: 8192, maxPromptBytes: 1024 }) =>
    parseEventSystemYaml(text, join(root, 'catalog', 'system.yml'), limits)
  return { root, definition, parse }
}
describe('trusted no-code event configuration', () => {
  it('resolves Markdown without interpreting it as configuration', () => {
    const { parse } = fixture()
    expect(parse().agents[0]!.prompt).toBe('Coordinate analysis.')
  })
  it.each(['id: x\nid: y', '%YAML 1.2\n---\nid: x', 'id: !!str x', 'id: &a x\nversion: *a', '<<: {}', '? [x, y]\n: z'])(
    'rejects YAML feature %s',
    (text) => {
      expect(() => fixture().parse(text)).toThrow()
    },
  )
  it('rejects unknown fields, missing references, and payload schemas outside the native subset', () => {
    const { definition, parse } = fixture()
    expect(() => parse(JSON.stringify({ ...definition, code: 'execute' }))).toThrow()
    expect(() => parse(JSON.stringify({ ...definition, primary: 'missing' }))).toThrow('primary')
    expect(() =>
      parse(JSON.stringify({ ...definition, subscriptions: [{ id: 'unknown', event: 'missing', target: 'primary' }] })),
    ).toThrow('subscription')
    expect(() => parse(JSON.stringify({ ...definition, events: { result: { $ref: '#/x' } } }))).toThrow()
  })
  it('bounds YAML and prompt bytes and rejects empty or missing prompts', () => {
    const { parse, root } = fixture()
    expect(() => parse(undefined, { maxFileBytes: 1, maxPromptBytes: 1024 })).toThrow('YAML byte')
    expect(() => parse(undefined, { maxFileBytes: 8192, maxPromptBytes: 1 })).toThrow('prompt byte')
    writeFileSync(join(root, 'catalog', 'primary.md'), ' ')
    expect(() => parse()).toThrow('empty')
    rmSync(join(root, 'catalog', 'primary.md'))
    expect(() => parse()).toThrow()
  })
  it('rejects traversal and symlink escape from the definition directory', () => {
    const { root, definition, parse } = fixture()
    writeFileSync(join(root, 'outside.md'), 'External prompt')
    expect(() =>
      parse(JSON.stringify({ ...definition, agents: [{ ...definition.agents[0], prompt: '../outside.md' }] })),
    ).toThrow('contained')
    symlinkSync(join(root, 'outside.md'), join(root, 'catalog', 'linked.md'))
    expect(() =>
      parse(JSON.stringify({ ...definition, agents: [{ ...definition.agents[0], prompt: 'linked.md' }] })),
    ).toThrow('contained')
  })
})

it('loads the shipped generic analyst/reviewer YAML and Markdown example', () => {
  const source = new URL('../../event-system/examples/analysis-review/system.yml', import.meta.url)
  const parsed = parseEventSystemYaml(readFileSync(source, 'utf8'), source.pathname, {
    maxFileBytes: 8192,
    maxPromptBytes: 8192,
  })
  expect(parsed.agents.map(member => member.id)).toEqual(['primary', 'analyst', 'reviewer'])
  expect(parsed.subscriptions).toHaveLength(3)
})
