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
    import { serializePiToolResultPayload } from ${JSON.stringify(join(import.meta.dir, 'adapters/pi-tool-result-json.ts'))}
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
    goal.createGoalContract({sessionId:'linear-watermark-session',workspaceId:'w',expectedRevision:0,originalText:'最大entry水位校验必须线性',scope:[],nonGoals:[],hardConstraints:[],acceptance:[],userMessageRef:'linear-watermark-user'})
    const linearContract=goal.getGoalContract('linear-watermark-session','w')
    const maxWatermark=Array.from({length:50_000},(_,index)=>'watermark-'+index)
    const maxHashes=Object.fromEntries(maxWatermark.map((id)=>[id,'a'.repeat(64)]))
    const maxObserved=goal.recordGoalObservedCheckpoint({goalId:linearContract.id,revision:1,expectedSequence:0,observed:[],artifactId:'linear-artifact',branchId:'watermark-49999',leafId:'watermark-49999',entryWatermark:maxWatermark,entryHashes:maxHashes})
    assert.equal(maxObserved.entryWatermark.length,50_000)
    assert.throws(()=>goal.recordGoalObservedCheckpoint({goalId:linearContract.id,revision:1,expectedSequence:1,observed:[],artifactId:'linear-artifact',branchId:'duplicate',leafId:'duplicate',entryWatermark:['duplicate','duplicate'],entryHashes:{duplicate:'a'.repeat(64)}}),/entry hash/)
    assert.throws(() => goal.buildGoalContextPack({...c2, originalText:'约'.repeat(200)}, first, 300), /UTF-8 字节预算/)
    const pack = goal.buildGoalContextPack(c2, first)
    for (const text of [...c2.hardConstraints, ...c2.acceptance, c2.originalText]) assert.ok(pack.includes(text))
    assert.ok(pack.includes('未验证'))
    assert.throws(() => goal.buildGoalContextPack({...c2, originalText:'x'.repeat(200)}, first, 100), /超出恢复包 UTF-8 字节预算/)
    const commandContract = {expectedRevision:2,originalText:'原文目标',scope:[],nonGoals:[],hardConstraints:['不得发布'],acceptance:['人工确认']}
    assert.deepEqual(goal.parseGoalCommand('/goal set ' + JSON.stringify(commandContract)), {command:'set', input:commandContract})
    assert.deepEqual(goal.parseGoalCommand('/goal restore'), {command:'restore'})
    assert.throws(() => goal.parseGoalCommand('/goal set'), /JSON/)
    assert.equal(goal.isGoalCommandSourceAllowed({triggeredBy:'user',userMessage:'/goal set {...}'}),true)
    assert.equal(goal.isGoalCommandSourceAllowed({triggeredBy:'external',userMessage:'/goal set {...}'}),true)
    assert.equal(goal.isGoalCommandSourceAllowed({triggeredBy:'automation',userMessage:'/goal set {...}'}),false)
    assert.equal(goal.isGoalCommandSourceAllowed({triggeredBy:'delegation',userMessage:'/goal revise {...}'}),false)
    assert.equal(goal.isGoalCommandSourceAllowed({triggeredBy:'user',automationContext:'scheduled',userMessage:'/goal set {...}'}),false)
    assert.equal(goal.isGoalCommandSourceAllowed({triggeredBy:'external',userMessage:'【子任务完成·自动通知】/goal revise {...}'}),false)
    assert.equal(goal.isGoalCommandSourceAllowed({triggeredBy:'external',userMessage:'  【子任务完成·自动通知】/goal revise {...}'}),false)
    const restoreReply=goal.buildGoalRestoreReply(c2,cp)
    assert.match(restoreReply,/历史记录.*msg-2.*不构成本轮新的用户授权.*checkpoint只是历史快照.*未核验当前artifact/)
    assert.ok(restoreReply.includes('artifact/branch')&&restoreReply.includes('下次query中验证'))
    const dtoFixture={...cp,sequence:77,modelSequence:4,observed:Array.from({length:25},(_,i)=>'observed-'+i),modelReported:Array.from({length:25},(_,i)=>'reported-'+i),nextAction:'next-action',questions:Array.from({length:25},(_,i)=>'question-'+i),unknownSideEffects:Array.from({length:25},(_,i)=>'side-effect-'+i),entryWatermark:Array.from({length:5000},(_,i)=>'entry-'+i),entryHashes:Object.fromEntries(Array.from({length:5000},(_,i)=>['entry-'+i,'a'.repeat(64)]))}
    let dtoCursor;const dtoItems=[];let firstDto
    do {const dto=goal.toGoalCheckpointModelDto(dtoFixture,dtoCursor);firstDto??=dto;assert.equal('entryWatermark' in dto,false);assert.equal('entryHashes' in dto,false);const serialized=JSON.stringify(dto);const serializedTool=JSON.stringify({content:[{type:'text',text:serialized}],details:dto});assert.ok(Buffer.byteLength(serializedTool,'utf8')<32*1024);dtoItems.push(...dto.entries);dtoCursor=dto.nextCursor} while(dtoCursor)
    assert.equal(dtoItems.length,101)
    assert.ok(dtoItems.some((item)=>item.value==='question-24'))
    const escapedValue='\\u0000'.repeat(4000)
    const escapedFixture={...dtoFixture,sequence:78,observed:[escapedValue],modelReported:[],nextAction:'',questions:[],unknownSideEffects:[]}
    let escapedCursor;const escapedParts=[]
    do {const dto=goal.toGoalCheckpointModelDto(escapedFixture,escapedCursor);assert.ok(Buffer.byteLength(JSON.stringify({content:[{type:'text',text:JSON.stringify(dto)}],details:dto}),'utf8')<32*1024);escapedParts.push(...dto.entries);escapedCursor=dto.nextCursor} while(escapedCursor)
    assert.ok(escapedParts.length>1)
    assert.equal(escapedParts.map((part)=>part.value).join(''),escapedValue)
    assert.ok(escapedParts.every((part)=>part.partCount===escapedParts.length))
    assert.throws(()=>goal.toGoalCheckpointModelDto({...dtoFixture,modelSequence:-1}),/modelSequence/)
    assert.throws(()=>goal.toGoalCheckpointModelDto({...dtoFixture,sequence:78},firstDto.nextCursor),/cursor/)
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
    const rows = branchEntryIds.map((id,i) => JSON.stringify({id,parentId:i?branchEntryIds[i-1]:null,type:'message',message:{role:i%2?'assistant':'user',content:i===0?'旧证据 '.repeat(6000)+'TAIL_SENTINEL_OLD':i===5?[{type:'toolCall',id:'call-5',name:'search',arguments:{query:'蓝色关键词'}}]:i===6?[{type:'toolResult',toolCallId:'call-5',content:'工具回执'}]:i===7?[{type:'toolCall',id:'call-7',name:'shell',arguments:{command:'git status ARGUMENT_SENTINEL',path:'/tmp/ARGUMENT_PATH_SENTINEL',values:Array.from({length:4002},(_,index)=>index===4000?'ARRAY_TAIL_SENTINEL':'x')}}]:'历史证据 '.repeat(1400)} }))
    const entries=rows.join('\\n')+'\\n'
    writeFileSync(artifactPath, entries)
    goal.createGoalContract({sessionId:'artifact-session',workspaceId:'w',expectedRevision:0,originalText:'读取当轮原文',scope:['current-turn'],nonGoals:[],hardConstraints:['不得回溯其他branch'],acceptance:['精确entry读取'],userMessageRef:'artifact-user'})
    let hostBinding = {sessionId:'artifact-session',workspaceId:'w',artifactId:'artifact-sdk-session',artifactIdentity:'artifact-sdk-session:1:1',path:realpathSync(artifactPath),sessionsDirectory:realpathSync(process.env.HOME)}
    const artifactOwner = goal.createGoalMemoryCapability('artifact-session','w',async () => hostBinding)
    const artifactIdentity = {ownerId:artifactOwner.ownerId,sessionId:'artifact-session',workspaceId:'w',queryId:'query-artifact'}
    const recorded = await artifactOwner.request({...artifactIdentity,operation:'turn_end',artifactId:hostBinding.artifactId,leafId:'entry-299',entryIds:['entry-299'],branchEntryIds})
    assert.equal(recorded.checkpoint.counts.entryWatermark,300)
    assert.equal('entryWatermark' in recorded.checkpoint,false)
    assert.equal('entryHashes' in recorded.checkpoint,false)
    const turnEndSerialized=JSON.stringify(recorded.checkpoint)
    assert.ok(Buffer.byteLength(JSON.stringify({content:[{type:'text',text:turnEndSerialized}],details:recorded.checkpoint}),'utf8')<32*1024)
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
    const reportAfterTurnEnd=await artifactOwner.request({...artifactIdentity,operation:'checkpoint_model',input:{goalId:readBeforeTurnEnd.checkpoint.goalId,revision:readBeforeTurnEnd.checkpoint.revision,expectedModelSequence:readBeforeTurnEnd.checkpoint.modelSequence,status:'active',modelReported:['read-turn_end-report联测'],nextAction:'继续核验',questions:[],unknownSideEffects:[]}})
    assert.ok(reportAfterTurnEnd.checkpoint.counts.observed>0)
    assert.equal(reportAfterTurnEnd.checkpoint.modelSequence,readBeforeTurnEnd.checkpoint.modelSequence+1)
    const exactEvidence = await artifactOwner.request({...artifactIdentity,operation:'evidence_read',mode:'entry',query:'entry-0',...branchQuery})
    assert.equal(exactEvidence.evidence.status,'ok','entry '+JSON.stringify(exactEvidence))
    assert.ok(exactEvidence.evidence.lines[0].includes('TAIL_SENTINEL_OLD'))
    assert.ok(exactEvidence.evidence.lines[0].length>22_000)
    const keywordEvidence=await artifactOwner.request({...artifactIdentity,operation:'evidence_read',mode:'keyword',query:'TAIL_SENTINEL_OLD',...branchQuery})
    assert.equal(keywordEvidence.evidence.status,'ok','keyword '+JSON.stringify(keywordEvidence))
    const toolCallEvidence=await artifactOwner.request({...artifactIdentity,operation:'evidence_read',mode:'toolCall',query:'call-5',...branchQuery})
    assert.equal(toolCallEvidence.evidence.status,'ok','toolCall '+JSON.stringify(toolCallEvidence))
    assert.ok(toolCallEvidence.evidence.lines.some((line)=>line.includes('call-5')))
    const argumentKeyword=await artifactOwner.request({...artifactIdentity,operation:'evidence_read',mode:'keyword',query:'ARGUMENT_SENTINEL',...branchQuery})
    assert.equal(argumentKeyword.evidence.status,'ok')
    const arrayTailKeyword=await artifactOwner.request({...artifactIdentity,operation:'evidence_read',mode:'keyword',query:'ARRAY_TAIL_SENTINEL',...branchQuery})
    assert.equal(arrayTailKeyword.evidence.status,'ok')
    const budgetArtifactPath=join(process.env.HOME,'keyword-budget.jsonl')
    writeFileSync(budgetArtifactPath,JSON.stringify({id:'budget-entry',parentId:null,type:'message',message:{content:[{type:'toolCall',name:'bounded-search',arguments:{values:Array.from({length:10_050},()=>'x')}}]}})+'\\n')
    goal.createGoalContract({sessionId:'keyword-budget-session',workspaceId:'w',expectedRevision:0,originalText:'关键词扫描预算耗尽必须明确标记',scope:[],nonGoals:[],hardConstraints:['不误报not-found'],acceptance:['too-large/incomplete'],userMessageRef:'keyword-budget-user'})
    const budgetBinding={sessionId:'keyword-budget-session',workspaceId:'w',artifactId:'keyword-budget-sdk',artifactIdentity:'keyword-budget-sdk:1:1',path:realpathSync(budgetArtifactPath),sessionsDirectory:realpathSync(process.env.HOME)}
    const budgetOwner=goal.createGoalMemoryCapability('keyword-budget-session','w',async()=>budgetBinding)
    const budgetEvidence=await budgetOwner.request({ownerId:budgetOwner.ownerId,sessionId:'keyword-budget-session',workspaceId:'w',queryId:'keyword-budget-query',operation:'evidence_read',mode:'keyword',query:'ABSENT_AFTER_BUDGET',offset:0,branchEntryIds:['budget-entry'],leafId:'budget-entry'})
    assert.equal(budgetEvidence.evidence.status,'too-large')
    assert.equal(budgetEvidence.evidence.incomplete,true)
    goal.createGoalContract({sessionId:'first-evidence-session',workspaceId:'w',expectedRevision:0,originalText:'首次读取已有历史',scope:[],nonGoals:[],hardConstraints:['必须绑定已验证来源'],acceptance:['读到历史原文'],userMessageRef:'first-evidence-user'})
    const firstEvidenceBinding={...originalBinding,sessionId:'first-evidence-session'}
    const firstEvidenceOwner=goal.createGoalMemoryCapability('first-evidence-session','w',async()=>firstEvidenceBinding)
    const firstEvidence=await firstEvidenceOwner.request({ownerId:firstEvidenceOwner.ownerId,sessionId:'first-evidence-session',workspaceId:'w',queryId:'first-evidence-query',operation:'evidence_read',mode:'keyword',query:'TAIL_SENTINEL_OLD',offset:0,branchEntryIds,leafId:'entry-299'})
    assert.equal(firstEvidence.evidence.status,'ok','首次证据读取应先绑定已有artifact与branch')
    const firstEvidenceCheckpoint=goal.getGoalCheckpoint(goal.getGoalContract('first-evidence-session').id,1)
    assert.equal(firstEvidenceCheckpoint.artifactId,firstEvidenceBinding.artifactIdentity)
    assert.equal(firstEvidenceCheckpoint.entryWatermark.length,300)
    const largeResultPath=join(process.env.HOME,'large-tool-result.jsonl')
    const largeSourceLine=JSON.stringify({id:'source-entry',parentId:null,type:'message',message:{content:'z'.repeat(150_000)}})
    writeFileSync(largeResultPath,largeSourceLine+'\\n')
    goal.createGoalContract({sessionId:'large-result-session',workspaceId:'w',expectedRevision:0,originalText:'工具结果本身可能超过reader单行限制',scope:[],nonGoals:[],hardConstraints:['turn_end只校验hash'],acceptance:['证据读取后仍能落水位'],userMessageRef:'large-result-user'})
    const largeResultBinding={sessionId:'large-result-session',workspaceId:'w',artifactId:'large-result-sdk',artifactIdentity:'large-result-sdk:1:1',path:realpathSync(largeResultPath),sessionsDirectory:realpathSync(process.env.HOME)}
    const largeResultOwner=goal.createGoalMemoryCapability('large-result-session','w',async()=>largeResultBinding)
    const largeResultIdentity={ownerId:largeResultOwner.ownerId,sessionId:'large-result-session',workspaceId:'w',queryId:'large-result-query'}
    const sourceRead=await largeResultOwner.request({...largeResultIdentity,operation:'evidence_read',mode:'entry',query:'source-entry',offset:0,branchEntryIds:['source-entry'],leafId:'source-entry'})
    assert.equal(sourceRead.evidence.status,'ok')
    const largePayload=serializePiToolResultPayload(sourceRead)
    const largeToolResultLine=JSON.stringify({id:'large-tool-result',parentId:'source-entry',type:'toolResult',content:[{type:'text',text:largePayload.text}],details:largePayload.details})
    assert.ok(Buffer.byteLength(largeToolResultLine,'utf8')>256*1024,'重复content/details使合法证据工具结果变为超大leaf')
    writeFileSync(largeResultPath,largeSourceLine+'\\n'+largeToolResultLine+'\\n')
    const largeResultTurn=await largeResultOwner.request({...largeResultIdentity,operation:'turn_end',artifactId:largeResultBinding.artifactId,leafId:'large-tool-result',entryIds:['large-tool-result'],branchEntryIds:['source-entry','large-tool-result']})
    assert.equal(largeResultTurn.checkpoint.counts.entryWatermark,2,'大型工具回执leaf通过hash-only校验')
    const largeRows=[...rows];largeRows[0]=JSON.stringify({id:'entry-0',parentId:null,type:'message',message:{content:'x'.repeat(300_000)}});largeRows[299]=JSON.stringify({id:'entry-299',parentId:'entry-298',type:'toolResult',content:'y'.repeat(300_000)});writeFileSync(artifactPath,largeRows.join('\\n')+'\\n')
    goal.createGoalContract({sessionId:'large-artifact-session',workspaceId:'w',expectedRevision:0,originalText:'超大entry必须显式too-large',scope:[],nonGoals:[],hardConstraints:['不得静默截断'],acceptance:['too-large'],userMessageRef:'large-user'})
    const largeBinding={...hostBinding,sessionId:'large-artifact-session',artifactId:'large-sdk-session',artifactIdentity:'large-sdk-session:2:2'}
    const largeOwner=goal.createGoalMemoryCapability('large-artifact-session','w',async()=>largeBinding)
    const largeIdentity={ownerId:largeOwner.ownerId,sessionId:'large-artifact-session',workspaceId:'w',queryId:'large-query'}
    const largeTurnEnd=await largeOwner.request({...largeIdentity,operation:'turn_end',artifactId:largeBinding.artifactId,leafId:'entry-299',entryIds:['entry-299'],branchEntryIds})
    assert.equal(largeTurnEnd.checkpoint.counts.entryWatermark,300,'超大leaf只做hash水位校验')
    const tooLargeEvidence=await largeOwner.request({...largeIdentity,operation:'evidence_read',mode:'entry',query:'entry-0',...branchQuery})
    assert.equal(tooLargeEvidence.evidence.status,'too-large')
    const changedRows=[...rows];changedRows[299]=changedRows[299].replace('历史证据','篡改证据');changedRows.push(JSON.stringify({id:'entry-300',parentId:'entry-299',type:'message',message:{content:'新turn不能重建旧hash'}}));writeFileSync(artifactPath,changedRows.join('\\n')+'\\n')
    await assert.rejects(()=>artifactOwner.request({...artifactIdentity,operation:'turn_end',artifactId:hostBinding.artifactId,leafId:'entry-300',entryIds:['entry-300'],branchEntryIds:[...branchEntryIds,'entry-300']}),/changed/)
    assert.equal(goal.getGoalCheckpoint(goal.getGoalContract('artifact-session').id,1).leafId,'entry-299','旧entry篡改后新turn不得rebaseline')
    const changedEvidence = await artifactOwner.request({...artifactIdentity,operation:'evidence_read',mode:'entry',query:'entry-299',...branchQuery})
    assert.equal(changedEvidence.evidence.status,'changed')
    if(global.gc){global.gc();await new Promise((resolve)=>setTimeout(resolve,0));global.gc()}
    await assert.rejects(() => artifactOwner.request({...artifactIdentity,operation:'turn_end',artifactId:'replacement-artifact',leafId:'entry-299',entryIds:['entry-299'],branchEntryIds}), /binding/)
    await assert.rejects(() => artifactOwner.request({...artifactIdentity,operation:'turn_end',artifactId:hostBinding.artifactId,leafId:'entry-0',entryIds:['entry-0'],branchEntryIds:['entry-0']}), /rewind detected/)
    goal.createGoalContract({sessionId:'other-artifact-session',workspaceId:'w',expectedRevision:0,originalText:'同名entry不可跨session',scope:[],nonGoals:[],hardConstraints:['不可跨session读取'],acceptance:['拒绝'],userMessageRef:'other-artifact-user'})
    const otherOwner=goal.createGoalMemoryCapability('other-artifact-session','w',async()=>hostBinding)
    await assert.rejects(()=>otherOwner.request({ownerId:otherOwner.ownerId,sessionId:'other-artifact-session',workspaceId:'w',queryId:'other-query',operation:'evidence_read',mode:'entry',query:'entry-0',offset:0,branchEntryIds,leafId:'entry-299'}),/artifact binding changed/)
    const db = new DatabaseSync(join(process.env.HOME, '.proma-dev', 'goal-memory', 'goals.sqlite'))
    const createRevocationFixture=(name)=>{
      const sessionId='owner-revoke-'+name;const fixtureDir=join(process.env.HOME,'owner-revoke-'+name);mkdirSync(fixtureDir,{recursive:true})
      const artifactPath=join(fixtureDir,'session.jsonl');const ids=[];const rows=[];let parentId=null
      for(let index=0;index<1000;index++){const id='revoke-entry-'+index;rows.push(JSON.stringify({type:'message',id,parentId,message:{role:'user',content:[{type:'text',text:'x'.repeat(80)}]}}));ids.push(id);parentId=id}
      writeFileSync(artifactPath,rows.join('\\n')+'\\n')
      const binding={sessionId,workspaceId:'w',artifactId:'sdk-'+name,artifactIdentity:'identity-'+name,path:realpathSync(artifactPath),sessionsDirectory:realpathSync(fixtureDir)}
      const contract=goal.createGoalContract({sessionId,workspaceId:'w',expectedRevision:0,originalText:'revoke期间不得产生迟到水位写',scope:[],nonGoals:[],hardConstraints:[],acceptance:[],userMessageRef:'revoke-user-'+name})
      const owner=goal.createGoalMemoryCapability(sessionId,'w',async(signal)=>signal?.aborted?null:binding)
      return {sessionId,ids,leafId:parentId,binding,contract,owner,identity:{ownerId:owner.ownerId,sessionId,workspaceId:'w',queryId:'query-'+name}}
    }
    const makeRevocationRequest=(fixture,operation)=>({
      ...fixture.identity,operation,artifactId:fixture.binding.artifactId,leafId:fixture.leafId,branchEntryIds:fixture.ids,
      ...(operation==='evidence_read'?{mode:'entry',query:fixture.leafId,offset:0}:{}),
      ...(operation==='turn_end'?{entryIds:[fixture.leafId]}:{}),
      ...(operation==='compact_ack'?{reason:'manual'}:{}),
    })
    const assertNoLateBindingWrite=async(fixture,operation,callerController)=>{
      const before=goal.getGoalCheckpoint(fixture.contract.id,1)
      const pending=fixture.owner.request(makeRevocationRequest(fixture,operation),callerController?.signal)
      await new Promise((resolve)=>setImmediate(resolve))
      if(callerController)callerController.abort();else fixture.owner.revoke()
      await assert.rejects(()=>pending,/canceled|cancelled|已取消|已撤销|失效|身份不匹配/)
      const after=goal.getGoalCheckpoint(fixture.contract.id,1)
      assert.equal(after.sequence,before.sequence,operation+'撤销后checkpoint sequence不变')
      assert.equal(after.artifactId,before.artifactId,operation+'撤销后artifact binding不变')
      assert.deepEqual(after.entryWatermark,before.entryWatermark,operation+'撤销后entry watermark不变')
      assert.deepEqual(after.entryHashes,before.entryHashes,operation+'撤销后hash索引不变')
    }
    for(const operation of ['context','evidence_read','turn_end'])await assertNoLateBindingWrite(createRevocationFixture(operation),operation)
    const callerAbortFixture=createRevocationFixture('caller-abort');const callerAbortController=new AbortController()
    await assertNoLateBindingWrite(callerAbortFixture,'context',callerAbortController)
    const normallyBound=await callerAbortFixture.owner.request(makeRevocationRequest(callerAbortFixture,'context'))
    assert.ok(normallyBound.context)
    const normallyBoundCheckpoint=goal.getGoalCheckpoint(callerAbortFixture.contract.id,1)
    assert.equal(normallyBoundCheckpoint.sequence,1,'正常的1000行扫描仍可绑定checkpoint')
    assert.equal(normallyBoundCheckpoint.artifactId,callerAbortFixture.binding.artifactIdentity)
    const compactFixture=createRevocationFixture('compact')
    await compactFixture.owner.request(makeRevocationRequest(compactFixture,'turn_end'))
    const compactAckCountBefore=db.prepare('SELECT COUNT(*) AS n FROM compaction_acks WHERE session_id=?').get(compactFixture.sessionId).n
    const compactPending=compactFixture.owner.request(makeRevocationRequest(compactFixture,'compact_ack'))
    await new Promise((resolve)=>setImmediate(resolve));compactFixture.owner.revoke()
    await assert.rejects(()=>compactPending,/canceled|cancelled|已取消|已撤销|失效|身份不匹配/)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM compaction_acks WHERE session_id=?').get(compactFixture.sessionId).n,compactAckCountBefore,'revoke后不得写compact ack')
    assert.equal(goal.getGoalCheckpoint(compactFixture.contract.id,1).sequence,1,'compact ack revoke不改checkpoint sequence')
    let compactHook: ((event: unknown, context: unknown) => unknown) | undefined
    let toolCallHook: (() => unknown) | undefined
    const owner = goal.createGoalMemoryCapability('s', 'w')
    const identity = {ownerId:owner.ownerId,sessionId:'s',workspaceId:'w',queryId:'query-1'}
    const utility = new PiUtilityAdapter()
    const internals = utility as unknown as {pendingQueries: Map<string, unknown>; handleRuntimeRequest: (request: unknown) => Promise<unknown>}
    internals.pendingQueries.set('query-1', {queryId:'query-1',sessionId:'s',input:{goalMemoryCapability:owner}})
    const capabilityRequest = createAgentRuntimeRequest(AGENT_RUNTIME_METHODS.CAPABILITY_GOAL_MEMORY, {...identity,operation:'checkpoint_read'}, {sessionId:'s',queryId:'query-1'})
    const utilityRead = await internals.handleRuntimeRequest(capabilityRequest) as {checkpoint?: {goalId:string;entryWatermark?:unknown;entryHashes?:unknown}}
    assert.equal(utilityRead.checkpoint.goalId, c2.id)
    assert.equal('entryWatermark' in utilityRead.checkpoint,false)
    assert.equal('entryHashes' in utilityRead.checkpoint,false)
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
    const goalToolDefinitions=goal.buildGoalMemoryTools({defineTool:(definition)=>definition},owner,'s','query-1',{getLeafId:()=>null,getBranch:()=>[]},(payload)=>{const serialized=serializePiToolResultPayload(payload);return {content:[{type:'text',text:serialized.text}],details:serialized.details}})
    const checkpointReadTool=goalToolDefinitions.find((tool)=>tool.name==='GoalCheckpointRead')
    const checkpointReportTool=goalToolDefinitions.find((tool)=>tool.name==='GoalCheckpointReport')
    const checkpointToolResult=await checkpointReadTool.execute('tool-read',{})
    assert.ok(Buffer.byteLength(JSON.stringify(checkpointToolResult),'utf8')<32*1024)
    assert.equal('entryHashes' in checkpointToolResult.details,false)
    const reportToolResult=await checkpointReportTool.execute('tool-report',{goalId:checkpointToolResult.details.goalId,revision:checkpointToolResult.details.revision,expectedModelSequence:checkpointToolResult.details.modelSequence,status:'active',modelReported:['模块化工具报告'],nextAction:'继续',questions:[],unknownSideEffects:[]})
    assert.ok(Buffer.byteLength(JSON.stringify(reportToolResult),'utf8')<32*1024)

    const paginationSession='goal-pagination-lifecycle'
    const paginationContract=goal.createGoalContract({sessionId:paginationSession,workspaceId:'w',expectedRevision:0,originalText:'跨真实工具轮次保持同一分页快照',scope:[],nonGoals:[],hardConstraints:[],acceptance:[],userMessageRef:'pagination-user'})
    const paginationBase=goal.getGoalCheckpoint(paginationContract.id,1)
    const beforeReportValue='旧快照🌙\\\\'.repeat(240)
    goal.recordGoalModelCheckpoint({goalId:paginationContract.id,revision:1,expectedSequence:paginationBase.sequence,status:'active',modelReported:[beforeReportValue],nextAction:'旧下一步',questions:[],unknownSideEffects:[]})
    const paginationSessions=join(process.env.HOME,'sessions')
    mkdirSync(paginationSessions,{recursive:true})
    const paginationArtifactPath=join(paginationSessions,'goal-pagination.jsonl')
    const paginationRows=[JSON.stringify({type:'message',id:'pagination-entry-0',parentId:null,message:{role:'user',content:'Goal pagination fixture'}})]
    writeFileSync(paginationArtifactPath,paginationRows.join('\\n')+'\\n')
    const paginationBinding={sessionId:paginationSession,workspaceId:'w',artifactId:'pagination-artifact',artifactIdentity:'pagination-file-identity',path:realpathSync(paginationArtifactPath),sessionsDirectory:realpathSync(paginationSessions)}
    const paginationOwner=goal.createGoalMemoryCapability(paginationSession,'w',async()=>paginationBinding)
    const paginationIdentity={ownerId:paginationOwner.ownerId,sessionId:paginationSession,workspaceId:'w',queryId:'pagination-query'}
    let paginationBranch=['pagination-entry-0'];let paginationLeaf='pagination-entry-0';let paginationToolResultNo=0
    const paginationTools=goal.buildGoalMemoryTools({defineTool:(definition)=>definition},paginationOwner,paginationSession,'pagination-query',{getLeafId:()=>paginationLeaf,getBranch:()=>paginationBranch.map((id)=>({id}))},(payload)=>{const serialized=serializePiToolResultPayload(payload);return {content:[{type:'text',text:serialized.text}],details:serialized.details}})
    const paginationReadTool=paginationTools.find((tool)=>tool.name==='GoalCheckpointRead')
    const paginationReportTool=paginationTools.find((tool)=>tool.name==='GoalCheckpointReport')
    const appendToolResultAndTurnEnd=async(result,toolName)=>{
      const id='pagination-tool-'+paginationToolResultNo++
      paginationRows.push(JSON.stringify({type:'message',id,parentId:paginationLeaf,message:{role:'toolResult',toolCallId:'call-'+id,toolName,content:result.content,details:result.details,isError:false,timestamp:Date.now()}}))
      writeFileSync(paginationArtifactPath,paginationRows.join('\\n')+'\\n')
      paginationBranch=[...paginationBranch,id];paginationLeaf=id
      const beforeHostSequence=goal.getGoalCheckpoint(paginationContract.id,1).sequence
      await paginationOwner.request({...paginationIdentity,operation:'turn_end',artifactId:paginationBinding.artifactId,leafId:paginationLeaf,entryIds:[id],branchEntryIds:paginationBranch})
      assert.equal(goal.getGoalCheckpoint(paginationContract.id,1).sequence,beforeHostSequence+1,'每个真实tool round的turn_end推进host sequence')
    }
    const collectCheckpointDto=(firstPage)=>{
      const fields={observed:[],modelReported:[],nextAction:[],questions:[],unknownSideEffects:[]}
      const nextParts=new Map()
      const collect=(dto)=>{for(const entry of dto.entries){const key=entry.field+':'+entry.index;const prior=nextParts.get(key)??{next:0,value:''};assert.equal(entry.partIndex,prior.next,'checkpoint 分片顺序完整');prior.value+=entry.value;prior.next+=1;nextParts.set(key,prior);fields[entry.field][entry.index]=prior.value}}
      collect(firstPage)
      return {fields,collect}
    }
    const initialPaginationRead=await paginationReadTool.execute('pagination-initial-read',{})
    const oldRootCursor=initialPaginationRead.details.nextCursor
    assert.ok(oldRootCursor,'分页fixture应产生cursor')
    const longModelReported=Array.from({length:6},(_,index)=>'报告'+index+'🌙\\\\'+('详细值'.repeat(240)))
    const reportValues={observed:['已读取工具结果🌙\\\\'.repeat(160)],modelReported:longModelReported,nextAction:'下一步🧭\\\\'.repeat(220),questions:['问题🌗\\\\'.repeat(150),'补充问题'.repeat(180)],unknownSideEffects:['未知副作用⚠️\\\\'.repeat(130)]}
    const reportResult=await paginationReportTool.execute('pagination-report',{goalId:initialPaginationRead.details.goalId,revision:initialPaginationRead.details.revision,expectedModelSequence:initialPaginationRead.details.modelSequence,status:'active',modelReported:reportValues.modelReported,nextAction:reportValues.nextAction,questions:reportValues.questions,unknownSideEffects:reportValues.unknownSideEffects})
    const reportPage=reportResult.details
    const reportExpected=goal.getGoalCheckpoint(paginationContract.id,1)
    assert.ok(reportPage.nextCursor,'Report返回分页cursor')
    assert.notEqual(reportPage.sequence,initialPaginationRead.details.sequence,'成功Report刷新snapshot sequence')
    assert.notEqual(reportPage.modelSequence,initialPaginationRead.details.modelSequence)
    await appendToolResultAndTurnEnd(reportResult,'GoalCheckpointReport')
    await assert.rejects(()=>paginationReadTool.execute('stale-root-cursor',{cursor:oldRootCursor}),/失效或无效/)
    await assert.rejects(()=>paginationReportTool.execute('stale-model-report',{goalId:paginationContract.id,revision:1,expectedModelSequence:initialPaginationRead.details.modelSequence,status:'active',modelReported:['旧modelSequence必须拒绝'],nextAction:'拒绝',questions:[],unknownSideEffects:[]}),/model sequence CAS/)
    const reportCollected=collectCheckpointDto(reportPage)
    let reportCursor=reportPage.nextCursor;let reportPages=1
    while(reportCursor){
      const pageResult=await paginationReadTool.execute('pagination-report-page-'+reportPages,{cursor:reportCursor})
      const page=pageResult.details
      assert.equal(page.sequence,reportPage.sequence,'Report游标固定在成功提交时的sequence')
      assert.equal(page.modelSequence,reportPage.modelSequence)
      reportCollected.collect(page)
      await appendToolResultAndTurnEnd(pageResult,'GoalCheckpointRead')
      reportCursor=page.nextCursor;reportPages+=1
    }
    assert.ok(reportPages>2,'Report checkpoint被分页读取')
    assert.deepEqual(reportCollected.fields.observed,reportExpected.observed)
    assert.deepEqual(reportCollected.fields.modelReported,reportExpected.modelReported)
    assert.equal(reportCollected.fields.nextAction[0],reportExpected.nextAction)
    assert.deepEqual(reportCollected.fields.questions,reportExpected.questions)
    assert.deepEqual(reportCollected.fields.unknownSideEffects,reportExpected.unknownSideEffects)
    assert.ok(reportCollected.fields.modelReported.some((value)=>value.includes('🌙\\\\')),'Unicode与反斜杠长值完整重建')
    const rootPageResult=await paginationReadTool.execute('pagination-root-read',{})
    const rootPage=rootPageResult.details
    const rootExpected=goal.getGoalCheckpoint(paginationContract.id,1)
    assert.equal(rootPage.sequence,rootExpected.sequence,'新的无cursor root读取刷新到host最新水位')
    assert.ok(rootPage.nextCursor)
    const rootCollected=collectCheckpointDto(rootPage)
    await appendToolResultAndTurnEnd(rootPageResult,'GoalCheckpointRead')
    let rootCursor=rootPage.nextCursor;let rootPages=1
    while(rootCursor){
      const pageResult=await paginationReadTool.execute('pagination-root-page-'+rootPages,{cursor:rootCursor})
      assert.equal(pageResult.details.sequence,rootPage.sequence,'Read cursor不随每轮turn_end变化')
      rootCollected.collect(pageResult.details)
      await appendToolResultAndTurnEnd(pageResult,'GoalCheckpointRead')
      rootCursor=pageResult.details.nextCursor;rootPages+=1
    }
    assert.ok(rootPages>2)
    assert.deepEqual(rootCollected.fields.observed,rootExpected.observed)
    assert.deepEqual(rootCollected.fields.modelReported,rootExpected.modelReported)
    assert.equal(rootCollected.fields.nextAction[0],rootExpected.nextAction)
    assert.deepEqual(rootCollected.fields.questions,rootExpected.questions)
    assert.deepEqual(rootCollected.fields.unknownSideEffects,rootExpected.unknownSideEffects)
    const refreshedRoot=await paginationReadTool.execute('pagination-new-root',{})
    await assert.rejects(()=>paginationReadTool.execute('pagination-old-cursor-after-root',{cursor:rootPage.nextCursor}),/失效或无效/)
    const revOne=goal.getGoalContract(paginationSession,'w')
    goal.createGoalContract({sessionId:paginationSession,workspaceId:'w',expectedRevision:1,originalText:'revision changes invalidate page snapshots',scope:[],nonGoals:[],hardConstraints:[],acceptance:[],userMessageRef:'pagination-revision-2'})
    await assert.rejects(()=>paginationReadTool.execute('pagination-old-cursor-after-revision',{cursor:refreshedRoot.details.nextCursor}),/snapshot unavailable/)
    const revisionTwo=goal.getGoalContract(paginationSession,'w')
    const revisionTwoCheckpoint=goal.getGoalCheckpoint(revisionTwo.id,revisionTwo.revision)
    goal.recordGoalModelCheckpoint({goalId:revisionTwo.id,revision:revisionTwo.revision,expectedSequence:revisionTwoCheckpoint.sequence,status:'active',modelReported:['撤销前分页值🌘\\\\'.repeat(160)],nextAction:'安全撤销',questions:[],unknownSideEffects:[]})
    const revokeOwner=goal.createGoalMemoryCapability(paginationSession,'w')
    const revokeIdentity={ownerId:revokeOwner.ownerId,sessionId:paginationSession,workspaceId:'w',queryId:'revoke-pagination-query'}
    const revokeRoot=await revokeOwner.request({...revokeIdentity,operation:'checkpoint_read'})
    assert.ok(revokeRoot.checkpoint.nextCursor)
    const revokeCursor=revokeRoot.checkpoint.nextCursor
    process.env.PROMA_PERSONAL_GOAL_MEMORY='0'
    await assert.rejects(()=>revokeOwner.request({...revokeIdentity,operation:'checkpoint_read',cursor:revokeCursor}),/当前已关闭/)
    process.env.PROMA_PERSONAL_GOAL_MEMORY='1'
    await assert.rejects(()=>revokeOwner.request({...revokeIdentity,operation:'checkpoint_read',cursor:revokeCursor}),/snapshot unavailable/)
    const revokeRootAgain=await revokeOwner.request({...revokeIdentity,operation:'checkpoint_read'})
    assert.ok(revokeRootAgain.checkpoint.nextCursor)
    revokeOwner.revoke()
    await assert.rejects(()=>revokeOwner.request({...revokeIdentity,operation:'checkpoint_read',cursor:revokeRootAgain.checkpoint.nextCursor}),/query.*失效/)
    const queryBoundOwner=goal.createGoalMemoryCapability('s','w')
    await queryBoundOwner.request({ownerId:queryBoundOwner.ownerId,sessionId:'s',workspaceId:'w',queryId:'query-bound',operation:'checkpoint_read'})
    await assert.rejects(()=>queryBoundOwner.request({ownerId:queryBoundOwner.ownerId,sessionId:'s',workspaceId:'w',queryId:'query-other',operation:'checkpoint_read'}),/query.*身份不匹配/)
    queryBoundOwner.revoke()
    await assert.rejects(()=>queryBoundOwner.request({ownerId:queryBoundOwner.ownerId,sessionId:'s',workspaceId:'w',queryId:'query-bound',operation:'checkpoint_read'}),/query.*失效/)
    let releaseLateBinding
    const lateBindingPromise=new Promise((resolve)=>{releaseLateBinding=resolve})
    const lateOwner=goal.createGoalMemoryCapability('s','w',()=>lateBindingPromise)
    const lateSequence=goal.getGoalCheckpoint(c2.id,2).sequence
    const lateRequest=lateOwner.request({ownerId:lateOwner.ownerId,sessionId:'s',workspaceId:'w',queryId:'late-query',operation:'context',artifactId:'late-artifact',leafId:'entry-1',branchEntryIds:['entry-1']})
    lateOwner.revoke()
    await assert.rejects(()=>lateRequest,/已取消|query.*失效/)
    releaseLateBinding(null)
    assert.equal(goal.getGoalCheckpoint(c2.id,2).sequence,lateSequence,'query撤销后的迟到回执不得写checkpoint')
    const reported = await owner.request({...identity,operation:'checkpoint_model',input:{goalId:c2.id,revision:2,expectedModelSequence:latest.checkpoint.modelSequence+1,status:'claimed_done',modelReported:['模型自报完成'],nextAction:'交用户验证',questions:[],unknownSideEffects:[]}})
    assert.equal(reported.checkpoint.status,'claimed_done')
    await assert.rejects(()=>owner.request({...identity,operation:'checkpoint_model',input:{goalId:c2.id,revision:2,expectedModelSequence:latest.checkpoint.modelSequence,status:'active',modelReported:['重复旧报告'],nextAction:'拒绝',questions:[],unknownSideEffects:[]}}),/model sequence CAS/)
    goal.createGoalContract({sessionId:'revision-cas-session',workspaceId:'w',expectedRevision:0,originalText:'旧revision报告不能写入新revision',scope:[],nonGoals:[],hardConstraints:[],acceptance:[],userMessageRef:'revision-cas-1'})
    const revisionOwner=goal.createGoalMemoryCapability('revision-cas-session','w')
    const revisionIdentity={ownerId:revisionOwner.ownerId,sessionId:'revision-cas-session',workspaceId:'w',queryId:'revision-cas-query'}
    const oldRevisionDto=await revisionOwner.request({...revisionIdentity,operation:'checkpoint_read'})
    const revisionOne=goal.getGoalContract('revision-cas-session','w')
    goal.createGoalContract({sessionId:'revision-cas-session',workspaceId:'w',expectedRevision:1,originalText:'新revision',scope:[],nonGoals:[],hardConstraints:[],acceptance:[],userMessageRef:'revision-cas-2'})
    await assert.rejects(()=>revisionOwner.request({...revisionIdentity,operation:'checkpoint_model',input:{goalId:revisionOne.id,revision:1,expectedModelSequence:oldRevisionDto.checkpoint.modelSequence,status:'active',modelReported:['迟到旧报告'],nextAction:'不应写入新版本',questions:[],unknownSideEffects:[]}}),/合同revision已失效/)
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
