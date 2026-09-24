import { expect, test } from 'bun:test'
import { AgentPermissionService, type CanUseToolOptions } from './agent-permission-service'

function permissionOptions(signal: AbortSignal, toolUseID: string): CanUseToolOptions {
  return { signal, toolUseID, displayName: '删除分组', description: '删除 Todo 分组' }
}


test('Given a destructive planning request When it is approved Then approval is single-use and cannot create a session whitelist', async () => {
  const service = new AgentPermissionService()
  const controller = new AbortController()
  let firstRequest: { requestId: string; allowAlways?: boolean } | undefined

  const firstResult = service.requestSingleApproval(
    'session-1',
    'mcp__planning__delete_group',
    { id: 'group-1', scope: 'todo' },
    permissionOptions(controller.signal, 'tool-1'),
    (request) => { firstRequest = request },
  )

  expect(firstRequest?.allowAlways).toBe(false)
  expect(service.respondToPermission(firstRequest!.requestId, 'allow', true)).toBe('session-1')
  expect((await firstResult).behavior).toBe('allow')

  let secondRequest: { requestId: string } | undefined
  const secondResult = service.createCanUseTool('session-1', (request) => { secondRequest = request })(
    'mcp__planning__delete_group',
    { id: 'group-2', scope: 'todo' },
    permissionOptions(controller.signal, 'tool-2'),
  )

  expect(secondRequest).toBeDefined()
  expect(service.respondToPermission(secondRequest!.requestId, 'deny', false)).toBe('session-1')
  expect((await secondResult).behavior).toBe('deny')
})

test('Given an EgoBrowser call When auto permission is evaluated Then it requires approval and allows session-only whitelisting', async () => {
  const service = new AgentPermissionService()
  const controller = new AbortController()
  const firstRequests: Array<{ requestId: string; allowAlways?: boolean }> = []
  const canUseTool = service.createCanUseTool('session-ego-1', (request) => {
    firstRequests.push(request)
  })

  const firstResult = canUseTool(
    'EgoBrowser',
    { script: 'console.log("first")' },
    permissionOptions(controller.signal, 'ego-tool-1'),
  )

  expect(firstRequests).toHaveLength(1)
  expect(firstRequests[0]?.allowAlways).not.toBe(false)
  expect(service.respondToPermission(firstRequests[0]!.requestId, 'allow', true)).toBe('session-ego-1')
  expect((await firstResult).behavior).toBe('allow')

  const secondResult = canUseTool(
    'EgoBrowser',
    { script: 'console.log("same session")' },
    permissionOptions(controller.signal, 'ego-tool-2'),
  )
  expect((await secondResult).behavior).toBe('allow')
  expect(firstRequests).toHaveLength(1)

  const secondSessionRequests: Array<{ requestId: string }> = []
  const otherSessionResult = service.createCanUseTool('session-ego-2', (request) => {
    secondSessionRequests.push(request)
  })(
    'EgoBrowser',
    { script: 'console.log("other session")' },
    permissionOptions(controller.signal, 'ego-tool-3'),
  )

  expect(secondSessionRequests).toHaveLength(1)
  expect(service.respondToPermission(secondSessionRequests[0]!.requestId, 'deny', false)).toBe('session-ego-2')
  expect((await otherSessionResult).behavior).toBe('deny')
})

