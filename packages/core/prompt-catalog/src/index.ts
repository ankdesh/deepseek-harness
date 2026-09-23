/**
 * Startup-owned, immutable prompt bundle catalog.
 * @module @deepseek-ai/dsh-prompt-catalog
 */

import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'

const ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\s*\}\}/g
export const MAX_PROMPT_TEXT_BYTES = 32 * 1024
export const MAX_PROMPT_BUNDLE_BYTES = 128 * 1024
export const MAX_BOUND_PROMPT_BYTES = 64 * 1024

export interface PromptBundleSection {
  readonly id: string
  readonly order: number
  readonly text: string
}

export interface PromptBundle {
  readonly apiVersion: 'dsh.deepseek.ai/v1'
  readonly kind: 'PromptBundle'
  readonly metadata: { readonly id: string; readonly version: string }
  readonly sections: readonly PromptBundleSection[]
  readonly texts?: Readonly<Record<string, string>>
}

export interface PromptBundleRef {
  readonly id: string
  readonly version: string
}

export interface PromptCatalogEntry {
  readonly bundle: PromptBundle
  readonly digest: `sha256:${string}`
  readonly source: string
}

export interface BoundPromptBundle {
  readonly ref: PromptBundleRef
  readonly digest: `sha256:${string}`
  readonly sections: readonly PromptBundleSection[]
  readonly texts: Readonly<Record<string, string>>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    promptCatalog: PromptCatalog
  }
}

/** Stable JSON form used for content identity. */
export function canonicalJson(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical)
    if (item === null || typeof item !== 'object') return item
    return Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]))
  }
  return JSON.stringify(canonical(value))
}

/** Validate and detach a bundle before it enters the catalog. */
export function validatePromptBundle(value: PromptBundle): PromptBundle {
  if (value.apiVersion !== 'dsh.deepseek.ai/v1' || value.kind !== 'PromptBundle') {
    throw new Error('prompt bundle must use apiVersion dsh.deepseek.ai/v1 and kind PromptBundle')
  }
  if (!ID.test(value.metadata.id) || !VERSION.test(value.metadata.version)) {
    throw new Error('prompt bundle metadata id or version is invalid')
  }
  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    throw new Error('prompt bundle requires at least one section')
  }
  const sectionIds = new Set<string>()
  const sections = value.sections.map((section) => {
    if (!ID.test(section.id) || sectionIds.has(section.id)) {
      throw new Error(`prompt bundle section id is invalid or duplicated: ${section.id}`)
    }
    sectionIds.add(section.id)
    if (!Number.isSafeInteger(section.order) || section.order < 0) {
      throw new Error(`prompt bundle section ${section.id} has an invalid order`)
    }
    checkText(`section ${section.id}`, section.text)
    return { id: section.id, order: section.order, text: section.text }
  }).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  const texts: Record<string, string> = {}
  for (const [key, text] of Object.entries(value.texts ?? {})) {
    if (!ID.test(key) || Object.hasOwn(texts, key)) throw new Error(`prompt text id is invalid or duplicated: ${key}`)
    checkText(`text ${key}`, text)
    texts[key] = text
  }
  const bundle: PromptBundle = {
    apiVersion: value.apiVersion,
    kind: value.kind,
    metadata: { ...value.metadata },
    sections,
    ...Object.keys(texts).length === 0 ? {} : { texts },
  }
  if (Buffer.byteLength(canonicalJson(bundle)) > MAX_PROMPT_BUNDLE_BYTES) {
    throw new Error(`prompt bundle exceeds ${MAX_PROMPT_BUNDLE_BYTES} bytes`)
  }
  return bundle
}

function checkText(name: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`prompt ${name} must be non-empty text`)
  if (Buffer.byteLength(value) > MAX_PROMPT_TEXT_BYTES) {
    throw new Error(`prompt ${name} exceeds ${MAX_PROMPT_TEXT_BYTES} bytes`)
  }
}

function render(text: string, variables: Readonly<Record<string, string>>): string {
  const rendered = text.replace(PLACEHOLDER, (_whole, key: string) => {
    const value = variables[key]
    if (value === undefined) throw new Error(`prompt variable ${key} is missing`)
    if (value.includes('{{') || value.includes('}}')) throw new Error(`prompt variable ${key} contains template syntax`)
    return value
  })
  if (rendered.includes('{{') || rendered.includes('}}')) throw new Error('prompt contains an unresolved or malformed variable reference')
  return rendered
}

/** Immutable after startup sealing; registrations remain effect-owned for teardown. */
export class PromptCatalog extends Service {
  private readonly entries = new Map<string, PromptCatalogEntry>()
  private sealed = false

  constructor(ctx: Context) {
    super(ctx, 'promptCatalog')
  }

  register(input: PromptBundle, source = 'inline'): () => void {
    if (this.sealed) throw new Error('prompt catalog is sealed')
    const bundle = validatePromptBundle(input)
    const key = this.key(bundle.metadata)
    if (this.entries.has(key)) throw new Error(`duplicate prompt bundle ${key}`)
    const digest = `sha256:${createHash('sha256').update(canonicalJson(bundle)).digest('hex')}` as const
    const entry = { bundle, digest, source }
    this.entries.set(key, entry)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.entries.get(key) === entry) this.entries.delete(key)
    }
  }

  get(ref: PromptBundleRef): PromptCatalogEntry {
    const entry = this.entries.get(this.key(ref))
    if (entry === undefined) throw new Error(`unknown prompt bundle ${this.key(ref)}`)
    return entry
  }

  list(): readonly PromptCatalogEntry[] {
    return [...this.entries.values()].sort((left, right) =>
      this.key(left.bundle.metadata).localeCompare(this.key(right.bundle.metadata)))
  }

  bind(ref: PromptBundleRef, variables: Readonly<Record<string, string>> = {}): BoundPromptBundle {
    const entry = this.get(ref)
    const sections = entry.bundle.sections.map(section => ({ ...section, text: render(section.text, variables) }))
    const texts = Object.fromEntries(Object.entries(entry.bundle.texts ?? {})
      .map(([key, text]) => [key, render(text, variables)]))
    const total = sections.reduce((bytes, section) => bytes + Buffer.byteLength(section.text), 0)
      + Object.values(texts).reduce((bytes, text) => bytes + Buffer.byteLength(text), 0)
    if (total > MAX_BOUND_PROMPT_BYTES) throw new Error(`bound prompt exceeds ${MAX_BOUND_PROMPT_BYTES} bytes`)
    return { ref: { ...ref }, digest: entry.digest, sections, texts }
  }

  seal(): void { this.sealed = true }
  isSealed(): boolean { return this.sealed }

  private key(ref: PromptBundleRef): string { return `${ref.id}@${ref.version}` }
}

export default PromptCatalog
