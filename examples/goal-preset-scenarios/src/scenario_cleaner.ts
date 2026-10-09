/**
 * Scenario 1: Multi-Step CSV Data Explorer and Cleaner
 */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountGoalPreset } from './preset.ts'

export interface ScenarioCleanerOptions {
  rawCsvPath?: string
  outputDir?: string
  maxRounds?: number
}

export const SCENARIO_1_OBJECTIVE =
  'Inspect the raw sales dataset at data/raw_sales_data.csv for data hygiene issues (missing values, '
  + 'inconsistent dates, currency formatting, typos in status, duplicates). Write and execute clean_sales_data.py '
  + 'to produce output/cleaned_sales_data.csv, generate data_profile.md describing the dataset, '
  + 'and mark the goal complete.'

export const SCENARIO_1_INITIAL_PROMPT =
  'Please explore the dataset at data/raw_sales_data.csv. Clean all anomalies and output the cleaned data to '
  + 'output/cleaned_sales_data.csv. Also create a data description report at output/data_profile.md. '
  + 'Use your goal tools to track progress and mark complete when finished.'

/**
 * Initializes and sets up the agent session for Scenario 1.
 */
export async function setupCleanerScenario(
  ctx: Context,
  options: ScenarioCleanerOptions = {},
): Promise<{ agent: Agent; goalId: string }> {
  await mountGoalPreset(ctx, { maxGoalRounds: options.maxRounds ?? 8 })

  const sessionId = SessionId(`cleaner-scenario-${Date.now()}`)
  const agent = await ctx.agentLoop.create(sessionId, {
    provider: 'default',
    model: 'default',
  })

  // Start the durable goal
  const goalView = ctx.goals.create(agent, {
    objective: SCENARIO_1_OBJECTIVE,
    maxGoalRounds: options.maxRounds ?? 8,
  })

  return { agent, goalId: String(goalView.id) }
}
