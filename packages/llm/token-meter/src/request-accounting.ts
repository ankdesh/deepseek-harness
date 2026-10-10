/** Shared reservation and settlement rules for bounded native execution. */
import type { TokenUsage } from '@deepseek-ai/dsh-llm/types'
/** Reserve conservative request capacity before provider access.
 * @param envelope - Exact serialized messages, system prompt, and tool schemas.
 * @param maxOutputTokens - Explicit output allowance.
 * @param measuredContextTokens - Existing replay-aware context measurement.
 * @returns Conservative input plus output capacity.
 */
export function reserveRequestTokens(envelope: unknown, maxOutputTokens: number, measuredContextTokens: number = 0): number {
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || !Number.isFinite(measuredContextTokens) || measuredContextTokens < 0) throw new Error('Request reservation requires finite explicit limits')
  return Math.max(Buffer.byteLength(JSON.stringify(envelope)), measuredContextTokens) + maxOutputTokens
}
/** Sum provider-reported disjoint token buckets; reasoning is an output subset.
 * @param usage - Correlated provider usage, when available.
 * @returns Actual spending, or undefined to retain a conservative reservation.
 */
export function reportedRequestTokens(usage: TokenUsage | undefined): number | undefined {
  if (!usage) return undefined
  const buckets = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0]
  if (buckets.some(value => !Number.isSafeInteger(value) || value < 0)) return undefined
  const total = buckets.reduce((sum, value) => sum + value, 0)
  return Number.isSafeInteger(total) ? total : undefined
}
/** Settle exactly once at the caller's persisted receipt boundary.
 * @param reserved - Committed conservative capacity.
 * @param reported - Validated correlated usage; undefined preserves uncertainty.
 * @returns The charge retained for this request.
 */
export function settleRequestTokens(reserved: number, reported: number | undefined): number {
  return reported === undefined ? reserved : reported
}
