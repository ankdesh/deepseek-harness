#!/usr/bin/env tsx
/**
 * CLI Runner for DeepSeek Harness Goal Preset Scenarios.
 *
 * Demonstrates autonomous multi-round agent execution driven by GoalRoundDriver.
 *
 * Usage:
 *   # Run Scenario 1 (CSV Exploration & Cleaning) in offline mock mode:
 *   pnpm exec tsx examples/goal-preset-scenarios/run.ts --scenario 1 --mock
 *
 *   # Run Scenario 2 (Automated Pandas Analysis & Reporting) in offline mock mode:
 *   pnpm exec tsx examples/goal-preset-scenarios/run.ts --scenario 2 --mock
 *
 *   # Run with real LLM (OpenAI / DeepSeek / etc.):
 *   OPENAI_API_KEY=sk-... pnpm exec tsx examples/goal-preset-scenarios/run.ts --scenario 1 --provider openai --model gpt-4o-mini
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import GoalService from '@deepseek-ai/dsh-goal'
import * as GoalRoundDriver from '@deepseek-ai/dsh-goal-round-driver'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as ToolGoal from '@deepseek-ai/dsh-tool-goal'
import * as DataScenarioTools from './src/tools.ts'
import { SCENARIO_1_OBJECTIVE } from './src/scenario_cleaner.ts'
import { SCENARIO_2_OBJECTIVE } from './src/scenario_analyzer.ts'

// --- Scripted Mock LLM Adapter for Offline Verification ---
type ScriptEntry = StreamChunk[] | ((options: GenerateOptions) => StreamChunk[])

class ScriptedAdapter extends LlmAdapter {
  constructor(private readonly script: ScriptEntry[]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const entry = this.script.shift()
    if (entry === undefined) {
      throw new Error('ScriptedAdapter: script exhausted')
    }
    const chunks = typeof entry === 'function' ? entry(options) : entry
    for (const chunk of chunks) yield chunk
  }
}

function textChunk(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 20, outputTokens: 20 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallChunk(call: { id: string; name: string; args: object }): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    {
      type: 'block-end',
      index: 0,
      block: {
        type: 'tool-call',
        id: ToolCallId(call.id),
        name: call.name,
        arguments: JSON.stringify(call.args),
      },
    },
    { type: 'usage', usage: { inputTokens: 20, outputTokens: 20 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

// --- CLI Arguments Parsing ---
function parseArgs(): {
  scenario: 1 | 2
  mock: boolean
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
  maxRounds: number
} {
  const args = process.argv.slice(2)
  let scenario: 1 | 2 = 1
  let mock = false
  let provider = 'openai'
  let model = 'gpt-4o-mini'
  let apiKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || ''
  let baseUrl: string | undefined
  let maxRounds = 8

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--scenario' && args[i + 1]) {
      const val = parseInt(args[++i], 10)
      if (val === 2) scenario = 2
    } else if (arg === '--mock') {
      mock = true
    } else if (arg === '--provider' && args[i + 1]) {
      provider = args[++i]
    } else if (arg === '--model' && args[i + 1]) {
      model = args[++i]
    } else if (arg === '--api-key' && args[i + 1]) {
      apiKey = args[++i]
    } else if (arg === '--base-url' && args[i + 1]) {
      baseUrl = args[++i]
    } else if (arg === '--max-rounds' && args[i + 1]) {
      maxRounds = parseInt(args[++i], 10)
    }
  }

  // Default to mock mode if no API key is detected
  if (!apiKey && !mock) {
    console.log('\n[NOTICE] No API key detected in environment. Falling back to deterministic --mock mode.\n')
    mock = true
  }

  return { scenario, mock, provider, model, apiKey, baseUrl, maxRounds }
}

async function main() {
  const opts = parseArgs()
  const outputDir = resolve(process.cwd(), 'examples/goal-preset-scenarios/output')
  mkdirSync(outputDir, { recursive: true })

  console.log('='.repeat(70))
  console.log('  DEEPSEEK HARNESS - GOAL PRESET SCENARIO RUNNER')
  console.log('='.repeat(70))
  console.log(`Scenario : ${opts.scenario === 1 ? '1: Multi-Step CSV Data Explorer & Cleaner' : '2: Automated Pandas Data Analyzer & Reporter'}`)
  console.log(`Mode     : ${opts.mock ? 'Mock (Deterministic offline execution)' : `Live LLM (${opts.provider} / ${opts.model})`}`)
  console.log(`Max Rnds : ${opts.maxRounds}`)
  console.log(`Output   : ${outputDir}`)
  console.log('='.repeat(70))

  const objective = opts.scenario === 1 ? SCENARIO_1_OBJECTIVE : SCENARIO_2_OBJECTIVE
  console.log(`\nObjective:\n"${objective}"\n`)

  // Pre-requisite for Scenario 2: Ensure cleaned data exists
  if (opts.scenario === 2) {
    const cleanedCsv = resolve(outputDir, 'cleaned_sales_data.csv')
    if (!existsSync(cleanedCsv)) {
      console.log('[Setup] Scenario 2 requires cleaned data. Pre-cleaning raw dataset...')
      const preCleanScript = `
import pandas as pd
df = pd.read_csv('examples/goal-preset-scenarios/data/raw_sales_data.csv')
df = df.drop_duplicates(subset=['order_id']).copy()
df['amount'] = df['amount'].astype(str).str.replace('$', '', regex=False).str.replace(',', '', regex=False).astype(float)
df['discount_percent'] = df['discount_percent'].fillna(0).astype(float)
df['customer_age'] = df['customer_age'].fillna(int(df['customer_age'].median())).astype(int)
df['product_category'] = df['product_category'].astype(str).str.strip().str.title()
status_map = {'dlvd': 'Delivered', 'delivered': 'Delivered', 'pending': 'Pending', 'cancelled': 'Cancelled'}
df['order_status'] = df['order_status'].astype(str).str.strip().str.lower().map(status_map).fillna('Other')
df['order_date'] = pd.to_datetime(df['order_date'], format='mixed').dt.strftime('%Y-%m-%d')
df.to_csv('examples/goal-preset-scenarios/output/cleaned_sales_data.csv', index=False)
`
      spawnSync('uv', ['run', '--with', 'pandas', 'python', '-c', preCleanScript], { encoding: 'utf-8' })
      console.log('[Setup] Generated examples/goal-preset-scenarios/output/cleaned_sales_data.csv\n')
    }
  }

  const ctx = new Context()

  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(GoalService, { defaultMaxGoalRounds: opts.maxRounds })
  await ctx.plugin(ToolGoal, { blockedAfterConsecutiveRounds: 3 })
  await ctx.plugin(GoalRoundDriver)
  await ctx.plugin(DataScenarioTools)
  await ctx.plugin(AgentLoop, { agents: [] })

  let getAgentRevision = (): number => 1
  let goalId = ''

  if (opts.mock) {
    // Deterministic mock script for offline demonstration
    const script: ScriptEntry[] = opts.scenario === 1
      ? [
        // Round 1: Inspect
        toolCallChunk({
          id: 'call_inspect',
          name: 'inspect_csv',
          args: { file_path: 'examples/goal-preset-scenarios/data/raw_sales_data.csv' },
        }),
        textChunk('I have inspected raw_sales_data.csv. Found 1 duplicate row, dirty currency amounts, inconsistent status codes, and missing values. In Round 2 I will write and execute clean_sales_data.py.'),

        // Round 2: Clean & Execute
        toolCallChunk({
          id: 'call_write_cleaner',
          name: 'write_file',
          args: {
            file_path: 'examples/goal-preset-scenarios/output/clean_sales_data.py',
            content: `import pandas as pd
df = pd.read_csv('examples/goal-preset-scenarios/data/raw_sales_data.csv')
df = df.drop_duplicates(subset=['order_id']).copy()
df['amount'] = df['amount'].astype(str).str.replace('$', '', regex=False).str.replace(',', '', regex=False).astype(float)
df['discount_percent'] = df['discount_percent'].fillna(0).astype(float)
df['customer_age'] = df['customer_age'].fillna(int(df['customer_age'].median())).astype(int)
df['product_category'] = df['product_category'].astype(str).str.strip().str.title()
status_map = {'dlvd': 'Delivered', 'delivered': 'Delivered', 'pending': 'Pending', 'cancelled': 'Cancelled'}
df['order_status'] = df['order_status'].astype(str).str.strip().str.lower().map(status_map).fillna('Other')
df['order_date'] = pd.to_datetime(df['order_date'], format='mixed').dt.strftime('%Y-%m-%d')
df.to_csv('examples/goal-preset-scenarios/output/cleaned_sales_data.csv', index=False)
print(f"Successfully cleaned {len(df)} records into output/cleaned_sales_data.csv")
`,
          },
        }),
        toolCallChunk({
          id: 'call_exec_cleaner',
          name: 'execute_python_code',
          args: {
            code: 'exec(open("examples/goal-preset-scenarios/output/clean_sales_data.py").read())',
          },
        }),
        textChunk('Cleaning script executed successfully and generated output/cleaned_sales_data.csv. In Round 3 I will generate the data profile and mark the goal complete.'),

        // Round 3: Document & Complete
        toolCallChunk({
          id: 'call_write_profile',
          name: 'write_file',
          args: {
            file_path: 'examples/goal-preset-scenarios/output/data_profile.md',
            content: `# Raw Sales Dataset Profile & Cleaning Documentation

## Overview
* **Source**: \`examples/goal-preset-scenarios/data/raw_sales_data.csv\`
* **Cleaned Destination**: \`examples/goal-preset-scenarios/output/cleaned_sales_data.csv\`
* **Total Cleaned Rows**: 25 (1 duplicate removed)

## Quality Issues Fixed
1. **Duplicates**: Dropped redundant order #1004.
2. **Data Types**: Cleaned currency string ($1,250.00 -> 1250.0).
3. **Missing Values**: Imputed customer age with median (34) and discount with 0.0.
4. **Categorical Normalization**: Normalized status abbreviations (\`DLVD\` -> \`Delivered\`).
`,
          },
        }),
        toolCallChunk({
          id: 'call_get_goal',
          name: 'get_goal',
          args: {},
        }),
        () => toolCallChunk({
          id: 'call_complete',
          name: 'update_goal',
          args: {
            goal_id: goalId,
            revision: getAgentRevision(),
            action: 'complete',
          },
        }),
        textChunk('Data exploration, cleaning pipeline, and documentation complete. Goal marked complete.'),
      ]
      : [
        // Scenario 2: Analyze
        // Round 1: Inspect cleaned CSV
        toolCallChunk({
          id: 'call_inspect_clean',
          name: 'inspect_csv',
          args: { file_path: 'examples/goal-preset-scenarios/output/cleaned_sales_data.csv' },
        }),
        textChunk('I have inspected the cleaned dataset (25 rows, no missing values). In Round 2 I will write and run analyze_sales.py to compute metrics.'),

        // Round 2: Analysis script & run
        toolCallChunk({
          id: 'call_write_analyzer',
          name: 'write_file',
          args: {
            file_path: 'examples/goal-preset-scenarios/output/analyze_sales.py',
            content: `import pandas as pd
df = pd.read_csv('examples/goal-preset-scenarios/output/cleaned_sales_data.csv')
total_rev = df['amount'].sum()
avg_val = df['amount'].mean()
by_cat = df.groupby('product_category')['amount'].sum().to_dict()
by_status = df.groupby('order_status')['amount'].sum().to_dict()
print(f"Total Revenue: \${total_rev:,.2f}")
print(f"Average Order Value: \${avg_val:,.2f}")
print(f"Revenue by Category: {by_cat}")
`,
          },
        }),
        toolCallChunk({
          id: 'call_exec_analyzer',
          name: 'execute_python_code',
          args: {
            code: 'exec(open("examples/goal-preset-scenarios/output/analyze_sales.py").read())',
          },
        }),
        textChunk('Analysis script executed successfully. In Round 3 I will write sales_insights.md and mark the goal complete.'),

        // Round 3: Document insights & Complete
        toolCallChunk({
          id: 'call_write_insights',
          name: 'write_file',
          args: {
            file_path: 'examples/goal-preset-scenarios/output/sales_insights.md',
            content: `# Sales Performance & Customer Insights Report

## Executive Summary
* **Total Net Sales**: $13,409.24 across 25 fulfilled orders.
* **Average Order Value (AOV)**: $536.37.
* **Top Category**: Electronics represents 71% of total order revenue.
* **Fulfillment**: 92% of orders successfully delivered.

## Actionable Recommendations
1. Focus promotional campaigns on high-margin Electronics accessories.
2. Follow up on pending customer orders in Home Goods.
`,
          },
        }),
        toolCallChunk({
          id: 'call_get_goal_2',
          name: 'get_goal',
          args: {},
        }),
        () => toolCallChunk({
          id: 'call_complete_2',
          name: 'update_goal',
          args: {
            goal_id: goalId,
            revision: getAgentRevision(),
            action: 'complete',
          },
        }),
        textChunk('Sales analysis complete and executive insights report generated. Goal marked complete.'),
      ]

    const adapter = new ScriptedAdapter(script)
    ctx.llm.registerAdapter(['mock'], adapter)
  } else {
    // Live LLM Provider via PiAi
    process.env.HARNESS_CLI_API_KEY = opts.apiKey
    await ctx.plugin(LlmPiAi, {
      providers: {
        [opts.provider]: {
          apiKeyEnv: 'HARNESS_CLI_API_KEY',
          ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
        },
      },
    })
  }

  // Create the agent
  const agent = await ctx.agentLoop.create(SessionId(`runner-${Date.now()}`), {
    provider: opts.mock ? 'mock' : opts.provider,
    model: opts.mock ? 'mock' : opts.model,
  })
  getAgentRevision = () => ctx.goals.get(agent)?.revision ?? 1

  // Hook live events for terminal visibility
  let currentRound = 0
  ctx.on('goal/changed', ({ change }) => {
    const goal = ctx.goals.get(agent)
    if (!goal) return
    if (goal.roundsStarted > currentRound) {
      currentRound = goal.roundsStarted
      console.log(`\n>>> [ROUND ${currentRound}/${goal.maxGoalRounds}] Starting autonomous agent cycle...`)
    }
    if (change.operation === 'complete') {
      console.log(`\n[GOAL COMPLETE] Goal ID "${goal.id}" marked complete at revision ${goal.revision}!`)
    } else if (change.operation === 'block') {
      console.log(`\n[GOAL BLOCKED] Reason: ${JSON.stringify(goal.blockedReason)}`)
    }
  })

  // Log session events (tool calls & assistant messages)
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'tool/call') {
      console.log(`  [TOOL CALL] ${event.data.name}(${JSON.stringify(event.data.arguments)})`)
    } else if (event.type === 'tool/result') {
      const toolResultBlock = event.data.message?.content?.[0] as Record<string, unknown> | undefined
      let snippet = ''
      if (toolResultBlock && 'content' in toolResultBlock && Array.isArray(toolResultBlock.content)) {
        snippet = toolResultBlock.content.map((c: unknown) => {
          if (typeof c === 'object' && c !== null && 'text' in c) {
            return String((c as Record<string, unknown>).text)
          }
          return JSON.stringify(c)
        }).join(' ')
      } else if (toolResultBlock && 'text' in toolResultBlock) {
        snippet = String(toolResultBlock.text)
      } else {
        snippet = JSON.stringify(event.data)
      }
      console.log(`  [TOOL RESULT] -> ${snippet.trim().slice(0, 120).replace(/\n/g, ' ')}...`)
    } else if (event.type === 'assistant/message') {
      for (const block of event.data.content) {
        if (block.type === 'text') {
          console.log(`  [ASSISTANT] ${block.text.trim()}`)
        }
      }
    }
  })

  // Launch the goal
  const goalView = ctx.goals.create(agent, {
    objective,
    maxGoalRounds: opts.maxRounds,
  })
  goalId = String(goalView.id)
  console.log(`[GOAL CREATED] ID: ${goalId}, Activation: ${goalView.activation}`)

  // Wait until goal reaches terminal state ('complete' or 'blocked')
  await new Promise<void>((resolvePromise) => {
    const checkInterval = setInterval(() => {
      const g = ctx.goals.get(agent)
      if (g && (g.phase === 'complete' || g.phase === 'blocked')) {
        clearInterval(checkInterval)
        resolvePromise()
      }
    }, 200)
  })

  // Ensure agent reaches idle
  if (agent.status !== 'idle') {
    await new Promise<void>((res) => {
      const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') {
          dispose()
          res()
        }
      })
    })
  }

  // Summary
  const finalGoal = ctx.goals.get(agent)
  console.log('\n' + '='.repeat(70))
  console.log('  EXECUTION SUMMARY')
  console.log('='.repeat(70))
  console.log(`Status        : ${finalGoal?.phase.toUpperCase()}`)
  console.log(`Total Rounds  : ${finalGoal?.roundsStarted}/${finalGoal?.maxGoalRounds}`)
  console.log('Generated Artifacts:')

  const files = readdirSync(outputDir)
  for (const file of files) {
    const filePath = resolve(outputDir, file)
    const stats = statSync(filePath)
    console.log(`  - ${file.padEnd(28)} (${stats.size} bytes) -> ${filePath}`)
  }

  console.log('\nSample Content from Generated Output:')
  if (opts.scenario === 1) {
    const profilePath = resolve(outputDir, 'data_profile.md')
    if (existsSync(profilePath)) {
      console.log('--- data_profile.md ---')
      console.log(readFileSync(profilePath, 'utf-8').trim())
    }
  } else {
    const insightsPath = resolve(outputDir, 'sales_insights.md')
    if (existsSync(insightsPath)) {
      console.log('--- sales_insights.md ---')
      console.log(readFileSync(insightsPath, 'utf-8').trim())
    }
  }
  console.log('='.repeat(70))

  await ctx.fiber.dispose()
  process.exit(0)
}

main().catch((err: unknown) => {
  console.error('\n[FATAL ERROR]', err)
  process.exit(1)
})
