import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import PromptCatalog from '../src/index.ts'

const bundle = {
  apiVersion: 'dsh.deepseek.ai/v1' as const,
  kind: 'PromptBundle' as const,
  metadata: { id: 'test.prompt', version: '1.0.0' },
  sections: [
    { id: 'output', order: 300, text: 'Answer for {{binding.id}}.' },
    { id: 'persona', order: 100, text: 'You are focused.' },
  ],
  texts: { tool: 'Read {{binding.id}}.' },
}

describe('PromptCatalog', () => {
  it('orders, digests, binds and seals bundles', async () => {
    const ctx = new Context()
    await ctx.plugin(PromptCatalog)
    ctx.promptCatalog.register(bundle, 'fixture')
    const bound = ctx.promptCatalog.bind(bundle.metadata, { 'binding.id': 'doc-1' })
    expect(bound.sections.map(section => section.id)).toEqual(['persona', 'output'])
    expect(bound.sections[1]?.text).toBe('Answer for doc-1.')
    expect(bound.texts.tool).toBe('Read doc-1.')
    expect(bound.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    ctx.promptCatalog.seal()
    expect(() => ctx.promptCatalog.register({ ...bundle, metadata: { id: 'later', version: '1.0.0' } })).toThrow(/sealed/)
    await ctx.fiber.dispose()
  })

  it('rejects duplicates and unresolved variables', async () => {
    const ctx = new Context()
    await ctx.plugin(PromptCatalog)
    ctx.promptCatalog.register(bundle)
    expect(() => ctx.promptCatalog.register(bundle)).toThrow(/duplicate/)
    expect(() => ctx.promptCatalog.bind(bundle.metadata)).toThrow(/binding\.id is missing/)
    expect(() => ctx.promptCatalog.bind(bundle.metadata, { 'binding.id': '{{other.id}}' })).toThrow(/template syntax/)
    ctx.promptCatalog.register({
      ...bundle,
      metadata: { id: 'malformed', version: '1.0.0' },
      sections: [{ id: 'persona', order: 100, text: 'Use {{binding-id}}.' }],
    })
    expect(() => ctx.promptCatalog.bind({ id: 'malformed', version: '1.0.0' })).toThrow(/malformed variable/)
    await ctx.fiber.dispose()
  })
})
