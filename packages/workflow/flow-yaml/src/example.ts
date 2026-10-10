/** Domain-neutral text analysis example; no product or log-parser dependencies. */
import { readFileSync } from 'node:fs'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { parseFlowYaml } from './index.ts'
export const name = 'flow-text-example'
export const inject = ['flows']
const stats: JsonSchemaNode = {
  type: 'object',
  properties: { lines: { type: 'integer' }, words: { type: 'integer' } },
  required: ['lines', 'words'],
  additionalProperties: false,
}
const summary: JsonSchemaNode = { oneOf: [{ type: 'string' }, { type: 'null' }] }
/** Register two pure operations and data definitions.
 * @param ctx - Generic flow composition.
 */
export function apply(ctx: Context): void {
  ctx.effect(() =>
    ctx.flows.registerOperation({
      id: 'example.count',
      version: '1.0.0',
      effect: 'read',
      cancellation: 'cooperative',
      recovery: 'repeat',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      outputSchema: stats,
      execute: (input) => {
        const text = (input as { text: string }).text
        return Promise.resolve({
          lines: text.split(/\r?\n/).filter(line => line.trim()).length,
          words: text.match(/\S+/g)?.length ?? 0,
        })
      },
    }),
  )
  ctx.effect(() =>
    ctx.flows.registerOperation({
      id: 'example.report',
      version: '1.0.0',
      effect: 'read',
      cancellation: 'cooperative',
      recovery: 'repeat',
      inputSchema: {
        type: 'object',
        properties: { statistics: stats, summary },
        required: ['statistics', 'summary'],
        additionalProperties: false,
      },
      outputSchema: {
        ...stats,
        properties: { ...stats.properties, summary },
        required: ['lines', 'words', 'summary'],
      },
      execute: (input) => {
        const value = input as { statistics: { lines: number; words: number }; summary: JsonValue }
        return Promise.resolve({ ...value.statistics, summary: value.summary })
      },
    }),
  )
  const directory = new URL('../examples/', import.meta.url)
  for (const filename of ['count_text.yaml', 'analyze_text.yaml']) {
    const data = parseFlowYaml(readFileSync(new URL(filename, directory), 'utf8'), filename, 262144, path =>
      readFileSync(new URL(path, directory), 'utf8'),
    )
    ctx.effect(() => ctx.flows.registerDefinition(data))
  }
}
