/**
 * Scenario 2: Automated Code Generator for Data Analysis using Pandas
 */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountGoalPreset } from './preset.ts'

export interface ScenarioAnalyzerOptions {
  cleanedCsvPath?: string
  outputDir?: string
  maxRounds?: number
}

export const SCENARIO_2_OBJECTIVE =
  'Analyze output/cleaned_sales_data.csv using Pandas. Write and run analyze_sales.py to compute '
  + 'total revenue, monthly trends, sales by category, average order value, and repeat customers. '
  + 'Generate sales_insights.md with findings and mark the goal complete.'

export const SCENARIO_2_INITIAL_PROMPT =
  'Please analyze the cleaned sales dataset at output/cleaned_sales_data.csv using Pandas. '
  + 'Formulate an analytical plan, generate and execute analyze_sales.py, write the findings '
  + 'to output/sales_insights.md, and mark the goal complete.'

/**
 * Initializes and sets up the agent session for Scenario 2.
 */
export async function setupAnalyzerScenario(
  ctx: Context,
  options: ScenarioAnalyzerOptions = {},
): Promise<{ agent: Agent; goalId: string }> {
  await mountGoalPreset(ctx, { maxGoalRounds: options.maxRounds ?? 8 })

  const sessionId = SessionId(`analyzer-scenario-${Date.now()}`)
  const agent = await ctx.agentLoop.create(sessionId, {
    provider: 'default',
    model: 'default',
  })

  // Start the durable goal
  const goalView = ctx.goals.create(agent, {
    objective: SCENARIO_2_OBJECTIVE,
    maxGoalRounds: options.maxRounds ?? 8,
  })

  return { agent, goalId: String(goalView.id) }
}
