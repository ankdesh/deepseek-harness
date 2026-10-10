/** Pure definition validation and graph compilation. */
import { createHash } from 'node:crypto'
import { assertSupportedJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { snapshotJsonValue, deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { CompiledFlow, FlowDefinition, FlowOperation, FlowRef, FlowValue } from './types.ts'

/** Stable identity independent of JSON property order.
 * @param value - JSON data.
 * @returns SHA-256 identity.
 */
export function flowDigest(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v !== null && typeof v === 'object'
        ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map(k => [k, canonical((v as Record<string, unknown>)[k])]),
        )
        : v
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
}
/** Exact catalog key.
 * @param ref - Named version.
 * @returns Key.
 */
export function flowKey(ref: FlowRef): string {
  return ref.id + '@' + ref.version
}
/** Enforce a schema at file, model, service, or persistence admission.
 * @param schema - Supported schema.
 * @param value - Candidate JSON.
 * @param where - Diagnostic location.
 */
export function assertFlowValue(schema: JsonSchemaNode, value: unknown, where: string): void {
  const problems = validateJsonSchemaValue(schema, value, where)
  if (problems.length) throw new Error(problems.join('; '))
}
/** Resolve typed references recursively without coercing values.
 * @param value - Literal or reference tree.
 * @param inputs - Local inputs.
 * @param outputs - Committed local outputs.
 * @returns Detached JSON value.
 */
export function resolveFlowValue(
  value: FlowValue,
  inputs: JsonValue,
  outputs: Readonly<Record<string, JsonValue>>,
): JsonValue {
  const resolve = (v: JsonValue): JsonValue => {
    if (Array.isArray(v)) return v.map(resolve)
    if (v !== null && typeof v === 'object') {
      if (Object.keys(v).length === 1 && typeof v.$ref === 'string') {
        const parts = v.$ref.split('.')
        let current: unknown = parts.shift() === 'inputs' ? inputs : outputs
        for (const part of parts) {
          if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part))
            throw new Error('Unresolved flow reference ' + v.$ref)
          current = (current as Record<string, unknown>)[part]
        }
        const result = snapshotJsonValue(current)
        if (result === undefined) throw new Error('Reference is not JSON: ' + v.$ref)
        return result as JsonValue
      }
      if (Object.keys(v).length === 1 && Object.hasOwn(v, '$literal')) return v.$literal as JsonValue
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]))
    }
    return v
  }
  return resolve(value)
}
function exact(v: Record<string, unknown>, keys: string[], location: string): void {
  for (const key of Object.keys(v))
    if (!keys.includes(key)) throw new Error(location + ': unknown field ' + key)
}
function object(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(where + ' requires an object')
  return value as Record<string, unknown>
}
/** Validate developer-authored data before registering it.
 * @param input - Untrusted YAML or JSON.
 * @returns Detached typed definition.
 */
