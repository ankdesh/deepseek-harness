/** Strict startup-only YAML provider for workflow and adapter catalogs. */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isAlias, isMap, isPair, isScalar, isSeq, parseDocument, visit } from 'yaml'
import type { SWorkflowDefinition, SWorkflowServiceAdapter } from '@deepseek-ai/dsh-s-workflow'

const MAX_FILE_BYTES = 256 * 1024

/** Trusted startup roots; files are read once and never hot-reloaded. */
export interface Config {
  /** Trusted catalog files or non-recursive directories loaded once at startup. */
  roots: string[]
}
export const Config: z<Config> = z.object({ roots: z.array(z.string()).required() })

declare module '@deepseek-ai/cordis' {
  interface Context { sWorkflowYaml: SWorkflowYamlProvider }
}

/** Supported strict YAML catalog documents. */
export type SWorkflowYamlDocument = SWorkflowDefinition | SWorkflowServiceAdapter

function record(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} must be a mapping`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, fields: readonly string[], where: string): void {
  const extras = Object.keys(value).filter(key => !fields.includes(key))
  if (extras.length > 0) throw new Error(`${where} has unknown fields: ${extras.join(', ')}`)
}

function strictDocument(text: string, source: string): Record<string, unknown> {
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error(`${source} exceeds ${MAX_FILE_BYTES} bytes`)
  const document = parseDocument(text, { prettyErrors: true, uniqueKeys: true, merge: false, schema: 'core' })
  if (document.errors.length > 0) throw new Error(`${source}: ${document.errors[0]?.message ?? 'invalid YAML'}`)
  const declaredTags = Object.keys(document.directives?.tags ?? {}).filter(tag => tag !== '!!')
  if (document.directives?.yaml?.explicit === true || declaredTags.length > 0) {
    throw new Error(`${source} cannot declare YAML directives or tags`)
  }
  visit(document, (_key, node) => {
    const object = node !== null && typeof node === 'object' ? node as { anchor?: string; tag?: string } : undefined
    if (isAlias(node) || object?.anchor !== undefined || object?.tag !== undefined) {
      throw new Error(`${source} cannot use aliases, anchors, or tags`)
    }
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || pair.key.value === '<<') {
          throw new Error(`${source} requires string keys and forbids merge keys`)
        }
      }
    } else if (!isPair(node) && !isSeq(node) && !isScalar(node) && node !== null) {
      throw new Error(`${source} contains an unsupported YAML node`)
    }
  })
  return record(document.toJS({ maxAliasCount: 0 }), source)
}

/** Parse one no-code catalog document and reject unknown fields at every level. */
export function parseSWorkflowYaml(text: string, source = 's-workflow document'): SWorkflowYamlDocument {
  const root = strictDocument(text, source)
  const common = ['apiVersion', 'kind', 'metadata', 'service']
  const metadata = record(root.metadata, `${source}.metadata`)
  exact(metadata, ['id', 'version'], `${source}.metadata`)
  if (root.kind === 'WorkflowDefinition') {
    exact(root, [...common, 'presets', 'steps'], source)
    if (!Array.isArray(root.presets) || !Array.isArray(root.steps)) throw new Error(`${source} presets and steps must be sequences`)
    const steps = root.steps.map((item, index) => {
      const step = record(item, `${source}.steps[${index}]`)
      exact(step, ['id', 'kind', 'description'], `${source}.steps[${index}]`)
      return { id: step.id, kind: step.kind, description: step.description }
    })
    return {
      apiVersion: root.apiVersion,
      kind: root.kind,
      metadata,
      service: root.service,
      presets: root.presets,
      steps,
    } as unknown as SWorkflowDefinition
  }
  if (root.kind === 'ServiceAdapter') {
    exact(root, [...common, 'promptBundles', 'toolPackages', 'skillPackages', 'reviewKind'], source)
    if (!Array.isArray(root.promptBundles) || !Array.isArray(root.toolPackages) || !Array.isArray(root.skillPackages)) {
      throw new Error(`${source} adapter package and prompt fields must be sequences`)
    }
    const promptBundles = root.promptBundles.map((item, index) => {
      const ref = record(item, `${source}.promptBundles[${index}]`)
      exact(ref, ['id', 'version'], `${source}.promptBundles[${index}]`)
      return ref
    })
    return {
      apiVersion: root.apiVersion,
      kind: root.kind,
      metadata,
      service: root.service,
      promptBundles,
      toolPackages: root.toolPackages,
      skillPackages: root.skillPackages,
      reviewKind: root.reviewKind,
    } as unknown as SWorkflowServiceAdapter
  }
  throw new Error(`${source} has unsupported kind ${String(root.kind)}`)
}

function files(root: string): string[] {
  const path = resolve(root)
  const info = statSync(path)
  if (info.isFile()) return [path]
  if (!info.isDirectory()) throw new Error(`s-workflow root is not a file or directory: ${path}`)
  return readdirSync(path, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map(entry => resolve(path, entry.name)).sort()
}

/** Register every document and release registrations on plugin teardown. */
/** Startup barrier proving every configured workflow document is registered. */
export class SWorkflowYamlProvider extends Service {
  static inject = ['sWorkflow']
  static Config = Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'sWorkflowYaml')
    const disposers: Array<() => void> = []
    for (const root of config.roots) {
      for (const path of files(root)) {
        const document = parseSWorkflowYaml(readFileSync(path, 'utf8'), path)
        disposers.push(document.kind === 'WorkflowDefinition'
          ? ctx.sWorkflow.registerDefinition(document, path)
          : ctx.sWorkflow.registerAdapter(document, path))
      }
    }
    ctx.effect(() => () => { for (const dispose of disposers.reverse()) dispose() })
  }
}

export default SWorkflowYamlProvider
