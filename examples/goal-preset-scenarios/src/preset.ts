/**
 * Goal Preset Composition for Data Scenarios.
 * Mounts the durable goal service, model-facing goal tools, round driver, and domain tools.
 */
import type { Context } from '@deepseek-ai/cordis'
import GoalService from '@deepseek-ai/dsh-goal'
import * as GoalRoundDriver from '@deepseek-ai/dsh-goal-round-driver'
import * as ToolGoal from '@deepseek-ai/dsh-tool-goal'
import * as DataScenarioTools from './tools.ts'

export interface GoalPresetOptions {
  maxGoalRounds?: number
  blockedAfterConsecutiveRounds?: number
}

/**
 * Mounts the complete goal preset suite into the given Cordis context.
 */
export async function mountGoalPreset(ctx: Context, options: GoalPresetOptions = {}): Promise<void> {
  // 1. Durable Goal Service
  await ctx.plugin(GoalService, {
    defaultMaxGoalRounds: options.maxGoalRounds ?? 8,
  })

  // 2. Model-facing Goal Tools (`get_goal`, `create_goal`, `update_goal`)
  await ctx.plugin(ToolGoal, {
    blockedAfterConsecutiveRounds: options.blockedAfterConsecutiveRounds ?? 2,
  })

  // 3. Goal Round Driver (drives multi-round continuation when goal is active)
  await ctx.plugin(GoalRoundDriver)

  // 4. Data Scenario Domain Tools (inspect_csv, execute_python_code, write_file, read_file)
  await ctx.plugin(DataScenarioTools)
}
