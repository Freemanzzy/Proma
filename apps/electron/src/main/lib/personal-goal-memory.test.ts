import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const modulePath = join(import.meta.dir, 'personal-goal-memory.ts')
const repoRoot = dirname(dirname(dirname(dirname(dirname(import.meta.dir)))))
const electronEntry = createRequire(import.meta.url).resolve('electron')
const electronDir = dirname(electronEntry)
const electronBinary = join(electronDir, 'dist', readFileSync(join(electronDir, 'path.txt'), 'utf8').trim())

test('Goal Memory contracts stay immutable, CAS rejects stale state, pack never truncates constraints, evidence stays bound', async () => {
  const home = mkdtempSync(join(tmpdir(), 'proma-goal-memory-'))
  const sourcePath = join(home, 'verify-goal-memory.ts')
  const outputPath = join(home, 'verify-goal-memory.mjs')
  const source = `
    import assert from 'node:assert/strict'
    import { DatabaseSync } from 'node:sqlite'
    import { mkdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
    import { join } from 'node:path'
    import * as goal from ${JSON.stringify(modulePath)}
    import { PiUtilityAdapter } from ${JSON.stringify(join(import.meta.dir, 'adapters/pi-utility-adapter.ts'))}
    import { AGENT_RUNTIME_METHODS } from ${JSON.stringify(join(repoRoot, 'packages/shared/src/types/agent-runtime.ts'))}
    import { createAgentRuntimeRequest } from ${JSON.stringify(join(repoRoot, 'packages/shared/src/utils/agent-runtime.ts'))}
    const root = join(process.env.HOME, '.proma-dev', 'goal-memory')
    const markerUser={role:'user',content:'<goal-memory-task-data>这是用户原文，不应删除',timestamp:1}
    const packed=goal.injectGoalTaskData([markerUser],'目标恢复合同')
    const packedAgain=goal.injectGoalTaskData(packed,'目标恢复合同')
    assert.equal(packedAgain.filter((item)=>String(item.content).includes('目标恢复合同')).length,1)
    assert.ok(packedAgain.includes(markerUser))
    assert.equal(packedAgain.find((item)=>item===markerUser).content,markerUser.content)
    assert.equal(goal.getGoalContract('off'), null)
    assert.equal(existsSync(root), false)
    process.env.PROMA_PERSONAL_GOAL_MEMORY = '1'
    const c1 = goal.createGoalContract({sessionId:'s', workspaceId:'w', expectedRevision:0, originalText:'保留原文；先验证，再决定', scope:['当前仓库'], nonGoals:['不发布'], hardConstraints:['不删数据','须先询问'], acceptance:['测试通过'], userMessageRef:'msg-1'})
    assert.equal(c1.revision, 1)
    assert.equal(goal.getGoalContract('s').hash, c1.hash)
    assert.throws(() => goal.createGoalContract({sessionId:'s', workspaceId:'w', expectedRevision:0, originalText:'stale', scope:[], nonGoals:[], hardConstraints:[], acceptance:[], userMessageRef:'msg-stale'}), /CAS 冲突/)
    const c2 = goal.createGoalContract({sessionId:'s', workspaceId:'w', expectedRevision:1, originalText:'用户纠正：不发布', scope:c1.scope, nonGoals:c1.nonGoals, hardConstraints:c1.hardConstraints, acceptance:c1.acceptance, userMessageRef:'msg-2'})
    assert.equal(c2.revision, 2)
    assert.equal(goal.getGoalContract('s').revision, 2)
    assert.equal(goal.getGoalContract('s').originalText, '用户纠正：不发布')
    const cp = goal.getGoalCheckpoint(c2.id, 2)
    goal.acknowledgeGoalBeforeCompact('s')
    const first = goal.recordGoalModelCheckpoint({goalId:c2.id, revision:2, expectedSequence:cp.sequence, status:'active', modelReported:['模型声称测试完成'], questions:[], unknownSideEffects:[], nextAction:'独立验证'})
    assert.deepEqual(goal.getGoalCheckpoint(c2.id, 2).modelReported, ['模型声称测试完成'])
    assert.equal(first.sequence, cp.sequence + 1)
    assert.throws(() => goal.recordGoalModelCheckpoint({goalId:c2.id, revision:2, expectedSequence:cp.sequence, status:'active', modelReported:[], questions:[], unknownSideEffects:[], nextAction:'旧写入'}), /CAS/)
    assert.throws(() => goal.recordGoalModelCheckpoint({goalId:c2.id, revision:2, expectedSequence:first.sequence, status:'completed' as never, modelReported:[], questions:[], unknownSideEffects:[], nextAction:''}), /不能提交/)
    assert.throws(() => goal.recordGoalModelCheckpoint({goalId:c1.id, revision:1, expectedSequence:0, status:'active', modelReported:[], questions:[], unknownSideEffects:[], nextAction:''}), /CAS/)
    const observed = goal.recordGoalObservedCheckpoint({goalId:c2.id, revision:2, expectedSequence:first.sequence, observed:['宿主检查通过'], artifactId:'', branchId:'', leafId:'', entryWatermark:[], entryHashes:{}})
    assert.deepEqual(observed.observed, ['宿主检查通过'])
    assert.throws(() => goal.buildGoalContextPack({...c2, originalText:'约'.repeat(200)}, first, 300), /UTF-8 字节预算/)
    const pack = goal.buildGoalContextPack(c2, first)
    for (const text of [...c2.hardConstraints, ...c2.acceptance, c2.originalText]) assert.ok(pack.includes(text))
    assert.ok(pack.includes('未验证'))
    assert.throws(() => goal.buildGoalContextPack({...c2, originalText:'x'.repeat(200)}, first, 100), /超出恢复包 UTF-8 字节预算/)
    const commandContract = {expectedRevision:2,originalText:'原文目标',scope:[],nonGoals:[],hardConstraints:['不得发布'],acceptance:['人工确认']}
    assert.deepEqual(goal.parseGoalCommand('/goal set ' + JSON.stringify(commandContract)), {command:'set', input:commandContract})
    assert.deepEqual(goal.parseGoalCommand('/goal restore'), {command:'restore'})
    assert.throws(() => goal.parseGoalCommand('/goal set'), /JSON/)
    const scenarioTypes = ['用户更正：采用新要求', '否定：不得推断已完成', '例外：必须满足限定条件', '旧授权：不得沿用', '待决定：等待用户选择']
    const thirty = Array.from({length:30}, (_,i) => ({
      sessionId:'case-' + i, originalText:'案例 ' + i + ' · ' + scenarioTypes[i % scenarioTypes.length],
      scope:['scope-' + i], nonGoals:['禁止未授权副作用 ' + i],
      hardConstraints:['禁止发布 ' + i, scenarioTypes[i % scenarioTypes.length]], acceptance:['等待验收 ' + i],
    }))
    const caseContracts = thirty.map((item) => goal.createGoalContract({...item, workspaceId:'w', expectedRevision:0, userMessageRef:'user-' + item.sessionId}))
    for (let run=0; run<10; run++) {
      for (let index=0; index<thirty.length; index++) {
        const item = thirty[index]
        const contract = goal.getGoalContract(item.sessionId, 'w')
        const state = goal.getGoalCheckpoint(caseContracts[index].id, 1)
        const updated = goal.recordGoalModelCheckpoint({goalId:contract.id,revision:contract.revision,expectedSequence:state.sequence,status:'active',modelReported:['恢复轮次 ' + run],nextAction:'按合同核验 ' + index,questions:[],unknownSideEffects:[]})
        const restoredContract = goal.getGoalContract(item.sessionId, 'w')
        const restoredCheckpoint = goal.getGoalCheckpoint(restoredContract.id, restoredContract.revision)
        assert.equal(restoredCheckpoint.sequence, updated.sequence)
        const recovered = goal.buildGoalContextPack(restoredContract, restoredCheckpoint)
        for (const required of [item.originalText,...item.scope,...item.nonGoals,...item.hardConstraints,...item.acceptance]) assert.ok(recovered.includes(required))
      }
    }
    const artifactPath = join(process.env.HOME, 'artifact.jsonl')
    const branchEntryIds = Array.from({length:300}, (_,i) => 'entry-' + i)
    const rows = branchEntryIds.map((id,i) => JSON.stringify({id,parentId:i?branchEntryIds[i-1]:null,type:'message',message:{role:i%2?'assistant':'user',content:i===0?'旧证据 '.repeat(6000)+'TAIL_SENTINEL_OLD':i===5?[{type:'toolCall',id:'call-5',name:'search',arguments:{query:'蓝色关键词'}}]:i===6?[{type:'toolResult',toolCallId:'call-5',content:'工具回执'}]:'历史证据 '.repeat(1400)} }))
    const entries=rows.join('\\n')+'\\n'
    writeFileSync(artifactPath, entries)
    goal.createGoalContract({sessionId:'artifact-session',workspaceId:'w',expectedRevision:0,originalText:'读取当轮原文',scope:['current-turn'],nonGoals:[],hardConstraints:['不得回溯其他branch'],acceptance:['精确entry读取'],userMessageRef:'artifact-user'})
    let hostBinding = {sessionId:'artifact-session',workspaceId:'w',artifactId:'artifact-sdk-session',artifactIdentity:'artifact-sdk-session:1:1',path:realpathSync(artifactPath),sessionsDirectory:realpathSync(process.env.HOME)}
    const artifactOwner = goal.createGoalMemoryCapability('artifact-session','w',async () => hostBinding)
    const artifactIdentity = {ownerId:artifactOwner.ownerId,sessionId:'artifact-session',workspaceId:'w',queryId:'query-artifact'}
    const recorded = await artifactOwner.request({...artifactIdentity,operation:'turn_end',artifactId:hostBinding.artifactId,leafId:'entry-299',entryIds:['entry-299'],branchEntryIds})
    assert.equal(recorded.checkpoint.leafId,'entry-299')
    assert.equal(recorded.checkpoint.entryWatermark.length,300)
    const branchQuery={branchEntryIds,leafId:'entry-299',offset:0}
    const contextRequest={...artifactIdentity,operation:'context',artifactId:hostBinding.artifactId,...branchQuery}
    assert.ok((await artifactOwner.request(contextRequest)).context)
    const originalBinding=hostBinding
    hostBinding={...originalBinding,artifactIdentity:'replacement-identity'}
    await assert.rejects(()=>artifactOwner.request(contextRequest),/binding changed/)
    await assert.rejects(()=>artifactOwner.request({...artifactIdentity,operation:'compact_ack',reason:'manual',artifactId:hostBinding.artifactId,leafId:'entry-299',branchEntryIds}),/binding changed/)
    hostBinding={...originalBinding,workspaceId:'moved-workspace'}
    await assert.rejects(()=>artifactOwner.request(contextRequest),/identity changed/)
    hostBinding=originalBinding
    const readBeforeTurnEnd=await artifactOwner.request({...artifactIdentity,operation:'checkpoint_read'})
    const hostTurnEnd=await artifactOwner.request({...artifactIdentity,operation:'turn_end',artifactId:hostBinding.artifactId,leafId:'entry-299',entryIds:['entry-299'],branchEntryIds})
    assert.equal(hostTurnEnd.checkpoint.sequence,readBeforeTurnEnd.checkpoint.sequence+1)
    const reportAfterTurnEnd=await artifactOwner.request({...artifactIdentity,operation:'checkpoint_model',input:{goalId:hostTurnEnd.checkpoint.goalId,revision:hostTurnEnd.checkpoint.revision,status:'active',modelReported:['read-turn_end-report联测'],nextAction:'继续核验',questions:[],unknownSideEffects:[]}})
    assert.ok(reportAfterTurnEnd.checkpoint.observed.length>0)
    assert.deepEqual(reportAfterTurnEnd.checkpoint.modelReported,['read-turn_end-report联测'])
    const exactEvidence = await artifactOwner.request({...artifactIdentity,operation:'evidence_read',mode:'entry',query:'entry-0',...branchQuery})
    assert.equal(exactEvidence.evidence.status,'ok','entry '+JSON.stringify(exactEvidence))
    assert.ok(exactEvidence.evidence.lines[0].includes('TAIL_SENTINEL_OLD'))
    assert.ok(exactEvidence.evidence.lines[0].length>22_000)
    const keywordEvidence=await artifactOwner.request({...artifactIdentity,operation:'evidence_read',mode:'keyword',query:'TAIL_SENTINEL_OLD',...branchQuery})
    assert.equal(keywordEvidence.evidence.status,'ok','keyword '+JSON.stringify(keywordEvidence))
    const toolCallEvidence=await artifactOwner.request({...artifactIdentity,operation:'evidence_read',mode:'toolCall',query:'call-5',...branchQuery})
    assert.equal(toolCallEvidence.evidence.status,'ok','toolCall '+JSON.stringify(toolCallEvidence))
    assert.ok(toolCallEvidence.evidence.lines.some((line)=>line.includes('call-5')))
    const largeRows=[...rows];largeRows[0]=JSON.stringify({id:'entry-0',parentId:null,type:'message',message:{content:'x'.repeat(300_000)}});writeFileSync(artifactPath,largeRows.join('\\n')+'\\n')
    goal.createGoalContract({sessionId:'large-artifact-session',workspaceId:'w',expectedRevision:0,originalText:'超大entry必须显式too-large',scope:[],nonGoals:[],hardConstraints:['不得静默截断'],acceptance:['too-large'],userMessageRef:'large-user'})
    const largeBinding={...hostBinding,sessionId:'large-artifact-session',artifactId:'large-sdk-session',artifactIdentity:'large-sdk-session:2:2'}
    const largeOwner=goal.createGoalMemoryCapability('large-artifact-session','w',async()=>largeBinding)
    const largeIdentity={ownerId:largeOwner.ownerId,sessionId:'large-artifact-session',workspaceId:'w',queryId:'large-query'}
    await largeOwner.request({...largeIdentity,operation:'turn_end',artifactId:largeBinding.artifactId,leafId:'entry-299',entryIds:['entry-299'],branchEntryIds})
    const tooLargeEvidence=await largeOwner.request({...largeIdentity,operation:'evidence_read',mode:'entry',query:'entry-0',...branchQuery})
    assert.equal(tooLargeEvidence.evidence.status,'too-large')
    const changedRows=[...rows];changedRows[299]=changedRows[299].replace('历史证据','篡改证据');writeFileSync(artifactPath,changedRows.join('\\n')+'\\n')
    await assert.rejects(()=>artifactOwner.request({...artifactIdentity,operation:'turn_end',artifactId:hostBinding.artifactId,leafId:'entry-299',entryIds:['entry-299'],branchEntryIds}),/changed/)
    const changedEvidence = await artifactOwner.request({...artifactIdentity,operation:'evidence_read',mode:'entry',query:'entry-299',...branchQuery})
    assert.equal(changedEvidence.evidence.status,'changed')
    if(global.gc){global.gc();await new Promise((resolve)=>setTimeout(resolve,0));global.gc()}
    await assert.rejects(() => artifactOwner.request({...artifactIdentity,operation:'turn_end',artifactId:'replacement-artifact',leafId:'entry-299',entryIds:['entry-299'],branchEntryIds}), /binding/)
    await assert.rejects(() => artifactOwner.request({...artifactIdentity,operation:'turn_end',artifactId:hostBinding.artifactId,leafId:'entry-0',entryIds:['entry-0'],branchEntryIds:['entry-0']}), /rewind detected/)
    goal.createGoalContract({sessionId:'other-artifact-session',workspaceId:'w',expectedRevision:0,originalText:'同名entry不可跨session',scope:[],nonGoals:[],hardConstraints:['不可跨session读取'],acceptance:['拒绝'],userMessageRef:'other-artifact-user'})
    const otherOwner=goal.createGoalMemoryCapability('other-artifact-session','w',async()=>hostBinding)
    await assert.rejects(()=>otherOwner.request({ownerId:otherOwner.ownerId,sessionId:'other-artifact-session',workspaceId:'w',queryId:'other-query',operation:'evidence_read',mode:'entry',query:'entry-0',offset:0,branchEntryIds,leafId:'entry-299'}),/artifact binding changed/)
    const db = new DatabaseSync(join(process.env.HOME, '.proma-dev', 'goal-memory', 'goals.sqlite'))
    let compactHook: ((event: unknown, context: unknown) => unknown) | undefined
    let toolCallHook: (() => unknown) | undefined
    const owner = goal.createGoalMemoryCapability('s', 'w')
    const identity = {ownerId:owner.ownerId,sessionId:'s',workspaceId:'w',queryId:'query-1'}
    const utility = new PiUtilityAdapter()
    const internals = utility as unknown as {pendingQueries: Map<string, unknown>; handleRuntimeRequest: (request: unknown) => Promise<unknown>}
    internals.pendingQueries.set('query-1', {queryId:'query-1',sessionId:'s',input:{goalMemoryCapability:owner}})
    const capabilityRequest = createAgentRuntimeRequest(AGENT_RUNTIME_METHODS.CAPABILITY_GOAL_MEMORY, {...identity,operation:'checkpoint_read'}, {sessionId:'s',queryId:'query-1'})
    const utilityRead = await internals.handleRuntimeRequest(capabilityRequest) as {checkpoint?: {goalId:string}}
    assert.equal(utilityRead.checkpoint.goalId, c2.id)
    const forgedEnvelope = createAgentRuntimeRequest(AGENT_RUNTIME_METHODS.CAPABILITY_GOAL_MEMORY, {...identity,operation:'checkpoint_read'}, {sessionId:'other',queryId:'query-1'})
    await assert.rejects(() => internals.handleRuntimeRequest(forgedEnvelope), /No active Agent query/)
    const forgedPayload = createAgentRuntimeRequest(AGENT_RUNTIME_METHODS.CAPABILITY_GOAL_MEMORY, {...identity,queryId:'other',operation:'checkpoint_read'}, {sessionId:'s',queryId:'query-1'})
    await assert.rejects(() => internals.handleRuntimeRequest(forgedPayload), /No active Agent query/)
    internals.pendingQueries.clear()
    let capabilityAborted = false
    const waitingOwner = {ownerId:'owner-wait',sessionId:'s',workspaceId:'w',request:(_request,signal) => new Promise((_,reject) => signal.addEventListener('abort', () => {capabilityAborted = true; reject(new Error('cancelled'))}, {once:true}))}
    internals.pendingQueries.set('query-wait', {queryId:'query-wait',sessionId:'s',input:{goalMemoryCapability:waitingOwner}})
    const waitingRequest = createAgentRuntimeRequest(AGENT_RUNTIME_METHODS.CAPABILITY_GOAL_MEMORY, {operation:'context',ownerId:'owner-wait',sessionId:'s',workspaceId:'w',queryId:'query-wait'}, {sessionId:'s',queryId:'query-wait'})
    const waiting = internals.handleRuntimeRequest(waitingRequest)
    await Promise.resolve()
    await internals.handleRuntimeRequest(createAgentRuntimeRequest(AGENT_RUNTIME_METHODS.CAPABILITY_CANCEL, {requestId:waitingRequest.requestId}, {sessionId:'s',queryId:'query-wait'}))
    await assert.rejects(() => waiting, /cancelled/)
    assert.equal(capabilityAborted, true)
    internals.pendingQueries.clear()
    const latest = await owner.request({...identity,operation:'checkpoint_read'})
    assert.ok(latest.checkpoint)
    const reported = await owner.request({...identity,operation:'checkpoint_model',input:{goalId:c2.id,revision:2,expectedSequence:latest.checkpoint.sequence,status:'claimed_done',modelReported:['模型自报完成'],nextAction:'交用户验证',questions:[],unknownSideEffects:[]}})
    assert.equal(reported.checkpoint.status,'claimed_done')
    await assert.rejects(() => owner.request({...identity,ownerId:'forged',operation:'checkpoint_read'}), /owner.*校验失败/)
    const extension = goal.createGoalCompactionExtension(owner, 's', 'query-1', () => {})
    extension({on: (name, handler) => { if (name === 'session_before_compact') compactHook = handler as unknown as (event: unknown, context: unknown) => unknown; if(name==='tool_call') toolCallHook=handler as unknown as ()=>unknown; return () => {} }} as Parameters<typeof extension>[0])
    assert.ok(compactHook)
    const hook = compactHook
    const event = {signal:new AbortController().signal, reason:'manual'} as Parameters<typeof hook>[0]
    let aborted = false
    const context = {abort:() => {aborted = true},sessionManager:{getSessionId:()=>'',getLeafId:()=>null,getBranch:()=>[]}} as Parameters<typeof hook>[1]
    const acksBefore = db.prepare('SELECT COUNT(*) AS n FROM compaction_acks').get().n
    for (const reason of ['manual','threshold','overflow']) await hook({...event,reason}, context)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM compaction_acks').get().n, acksBefore + 3)
    db.prepare('DELETE FROM checkpoints WHERE goal_id=? AND revision=?').run(c2.id, 2)
    const blocked = await hook(event, context) as {cancel?: boolean}
    assert.equal(blocked.cancel, true)
    assert.equal(aborted, true)
    assert.deepEqual(toolCallHook?.(),{block:true})
    let hostErrorVisible=false
    const failLatch=goal.createGoalRunFailLatch(()=>{hostErrorVisible=true})
    let falseAckHook:((event:unknown,context:unknown)=>unknown)|undefined;let falseToolHook:(()=>unknown)|undefined
    const falseOwner={...owner,request:async()=>({})}
    goal.createGoalCompactionExtension(falseOwner,'s','query-false',failLatch.fail,100)({on:(name,handler)=>{if(name==='session_before_compact')falseAckHook=handler as unknown as (event:unknown,context:unknown)=>unknown;if(name==='tool_call')falseToolHook=handler as unknown as ()=>unknown;return()=>{}}} as Parameters<typeof extension>[0])
    for(const reason of ['manual','threshold','overflow']) assert.equal((await falseAckHook!({...event,reason},context) as {cancel?:boolean}).cancel,true)
    assert.equal(failLatch.isFailed(),true);assert.equal(hostErrorVisible,true);assert.deepEqual(falseToolHook?.(),{block:true})
    let timeoutAborted=false;let timeoutAckHook:((event:unknown,context:unknown)=>unknown)|undefined
    const timeoutOwner={...owner,request:(_request,signal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{timeoutAborted=true;reject(new Error('timeout canceled'))},{once:true}))}
    goal.createGoalCompactionExtension(timeoutOwner,'s','query-timeout',()=>{},10)({on:(name,handler)=>{if(name==='session_before_compact')timeoutAckHook=handler as unknown as (event:unknown,context:unknown)=>unknown;return()=>{}}} as Parameters<typeof extension>[0])
    for(const reason of ['manual','threshold','overflow']) assert.equal((await timeoutAckHook!({...event,reason},context) as {cancel?:boolean}).cancel,true)
    assert.equal(timeoutAborted,true)
    const abortedController=new AbortController();abortedController.abort();let abortAckHook:((event:unknown,context:unknown)=>unknown)|undefined
    goal.createGoalCompactionExtension(owner,'s','query-abort',()=>{},10)({on:(name,handler)=>{if(name==='session_before_compact')abortAckHook=handler as unknown as (event:unknown,context:unknown)=>unknown;return()=>{}}} as Parameters<typeof extension>[0])
    for(const reason of ['manual','threshold','overflow']) assert.equal((await abortAckHook!({...event,reason,signal:abortedController.signal},context) as {cancel?:boolean}).cancel,true)
    const row = db.prepare('SELECT payload FROM contracts WHERE id=? AND revision=?').get(c2.id, 2)
    const corrupted = JSON.parse(row.payload)
    corrupted.hardConstraints = ['被篡改的约束']
    db.prepare('UPDATE contracts SET payload=? WHERE id=? AND revision=?').run(JSON.stringify(corrupted), c2.id, 2)
    assert.throws(() => goal.getGoalContract('s'), /hash 校验失败/)
    const contractPayloadBeforeFutureSchema=db.prepare('SELECT payload FROM contracts WHERE id=? AND revision=?').get(c2.id,2).payload
    const tablesBeforeFutureSchema=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    db.prepare("UPDATE metadata SET value='99' WHERE key='schemaVersion'").run()
    assert.throws(() => goal.getGoalContract('s'), /schema 版本不兼容/)
    const schemaCheckDb=new DatabaseSync(join(process.env.HOME,'.proma-dev','goal-memory','goals.sqlite'))
    assert.equal(schemaCheckDb.prepare("SELECT value FROM metadata WHERE key='schemaVersion'").get().value,'99')
    assert.deepEqual(schemaCheckDb.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(),tablesBeforeFutureSchema)
    assert.equal(schemaCheckDb.prepare('SELECT payload FROM contracts WHERE id=? AND revision=?').get(c2.id,2).payload,contractPayloadBeforeFutureSchema)
    schemaCheckDb.close();db.close()
  `
  writeFileSync(sourcePath, source)
  try {
    const build = await Bun.build({ entrypoints: [sourcePath], target: 'node', format: 'esm', external: ['node:sqlite'] })
    expect(build.success, build.logs.map((log) => log.message).join('\n')).toBe(true)
    const compiled = build.outputs[0]
    if (!compiled) throw new Error('未生成验证脚本')
    await Bun.write(outputPath, compiled)
    const result = spawnSync(electronBinary, ['--expose-gc', outputPath], {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HOME: home, PROMA_DEV: '1', PROMA_DEV_DATA_DIR_NAME: '.proma-dev', PROMA_PERSONAL_GOAL_MEMORY: '0' },
      encoding: 'utf8',
    })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
