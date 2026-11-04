import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { build as esbuildBuild } from 'esbuild'

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
    import { createHash } from 'node:crypto'
    import { DatabaseSync } from 'node:sqlite'
    import { mkdirSync, writeFileSync, existsSync, realpathSync, readFileSync, promises as fsp } from 'node:fs'
    import { syncBuiltinESMExports } from 'node:module'
    import { join } from 'node:path'
    import * as goal from ${JSON.stringify(modulePath)}
    import { buildSessionContext } from ${JSON.stringify(join(repoRoot, 'node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js'))}
    import { convertToLlm } from ${JSON.stringify(join(repoRoot, 'node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js'))}
    import { PiUtilityAdapter } from ${JSON.stringify(join(import.meta.dir, 'adapters/pi-utility-adapter.ts'))}
    import { serializePiToolResultPayload } from ${JSON.stringify(join(import.meta.dir, 'adapters/pi-tool-result-json.ts'))}
    import { AGENT_RUNTIME_METHODS } from ${JSON.stringify(join(repoRoot, 'packages/shared/src/types/agent-runtime.ts'))}
    import { createAgentRuntimeRequest } from ${JSON.stringify(join(repoRoot, 'packages/shared/src/utils/agent-runtime.ts'))}
    import { GoalArtifactWorkerRunner, getGoalArtifactWorkerDiagnostics } from ${JSON.stringify(join(import.meta.dir, 'personal-goal-artifact-worker-client.ts'))}
    assert.deepEqual(getGoalArtifactWorkerDiagnostics(),{created:false,activeWorkers:0,queuedJobs:0},'import alone不得spawn worker')
    const root = join(process.env.HOME, '.proma-dev', 'goal-memory')
    const markerUser={role:'user',content:'<goal-memory-task-data>这是用户原文，不应删除',timestamp:1}
    const packed=goal.injectGoalTaskData([markerUser],'目标恢复合同')
    const packedAgain=goal.injectGoalTaskData(packed,'目标恢复合同')
    assert.equal(packedAgain.filter((item)=>String(item.content).includes('目标恢复合同')).length,1)
    assert.ok(packedAgain.includes(markerUser))
    const sdkEntries=[
      {type:'session',id:'sdk-session',parentId:null,version:3,timestamp:new Date().toISOString(),cwd:'/tmp'},
      {type:'message',id:'old-user',parentId:'sdk-session',timestamp:new Date().toISOString(),message:{role:'user',content:'Old turn user message'}},
      {type:'compaction',id:'cut-turn',parentId:'old-user',timestamp:new Date().toISOString(),summary:'SDK-generated cut-turn summary',tokensBefore:40_000,firstKeptEntryId:'not-retained'},
      {type:'message',id:'continuation-assistant',parentId:'cut-turn',timestamp:new Date().toISOString(),message:{role:'assistant',content:[{type:'text',text:'Continue from the cut turn'}]}},
      {type:'message',id:'continuation-tool-result',parentId:'continuation-assistant',timestamp:new Date().toISOString(),message:{role:'toolResult',toolCallId:'sdk-tool-call',toolName:'Bash',content:[{type:'text',text:'SDK tool output'}]}}
    ]
    const sdkIndex=new Map(sdkEntries.map((entry)=>[entry.id,entry]))
    const sdkCutContext=buildSessionContext(sdkEntries,'continuation-tool-result',sdkIndex)
    assert.deepEqual(sdkCutContext.messages.map((message)=>message.role),['compactionSummary','assistant','toolResult'],'安装版Pi SDK应生成没有原始user的真实cut-turn上下文')
    const mandatoryPack='Goal original objective; HARD_CONSTRAINT: do not publish; user authorization is not inferred.'
    const sdkInjectedOnce=goal.injectGoalTaskData(sdkCutContext.messages,mandatoryPack)
    const sdkInjectedTwice=goal.injectGoalTaskData(sdkInjectedOnce,mandatoryPack)
    const sdkConverted=convertToLlm(sdkInjectedTwice)
    const sdkGoalPackets=sdkConverted.filter((message)=>message.role==='user'&&String(message.content).includes('<goal-memory-task-data>'))
    assert.equal(sdkGoalPackets.length,1,'真实cut-turn请求每次只携带一份Goal task-data')
    assert.ok(sdkGoalPackets[0].content.includes(mandatoryPack),'转换后完整保留必需目标与硬约束')
    assert.deepEqual(sdkConverted.map((message)=>message.role),['user','user','assistant','toolResult'])
    const systemOnlyEntries=[sdkEntries[0],{type:'message',id:'system-only',parentId:'sdk-session',timestamp:new Date().toISOString(),message:{role:'system',content:'System instructions'}}]
    const systemOnlyContext=buildSessionContext(systemOnlyEntries,'system-only',new Map(systemOnlyEntries.map((entry)=>[entry.id,entry])))
    const systemOnlyConverted=convertToLlm(goal.injectGoalTaskData(systemOnlyContext.messages,mandatoryPack))
    assert.deepEqual(systemOnlyConverted.map((message)=>message.role),['system','user'],'system-only合法上下文仍注入Goal包且不覆盖system')
    assert.ok(String(systemOnlyConverted[1].content).includes(mandatoryPack))
    const emptySdkContext=buildSessionContext([],null,new Map())
    const emptyConverted=convertToLlm(goal.injectGoalTaskData(emptySdkContext.messages,mandatoryPack))
    assert.deepEqual(emptyConverted.map((message)=>message.role),['user'],'空合法上下文也保留完整Goal包')
    assert.ok(String(emptyConverted[0].content).includes(mandatoryPack))
    const adapterSource=readFileSync(${JSON.stringify(join(repoRoot, 'apps/electron/src/main/lib/adapters/pi-agent-adapter.ts'))},'utf8')
    const adapterTransformStart=adapterSource.indexOf('session.agent.transformContext = async (messages, signal) => {')
    const adapterTransformEnd=adapterSource.indexOf('// Pi 0.86 的 transcript-aware',adapterTransformStart)
    const adapterTransform=adapterSource.slice(adapterTransformStart,adapterTransformEnd)
    const transformStageOrder=['await previousTransformContext?.','capability.request({','injectGoalTaskData(transformed, loaded.context)','sanitizePiMessageImageContent(transformed)','applyImageBudget(sanitized']
    const transformStagePositions=transformStageOrder.map((stage)=>adapterTransform.indexOf(stage))
    assert.ok(transformStagePositions.every((position)=>position>=0),'保留previous transform、Goal注入、图片sanitize与budget步骤')
    assert.deepEqual(transformStagePositions,[...transformStagePositions].sort((a,b)=>a-b),'Goal task-data仍经过既有图片处理链')
    assert.equal(packedAgain.find((item)=>item===markerUser).content,markerUser.content)
    assert.equal(goal.getGoalContract('off'), null)
    assert.equal(existsSync(root), false)
    process.env.PROMA_PERSONAL_GOAL_MEMORY = '1'
    const c1 = goal.createGoalContract({sessionId:'s', workspaceId:'w', expectedRevision:0, originalText:'保留原文；先验证，再决定', scope:['当前仓库'], nonGoals:['不发布'], hardConstraints:['不删数据','须先询问'], acceptance:['测试通过'], userMessageRef:'msg-1'})
    assert.deepEqual(getGoalArtifactWorkerDiagnostics(),{created:false,activeWorkers:0,queuedJobs:0},'合同创建/读写没有历史扫描时不得spawn worker')
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
    const legacyEdgeText='x'.repeat(11_650)
    const legacyEdgeContract=goal.createGoalContract({sessionId:'legacy-edge-contract',workspaceId:'w',expectedRevision:0,originalText:legacyEdgeText,scope:[],nonGoals:[],hardConstraints:[],acceptance:[],userMessageRef:'legacy-edge-user'})
    const legacyEdgeCheckpoint=goal.getGoalCheckpoint(legacyEdgeContract.id,1)
    const legacyInitialPack=goal.buildGoalContextPack(legacyEdgeContract,legacyEdgeCheckpoint)
    assert.equal(Buffer.byteLength(legacyInitialPack,'utf8'),11_955,'保留父复现的11,650 ASCII初始包边界')
    const maxProgressList=(prefix,character)=>Array.from({length:100},(_,index)=>{const head=prefix+'-'+index+'-';return head+character.repeat(5_000-head.length)})
    const budgetMaxObserved=maxProgressList('MAX_OBSERVED','o')
    const maxReports=maxProgressList('MAX_MODEL_PROGRESS_SENTINEL','m')
    const maxQuestions=maxProgressList('MAX_QUESTION','q')
    const maxUnknown=maxProgressList('MAX_UNKNOWN_SIDE_EFFECT','u')
    const maxNextAction='MAX_NEXT_ACTION_SENTINEL_'+ 'n'.repeat(5_000-'MAX_NEXT_ACTION_SENTINEL_'.length)
    const budgetContract=goal.createGoalContract({sessionId:'max-progress-budget',workspaceId:'w',expectedRevision:0,originalText:'Preserve this objective without inferring authorization.',scope:['temporary fixture'],nonGoals:['do not publish'],hardConstraints:['HARD_CONSTRAINT: never publish without explicit user approval'],acceptance:['retain the original constraint'],userMessageRef:'max-progress-user'})
    const budgetStart=goal.getGoalCheckpoint(budgetContract.id,1)
    const budgetObserved=goal.recordGoalObservedCheckpoint({goalId:budgetContract.id,revision:1,expectedSequence:budgetStart.sequence,observed:budgetMaxObserved,artifactId:'',branchId:'',leafId:'',entryWatermark:[],entryHashes:{}})
    const maxProgressCheckpoint=goal.recordGoalModelCheckpoint({goalId:budgetContract.id,revision:1,expectedSequence:budgetObserved.sequence,status:'claimed_done',modelReported:maxReports,nextAction:maxNextAction,questions:maxQuestions,unknownSideEffects:maxUnknown})
    assert.equal(maxProgressCheckpoint.status,'claimed_done')
    for(const status of ['active','waiting_user','blocked','paused','claimed_done']){
      const fallbackPack=goal.buildGoalContextPack(budgetContract,{...maxProgressCheckpoint,status})
      assert.ok(Buffer.byteLength(fallbackPack,'utf8')<=goal.GOAL_CONTEXT_BUDGET_CHARS)
      assert.ok(fallbackPack.includes('可选checkpoint进度已省略'))
      assert.ok(fallbackPack.includes('HARD_CONSTRAINT: never publish without explicit user approval'))
      assert.ok(fallbackPack.includes('Preserve this objective without inferring authorization.'))
      assert.equal(fallbackPack.includes('MAX_MODEL_PROGRESS_SENTINEL'),false,'可选进度全部省略时必需合同不得变形')
    }
    const legacyAfterLargeProgress=goal.buildGoalContextPack(legacyEdgeContract,{...maxProgressCheckpoint,goalId:legacyEdgeContract.id,revision:1})
    assert.ok(Buffer.byteLength(legacyAfterLargeProgress,'utf8')<=goal.GOAL_CONTEXT_BUDGET_CHARS,'未修改的历史边界合同可使用短省略标记恢复')
    assert.ok(legacyAfterLargeProgress.includes(legacyEdgeText),'历史合同原文逐字保留')
    const boundaryCandidate={...budgetContract,id:'a'.repeat(36),revision:1,hash:'b'.repeat(64),scope:[],nonGoals:[],hardConstraints:[],acceptance:[]}
    const fallbackFits=(text)=>{try{goal.buildGoalContextPack({...boundaryCandidate,originalText:text},{...maxProgressCheckpoint,goalId:boundaryCandidate.id,revision:1});return true}catch{return false}}
    const maxAsciiLength=(()=>{let low=0,high=12_000;while(low<high){const middle=Math.ceil((low+high)/2);if(fallbackFits('x'.repeat(middle)))low=middle;else high=middle-1}return low})()
    const asciiBoundary=goal.createGoalContract({sessionId:'ascii-budget-boundary',workspaceId:'w',expectedRevision:0,originalText:'x'.repeat(maxAsciiLength),scope:[],nonGoals:[],hardConstraints:[],acceptance:[],userMessageRef:'ascii-boundary'})
    const asciiBoundaryPack=goal.buildGoalContextPack(asciiBoundary,{...maxProgressCheckpoint,goalId:asciiBoundary.id,revision:1})
    assert.ok(Buffer.byteLength(asciiBoundaryPack,'utf8')<=goal.GOAL_CONTEXT_BUDGET_CHARS)
    assert.throws(()=>goal.createGoalContract({sessionId:'ascii-budget-over',workspaceId:'w',expectedRevision:0,originalText:'x'.repeat(maxAsciiLength+1),scope:[],nonGoals:[],hardConstraints:[],acceptance:[],userMessageRef:'ascii-over'}),/固定进度省略提示/)
    assert.equal(goal.getGoalContract('ascii-budget-over','w'),null,'预算拒绝后合同CAS状态未推进')
    const maxEmojiCount=(()=>{let low=0,high=3_000;while(low<high){const middle=Math.ceil((low+high)/2);if(fallbackFits('🌙'.repeat(middle)))low=middle;else high=middle-1}return low})()
    const unicodeBoundary=goal.createGoalContract({sessionId:'unicode-budget-boundary',workspaceId:'w',expectedRevision:0,originalText:'🌙'.repeat(maxEmojiCount),scope:[],nonGoals:[],hardConstraints:[],acceptance:[],userMessageRef:'unicode-boundary'})
    const unicodeBoundaryPack=goal.buildGoalContextPack(unicodeBoundary,{...maxProgressCheckpoint,goalId:unicodeBoundary.id,revision:1})
    assert.ok(Buffer.byteLength(unicodeBoundaryPack,'utf8')<=goal.GOAL_CONTEXT_BUDGET_CHARS)
    assert.throws(()=>goal.createGoalContract({sessionId:'unicode-budget-over',workspaceId:'w',expectedRevision:0,originalText:'🌙'.repeat(maxEmojiCount+1),scope:[],nonGoals:[],hardConstraints:[],acceptance:[],userMessageRef:'unicode-over'}),/固定进度省略提示/)
    assert.equal(goal.getGoalContract('unicode-budget-over','w'),null,'UTF-8越界拒绝不写新合同')
    const beforeBudgetCas=goal.getGoalContract(budgetContract.sessionId,'w')
    assert.throws(()=>goal.createGoalContract({sessionId:budgetContract.sessionId,workspaceId:'w',expectedRevision:0,originalText:'stale boundary revision',scope:[],nonGoals:[],hardConstraints:[],acceptance:[],userMessageRef:'stale-budget-cas'}),/CAS 冲突/)
    assert.deepEqual(goal.getGoalContract(budgetContract.sessionId,'w'),beforeBudgetCas,'CAS失败不改现有immutable合同')
    const commandContract = {expectedRevision:2,originalText:'原文目标',scope:[],nonGoals:[],hardConstraints:['不得发布'],acceptance:['人工确认']}
    assert.deepEqual(goal.parseGoalCommand('/goal set ' + JSON.stringify(commandContract)), {command:'set', input:commandContract})
    assert.deepEqual(goal.parseGoalCommand('/goal restore'), {command:'restore'})
    assert.throws(() => goal.parseGoalCommand('/goal set'), /JSON/)
    for(const command of ['/goal off','/goal set {}','/goal revise {}','/goal status','/goal restore','/goal unknown','  /goal typo'])assert.equal(goal.isGoalManagementCommandMessage(command),true)
    assert.equal(goal.isGoalManagementCommandMessage('ordinary queued text'),false)
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
    const orchestratorSource=readFileSync(${JSON.stringify(join(repoRoot, 'apps/electron/src/main/lib/agent-orchestrator.ts'))},'utf8')
    const goalCommandStart=orchestratorSource.indexOf('// Goal 指令只在明确启用时由宿主解析')
    const goalCommandEnd=orchestratorSource.indexOf('// 0.5 清除上一轮中断标记',goalCommandStart)
    const goalCommandBody=orchestratorSource.slice(goalCommandStart,goalCommandEnd)
    const queueMessageStart=orchestratorSource.indexOf('async queueMessage(')
    const queueMessageBody=orchestratorSource.slice(queueMessageStart)
    assert.ok(queueMessageBody.includes('isGoalMemoryEnabled() && isGoalManagementCommandMessage(text)'),'实际queueMessage先拒绝活跃Goal命令')
    const queueGuardIndex=queueMessageBody.indexOf('isGoalManagementCommandMessage(text)')
    for(const laterSideEffect of ['this.adapter.sendQueuedMessage','getAgentSessionMeta','getVaultUserContext','buildReferencedSessionsPrompt','presetUuid || randomUUID()','this.queuedMessageUuids.get','appendSDKMessages']){
      const sideEffectIndex=queueMessageBody.indexOf(laterSideEffect)
      assert.ok(sideEffectIndex>=0,'queueMessage应保留原有路径节点: '+laterSideEffect)
      assert.ok(queueGuardIndex<sideEffectIndex,'queue guard必须先于'+laterSideEffect)
    }
    assert.ok(goalCommandBody.includes("const goalWorkspaceId = sessionMeta?.workspaceId ?? requestedWorkspaceId ?? 'default'"),'宿主命令workspace优先级必须来自持久session metadata')
    assert.ok(goalCommandBody.includes('workspaceId: goalWorkspaceId'))
    assert.ok(goalCommandBody.includes('getGoalContract(sessionId, goalWorkspaceId)'),'status/restore必须使用同一会话归属')
    assert.ok(orchestratorSource.includes('const workspaceId = sessionMeta?.workspaceId ?? requestedWorkspaceId'),'普通query workspace也必须优先持久会话归属')
    assert.ok(orchestratorSource.includes("const activeGoal = isGoalMemoryEnabled() ? getGoalContract(sessionId, workspaceId ?? 'default') : null"),'query contract lookup必须与持久会话workspace归属一致')
    assert.ok(orchestratorSource.includes("const goalWorkspaceId = workspaceId ?? 'default'"),'query capability的workspace不得反向优先请求slug')
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
    const mainThreadSentinel='PROMA_GOAL_ARTIFACT_MAIN_THREAD_SENTINEL'
    const rows = branchEntryIds.map((id,i) => JSON.stringify({id,parentId:i?branchEntryIds[i-1]:null,type:'message',message:{role:i%2?'assistant':'user',content:i===0?'旧证据 '.repeat(6000)+'TAIL_SENTINEL_OLD '+mainThreadSentinel:i===5?[{type:'toolCall',id:'call-5',name:'search',arguments:{query:'蓝色关键词'}}]:i===6?[{type:'toolResult',toolCallId:'call-5',content:'工具回执'}]:i===7?[{type:'toolCall',id:'call-7',name:'shell',arguments:{command:'git status ARGUMENT_SENTINEL',path:'/tmp/ARGUMENT_PATH_SENTINEL',values:Array.from({length:4002},(_,index)=>index===4000?'ARRAY_TAIL_SENTINEL':'x')}}]:'历史证据 '.repeat(1400)} }))
    const entries=rows.join('\\n')+'\\n'
    writeFileSync(artifactPath, entries)
    goal.createGoalContract({sessionId:'artifact-session',workspaceId:'w',expectedRevision:0,originalText:'读取当轮原文',scope:['current-turn'],nonGoals:[],hardConstraints:['不得回溯其他branch'],acceptance:['精确entry读取'],userMessageRef:'artifact-user'})
    let hostBinding = {sessionId:'artifact-session',workspaceId:'w',artifactId:'artifact-sdk-session',artifactIdentity:'artifact-sdk-session:1:1',path:realpathSync(artifactPath),sessionsDirectory:realpathSync(process.env.HOME)}
    const artifactOwner = goal.createGoalMemoryCapability('artifact-session','w',async () => hostBinding)
    const artifactIdentity = {ownerId:artifactOwner.ownerId,sessionId:'artifact-session',workspaceId:'w',queryId:'query-artifact'}
    const nativeJsonParse=JSON.parse
    let mainThreadSentinelParseCount=0
    JSON.parse=function(value,...args){if(typeof value==='string'&&value.includes(mainThreadSentinel))mainThreadSentinelParseCount++;return nativeJsonParse.call(JSON,value,...args)}
    let recorded
    try { recorded = await artifactOwner.request({...artifactIdentity,operation:'turn_end',artifactId:hostBinding.artifactId,leafId:'entry-299',entryIds:['entry-299'],branchEntryIds}) }
    finally { JSON.parse=nativeJsonParse }
    assert.equal(mainThreadSentinelParseCount,0,'Goal artifact JSON.parse必须不在main thread执行，当前探针记录'+mainThreadSentinelParseCount+'次')
    const productionWorkerRunner=new GoalArtifactWorkerRunner({workerPath:join(process.env.HOME,'personal-goal-artifact-worker.cjs'),maxActiveWorkers:1,maxQueuedJobs:1})
    const workerExecution=await productionWorkerRunner.run({binding:{path:hostBinding.path,sessionsDirectory:hostBinding.sessionsDirectory},branchEntryIds:['entry-0'],leafId:'entry-0',mode:'entry',query:'entry-0',offset:0,limit:1,requiredIds:['entry-0'],expectedHashes:{},hashOnly:false,allowUnpersistedSuffix:false,options:{captureEvidenceSnapshot:true}})
    assert.ok(workerExecution.workerThreadId>0,'生产worker返回真实Node worker_threads.threadId')
    assert.equal(workerExecution.result.status,'ok')
    assert.deepEqual(workerExecution.result.lines,[rows[0]],'生产worker返回精确原始JSONL行')
    assert.equal(workerExecution.result.entryHashes['entry-0'],createHash('sha256').update(rows[0]).digest('hex'),'生产worker返回精确source hash')
    assert.equal(productionWorkerRunner.diagnostics().activeWorkers,0)
    assert.equal(productionWorkerRunner.diagnostics().queuedJobs,0)
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
    const runFinalStateNativeRace=async({name,operation='evidence_read',prebind=true,expectedError,mutate,verifyAfter})=>{
      const sessionId='final-state-'+name;const directory=join(process.env.HOME,'final-state-'+name);mkdirSync(directory,{recursive:true})
      const ids=['final-state-'+name+'-0','final-state-'+name+'-1','final-state-'+name+'-2'];const file=join(directory,'source.jsonl')
      const sourceRows=ids.map((id,index)=>({id,parentId:index?ids[index-1]:null,type:'message',message:{role:index?'assistant':'user',content:'NATIVE_RACE_'+name+' evidence row '+index}}))
      writeFileSync(file,sourceRows.map((row)=>JSON.stringify(row)).join('\\n')+'\\n')
      const contract=goal.createGoalContract({sessionId,workspaceId:'w',expectedRevision:0,originalText:'Final state native race '+name,scope:[],nonGoals:[],hardConstraints:['stale worker response must not commit'],acceptance:['reject after final stat'],userMessageRef:'final-state-user-'+name})
      const binding={sessionId,workspaceId:'w',artifactId:'sdk-final-'+name,artifactIdentity:'identity-final-'+name,path:realpathSync(file),sessionsDirectory:realpathSync(directory)}
      const owner=goal.createGoalMemoryCapability(sessionId,'w',async()=>binding)
      const identity={ownerId:owner.ownerId,sessionId,workspaceId:'w',queryId:'query-final-'+name}
      const contextRequest={...identity,operation:'context',artifactId:binding.artifactId,leafId:ids[2],branchEntryIds:ids}
      if(prebind)assert.ok((await owner.request(contextRequest)).context)
      const before=goal.getGoalCheckpoint(contract.id,contract.revision)
      const originalStat=fsp.stat;let armed=false;let mainStatCalls=0;let mutationFired=false
      fsp.stat=async function(...args){const stat=await originalStat.apply(this,args);if(armed&&(args[0]===file||args[0]===binding.path)){mainStatCalls++;if(mainStatCalls===1){mutationFired=true;mutate({contract,before,sessionId,owner,binding,ids})}}return stat}
      syncBuiltinESMExports()
      const request=operation==='evidence_read'?{...identity,operation,mode:'keyword',query:'NATIVE_RACE_'+name,offset:0,limit:1,branchEntryIds:ids,leafId:ids[2]}:
        operation==='turn_end'?{...identity,operation,artifactId:binding.artifactId,leafId:ids[2],entryIds:[ids[2]],branchEntryIds:ids}:
        operation==='compact_ack'?{...identity,operation,reason:'manual',artifactId:binding.artifactId,leafId:ids[2],branchEntryIds:ids}:contextRequest
      try{armed=true;await assert.rejects(()=>owner.request(request),expectedError)}finally{armed=false;fsp.stat=originalStat;syncBuiltinESMExports()}
      assert.equal(mainStatCalls,1,'只在最后main source stat处注入一次')
      assert.equal(mutationFired,true,'必须在最后source stat await期间触发真实sidecar mutation')
      const latestContract=goal.getGoalContract(sessionId,'w');const latestCheckpoint=goal.getGoalCheckpoint(latestContract.id,latestContract.revision)
      if(operation==='evidence_read')await assert.rejects(()=>owner.request({...identity,operation:'evidence_read',mode:'keyword',query:'NATIVE_RACE_'+name,offset:1,limit:1,branchEntryIds:ids,leafId:ids[2]}),/snapshot unavailable/,'拒绝root结果后不得留下或推进cursor快照')
      if(verifyAfter)verifyAfter({contract,before,latestContract,latestCheckpoint,sessionId,owner,binding,ids})
      owner.revoke()
    }
    const mutateRevisionDuringFinalStat=({contract})=>goal.createGoalContract({sessionId:contract.sessionId,workspaceId:contract.workspaceId,expectedRevision:contract.revision,originalText:'new revision wins during stat',scope:[],nonGoals:[],hardConstraints:['revision changed'],acceptance:['reject old result'],userMessageRef:'new-revision-user'})
    const mutateSequenceDuringFinalStat=({contract,before})=>goal.recordGoalModelCheckpoint({goalId:contract.id,revision:contract.revision,expectedSequence:before.sequence,status:'active',modelReported:['concurrent native metadata update'],nextAction:'',questions:[],unknownSideEffects:[]})
    await runFinalStateNativeRace({name:'evidence-revision',expectedError:/contract revision changed during artifact worker scan/,mutate:mutateRevisionDuringFinalStat,verifyAfter:({latestContract,latestCheckpoint})=>assert.equal(latestContract.revision,2)})
    await runFinalStateNativeRace({name:'evidence-sequence',expectedError:/checkpoint sequence changed during artifact worker scan/,mutate:mutateSequenceDuringFinalStat,verifyAfter:({before,latestCheckpoint})=>assert.equal(latestCheckpoint.sequence,before.sequence+1)})
    await runFinalStateNativeRace({name:'context-sequence',operation:'context',expectedError:/checkpoint sequence changed during artifact worker scan/,mutate:mutateSequenceDuringFinalStat,verifyAfter:({before,latestCheckpoint})=>assert.equal(latestCheckpoint.sequence,before.sequence+1)})
    await runFinalStateNativeRace({name:'initial-context-revision',operation:'context',prebind:false,expectedError:/contract revision changed during artifact worker scan/,mutate:mutateRevisionDuringFinalStat,verifyAfter:({latestContract,latestCheckpoint})=>{assert.equal(latestContract.revision,2);assert.equal(latestCheckpoint.artifactId,'');assert.equal(latestCheckpoint.entryWatermark.length,0)}})
    await runFinalStateNativeRace({name:'turn-end-sequence',operation:'turn_end',expectedError:/checkpoint sequence changed during artifact worker scan/,mutate:mutateSequenceDuringFinalStat,verifyAfter:({before,latestCheckpoint})=>{assert.equal(latestCheckpoint.sequence,before.sequence+1);assert.equal(latestCheckpoint.leafId,before.leafId);assert.ok(!latestCheckpoint.observed.some((entry)=>entry.includes('Pi turn_end 已持久化 entries')));assert.deepEqual(latestCheckpoint.entryWatermark,before.entryWatermark)}})
    await runFinalStateNativeRace({name:'compact-ack-sequence',operation:'compact_ack',expectedError:/checkpoint sequence changed during artifact worker scan/,mutate:mutateSequenceDuringFinalStat,verifyAfter:({sessionId})=>{const db=new DatabaseSync(join(process.env.HOME,'.proma-dev','goal-memory','goals.sqlite'));try{assert.equal(db.prepare('SELECT COUNT(*) AS count FROM compaction_acks WHERE session_id=?').get(sessionId).count,0)}finally{db.close()}}})
    const runEvidenceRootOwnershipRace=async({name,staleOffset,failOldStat=false})=>{
      const sessionId='snapshot-owner-'+name;const directory=join(process.env.HOME,'snapshot-owner-'+name);mkdirSync(directory,{recursive:true})
      const ids=['u0','a1','b0','b1','leaf'];const texts=['ALPHA first','ALPHA second','BETA first','BETA second','ALPHA BETA last'];const file=join(directory,'source.jsonl')
      const sourceRows=ids.map((id,index)=>({type:'message',id,parentId:index?ids[index-1]:null,message:{role:index?'assistant':'user',content:[{type:'text',text:texts[index]}]}}))
      writeFileSync(file,sourceRows.map((row)=>JSON.stringify(row)).join('\\n')+'\\n')
      const contract=goal.createGoalContract({sessionId,workspaceId:'w',expectedRevision:0,originalText:'Cursor snapshot ownership '+name,scope:[],nonGoals:[],hardConstraints:['stale scan cannot mutate newer root'],acceptance:['BETA offset1 returns b1'],userMessageRef:'snapshot-owner-user-'+name})
      const binding={sessionId,workspaceId:'w',artifactId:'sdk-snapshot-'+name,artifactIdentity:'snapshot-owner-'+name,path:realpathSync(file),sessionsDirectory:realpathSync(directory)}
      const owner=goal.createGoalMemoryCapability(sessionId,'w',async()=>binding)
      const identity={ownerId:owner.ownerId,sessionId,workspaceId:'w',queryId:'snapshot-owner-query-'+name}
      const read=(query,offset)=>owner.request({...identity,operation:'evidence_read',mode:'keyword',query,offset,limit:1,branchEntryIds:ids,leafId:'leaf'})
      try{
        assert.ok((await owner.request({...identity,operation:'context',artifactId:binding.artifactId,branchEntryIds:ids,leafId:'leaf'})).context)
        const checkpointBefore=JSON.stringify(goal.getGoalCheckpoint(contract.id,contract.revision))
        const alphaRoot=await read('ALPHA',0);assert.equal(alphaRoot.evidence.nextOffset,1);assert.equal(JSON.parse(alphaRoot.evidence.lines[0]).id,'u0')
        const originalStat=fsp.stat;let armed=false;let gateEnteredResolve;let releaseGate;let gateEntered=false
        const gateEnteredPromise=new Promise((resolve)=>{gateEnteredResolve=resolve});const gate=new Promise((resolve)=>{releaseGate=resolve})
        fsp.stat=async function(...args){const stat=await originalStat.apply(this,args);if(armed&&!gateEntered&&args[0]===binding.path){gateEntered=true;gateEnteredResolve();await gate;if(failOldStat)throw new Error('injected stale snapshot stat failure')}return stat}
        syncBuiltinESMExports()
        try{
          armed=true
          const staleRead=read('ALPHA',staleOffset).then((value)=>({accepted:true,nextOffset:value.evidence?.nextOffset}),error=>({accepted:false,error:String(error)}))
          let watchdog;try{await Promise.race([gateEnteredPromise,new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(new Error('snapshot owner stat gate not reached')),3000)})])}finally{if(watchdog)clearTimeout(watchdog)}
          const betaRoot=await read('BETA',0)
          assert.equal(betaRoot.evidence.nextOffset,1)
          assert.equal(JSON.parse(betaRoot.evidence.lines[0]).id,'b0')
          releaseGate()
          const staleOutcome=await staleRead
          assert.equal(staleOutcome.accepted,false,'旧root/continuation在新root建立后必须拒绝迟到结果')
          const betaContinuation=await read('BETA',1)
          assert.equal(betaContinuation.evidence.status,'ok')
          assert.equal(JSON.parse(betaContinuation.evidence.lines[0]).id,'b1','旧ALPHA请求不能清空或推进BETA游标')
          assert.equal(JSON.stringify(goal.getGoalCheckpoint(contract.id,contract.revision)),checkpointBefore,'快照竞争不得改动authoritative checkpoint')
          assert.equal(getGoalArtifactWorkerDiagnostics().activeWorkers,0)
          assert.equal(getGoalArtifactWorkerDiagnostics().queuedJobs,0)
        }finally{armed=false;releaseGate();fsp.stat=originalStat;syncBuiltinESMExports()}
      }finally{owner.revoke()}
    }
    await runEvidenceRootOwnershipRace({name:'stale-continuation',staleOffset:1})
    await runEvidenceRootOwnershipRace({name:'stale-root-return',staleOffset:0})
    await runEvidenceRootOwnershipRace({name:'stale-root-failure',staleOffset:0,failOldStat:true})
    const runFirstBindOwnerRace=async()=>{
      const sessionId='first-bind-owner-race';const directory=join(process.env.HOME,sessionId);mkdirSync(directory,{recursive:true})
      const ids=['u0','a1','b0','b1','leaf'];const texts=['ALPHA first','ALPHA second','BETA first','BETA second','ALPHA BETA last'];const file=join(directory,'source.jsonl')
      const sourceRows=ids.map((id,index)=>({type:'message',id,parentId:index?ids[index-1]:null,message:{role:index?'assistant':'user',content:[{type:'text',text:texts[index]}]}}))
      writeFileSync(file,sourceRows.map((row)=>JSON.stringify(row)).join('\\n')+'\\n')
      const contract=goal.createGoalContract({sessionId,workspaceId:'w',expectedRevision:0,originalText:'A superseded first binding must not advance the host checkpoint.',scope:[],nonGoals:[],hardConstraints:['latest root owns initial binding'],acceptance:['BETA b0/b1'],userMessageRef:'first-bind-owner-user'})
      const binding={sessionId,workspaceId:'w',artifactId:'sdk-first-bind-owner',artifactIdentity:'first-bind-owner-identity',path:realpathSync(file),sessionsDirectory:realpathSync(directory)}
      const owner=goal.createGoalMemoryCapability(sessionId,'w',async()=>binding)
      const identity={ownerId:owner.ownerId,sessionId,workspaceId:'w',queryId:'first-bind-owner-query'}
      const initial=goal.getGoalCheckpoint(contract.id,contract.revision)
      assert.equal(initial.sequence,0);assert.equal(initial.artifactId,'');assert.equal(initial.entryWatermark.length,0)
      const read=(query,offset=0)=>owner.request({...identity,operation:'evidence_read',mode:'keyword',query,offset,limit:1,branchEntryIds:ids,leafId:'leaf'})
      const originalStat=fsp.stat;let armed=false;let intercepted=0
      const release=[];const entered=[];const resolveEntered=[]
      for(let index=0;index<2;index++){let signalEntered;entered.push(new Promise((resolve)=>{signalEntered=resolve}));resolveEntered.push(signalEntered)}
      fsp.stat=async function(...args){const stat=await originalStat.apply(this,args);if(armed&&args[0]===binding.path&&intercepted<2){const slot=intercepted++;resolveEntered[slot]();await new Promise((resolve)=>{release[slot]=resolve})}return stat}
      syncBuiltinESMExports()
      const waitForEntered=async(index)=>{let timer;try{await Promise.race([entered[index],new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('first binding worker stat gate not reached')),4000)})])}finally{if(timer)clearTimeout(timer)}}
      try{
        armed=true
        const oldRoot=read('ALPHA').then((value)=>({accepted:true,value}),error=>({accepted:false,error:String(error)}))
        await waitForEntered(0)
        const newRoot=read('BETA').then((value)=>({accepted:true,value}),error=>({accepted:false,error:String(error)}))
        await waitForEntered(1)
        const whileBothGated=goal.getGoalCheckpoint(contract.id,contract.revision)
        assert.equal(whileBothGated.sequence,0,'两个未绑定root scans都在gate上时checkpoint应保持CP0')
        assert.equal(whileBothGated.artifactId,'')
        release[0]()
        const oldOutcome=await oldRoot
        assert.equal(oldOutcome.accepted,false,'superseded A must fail before first binding commit')
        const afterOld=goal.getGoalCheckpoint(contract.id,contract.revision)
        assert.equal(afterOld.sequence,0,'old A release must leave host sequence at CP0')
        assert.equal(afterOld.artifactId,'','old A release must leave source binding empty')
        assert.equal(afterOld.entryWatermark.length,0)
        release[1]()
        const newOutcome=await newRoot
        assert.equal(newOutcome.accepted,true,'current B root must initialize successfully')
        assert.equal(newOutcome.value.evidence.status,'ok')
        assert.equal(newOutcome.value.evidence.nextOffset,1)
        assert.equal(JSON.parse(newOutcome.value.evidence.lines[0]).id,'b0')
        const betaPage=await read('BETA',1)
        assert.equal(betaPage.evidence.status,'ok')
        assert.equal(JSON.parse(betaPage.evidence.lines[0]).id,'b1')
        const finalCheckpoint=goal.getGoalCheckpoint(contract.id,contract.revision)
        assert.equal(finalCheckpoint.sequence,1)
        assert.equal(finalCheckpoint.modelSequence,0)
        assert.equal(finalCheckpoint.artifactId,binding.artifactIdentity)
        assert.equal(finalCheckpoint.entryWatermark.length,ids.length)
        assert.equal(intercepted,2,'both initial root scans reached the gated main source stat')
        assert.equal(getGoalArtifactWorkerDiagnostics().activeWorkers,0)
        assert.equal(getGoalArtifactWorkerDiagnostics().queuedJobs,0)
      }finally{armed=false;for(const releaseGate of release)releaseGate?.();fsp.stat=originalStat;syncBuiltinESMExports();owner.revoke()}
    }
    await runFirstBindOwnerRace()
    goal.createGoalContract({sessionId:'worker-source-drift-session',workspaceId:'w',expectedRevision:0,originalText:'worker结果返回后必须重新验证artifact binding',scope:[],nonGoals:[],hardConstraints:['源变化不得提交/刷新快照'],acceptance:['拒绝迟到结果'],userMessageRef:'worker-source-drift-user'})
    const workerSourceDriftBinding={...originalBinding,sessionId:'worker-source-drift-session',artifactId:'worker-source-drift-artifact',artifactIdentity:'worker-source-drift:1:1'}
    const workerSourceDriftChanged={...workerSourceDriftBinding,artifactIdentity:'worker-source-drift:2:2'}
    const workerSourceDriftResponses=[]
    const workerSourceDriftOwner=goal.createGoalMemoryCapability('worker-source-drift-session','w',async()=>workerSourceDriftResponses.length?workerSourceDriftResponses.shift():workerSourceDriftBinding)
    const workerSourceDriftIdentity={ownerId:workerSourceDriftOwner.ownerId,sessionId:'worker-source-drift-session',workspaceId:'w',queryId:'worker-source-drift-query'}
    const workerSourceDriftRoot={...workerSourceDriftIdentity,operation:'context',artifactId:workerSourceDriftBinding.artifactId,leafId:'entry-299',branchEntryIds}
    assert.ok((await workerSourceDriftOwner.request(workerSourceDriftRoot)).context)
    const workerSourceDriftBefore=goal.getGoalCheckpoint(goal.getGoalContract('worker-source-drift-session','w').id,1)
    workerSourceDriftResponses.push(workerSourceDriftBinding,workerSourceDriftChanged)
    await assert.rejects(()=>workerSourceDriftOwner.request({...workerSourceDriftIdentity,operation:'evidence_read',mode:'keyword',query:'历史证据',offset:0,limit:1,branchEntryIds,leafId:'entry-299'}),/binding changed during worker scan/)
    const workerSourceDriftAfter=goal.getGoalCheckpoint(goal.getGoalContract('worker-source-drift-session','w').id,1)
    assert.equal(workerSourceDriftAfter.sequence,workerSourceDriftBefore.sequence,'worker source漂移不得迟到写checkpoint')
    assert.equal(workerSourceDriftAfter.artifactId,workerSourceDriftBefore.artifactId)
    assert.equal(workerSourceDriftAfter.entryWatermark.length,workerSourceDriftBefore.entryWatermark.length)
    await assert.rejects(()=>workerSourceDriftOwner.request({...workerSourceDriftIdentity,operation:'evidence_read',mode:'keyword',query:'历史证据',offset:1,limit:1,branchEntryIds,leafId:'entry-299'}),/snapshot unavailable/,'source漂移不得刷新root分页快照')
    const workerFileDriftDir=join(process.env.HOME,'worker-file-drift');mkdirSync(workerFileDriftDir,{recursive:true})
    const workerFileDriftPath=join(workerFileDriftDir,'session.jsonl')
    const workerFileDriftIds=['file-drift-0','file-drift-1']
    const workerFileDriftOriginal=workerFileDriftIds.map((id,index)=>JSON.stringify({id,parentId:index?workerFileDriftIds[index-1]:null,type:'message',message:{content:'FILE_DRIFT_SENTINEL '+id}})).join('\\n')+'\\n'
    writeFileSync(workerFileDriftPath,workerFileDriftOriginal)
    const workerFileDriftSession='worker-file-drift-session'
    const workerFileDriftContract=goal.createGoalContract({sessionId:workerFileDriftSession,workspaceId:'w',expectedRevision:0,originalText:'复核worker期间源文件变化',scope:[],nonGoals:[],hardConstraints:['不能基于旧快照写入'],acceptance:['source fingerprint变更拒绝'],userMessageRef:'worker-file-drift-user'})
    const workerFileDriftBinding={sessionId:workerFileDriftSession,workspaceId:'w',artifactId:'worker-file-drift-artifact',artifactIdentity:'worker-file-drift:1:1',path:realpathSync(workerFileDriftPath),sessionsDirectory:realpathSync(workerFileDriftDir)}
    let mutateOnSecondResolve=false;let workerFileDriftResolveCount=0
    const workerFileDriftOwner=goal.createGoalMemoryCapability(workerFileDriftSession,'w',async()=>{
      if(mutateOnSecondResolve&&++workerFileDriftResolveCount===2)writeFileSync(workerFileDriftPath,workerFileDriftOriginal+JSON.stringify({id:'file-drift-external',parentId:'file-drift-1',type:'message',message:{content:'changed after worker result'}})+'\\n')
      return workerFileDriftBinding
    })
    const workerFileDriftIdentity={ownerId:workerFileDriftOwner.ownerId,sessionId:workerFileDriftSession,workspaceId:'w',queryId:'worker-file-drift-query'}
    assert.ok((await workerFileDriftOwner.request({...workerFileDriftIdentity,operation:'context',artifactId:workerFileDriftBinding.artifactId,leafId:workerFileDriftIds[1],branchEntryIds:workerFileDriftIds})).context)
    const workerFileDriftBefore=goal.getGoalCheckpoint(workerFileDriftContract.id,1)
    mutateOnSecondResolve=true
    await assert.rejects(()=>workerFileDriftOwner.request({...workerFileDriftIdentity,operation:'evidence_read',mode:'keyword',query:'FILE_DRIFT_SENTINEL',offset:0,limit:1,branchEntryIds:workerFileDriftIds,leafId:workerFileDriftIds[1]}),/source changed immediately after worker scan/)
    assert.equal(goal.getGoalCheckpoint(workerFileDriftContract.id,1).sequence,workerFileDriftBefore.sequence,'worker完成后文件变更不得迟到提交')
    await assert.rejects(()=>workerFileDriftOwner.request({...workerFileDriftIdentity,operation:'evidence_read',mode:'keyword',query:'FILE_DRIFT_SENTINEL',offset:1,limit:1,branchEntryIds:workerFileDriftIds,leafId:workerFileDriftIds[1]}),/snapshot unavailable/,'source fingerprint失败不得刷新分页快照')
    const makeConcurrentOwner=(name)=>{
      const directory=join(process.env.HOME,'worker-owner-'+name);mkdirSync(directory,{recursive:true})
      const ids=['worker-'+name+'-0','worker-'+name+'-1']
      const artifact=join(directory,'session.jsonl')
      writeFileSync(artifact,ids.map((id,index)=>JSON.stringify({id,parentId:index?ids[index-1]:null,type:'message',message:{role:'user',content:name+' '+id}})).join('\\n')+'\\n')
      const sessionId='worker-owner-'+name
      const contract=goal.createGoalContract({sessionId,workspaceId:'w',expectedRevision:0,originalText:'worker owner isolation '+name,scope:[],nonGoals:[],hardConstraints:['不得串owner状态'],acceptance:['水位独立'],userMessageRef:'worker-owner-user-'+name})
      const binding={sessionId,workspaceId:'w',artifactId:'sdk-'+name,artifactIdentity:'identity-'+name,path:realpathSync(artifact),sessionsDirectory:realpathSync(directory)}
      const capability=goal.createGoalMemoryCapability(sessionId,'w',async()=>binding)
      return {sessionId,contract,binding,ids,capability,identity:{ownerId:capability.ownerId,sessionId,workspaceId:'w',queryId:'query-'+name}}
    }
    const concurrentOwnerA=makeConcurrentOwner('a');const concurrentOwnerB=makeConcurrentOwner('b')
    const [concurrentResultA,concurrentResultB]=await Promise.all([concurrentOwnerA.capability.request({...concurrentOwnerA.identity,operation:'turn_end',artifactId:concurrentOwnerA.binding.artifactId,leafId:concurrentOwnerA.ids[1],entryIds:[concurrentOwnerA.ids[1]],branchEntryIds:concurrentOwnerA.ids}),concurrentOwnerB.capability.request({...concurrentOwnerB.identity,operation:'turn_end',artifactId:concurrentOwnerB.binding.artifactId,leafId:concurrentOwnerB.ids[1],entryIds:[concurrentOwnerB.ids[1]],branchEntryIds:concurrentOwnerB.ids})])
    assert.equal(concurrentResultA.checkpoint.counts.entryWatermark,2)
    assert.equal(concurrentResultB.checkpoint.counts.entryWatermark,2)
    assert.deepEqual(Object.keys(goal.getGoalCheckpoint(concurrentOwnerA.contract.id,1).entryHashes),concurrentOwnerA.ids)
    assert.deepEqual(Object.keys(goal.getGoalCheckpoint(concurrentOwnerB.contract.id,1).entryHashes),concurrentOwnerB.ids)
    const sameOwnerConcurrent=makeConcurrentOwner('same')
    const sameOwnerRequests=await Promise.allSettled([0,1].map(()=>sameOwnerConcurrent.capability.request({...sameOwnerConcurrent.identity,operation:'turn_end',artifactId:sameOwnerConcurrent.binding.artifactId,leafId:sameOwnerConcurrent.ids[1],entryIds:[sameOwnerConcurrent.ids[1]],branchEntryIds:sameOwnerConcurrent.ids})))
    assert.equal(sameOwnerRequests.filter((item)=>item.status==='fulfilled').length,1)
    assert.equal(sameOwnerRequests.filter((item)=>item.status==='rejected').length,1)
    assert.equal(goal.getGoalCheckpoint(sameOwnerConcurrent.contract.id,1).sequence,1,'同owner并发只允许一个基于旧sequence的worker结果提交')
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
    const createEvidenceLoopFixture=(name)=>{
      const sessionId='evidence-pages-'+name;const workspaceId='w';const artifactId='evidence-sdk-'+name
      const directory=join(process.env.HOME,'evidence-pages-'+name);mkdirSync(directory,{recursive:true})
      const artifactPath=join(directory,'session.jsonl');const needle='EVIDENCE_PAGE_NEEDLE'
      const rows=[
        {type:'session',version:3,id:artifactId,timestamp:new Date().toISOString(),cwd:directory},
        {type:'message',id:'evidence-a',parentId:null,timestamp:new Date().toISOString(),message:{role:'user',content:[{type:'text',text:needle}]}},
        {type:'message',id:'evidence-b',parentId:'evidence-a',timestamp:new Date().toISOString(),message:{role:'user',content:[{type:'text',text:needle}]}}
      ]
      const writeRows=()=>writeFileSync(artifactPath,rows.map((row)=>JSON.stringify(row)).join('\\n')+'\\n')
      writeRows()
      const binding={sessionId,workspaceId,artifactId,artifactIdentity:'identity-'+name,path:realpathSync(artifactPath),sessionsDirectory:realpathSync(directory)}
      const contract=goal.createGoalContract({sessionId,workspaceId,expectedRevision:0,originalText:'Evidence pagination must stay on the captured hit set.',scope:[],nonGoals:[],hardConstraints:[],acceptance:[],userMessageRef:'evidence-pages-'+name})
      const owner=goal.createGoalMemoryCapability(sessionId,workspaceId,async()=>binding)
      const identity={ownerId:owner.ownerId,sessionId,workspaceId,queryId:'evidence-pages-query-'+name}
      let branchEntryIds=['evidence-a','evidence-b'];let leafId='evidence-b';let receiptNo=0
      const tools=goal.buildGoalMemoryTools({defineTool:(definition)=>definition},owner,sessionId,identity.queryId,{getLeafId:()=>leafId,getBranch:()=>branchEntryIds.map((id)=>({id}))},(payload)=>{const serialized=serializePiToolResultPayload(payload);return {content:[{type:'text',text:serialized.text}],details:serialized.details}})
      const read=tools.find((tool)=>tool.name==='GoalEvidenceRead')
      const turnEnd=async(entryIds)=>owner.request({...identity,operation:'turn_end',artifactId,leafId,entryIds,branchEntryIds})
      const addToolReceipt=async(result)=>{
        const id='evidence-receipt-'+receiptNo++
        rows.push({type:'message',id,parentId:leafId,timestamp:new Date().toISOString(),message:{role:'toolResult',toolCallId:'evidence-call-'+receiptNo,toolName:'GoalEvidenceRead',content:result.content,details:result.details,isError:false}})
        writeRows();branchEntryIds=[...branchEntryIds,id];leafId=id
        await turnEnd([id])
      }
      return {sessionId,workspaceId,artifactId,artifactPath,rows,needle,contract,owner,identity,read,turnEnd,addToolReceipt,getBranch:()=>branchEntryIds,setBranch:(ids,leaf)=>{branchEntryIds=ids;leafId=leaf},writeRows}
    }
    const evidenceLoop=createEvidenceLoopFixture('self-reference')
    await evidenceLoop.turnEnd(['evidence-b'])
    const evidenceFound=[];let evidenceOffset=0;let evidencePages=0;let evidenceDone=false
    while(evidencePages<5){
      const pageResult=await evidenceLoop.read.execute('evidence-call-'+evidencePages,{mode:'keyword',query:evidenceLoop.needle,offset:evidenceOffset,limit:1},new AbortController().signal)
      const evidence=pageResult.details.evidence
      assert.equal('snapshotEntries' in evidence,false,'main-only match snapshot不得暴露给模型')
      assert.equal('entryHashes' in evidence,false,'source hash map不得暴露给模型')
      assert.equal(evidence.status,'ok')
      evidenceFound.push(...evidence.lines.map((line)=>JSON.parse(line).id))
      evidencePages+=1
      await evidenceLoop.addToolReceipt(pageResult)
      if(evidence.nextOffset===undefined){evidenceDone=true;break}
      evidenceOffset=evidence.nextOffset
    }
    assert.equal(evidenceDone,true,'真实toolResult/turn_end之后原始两条命中分页必须结束')
    assert.equal(evidencePages,2)
    assert.deepEqual(evidenceFound,['evidence-a','evidence-b'],'当前GoalEvidenceRead receipt不递归进入当前检索快照')

    const selectorFixture=createEvidenceLoopFixture('selector-change')
    await selectorFixture.turnEnd(['evidence-b'])
    assert.equal((await selectorFixture.read.execute('selector-root-a',{mode:'keyword',query:selectorFixture.needle,offset:0,limit:1})).details.evidence.nextOffset,1)
    assert.equal((await selectorFixture.read.execute('selector-root-b',{mode:'keyword',query:'PAGE_NEEDLE',offset:0,limit:1})).details.evidence.nextOffset,1,'新的root/selector建立新快照')
    await assert.rejects(()=>selectorFixture.read.execute('selector-old-cursor',{mode:'keyword',query:selectorFixture.needle,offset:1,limit:1}),/selector changed/)
    await assert.rejects(()=>selectorFixture.read.execute('selector-cleared-cursor',{mode:'keyword',query:'PAGE_NEEDLE',offset:1,limit:1}),/snapshot unavailable/)

    const tamperFixture=createEvidenceLoopFixture('tampered-source')
    await tamperFixture.turnEnd(['evidence-b'])
    const tamperFirst=await tamperFixture.read.execute('tamper-page-0',{mode:'keyword',query:tamperFixture.needle,offset:0,limit:1})
    assert.equal(tamperFirst.details.evidence.nextOffset,1)
    await tamperFixture.addToolReceipt(tamperFirst)
    tamperFixture.rows[1].message.content[0].text='EVIDENCE_PAGE_TAMPER'
    tamperFixture.writeRows()
    const tamperedPage=await tamperFixture.read.execute('tamper-page-1',{mode:'keyword',query:tamperFixture.needle,offset:1,limit:1})
    assert.equal(tamperedPage.details.evidence.status,'changed','snapshot分页必须重新验证原始source hash')

    const rewindFixture=createEvidenceLoopFixture('rewound-source')
    await rewindFixture.turnEnd(['evidence-b'])
    assert.equal((await rewindFixture.read.execute('rewind-page-0',{mode:'keyword',query:rewindFixture.needle,offset:0,limit:1})).details.evidence.nextOffset,1)
    rewindFixture.setBranch(['evidence-a'],'evidence-a')
    await assert.rejects(()=>rewindFixture.read.execute('rewind-page-1',{mode:'keyword',query:rewindFixture.needle,offset:1,limit:1}),/branch rewind/)

    const revisionEvidence=createEvidenceLoopFixture('revision-invalidates')
    await revisionEvidence.turnEnd(['evidence-b'])
    assert.equal((await revisionEvidence.read.execute('revision-page-0',{mode:'keyword',query:revisionEvidence.needle,offset:0,limit:1})).details.evidence.nextOffset,1)
    goal.createGoalContract({sessionId:revisionEvidence.sessionId,workspaceId:revisionEvidence.workspaceId,expectedRevision:1,originalText:'new revision invalidates old evidence cursors',scope:[],nonGoals:[],hardConstraints:[],acceptance:[],userMessageRef:'evidence-revision-2'})
    await assert.rejects(()=>revisionEvidence.read.execute('revision-page-1',{mode:'keyword',query:revisionEvidence.needle,offset:1,limit:1}),/snapshot unavailable/)

    const disabledEvidence=createEvidenceLoopFixture('feature-off-invalidates')
    await disabledEvidence.turnEnd(['evidence-b'])
    assert.equal((await disabledEvidence.read.execute('disabled-page-0',{mode:'keyword',query:disabledEvidence.needle,offset:0,limit:1})).details.evidence.nextOffset,1)
    process.env.PROMA_PERSONAL_GOAL_MEMORY='0'
    await assert.rejects(()=>disabledEvidence.read.execute('disabled-page-1',{mode:'keyword',query:disabledEvidence.needle,offset:1,limit:1}),/当前已关闭/)
    process.env.PROMA_PERSONAL_GOAL_MEMORY='1'
    await assert.rejects(()=>disabledEvidence.read.execute('disabled-page-1-after-enable',{mode:'keyword',query:disabledEvidence.needle,offset:1,limit:1}),/snapshot unavailable/)

    const revokedEvidence=createEvidenceLoopFixture('owner-revoke-invalidates')
    await revokedEvidence.turnEnd(['evidence-b'])
    assert.equal((await revokedEvidence.read.execute('revoke-page-0',{mode:'keyword',query:revokedEvidence.needle,offset:0,limit:1})).details.evidence.nextOffset,1)
    revokedEvidence.owner.revoke()
    await assert.rejects(()=>revokedEvidence.read.execute('revoke-page-1',{mode:'keyword',query:revokedEvidence.needle,offset:1,limit:1}),/query.*失效/)

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
    assert.deepEqual(getGoalArtifactWorkerDiagnostics(),{created:true,activeWorkers:0,queuedJobs:0},'真实历史扫描使用过的worker在所有请求settle后必须关闭')
    schemaCheckDb.close();db.close()
  `
  writeFileSync(sourcePath, source)
  try {
    const workerBuild = await esbuildBuild({ entryPoints: [join(import.meta.dir, 'personal-goal-artifact-worker.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(home, 'personal-goal-artifact-worker.cjs'), logLevel: 'silent' })
    expect(workerBuild.errors.map((error) => error.text).join('\n')).toBe('')
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
}, 30_000) // 子进程 Electron 验证单独运行约 4.6 s，默认 5 s 超时在打包时的全量测试负载下会误报

test('Goal sidecar resolves shared packaged/dev config roots and stays filesystem-lazy when disabled', async () => {
  const suiteHome=mkdtempSync(join(tmpdir(),'proma-goal-config-suite-'))
  const sourcePath=join(suiteHome,'verify-goal-config.ts')
  const outputPath=join(suiteHome,'verify-goal-config.mjs')
  const preloadPath=join(suiteHome,'mock-electron.cjs')
  const scenarios = [
    { name:'unpackaged-default', packaged:false, expectedName:'.proma-dev' },
    { name:'unpackaged-valid-override', packaged:false, dataDirName:'.proma-dev-goal-fixture', expectedName:'.proma-dev-goal-fixture' },
    { name:'unpackaged-invalid-override', packaged:false, dataDirName:'../.proma', expectedName:'.proma-dev' },
    { name:'packaged-ignores-dev-override', packaged:true, dataDirName:'.proma-dev-goal-fixture', expectedName:'.proma' },
    { name:'explicit-test-root', packaged:true, override:true, expectedName:null },
  ]
  const probeSource = `
    import assert from 'node:assert/strict'
    import { existsSync } from 'node:fs'
    import { join } from 'node:path'
    import * as goal from ${JSON.stringify(modulePath)}
    const scenario=JSON.parse(process.env.GOAL_CONFIG_SCENARIO)
    const home=process.env.HOME
    process.env.PROMA_PERSONAL_GOAL_MEMORY='0'
    assert.equal(goal.getGoalContract('disabled'),null)
    assert.throws(()=>goal.createGoalContract({sessionId:'disabled',workspaceId:'w',expectedRevision:0,originalText:'disabled',scope:[],nonGoals:[],hardConstraints:[],acceptance:[],userMessageRef:'disabled'}),/已关闭/)
    assert.equal(existsSync(join(home,'.proma')),false,'flag=0不得创建正式配置根')
    assert.equal(existsSync(join(home,'.proma-dev')),false,'flag=0不得创建默认开发配置根')
    process.env.PROMA_PERSONAL_GOAL_MEMORY='1'
    const contract=goal.createGoalContract({sessionId:'path-'+scenario.name,workspaceId:'w',expectedRevision:0,originalText:'temporary path fixture',scope:[],nonGoals:[],hardConstraints:[],acceptance:[],userMessageRef:'path-fixture'})
    assert.ok(contract.id)
    const databasePath=join(scenario.override?join(home,'goal-test-override'):join(home,scenario.expectedName),'goal-memory','goals.sqlite')
    assert.equal(existsSync(databasePath),true,'sidecar must follow the configured root')
    for(const name of ['.proma','.proma-dev','.proma-dev-goal-fixture']){
      if(!scenario.override&&name===scenario.expectedName)continue
      assert.equal(existsSync(join(home,name)),false,'unexpected root created: '+name)
    }
  `
  const preloadSource=`
    const Module=require('node:module')
    const originalLoad=Module._load
    Module._load=function(request,parent,isMain){
      if(request==='electron'||/(?:^|[/\\\\])electron(?:[/\\\\]index\\.js)?$/.test(String(request)))return {app:{isPackaged:process.env.PROMA_TEST_ELECTRON_PACKAGED==='1'}}
      return originalLoad.call(this,request,parent,isMain)
    }
  `
  try {
    writeFileSync(sourcePath,probeSource)
    writeFileSync(preloadPath,preloadSource)
    const build=await Bun.build({entrypoints:[sourcePath],target:'node',format:'esm',external:['node:sqlite','electron']})
    expect(build.success,build.logs.map((log)=>log.message).join('\\n')).toBe(true)
    const compiled=build.outputs[0]
    if(!compiled)throw new Error('未生成配置路径验证脚本')
    await Bun.write(outputPath,compiled)
    for(const scenario of scenarios){
      const home=mkdtempSync(join(tmpdir(),'proma-goal-config-'+scenario.name+'-'))
      const env:NodeJS.ProcessEnv={...process.env,HOME:home,PROMA_PERSONAL_GOAL_MEMORY:'0',PROMA_TEST_ELECTRON_PACKAGED:scenario.packaged?'1':'0',GOAL_CONFIG_SCENARIO:JSON.stringify(scenario)}
      delete env.PROMA_DEV
      delete env.PROMA_DEV_DATA_DIR_NAME
      delete env.PROMA_PERSONAL_GOAL_DATA_DIR
      if(scenario.dataDirName!==undefined)env.PROMA_DEV_DATA_DIR_NAME=scenario.dataDirName
      if(scenario.override)env.PROMA_PERSONAL_GOAL_DATA_DIR=join(home,'goal-test-override')
      try {
        const result=spawnSync('node',['--require',preloadPath,outputPath],{cwd:repoRoot,env,encoding:'utf8',timeout:15_000,maxBuffer:2*1024*1024})
        expect(result.status,`${scenario.name}: ${result.stdout}\\n${result.stderr}`).toBe(0)
      } finally {rmSync(home,{recursive:true,force:true})}
    }
  } finally {rmSync(suiteHome,{recursive:true,force:true})}
},30_000)
