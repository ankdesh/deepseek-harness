/**
 * Vitest automated test suite for the DeepSeek Harness Goal Preset Data Scenarios.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import GoalService from '@deepseek-ai/dsh-goal'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import * as GoalRoundDriver from '@deepseek-ai/dsh-goal-round-driver'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as ToolGoal from '@deepseek-ai/dsh-tool-goal'
import * as DataScenarioTools from '../src/tools.ts'
import { SCENARIO_1_OBJECTIVE } from '../src/scenario_cleaner.ts'
import { SCENARIO_2_OBJECTIVE } from '../src/scenario_analyzer.ts'

type ScriptEntry = StreamChunk[] | ((options: GenerateOptions) => StreamChunk[])

/** Scripted in-memory LLM Adapter to drive exact multi-round tool calling. */
class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: ScriptEntry[]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) {
      throw new Error(`ScriptedAdapter: script exhausted at request ${this.requests.length}`)
    }
    const chunks = typeof entry === 'function' ? entry(options) : entry
    for (const chunk of chunks) yield chunk
  }
}

function textChunk(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } },
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
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  if (agent.status === 'idle') return Promise.resolve()
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

async function waitForGoal(
  ctx: Context,
  agent: Agent,
  predicate: (goal: GoalView | undefined) => boolean,
  timeout = 20_000,
): Promise<GoalView | undefined> {
  await vi.waitFor(() => {
    expect(predicate(ctx.goals.get(agent))).toBe(true)
  }, { timeout })
  return ctx.goals.get(agent)
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(c => c.fiber.dispose()))
  // Clean output directory after test
  rmSync(resolve(process.cwd(), 'examples/goal-preset-scenarios/output'), { recursive: true, force: true })
})

