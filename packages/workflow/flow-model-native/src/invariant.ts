/** Compare committed model outputs with independently recorded native result receipts. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { CompiledFlow, FlowModelNode, FlowNodeRecord, FlowView } from '@deepseek-ai/dsh-flow'
import { flowDigest } from '@deepseek-ai/dsh-flow'
import { flowPhaseMessageId, readFlowPhaseResult, persistedFlowEvents } from './index.ts'
export const name = 'flow-model-native-invariant'
export const inject = ['invariants']
function modelNode(definition: CompiledFlow, path: string): FlowModelNode {
  const parts = path.split('/'),
    // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
    local = parts.pop()!
  let graph = definition
  for (const part of parts) {
    const child = graph.subflows[part]
    if (!child) throw new Error('Missing compiled subflow')
    graph = child
  }
  const node = graph.nodes.find(n => n.id === local)
  if (node?.kind !== 'model') throw new Error('Model receipt does not identify a model node')
  return node
}
const install: InvariantInstaller = (ctx, fail) => {
  const check = async (flow: FlowView, receipt: FlowNodeRecord): Promise<void> => {
    for (const id of flow.conversations) {
      const context = {
        executionId: flow.id,
        nodeId: receipt.id,
        operationId: receipt.operationId,
        sourceSessionId: flow.sourceSessionId,
        signal: AbortSignal.abort(),
        claimConversation: () => {
          throw new Error('Invariant inspection cannot claim a conversation')
        },
      }
      const inbox = flowPhaseMessageId(context)
      const events = await persistedFlowEvents(ctx, id)
      if (!events.some(e => e.type === 'user/message' && e.data.id === inbox)) continue
      const result = readFlowPhaseResult(events, modelNode(flow.definition, receipt.id), context)
      if (!result || flowDigest(result.value) !== flowDigest(receipt.output))
        fail('Committed flow model output differs from its native structured-result receipt')
      return
    }
    fail('Committed flow model output has no native phase input receipt')
  }
  ctx.on(
    'flow/changed',
    async (flow) => {
      for (const receipt of flow.nodes)
        if (receipt.kind === 'model' && receipt.state === 'succeeded') {
          try {
            await check(flow, receipt)
          } catch (error) {
            fail(String(error))
          }
        }
    },
    { global: true },
  )
}
/** Register native-receipt observations through exact companion disposal.
 * @param ctx - Invariant composition.
 */
export const apply = (ctx: Context): void => {
  ctx.effect(async () => {
    const registration = ctx.invariants.register(
      '@deepseek-ai/dsh-flow-model-native',
      install,
    ) as (() => Promise<void>) & PromiseLike<void>
    await registration
    return () => registration()
  })
}
