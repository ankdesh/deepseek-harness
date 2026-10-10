/** Startup-only data loader; instruction files are resolved and pinned before execution. */
import { readFileSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isAlias, isMap, isScalar, parseDocument, visit } from 'yaml'
import { defineFlow } from '@deepseek-ai/dsh-flow'
import type { FlowDefinition } from '@deepseek-ai/dsh-flow'
/** Explicit trusted roots and whole-file bounds. */
export interface Config {
  /** Trusted definition files or catalog directories. */
  roots: string[]
  /** Maximum bytes in each definition file. */
  maxFileBytes: number
  /** Maximum bytes in each referenced instruction file. */
  maxInstructionBytes: number
}
export const Config: z<Config> = z.object({
  roots: z.array(z.string()).required(),
  maxFileBytes: z.number().step(1).min(1).required(),
  maxInstructionBytes: z.number().step(1).min(1).required(),
})
/** Strict no-code YAML parser; external instructions require an explicit file resolver.
 * @param text - Developer-authored YAML.
 * @param source - Source diagnostic.
 * @param maxBytes - Whole-file limit.
 * @param instruction - Trusted instruction-file resolver.
 * @returns Validated definition.
 */
export function parseFlowYaml(
  text: string,
  source: string,
  maxBytes: number,
  instruction?: (path: string) => string,
): FlowDefinition {
  if (Buffer.byteLength(text) > maxBytes) throw new Error(source + ' exceeds file bound')
  const doc = parseDocument(text, { uniqueKeys: true, merge: false, schema: 'core' })
  if (
    doc.errors.length ||
    doc.warnings.length ||
    doc.directives.yaml.explicit ||
    Object.keys(doc.directives.tags).some(t => t !== '!!')
  )
    throw new Error(source + ': invalid data-only YAML')
  visit(doc, (_key, node) => {
    const v = node && typeof node === 'object' ? (node as { anchor?: string; tag?: string }) : undefined
    if (isAlias(node) || v?.anchor || v?.tag)
      throw new Error(source + ': tags, anchors and aliases are not supported')
    if (isMap(node))
      for (const pair of node.items)
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || pair.key.value === '<<')
          throw new Error(source + ': string keys are required')
  })
  const data: unknown = doc.toJS({ maxAliasCount: 0 })
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error(source + ': expected a flow mapping')
  const candidate = data as Record<string, unknown>
  if (Array.isArray(candidate.nodes))
    for (const raw of candidate.nodes) {
      if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).kind === 'model') {
        const n = raw as Record<string, unknown>
        if (n.instructionsFile !== undefined) {
          if (n.instructions !== undefined || typeof n.instructionsFile !== 'string' || !instruction)
            throw new Error(source + ': invalid instruction file reference')
          n.instructions = instruction(n.instructionsFile)
          delete n.instructionsFile
        }
      }
    }
  return defineFlow(candidate as unknown as FlowDefinition)
}
/** Loader provider; registrations unwind with its plugin fiber. */
export class FlowYamlProvider extends Service {
  static inject = ['flows']
  static Config = Config
  /** Mount this service in the native composition.
   * @param ctx - Composition.
   * @param config - Trusted deployment paths.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'flowYaml')
    const disposers: Array<() => void> = []
    try {
      for (const entry of config.roots) {
        const path = realpathSync(entry)
        const files = statSync(path).isDirectory()
          ? readdirSync(path, { withFileTypes: true })
            .filter(f => f.isFile() && /\.ya?ml$/.test(f.name))
            .map(f => resolve(path, f.name))
            .sort()
          : [path]
        for (const file of files)
          disposers.push(
            ctx.flows.registerDefinition(
              parseFlowYaml(readFileSync(file, 'utf8'), file, config.maxFileBytes, (name) => {
                const base = realpathSync(dirname(file)),
                  target = realpathSync(resolve(base, name)),
                  rel = relative(base, target)
                if (isAbsolute(name) || rel.startsWith('..') || isAbsolute(rel))
                  throw new Error('Instruction path escaped its catalog directory')
                const text = readFileSync(target, 'utf8')
                if (Buffer.byteLength(text) > config.maxInstructionBytes)
                  throw new Error('Instructions exceed byte bound')
                return text
              }),
            ),
          )
      }
    } catch (error: unknown) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    ctx.effect(() => () => {
      for (const dispose of disposers.reverse()) dispose()
    })
  }
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    flowYaml: FlowYamlProvider
  }
}
export default FlowYamlProvider
