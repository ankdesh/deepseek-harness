/** Real Loader and AgentLoop execution with only the provider scripted. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import Sessions from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import Invariants from '@deepseek-ai/dsh-invariants'
import * as EventInvariant from '../src/invariant.ts'
import Goals from '@deepseek-ai/dsh-goal'
import * as GoalDriver from '@deepseek-ai/dsh-goal-round-driver'
import EventSystems from '../src/index.ts'
import type { EventSystemDefinition, ExecutionLimits } from '../src/types.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
export const limits: ExecutionLimits = {
  maxRounds: 20,
  maxRequests: 50,
  maxTokens: 1000000,
  maxActiveMillis: 60000,
  maxMembers: 3,
  maxConcurrency: 2,
  maxPending: 50,
  maxEvents: 100,
  maxPayloadBytes: 8192,
  maxDepth: 8,
  maxOutputTokens: 128,
}
const exampleRoot = new URL('../examples/analysis-review/', import.meta.url)
const example = JSON.parse(readFileSync(new URL('system.yml', exampleRoot), 'utf8')) as EventSystemDefinition
export const definition: EventSystemDefinition = {
  ...example,
  agents: example.agents.map(member => ({
    ...member,
    prompt: readFileSync(new URL(member.prompt, exampleRoot), 'utf8'),
    provider: 'mock',
    model: 'mock',
  })),
}

class CollaborationAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const last = options.messages.at(-1)
    let input: { event?: { id: string; type: string } } = {}
    if (last?.source?.kind === 'plugin') {
      const text = last.content.find(block => block.type === 'text')
      if (text?.type === 'text' && text.text.startsWith('{')) input = JSON.parse(text.text) as typeof input
    }
    const type = input.event?.type
    if (type === 'user.requested' || type === 'analysis.ready') {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield {
        type: 'block-end',
        index: 0,
        block: {
          type: 'tool-call',
          id: ToolCallId(randomUUID()),
          name: 'publish_event',
          arguments: JSON.stringify({
            type: type === 'user.requested' ? 'analysis.ready' : 'review.ready',
            payload_json: JSON.stringify(
              type === 'user.requested' ? { findings: 'Analysis complete.' } : { result: 'Review passed.' },
            ),
            dedupe_key: input.event!.id,
          }),
        },
      }
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'text', text: type === 'review.ready' ? 'Review accepted.' : 'Request accepted.' },
      }
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

export async function boot(root?: string) {
  const directory = root ?? (await mkdtemp(join(tmpdir(), 'dsh-events-loader-')))
  if (!root) roots.push(directory)
  const configPath = join(directory, 'cordis.yml')
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', Llm],
    ['@deepseek-ai/dsh-session', Sessions],
    ['@deepseek-ai/dsh-session-projection', Projections],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', Tools],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlPersistence],
    ['@deepseek-ai/dsh-token-meter', TokenMeter],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-sqlite', StorageSqlite],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-event-system', EventSystems],
    ['@deepseek-ai/dsh-invariants', Invariants],
    ['@deepseek-ai/dsh-event-system/invariant', EventInvariant],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-goal', Goals],
    ['@deepseek-ai/dsh-goal-round-driver', GoalDriver],
  ])
  const rows = [...modules.keys()].map((name) => {
    const config = name.endsWith('session-persistence-jsonl')
      ? { root: join(directory, 'sessions'), compression: 'none' }
      : name.endsWith('storage-sqlite')
        ? { path: join(directory, 'state.sqlite3') }
        : name.endsWith('storage-domain')
          ? { backend: 'sqlite' }
          : name.endsWith('agent-loop')
            ? { agents: [] }
            : name.endsWith('dsh-goal')
              ? { defaultMaxGoalRounds: 8 }
              : undefined
    return `- name: '${name}'${config ? '\n  config: ' + JSON.stringify(config) : ''}`
  })
  await writeFile(configPath, rows.join('\n') + '\n')
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(directory).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected import ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  await ctx.eventSystems.ready
  const adapter = new CollaborationAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter, directory }
}