export function defineFlow(input: FlowDefinition): FlowDefinition {
  const v = object(snapshotJsonValue(input), 'flow')
  exact(
    v,
    ['id', 'version', 'description', 'inputSchema', 'outputSchema', 'nodes', 'outputs', 'publication'],
    'flow',
  )
  for (const k of ['id', 'version', 'description'])
    if (typeof v[k] !== 'string' || !v[k].trim()) throw new Error('Flow ' + k + ' must be nonempty')
  if (!Object.hasOwn(v, 'outputs')) throw new Error('Flow outputs are required')
  assertSupportedJsonSchema(input.inputSchema)
  assertSupportedJsonSchema(input.outputSchema)
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- YAML and JSON admission must reject non-object input schemas.
  if (input.inputSchema.type !== 'object') throw new Error('Flow inputs require an object schema')
  if (!Array.isArray(input.nodes) || !input.nodes.length) throw new Error('Flow requires nodes')
  const ids = new Set<string>()
  for (const node of input.nodes as readonly import('./types.ts').FlowNode[]) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(node.id) || ids.has(node.id))
      throw new Error('Invalid or duplicate node ID ' + node.id)
    ids.add(node.id)
    const common = ['id', 'kind', 'next', 'result']
    const fields = {
      call: ['operation', 'inputs'],
      model: ['instructions', 'inputs', 'outputSchema', 'conversation'],
      wait: ['request', 'outputSchema'],
      branch: ['value', 'equals', 'then', 'otherwise'],
      flow: ['flow', 'inputs'],
    }
    if (!(node.kind in fields)) throw new Error('Unknown flow node kind')
    exact(object(node, node.id), [...common, ...fields[node.kind]], node.id)
    for (const field of fields[node.kind].filter(field => field !== 'conversation'))
      if (!Object.hasOwn(node, field)) throw new Error(node.id + ': missing field ' + field)
    if (node.next !== undefined && node.next !== null && typeof node.next !== 'string')
      throw new Error('Invalid node destination')
    if (
      node.kind === 'branch' &&
      [node.then, node.otherwise].some(target => target !== null && typeof target !== 'string')
    )
      throw new Error('Invalid branch destination')
    if (node.kind === 'model' || node.kind === 'wait') assertSupportedJsonSchema(node.outputSchema)
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Check model schema at data admission.
    if (node.kind === 'model' && (!node.instructions.trim() || node.outputSchema.type !== 'object'))
      throw new Error('Model phase requires instructions and object result schema')
    if (node.kind === 'call' || node.kind === 'flow') {
      const ref = node.kind === 'call' ? node.operation : node.flow
      exact(object(ref, node.id), ['id', 'version'], node.id)
      if (typeof ref.id !== 'string' || typeof ref.version !== 'string' || !ref.id || !ref.version)
        throw new Error('Exact registered version is required')
    }
  }
  if (input.publication) {
    exact(object(input.publication, 'publication'), ['toolName', 'contexts'], 'publication')
    if (
      !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(input.publication.toolName) ||
      !input.publication.contexts.length ||
      input.publication.contexts.some(x => typeof x !== 'string' || !x)
    )
      throw new Error('Invalid flow publication')
  }
  return deepFreeze(v) as unknown as FlowDefinition
}
/** Validate a code operation's recovery declaration.
 * @param operation - Typed operation.
 * @returns The operation.
 */
export function defineOperation<I, O>(operation: FlowOperation<I, O>): FlowOperation<I, O> {
  if (
    !['read', 'write'].includes(operation.effect) ||
    !['repeat', 'receipt', 'manual'].includes(operation.recovery) ||
    typeof operation.execute !== 'function'
  )
    throw new Error('Invalid operation declaration')
  if (!operation.id || !operation.version) throw new Error('Operation requires exact identity')
  assertSupportedJsonSchema(operation.inputSchema)
  assertSupportedJsonSchema(operation.outputSchema)
  if (!['cooperative', 'await-settlement'].includes(operation.cancellation))
    throw new Error('Operation requires cancellation behavior')
  if (operation.effect === 'write' && operation.recovery === 'repeat')
    throw new Error('Writes require receipt or manual recovery')
  if (operation.recovery === 'receipt' && !operation.reconcile)
    throw new Error('Receipt recovery requires reconcile')
  return Object.freeze({
    ...operation,
    // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
    inputSchema: deepFreeze(snapshotJsonValue(operation.inputSchema)!),
    // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
    outputSchema: deepFreeze(snapshotJsonValue(operation.outputSchema)!),
  })
}
/** Compile an acyclic graph and its exact subflows without invoking operations.
 * @param definition - Registered root definition.
 * @param definitions - Exact definition lookup.
 * @param operations - Exact operation lookup.
 * @param maxNodes - Maximum expanded nodes.
 * @param ancestry - Internal recursion check.
 * @returns Immutable compiled graph.
 */
