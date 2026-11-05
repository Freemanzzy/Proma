import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPiMcpTools, disposePiMcpConnections } from './pi-mcp-tools'

const dir = mkdtempSync(join(tmpdir(), 'pi-mcp-schema-'))
afterAll(async () => { await disposePiMcpConnections(); rmSync(dir, { recursive: true, force: true }) })

// 最小 stdio MCP 服务器：一个工具顶层 anyOf（nowledge-mem 2026-11-05 的形状），一个普通工具。
const serverPath = join(dir, 'server.mjs')
writeFileSync(serverPath, `
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
const server = new Server({ name: 'schema-fixture', version: '1.0.0' }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'fetch', description: 'Fetch thread', inputSchema: { type: 'object', properties: { thread_id: { type: 'string' }, thread_reference: { type: 'string' } }, anyOf: [{ required: ['thread_id'] }, { required: ['thread_reference'] }] } },
  { name: 'plain', description: 'Plain tool', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
] }))
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
await server.connect(new StdioServerTransport())
`)

test('MCP tools reaching Pi have no top-level combinators; the constraint moves into the description', async () => {
  const tools = await buildPiMcpTools({ fixture: { type: 'stdio', command: process.execPath, args: [serverPath], env: { NODE_PATH: join(process.cwd(), 'node_modules') } } } as never)
  const fetch = tools.find((tool) => tool.name.endsWith('fetch'))!
  const plain = tools.find((tool) => tool.name.endsWith('plain'))!
  const fetchSchema = JSON.parse(JSON.stringify(fetch.parameters))
  for (const key of ['anyOf', 'oneOf', 'allOf']) expect(key in fetchSchema).toBe(false)
  expect(fetchSchema.properties).toEqual({ thread_id: { type: 'string' }, thread_reference: { type: 'string' } })
  expect(fetch.description).toBe('Fetch thread\n参数约束：需提供 thread_id，或 需提供 thread_reference')
  expect(plain.description).toBe('Plain tool')
  expect(JSON.parse(JSON.stringify(plain.parameters)).required).toEqual(['q'])
}, 30_000)
