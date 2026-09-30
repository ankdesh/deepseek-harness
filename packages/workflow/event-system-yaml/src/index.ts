/** Startup-only, no-code event templates with separately authored Markdown prompts. */
import { readFileSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { parseDocument, visit, isAlias, isMap, isScalar } from 'yaml'
import { validateDefinition } from '@deepseek-ai/dsh-event-system'
import type { EventSystemDefinition } from '@deepseek-ai/dsh-event-system'

/** Required trusted roots and byte limits; templates are read once. */
export interface Config {
  /** Trusted files or immediate-child directories to load at startup. */
  roots: string[]
  /** Maximum UTF-8 byte length of each YAML definition. */
  maxFileBytes: number
  /** Maximum UTF-8 byte length of each contained Markdown prompt. */
  maxPromptBytes: number
}
export const Config: z<Config> = z.object({
  roots: z.array(z.string()).required(),
  maxFileBytes: z.number().step(1).min(1).required(),
  maxPromptBytes: z.number().step(1).min(1).required(),
})
declare module '@deepseek-ai/cordis' {
  interface Context {
    eventSystemsYaml: EventSystemYamlProvider
  }
}

/**
 * Parse strict YAML, resolve contained Markdown prompt files, then validate every reference.
 * @param text - untrusted YAML file text.
 * @param source - absolute definition filename.
 * @param limits - explicit YAML and prompt byte limits.
 * @returns validated definition with resolved Markdown text.
 */
export function parseEventSystemYaml(
  text: string,
  source: string,
  limits: Pick<Config, 'maxFileBytes' | 'maxPromptBytes'>,
): EventSystemDefinition {
  if (Buffer.byteLength(text) > limits.maxFileBytes) throw new Error(`${source}: YAML byte limit exceeded`)
  const document = parseDocument(text, { uniqueKeys: true, merge: false, schema: 'core' })
  const parseError = document.errors[0]
  if (parseError) throw new Error(`${source}: ${parseError.message}`)
  if (document.directives.yaml.explicit || Object.keys(document.directives.tags).some(tag => tag !== '!!'))
    throw new Error(`${source}: YAML directives are forbidden`)
  visit(document, (_key, node) => {
    if (
      isAlias(node) ||
      (node && typeof node === 'object' && (('anchor' in node && node.anchor) || ('tag' in node && node.tag)))
    )
      throw new Error(`${source}: YAML tags, anchors, and aliases are forbidden`)
    if (isMap(node))
      for (const pair of node.items)
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || pair.key.value === '<<')
          throw new Error(`${source}: YAML keys must be strings; merge keys are forbidden`)
  })
  const value: unknown = document.toJS({ maxAliasCount: 0 })
  const definition = validateDefinition(value)
  const base = realpathSync(dirname(source))
  const agents = definition.agents.map((member) => {
    const path = realpathSync(resolve(base, member.prompt))
    const child = relative(base, path)
    if (
      isAbsolute(child) ||
      child === '..' ||
      child.startsWith('../') ||
      child.startsWith('..\\') ||
      !path.endsWith('.md')
    )
      throw new Error(`${source}: prompt must be a contained Markdown file`)
    const prompt = readFileSync(path, 'utf8')
    if (Buffer.byteLength(prompt) > limits.maxPromptBytes) throw new Error(`${path}: prompt byte limit exceeded`)
    if (!prompt.trim()) throw new Error(`${path}: prompt is empty`)
    return { ...member, prompt }
  })
  return validateDefinition({ ...definition, agents })
}

/** Register startup templates and release all registrations on disposal. */
export default class EventSystemYamlProvider extends Service {
  static inject = ['eventSystems']
  static Config = Config
  constructor(ctx: Context, config: Config) {
    super(ctx, 'eventSystemsYaml')
    const disposers: Array<() => void> = []
    ctx.effect(() => () => {
      for (const dispose of disposers.reverse()) dispose()
    })
    for (const root of config.roots) {
      const path = resolve(root)
      const paths = statSync(path).isDirectory()
        ? readdirSync(path)
          .filter(name => /\.ya?ml$/.test(name))
          .map(name => resolve(path, name))
          .sort()
        : [path]
      for (const source of paths)
        disposers.push(
          ctx.eventSystems.registerDefinition(parseEventSystemYaml(readFileSync(source, 'utf8'), source, config)),
        )
    }
  }
}
