import { describe, expect, it } from 'vitest'
import { reserveRequestTokens, reportedRequestTokens, settleRequestTokens } from '../src/request-accounting.ts'
describe('shared request accounting',()=>{
  it('reserves the larger serialized or replay-measured input with explicit output capacity',()=>{
    const request={ text:'two lines\n三' }
    expect(reserveRequestTokens(request,20,100)).toBe(120)
    expect(reserveRequestTokens(request,20)).toBe(Buffer.byteLength(JSON.stringify(request))+20)
    expect(()=>reserveRequestTokens(request,0)).toThrow(/explicit limits/)
  })
  it('charges disjoint cache buckets and does not count reasoning twice',()=>{
    const usage={ inputTokens:10,outputTokens:20,cacheReadTokens:30,cacheWriteTokens:40,reasoningTokens:15 }
    expect(reportedRequestTokens(usage)).toBe(100)
    expect(settleRequestTokens(200,reportedRequestTokens(usage))).toBe(100)
  })
  it('retains reservations for missing or invalid provider usage, including unsafe totals',()=>{
    expect(settleRequestTokens(200,reportedRequestTokens(undefined))).toBe(200)
    expect(reportedRequestTokens({ inputTokens:-1,outputTokens:20 })).toBeUndefined()
    expect(reportedRequestTokens({ inputTokens:Number.MAX_SAFE_INTEGER,outputTokens:1 })).toBeUndefined()
    expect(settleRequestTokens(200,reportedRequestTokens({ inputTokens:0,outputTokens:0 }))).toBe(0)
  })
})