describe('Goal Preset Data Scenarios', { timeout: 30_000 }, () => {
  it('Scenario 1: autonomously inspects raw CSV, writes cleaning script, executes it, and documents findings across 3 rounds', async () => {
    const ctx = new Context()
    contexts.push(ctx)

    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(GoalService, { defaultMaxGoalRounds: 8 })
    await ctx.plugin(ToolGoal, { blockedAfterConsecutiveRounds: 2 })
    await ctx.plugin(GoalRoundDriver)
    await ctx.plugin(DataScenarioTools)
    await ctx.plugin(AgentLoop, { agents: [] })

    const agent = await ctx.agentLoop.create(SessionId(`test-cleaner-${Date.now()}`), {
      provider: 'mock',
      model: 'mock',
    })
    let goalId = ''

    const cleaningScriptContent = `
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
print(f"Cleaned {len(df)} rows")
`.trim()

    const dataProfileContent = `# Raw Sales Dataset Profile & Cleaning Documentation

## Overview
* **Source**: \`examples/goal-preset-scenarios/data/raw_sales_data.csv\`
* **Cleaned Destination**: \`examples/goal-preset-scenarios/output/cleaned_sales_data.csv\`
* **Total Cleaned Rows**: 25

## Quality Issues Addressed
1. **Duplicates**: Dropped 1 duplicate entry on \`order_id\` 1004.
2. **Missing Values**: Imputed \`customer_age\` with dataset median and \`discount_percent\` with 0.
3. **Format Normalization**: Standardized dates to ISO 8601 (\`YYYY-MM-DD\`) and normalized currency strings to numeric float values.
4. **Categorical Consistency**: Unified status abbreviations (\`DLVD\` -> \`Delivered\`).
`.trim()

    // Scripted LLM behavior across 3 rounds
    const script: ScriptEntry[] = [
      // --- ROUND 1 ---
      // Step 1: inspect raw data
      toolCallChunk({
        id: 'call_inspect',
        name: 'inspect_csv',
        args: { file_path: 'examples/goal-preset-scenarios/data/raw_sales_data.csv' },
      }),
      // Step 2: conclude round 1 with findings
      textChunk('I inspected raw_sales_data.csv. Found 1 duplicate row and missing values in customer_age and discount_percent. In Round 2 I will write and run the cleaning script.'),

      // --- ROUND 2 (Scheduled automatically by GoalRoundDriver) ---
      // Step 3: write clean_sales_data.py
      toolCallChunk({
        id: 'call_write_cleaner',
        name: 'write_file',
        args: {
          file_path: 'examples/goal-preset-scenarios/output/clean_sales_data.py',
          content: cleaningScriptContent,
        },
      }),
      // Step 4: execute clean_sales_data.py
      toolCallChunk({
        id: 'call_exec_cleaner',
        name: 'execute_python_code',
        args: {
          code: 'import subprocess; exec(open("examples/goal-preset-scenarios/output/clean_sales_data.py").read())',
        },
      }),
      // Step 5: conclude round 2
      textChunk('Cleaning script executed successfully and generated output/cleaned_sales_data.csv. In Round 3 I will generate data_profile.md and complete the goal.'),

      // --- ROUND 3 (Scheduled automatically by GoalRoundDriver) ---
      // Step 6: write data_profile.md
      toolCallChunk({
        id: 'call_write_profile',
        name: 'write_file',
        args: {
          file_path: 'examples/goal-preset-scenarios/output/data_profile.md',
          content: dataProfileContent,
        },
      }),
      // Step 7: get current goal revision before updating
      toolCallChunk({
        id: 'call_get_goal',
        name: 'get_goal',
        args: {},
      }),
      // Step 8: mark goal complete
      () => toolCallChunk({
        id: 'call_complete',
        name: 'update_goal',
        args: {
          goal_id: goalId,
          revision: ctx.goals.get(agent)?.revision ?? 1,
          action: 'complete',
        },
      }),
      // Step 9: final confirmation
      textChunk('Cleaning and documentation complete. Goal marked complete.'),
    ]

    const adapter = new ScriptedAdapter(script)
    ctx.llm.registerAdapter(['mock'], adapter)

    // Create durable goal
    const goalView = ctx.goals.create(agent, {
      objective: SCENARIO_1_OBJECTIVE,
      maxGoalRounds: 8,
    })
    goalId = String(goalView.id)

    // Wait until goal completes
    await waitForGoal(ctx, agent, goal => goal?.phase === 'complete')
    await waitForIdle(ctx, agent)

    // Assert goal reached complete phase
    const finalGoal = ctx.goals.get(agent)
    expect(finalGoal?.phase).toBe('complete')
    expect(finalGoal?.roundsStarted).toBe(3)

    // Assert files were generated
    const cleanerPath = resolve(process.cwd(), 'examples/goal-preset-scenarios/output/clean_sales_data.py')
    const cleanedCsvPath = resolve(process.cwd(), 'examples/goal-preset-scenarios/output/cleaned_sales_data.csv')
    const profilePath = resolve(process.cwd(), 'examples/goal-preset-scenarios/output/data_profile.md')

    expect(existsSync(cleanerPath)).toBe(true)
    expect(existsSync(cleanedCsvPath)).toBe(true)
    expect(existsSync(profilePath)).toBe(true)

    // Check cleaned CSV content
    const csvContent = readFileSync(cleanedCsvPath, 'utf-8')
    expect(csvContent).toContain('Delivered')
    expect(csvContent).not.toContain('DLVD')
    expect(csvContent).not.toContain('$1,250.00') // stripped currency signs
  })

  it('Scenario 2: analyzes cleaned sales data, generates pandas script, and produces insights report', async () => {
    // First, ensure cleaned data exists
    const cleanerScript = `
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
    const { spawnSync } = await import('node:child_process')
    spawnSync('uv', ['run', '--with', 'pandas', 'python', '-c', cleanerScript], { encoding: 'utf-8' })

    const ctx = new Context()
    contexts.push(ctx)

    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(GoalService, { defaultMaxGoalRounds: 8 })
    await ctx.plugin(ToolGoal, { blockedAfterConsecutiveRounds: 2 })
    await ctx.plugin(GoalRoundDriver)
    await ctx.plugin(DataScenarioTools)
    await ctx.plugin(AgentLoop, { agents: [] })

    const agent = await ctx.agentLoop.create(SessionId(`test-analyzer-${Date.now()}`), {
      provider: 'mock',
      model: 'mock',
    })
    let goalId = ''

    const analysisScriptContent = `
import pandas as pd
df = pd.read_csv('examples/goal-preset-scenarios/output/cleaned_sales_data.csv')
total_rev = df['amount'].sum()
avg_val = df['amount'].mean()
by_cat = df.groupby('product_category')['amount'].sum().to_dict()
print(f"Total: {total_rev}, Avg: {avg_val}, ByCat: {by_cat}")
`.trim()

    const insightsContent = `# Sales Performance & Customer Insights Report

## Key Findings
* **Total Net Sales**: $13,409.24 across 25 fulfilled orders.
* **Average Order Value (AOV)**: $536.37.
* **Top Category**: Electronics accounts for over 70% of total revenue.
* **Customer Retention**: High-value repeat transactions identified for CUST-101 and CUST-105.
`.trim()

    const script: ScriptEntry[] = [
      // --- ROUND 1 ---
      toolCallChunk({
        id: 'call_inspect_clean',
        name: 'inspect_csv',
        args: { file_path: 'examples/goal-preset-scenarios/output/cleaned_sales_data.csv' },
      }),
      textChunk('Dataset verified with 25 rows and 0 nulls. In Round 2 I will write and run analyze_sales.py.'),

      // --- ROUND 2 ---
      toolCallChunk({
        id: 'call_write_analyzer',
        name: 'write_file',
        args: {
          file_path: 'examples/goal-preset-scenarios/output/analyze_sales.py',
          content: analysisScriptContent,
        },
      }),
      toolCallChunk({
        id: 'call_exec_analyzer',
        name: 'execute_python_code',
        args: {
          code: 'exec(open("examples/goal-preset-scenarios/output/analyze_sales.py").read())',
        },
      }),
      textChunk('Analysis script executed successfully. In Round 3 I will document insights in sales_insights.md and complete the goal.'),

      // --- ROUND 3 ---
      toolCallChunk({
        id: 'call_write_insights',
        name: 'write_file',
        args: {
          file_path: 'examples/goal-preset-scenarios/output/sales_insights.md',
          content: insightsContent,
        },
      }),
      toolCallChunk({
        id: 'call_get_goal_2',
        name: 'get_goal',
        args: {},
      }),
      // Step 8: mark goal complete
      () => toolCallChunk({
        id: 'call_complete_2',
        name: 'update_goal',
        args: {
          goal_id: goalId,
          revision: ctx.goals.get(agent)?.revision ?? 1,
          action: 'complete',
        },
      }),
      textChunk('Sales analysis complete and insights report generated. Goal marked complete.'),
    ]

    const adapter = new ScriptedAdapter(script)
    ctx.llm.registerAdapter(['mock'], adapter)

    const goalView = ctx.goals.create(agent, {
      objective: SCENARIO_2_OBJECTIVE,
      maxGoalRounds: 8,
    })
    goalId = String(goalView.id)

    await waitForGoal(ctx, agent, goal => goal?.phase === 'complete')
    await waitForIdle(ctx, agent)

    const finalGoal = ctx.goals.get(agent)
    expect(finalGoal?.phase).toBe('complete')
    expect(finalGoal?.roundsStarted).toBe(3)

    const analyzerPath = resolve(process.cwd(), 'examples/goal-preset-scenarios/output/analyze_sales.py')
    const insightsPath = resolve(process.cwd(), 'examples/goal-preset-scenarios/output/sales_insights.md')

    expect(existsSync(analyzerPath)).toBe(true)
    expect(existsSync(insightsPath)).toBe(true)

    const report = readFileSync(insightsPath, 'utf-8')
    expect(report).toContain('Total Net Sales')
    expect(report).toContain('Average Order Value')
  })
})
