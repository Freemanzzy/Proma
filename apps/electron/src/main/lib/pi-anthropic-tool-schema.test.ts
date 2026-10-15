import { describe, expect, test } from 'bun:test'
import type { Model, Tool } from '@earendil-works/pi-ai'
import { stream } from '@earendil-works/pi-ai/api/anthropic-messages'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { Type } from 'typebox'

interface RequestTool {
  name: string
  input_schema: Record<string, unknown>
  strict?: boolean
}

interface CapturedRequest {
  tools: RequestTool[]
}

const model: Model<'anthropic-messages'> = {
  id: 'deepseek-v4-pro',
  name: 'DeepSeek schema fixture',
  api: 'anthropic-messages',
  provider: 'deepseek',
  baseUrl: 'https://schema-fixture.invalid/anthropic',
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
  compat: { supportsEagerToolInputStreaming: false },
}

// 真实经过 Pi provider 和 Anthropic SDK 的 HTTP 序列化；fetch 完全本地替身，绝不访问供应商。
async function captureRequest(tool: Tool, supportsStrictTools = false) {
  const requests: CapturedRequest[] = []
  const fetchFixture = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push(JSON.parse(await request.text()) as CapturedRequest)
    const events = [
      {
        type: 'message_start',
        message: { id: 'schema-fixture', model: model.id, usage: { input_tokens: 1, output_tokens: 0 } },
      },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } },
      { type: 'message_stop' },
    ]
    return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
      headers: { 'content-type': 'text/event-stream' },
    })
  }) as typeof fetch
  const result = await stream(
    { ...model, compat: { ...model.compat, supportsStrictTools } },
    normalizeContext({ tools: [tool], messages: [{ role: 'user', content: 'schema fixture', timestamp: 0 }] }),
    { apiKey: 'local-fixture-not-a-secret', fetch: fetchFixture, maxRetries: 0, cacheRetention: 'none' },
  ).result()
  return { requests, result }
}

function createTool(schema: Record<string, unknown>, constrainedSampling?: Tool['constrainedSampling']): Tool {
  return {
    name: 'mcp__rea__annotate_native_function',
    description: '本地 schema 回归 fixture，不执行 REA 操作',
    parameters: Type.Unsafe(schema),
    ...(constrainedSampling === undefined ? {} : { constrainedSampling }),
  }
}

// 来自 REA 6.4.0 listTools 的最小复现，保留引发报错的 __schema2 → __schema3 引用链。
function reaSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      procedure: { $ref: '#/$defs/__schema0' },
      comment: { $ref: '#/$defs/__schema2', description: 'Regular entry comment; empty text clears it' },
    },
    required: ['procedure'],
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    additionalProperties: false,
    $defs: {
      __schema0: { type: 'string', minLength: 1 },
      __schema2: { description: 'Regular entry comment; empty text clears it', $ref: '#/$defs/__schema3' },
      __schema3: { type: 'string' },
    },
  }
}

function expectSentTool(requests: CapturedRequest[]): RequestTool {
  expect(requests).toHaveLength(1)
  expect(requests[0]!.tools).toHaveLength(1)
  return requests[0]!.tools[0]!
}

describe('Pi Anthropic 工具 schema 的无损传输', () => {
  test('Given REA 多级 $ref When DeepSeek 组装请求 Then 保留 $defs 和全部约束且不修改输入', async () => {
    const schema = reaSchema()
    const before = structuredClone(schema)
    const { requests, result } = await captureRequest(createTool(schema))

    expect(result.stopReason).toBe('stop')
    expect(expectSentTool(requests).input_schema).toEqual(schema)
    expect(schema).toEqual(before)
  })

  test('Given 顶层组合与对象限制 When 非 strict 传输 Then 不丢失互斥和附加属性约束', async () => {
    const schema = {
      type: 'object',
      properties: { path: { type: 'string' }, address: { type: 'string' } },
      required: [],
      oneOf: [{ required: ['path'] }, { required: ['address'] }],
      not: { required: ['path', 'address'] },
      propertyNames: { minLength: 1 },
      additionalProperties: false,
      minProperties: 1,
    }
    const { requests, result } = await captureRequest(createTool(schema))

    expect(result.stopReason).toBe('stop')
    expect(expectSentTool(requests).input_schema).toEqual(schema)
  })

  test('Given Draft-07 definitions 与转义引用 When 序列化 Then 保留定义及原始 JSON Pointer', async () => {
    const schema = {
      type: 'object',
      properties: { value: { $ref: '#/definitions/a~1b~0c' } },
      required: ['value'],
      definitions: { 'a/b~c': { type: 'string', minLength: 1 } },
    }
    const { requests } = await captureRequest(createTool(schema))

    expect(expectSentTool(requests).input_schema).toEqual(schema)
  })

  test('Given 递归 $ref When 传输 Then 保留递归引用而不展开或删除约束', async () => {
    const schema = {
      type: 'object',
      properties: { root: { $ref: '#/$defs/node' } },
      required: ['root'],
      $defs: {
        node: {
          type: 'object',
          properties: { children: { type: 'array', items: { $ref: '#/$defs/node' } } },
          additionalProperties: false,
        },
      },
    }
    const { requests, result } = await captureRequest(createTool(schema))

    expect(result.stopReason).toBe('stop')
    expect(expectSentTool(requests).input_schema).toEqual(schema)
  })

  test('Given 普通空参数工具 When 传输 Then 保留既有 properties 和 required 默认值且不强开 strict', async () => {
    const { requests } = await captureRequest(createTool({ type: 'object' }))
    const sentTool = expectSentTool(requests)

    expect(sentTool.input_schema).toEqual({ type: 'object', properties: {}, required: [] })
    expect(sentTool.strict).toBeUndefined()
  })

  test('Given 支持 strict 的兼容 schema When 要求约束采样 Then 仍补全 nullable 和 required', async () => {
    const schema = {
      type: 'object',
      properties: { procedure: { type: 'string' }, comment: { type: 'string' } },
      required: ['procedure'],
    }
    const before = structuredClone(schema)
    const { requests, result } = await captureRequest(createTool(schema, { type: 'json_schema', strict: 'require' }), true)
    const sentTool = expectSentTool(requests)

    expect(result.stopReason).toBe('stop')
    expect(sentTool.strict).toBe(true)
    expect(sentTool.input_schema).toEqual({
      type: 'object',
      properties: { procedure: { type: 'string' }, comment: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
      required: ['procedure', 'comment'],
      additionalProperties: false,
    })
    expect(schema).toEqual(before)
  })

  test('Given prefer strict 遇到 $ref When SDK 回退非 strict Then 定义仍完整且不强开 strict', async () => {
    const schema = reaSchema()
    const { requests, result } = await captureRequest(createTool(schema, { type: 'json_schema', strict: 'prefer' }), true)
    const sentTool = expectSentTool(requests)

    expect(result.stopReason).toBe('stop')
    expect(sentTool.strict).toBeUndefined()
    expect(sentTool.input_schema).toEqual(schema)
  })

  test('Given require strict 遇到不支持的 $ref When SDK 拒绝 Then 不发送请求且不放宽约束', async () => {
    const { requests, result } = await captureRequest(createTool(reaSchema(), { type: 'json_schema', strict: 'require' }), true)

    expect(requests).toHaveLength(0)
    expect(result.stopReason).toBe('error')
    expect(result.errorMessage).toContain('requires JSON-schema constrained sampling')
  })
})
