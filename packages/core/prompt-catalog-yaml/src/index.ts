/** Strict trusted-YAML provider for prompt bundles. */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isAlias, isMap, isPair, isScalar, isSeq, parseDocument, visit } from 'yaml'
import type { PromptBundle } from '@deepseek-ai/dsh-prompt-catalog'

const MAX_FILE_BYTES = 256 * 1024

export interface Config {
  /** Trusted bundle files or non-recursive directories loaded once at startup. */
  roots: string[]
}
export const Config: z<Config> = z.object({ roots: z.array(z.string()).required() })

declare module '@deepseek-ai/cordis' {
  interface Context { promptCatalogYaml: PromptCatalogYamlProvider }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], where: string): void {
  const extra = Object.keys(value).filter(key => !expected.includes(key))
  if (extra.length > 0) throw new Error(`${where} has unknown fields: ${extra.join(', ')}`)
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} must be a mapping`)
  return value as Record<string, unknown>
}

export function parsePromptBundleYaml(text: string, source = 'prompt bundle'): PromptBundle {
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error(`${source} exceeds ${MAX_FILE_BYTES} bytes`)
  const document = parseDocument(text, { prettyErrors: true, uniqueKeys: true, merge: false, schema: 'core' })
  if (document.errors.length > 0) throw new Error(`${source}: ${document.errors[0]?.message ?? 'invalid YAML'}`)
  const declaredTags = Object.keys(document.directives?.tags ?? {}).filter(tag => tag !== '!!')
  if (document.directives?.yaml?.explicit === true || declaredTags.length > 0) {
    throw new Error(`${source} cannot declare YAML directives or tags`)
  }
  visit(document, (_key, node) => {
    const taggedNode = node !== null && typeof node === 'object'
      ? node as { anchor?: string; tag?: string }
      : undefined
    if (isAlias(node) || taggedNode?.anchor !== undefined || taggedNode?.tag !== undefined) {
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
  const root = record(document.toJS({ maxAliasCount: 0 }), source)
  exactKeys(root, ['apiVersion', 'kind', 'metadata', 'sections', 'texts'], source)
  const metadata = record(root.metadata, `${source}.metadata`)
  exactKeys(metadata, ['id', 'version'], `${source}.metadata`)
  if (!Array.isArray(root.sections)) throw new Error(`${source}.sections must be a sequence`)
  const sections = root.sections.map((item, index) => {
    const section = record(item, `${source}.sections[${index}]`)
    exactKeys(section, ['id', 'order', 'text'], `${source}.sections[${index}]`)
    return { id: section.id as string, order: section.order as number, text: section.text as string }
  })
  const texts = root.texts === undefined ? undefined : record(root.texts, `${source}.texts`)
  return {
    apiVersion: root.apiVersion as PromptBundle['apiVersion'],
    kind: root.kind as PromptBundle['kind'],
    metadata: { id: metadata.id as string, version: metadata.version as string },
    sections,
    ...texts === undefined ? {} : { texts: texts as Record<string, string> },
  }
}

function files(root: string): string[] {
  const path = resolve(root)
  const info = statSync(path)
  if (info.isFile()) return [path]
  if (!info.isDirectory()) throw new Error(`prompt catalog root is not a file or directory: ${path}`)
  return readdirSync(path, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map(entry => resolve(path, entry.name)).sort()
}

/** Startup barrier proving every configured prompt bundle is registered. */
export class PromptCatalogYamlProvider extends Service {
  static inject = ['promptCatalog']
  static Config = Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'promptCatalogYaml')
    const disposers: Array<() => void> = []
    for (const root of config.roots) {
      for (const path of files(root)) {
        disposers.push(ctx.promptCatalog.register(parsePromptBundleYaml(readFileSync(path, 'utf8'), path), path))
      }
    }
    ctx.effect(() => () => { for (const dispose of disposers.reverse()) dispose() })
  }
}

export default PromptCatalogYamlProvider
