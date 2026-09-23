import { describe, expect, it } from 'vitest'
import { parsePromptBundleYaml } from '../src/index.ts'

const valid = `apiVersion: dsh.deepseek.ai/v1
kind: PromptBundle
metadata:
  id: test.prompt
  version: 1.0.0
sections:
  - id: persona
    order: 100
    text: You are focused.
`

describe('prompt bundle YAML', () => {
  it('parses the strict document', () => {
    expect(parsePromptBundleYaml(valid).metadata.id).toBe('test.prompt')
  })
  it.each([
    `${valid}unknown: true\n`,
    valid.replace('text: You are focused.', 'text: &shared You are focused.\ntexts:\n  copied: *shared'),
    valid.replace('metadata:', 'metadata:\n  extra: nope'),
  ])('rejects unsupported YAML or fields', (source) => {
    expect(() => parsePromptBundleYaml(source)).toThrow()
  })
})