export function compileFlow(
  definition: FlowDefinition,
  definitions: ReadonlyMap<string, FlowDefinition>,
  operations: ReadonlyMap<string, FlowOperation>,
  maxNodes: number,
  ancestry: readonly string[] = [],
): CompiledFlow {
  const d = defineFlow(definition),
    key = flowKey(d)
  if (ancestry.includes(key)) throw new Error('Recursive subflow ' + key)
  const schemas = new Map<string, JsonSchemaNode>(),
    subflows: Record<string, CompiledFlow> = {},
    pinned: Record<string, string> = {}
  const incoming = new Map<string, Set<string>>(),
    reachable = new Set<string>()
  const index = new Map(d.nodes.map((n, i) => [n.id, i]))
  const successor = (i: number): string | null =>
    d.nodes[i]?.next === undefined ? (d.nodes[i + 1]?.id ?? null) : (d.nodes[i].next ?? null)
  for (let i = 0; i < d.nodes.length; i++) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
    const node = d.nodes[i]!
    const targets = node.kind === 'branch' ? [node.then, node.otherwise] : [successor(i)]
    for (const target of targets)
      if (target !== null) {
        const at = index.get(target)
        if (at === undefined || at <= i) throw new Error('Unknown or cyclic destination ' + target)
        const set = incoming.get(target) ?? new Set<string>()
        set.add(node.id)
        incoming.set(target, set)
      }
    if (node.kind === 'call') {
      const op = operations.get(flowKey(node.operation))
      if (!op) throw new Error('Missing operation ' + flowKey(node.operation))
      pinned[flowKey(node.operation)] = flowDigest({
        id: op.id,
        version: op.version,
        inputSchema: op.inputSchema,
        outputSchema: op.outputSchema,
        effect: op.effect,
        cancellation: op.cancellation,
        recovery: op.recovery,
      })
      schemas.set(node.id, op.outputSchema)
    } else if (node.kind === 'flow') {
      const sub = definitions.get(flowKey(node.flow))
      if (!sub) throw new Error('Missing subflow ' + flowKey(node.flow))
      subflows[node.id] = compileFlow(sub, definitions, operations, maxNodes, [...ancestry, key])
      schemas.set(node.id, sub.outputSchema)
    } else schemas.set(node.id, node.kind === 'branch' ? { type: 'boolean' } : node.outputSchema)
  }
  const dominators = new Map<string, Set<string>>()
  function referenceSchema(ref: string, available: ReadonlySet<string>): JsonSchemaNode {
    const parts = ref.split('.')
    const source = parts.shift()
    let schema: JsonSchemaNode | undefined
    if (source === 'inputs') schema = d.inputSchema
    else if (source === 'nodes') {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
      const id = parts.shift()!
      if (!available.has(id)) throw new Error('Reference does not dominate use: ' + ref)
      schema = schemas.get(id)
    } else throw new Error('Unknown reference root ' + ref)
    for (const part of parts) {
      if (!schema?.required?.includes(part)) throw new Error('Reference field is not guaranteed: ' + ref)
      schema = schema.properties?.[part]
    }
    if (!schema) throw new Error('Unknown reference field ' + ref)
    return schema
  }
  function compatible(source: JsonSchemaNode, target: JsonSchemaNode): boolean {
    if (!target.type && !target.oneOf) return true
    if (source.oneOf) return source.oneOf.every(part => compatible(part, target))
    if (target.oneOf) return target.oneOf.filter(part => compatible(source, part)).length === 1
    if (
      !source.type ||
      (source.type !== target.type && !(source.type === 'integer' && target.type === 'number'))
    )
      return false
    if (Object.hasOwn(target, 'const') && (!Object.hasOwn(source, 'const') || source.const !== target.const))
      return false
    if (
      target.enum &&
      !(Object.hasOwn(source, 'const')
        ? // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
        target.enum.includes(source.const!)
        : // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
        source.enum?.every(value => target.enum!.includes(value)))
    )
      return false
    if (target.type === 'array' && target.items && (!source.items || !compatible(source.items, target.items)))
      return false
    if (target.type === 'object') {
      for (const field of target.required ?? [])
        if (!source.required?.includes(field) || !source.properties?.[field]) return false
      if (
        target.additionalProperties === false &&
        (source.additionalProperties !== false ||
          Object.keys(source.properties ?? {}).some(field => !target.properties?.[field]))
      )
        return false
      for (const [field, schema] of Object.entries(source.properties ?? {}))
        if (target.properties?.[field] && !compatible(schema, target.properties[field])) return false
    }
    return true
  }
  function check(
    value: JsonValue,
    expected: JsonSchemaNode | undefined,
    available: ReadonlySet<string>,
  ): void {
    if (expected?.oneOf) {
      const matches = expected.oneOf.filter((candidate) => {
        try {
          check(value, candidate, available)
          return true
        } catch {
          return false
        }
      })
      if (matches.length !== 1) throw new Error('Input must match exactly one declared schema alternative')
      return
    }
    if (value !== null && !Array.isArray(value) && typeof value === 'object') {
      if (typeof value.$ref === 'string' && Object.keys(value).length === 1) {
        const schema = referenceSchema(value.$ref, available)
        if (expected && !compatible(schema, expected))
          throw new Error('Incompatible reference schema ' + value.$ref)
        return
      }
      if (Object.keys(value).length === 1 && Object.hasOwn(value, '$literal')) {
        if (expected) assertFlowValue(expected, value.$literal, 'literal')
        return
      }
      if (expected?.type && expected.type !== 'object') throw new Error('Incompatible object input')
      for (const required of expected?.required ?? [])
        if (!Object.hasOwn(value, required)) throw new Error('Missing input field ' + required)
      for (const [field, x] of Object.entries(value)) {
        if (expected?.additionalProperties === false && !expected.properties?.[field])
          throw new Error('Unknown input field ' + field)
        check(x, expected?.properties?.[field], available)
      }
    } else if (Array.isArray(value)) {
      if (expected?.type && expected.type !== 'array') throw new Error('Incompatible array input')
      for (const x of value) check(x, expected?.items, available)
    } else if (expected) assertFlowValue(expected, value, 'literal')
  }
  const ends: Set<string>[] = []
  for (let i = 0; i < d.nodes.length; i++) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
    const n = d.nodes[i]!,
      parents = [...(incoming.get(n.id) ?? [])]
    if (i === 0) reachable.add(n.id)
    else if (parents.some(p => reachable.has(p))) reachable.add(n.id)
    else throw new Error('Unreachable node ' + n.id)
    const available = parents.length
      ? new Set(
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
        [...dominators.get(parents[0]!)!].filter(id => parents.every(p => dominators.get(p)?.has(id))),
      )
      : new Set<string>()
    // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
    if (n.kind === 'call') check(n.inputs, operations.get(flowKey(n.operation))!.inputSchema, available)
    // oxlint-disable-next-line typescript/no-non-null-assertion -- Admitted node or receipt exists.
    if (n.kind === 'flow') check(n.inputs, subflows[n.id]!.inputSchema, available)
    if (n.kind === 'model') {
      check(n.inputs, undefined, available)
      if (n.conversation) check(n.conversation, { type: 'string' }, available)
    }
    if (n.kind === 'wait') check(n.request, undefined, available)
    if (n.kind === 'branch') {
      check(n.value, undefined, available)
      if (
        n.value &&
        typeof n.value === 'object' &&
        !Array.isArray(n.value) &&
        Object.keys(n.value).length === 1 &&
        typeof n.value.$ref === 'string'
      )
        assertFlowValue(referenceSchema(n.value.$ref, available), n.equals, 'branch equality')
    }
    available.add(n.id)
    dominators.set(n.id, available)
    const endsHere = n.kind === 'branch' ? n.then === null || n.otherwise === null : successor(i) === null
    if (n.result !== undefined) {
      if (!endsHere) throw new Error('Node result requires a terminal edge')
      check(n.result, d.outputSchema, available)
    } else if (endsHere) ends.push(available)
  }
  const final = new Set([...(ends[0] ?? [])].filter(id => ends.every(x => x.has(id))))
  if (ends.length) check(d.outputs, d.outputSchema, final)
  const expandedNodes =
    d.nodes.length + Object.values(subflows).reduce((sum, sub) => sum + sub.expandedNodes, 0)
  if (expandedNodes > maxNodes) throw new Error('Expanded flow exceeds node bound')
  const body = { ...d, subflows, operations: pinned, expandedNodes }
  return deepFreeze({ ...body, digest: flowDigest(body) })
}
