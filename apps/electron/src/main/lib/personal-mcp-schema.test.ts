import { afterEach, expect, test } from 'bun:test'
import { normalizeMcpInputSchema, resetPersonalMcpSchemaWarningsForTest } from './personal-mcp-schema'

afterEach(() => resetPersonalMcpSchemaWarningsForTest())

test('removes top-level anyOf (nowledge-mem thread_fetch_messages shape) and describes it', () => {
  const schema = {
    type: 'object',
    properties: { thread_id: { type: 'string' }, thread_reference: { type: 'string' }, limit: { type: 'integer' } },
    anyOf: [{ required: ['thread_id'] }, { required: ['thread_reference'] }],
  }
  const result = normalizeMcpInputSchema(schema, 'mcp__nowledge-mem__thread_fetch_messages')
  expect(result.schema).toEqual({ type: 'object', properties: schema.properties })
  expect('anyOf' in schema).toBe(true) // 原对象不被修改
  expect(result.note).toBe('参数约束：需提供 thread_id，或 需提供 thread_reference')
})

test('handles oneOf and allOf together, keeps nested combinators', () => {
  const nested = { anyOf: [{ type: 'string' }, { type: 'number' }] }
  const result = normalizeMcpInputSchema({ type: 'object', properties: { v: nested }, oneOf: [{ required: ['a'] }, { required: ['b'] }], allOf: [{ required: ['c'] }] })
  expect(result.schema).toEqual({ type: 'object', properties: { v: nested } })
  expect(result.note).toBe('参数约束：需提供 a，或（仅一项）需提供 b；需提供 c')
})

test('leaves ordinary schemas untouched (same object, no note)', () => {
  const schema = { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }
  const result = normalizeMcpInputSchema(schema)
  expect(result.schema).toBe(schema)
  expect(result.note).toBeNull()
})

test('truncates very long notes and warns once per tool', () => {
  const warns: unknown[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => { warns.push(args) }
  try {
    const branches = Array.from({ length: 80 }, (_, i) => ({ required: [`field_${i}`] }))
    const a = normalizeMcpInputSchema({ type: 'object', anyOf: branches }, 'tool-x')
    normalizeMcpInputSchema({ type: 'object', anyOf: branches }, 'tool-x')
    expect(a.note!.length).toBe(400)
    expect(a.note!.endsWith('…')).toBe(true)
    expect(warns.length).toBe(1)
  } finally { console.warn = original }
})

test('re-checks removed required-only combinators before execution', async () => {
  const { checkRemovedTopLevelConstraints } = await import('./personal-mcp-schema')
  const anyOf = { type: 'object', anyOf: [{ required: ['a'] }, { required: ['b'] }] }
  expect(checkRemovedTopLevelConstraints(anyOf, {})).toBe('参数不满足工具约束（anyOf）：需提供 a，或 需提供 b')
  expect(checkRemovedTopLevelConstraints(anyOf, { b: 'x' })).toBeNull()
  const oneOf = { type: 'object', oneOf: [{ required: ['a'] }, { required: ['b'] }] }
  expect(checkRemovedTopLevelConstraints(oneOf, { a: 1, b: 2 })).not.toBeNull()
  expect(checkRemovedTopLevelConstraints(oneOf, { a: 1 })).toBeNull()
  const allOf = { type: 'object', allOf: [{ required: ['a'] }, { required: ['c'] }] }
  expect(checkRemovedTopLevelConstraints(allOf, { a: 1 })).not.toBeNull()
  expect(checkRemovedTopLevelConstraints(allOf, { a: 1, c: 0 })).toBeNull()
  // 非 required-only 形状不在本地校验，交给服务端
  expect(checkRemovedTopLevelConstraints({ type: 'object', anyOf: [{ properties: { a: { const: 1 } } }] }, {})).toBeNull()
})
