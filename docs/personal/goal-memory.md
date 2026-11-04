# Goal Memory（M0）功能 SSOT 草稿

状态（2026-11-04）：**独立计划验收需要返工。对903fb8eb，B/C/D通过；A未满足“不在主线程扫描大历史”，当前解析/hash仍在主线程。E指出审查结论未同步，本次已补记，但整体不得标为已验收。Codex额外复审3无需要报告的缺陷；871测试及完整矩阵通过不替代计划符合性。功能默认关闭、未合入/安装，后续线程隔离或条款调整及新增复审须用户确认。**

## 范围与启用

Goal Memory 将本会话用户明确提交的目标作为版本化恢复合同，并在后续请求中附带一份有界恢复包。它不自动安排任务、不自动续跑、不创建子任务，也不授权任何外部操作。`claimed_done` 是待核验报告，不等于已完成。

默认关闭。只有 `PROMA_PERSONAL_GOAL_MEMORY=1` 时宿主命令、Goal 数据库与恢复包才启用；关闭时不创建/读取 sidecar，也不改变普通请求上下文。关闭不会删除已保存数据。功能当前没有界面开关；环境变量用于阶段性验证。

## 用户命令

- `/goal set <JSON合同>`：保存一个新合同 revision，保留用户原文及当前用户消息引用。
- `/goal revise <JSON合同>`：追加新 revision；上一 revision 不覆盖。
- `/goal status`：显示当前 revision、hash 与 checkpoint 状态。
- `/goal restore`：只返回当前恢复包，不发起模型请求或继续执行。
- `/goal off`：解除本会话当前合同绑定，数据库中的历史合同与 checkpoint 保留。

命令由主进程编排器解析。`set`/`revise` 的 JSON schema 要求 `expectedRevision`（非负整数）、`originalText`（字符串）、`scope`、`nonGoals`、`hardConstraints`、`acceptance`（均为字符串数组，可为空）；未知字段拒绝而非忽略。`expectedRevision` 必须等于已存最新版本，CAS 在 SQLite `BEGIN IMMEDIATE` 事务内完成。命令来源 gate 拒绝 automation、delegation、带 `automationContext` 的运行及已知子任务自动唤醒通知；保留手动用户和人类 web-remote `external` 入口，不把所有 `external` 一概拒绝。模型没有创建或修订合同的工具。Goal 相关 workspace 统一先取持久会话 metadata 的 `workspaceId`；仅缺失时才回退请求 workspace，最终使用 `default`，不能由后续请求改写会话归属。功能启用时，活跃轮次中的 `queueMessage` 在 adapter 注入、enrichment 与 JSONL 持久化前拒绝所有 `/goal` 管理命令（含未知子命令），提示等待当前轮结束或停止后再发；普通queued文本不受影响，功能关闭时保留既有路径。合同字段另含用户消息引用与 hash。`/goal restore` 会把 `userMessageRef` 标为历史来源，说明 checkpoint 只是历史快照、本命令未核验当前artifact/branch，待下次query验证，并明确不构成本轮新授权。

## 存储与一致性

使用独立 SQLite sidecar，schemaVersion=1、DELETE journal、`synchronous=FULL`。合同记录以 `(goal_id, revision)` 追加保存，当前会话只维护指向当前 revision 的索引。Checkpoint 的宿主观察使用单调递增 `sequence` 做严格 CAS；模型报告使用独立 `modelSequence` CAS，因此合法 `turn_end` observation 不会使报告必然冲突，而同一旧 model token 的并发/迟到报告会被拒绝。模型工具必须提交读取时的 `goalId`、合同 `revision` 与 `expectedModelSequence`，不会先读最新checkpoint再把旧报告重基线到新合同。报告在事务中保留最新 host `observed`/artifact hash，不可写host-only事实。旧合同revision写入拒绝。模型状态最多`claimed_done`，没有`verified/completed`。历史schemaVersion=1 checkpoint 缺少 `modelSequence` 时按初值0读取；存在但无效的值会 fail closed。

默认路径通过共享`config-paths.getConfigDir()`解析后使用`goal-memory/goals.sqlite`：打包版固定`.proma`，未打包版默认为`.proma-dev`，并复用`PROMA_DEV_DATA_DIR_NAME`的统一开发目录名校验；测试可用`PROMA_PERSONAL_GOAL_DATA_DIR`显式覆盖到临时目录。Goal模块导入时不解析/创建配置根，只有flag=1且打开数据库时才调用配置路径解析；flag=0不触碰正式/开发配置根。

## 恢复包与原文证据

每次provider请求的 transformContext 从主进程 capability 重载一份恢复包；恢复包正文的默认 UTF-8 字节预算为12,000，外层task-data标记另有固定长度。用户原文、合同 hash、scope、non-goals、硬约束、验收字段为必需内容。创建/修订合同会额外验证必需字段与固定短省略标记可同时放入预算；必需字段超限或未给省略标记预留空间时拒绝创建，永不截断/摘要合同。后续可选进度超预算时整体省略，使用固定说明`[可选checkpoint进度已省略；请用 GoalCheckpointRead 分页读取。]`；不因合法的进度字段增长而令新合同事后不可用。对已存旧合同不改schema、不自动迁移/改写；已按旧校验接受的边界合同通过更短标记继续可读（如11,650 ASCII原文复现），若导入/异常历史数据连必需字段与固定标记都放不下，则仍fail closed并要求显式修订，不截断字段。恢复包明确把模型报告标为未验证，并将其作为任务数据而非系统指令。

Pi `turn_end` hook只提交SDK提供的持久`messageEntryId/toolResultEntryIds`、当前branch entry IDs和leaf；主进程从当前会话metadata解析Pi artifact路径，校验session/workspace/sdkSessionId、规范session目录、symlink及文件身份，并扫描有界JSONL artifact验证branch的ID/parent链与已有hash。超大leaf可走hash-only水位校验，不读取/返回正文；正文读取仍受单行上限约束并明确返回too-large，绝不截断。新合同在首次有持久历史的context/evidence读取前，绑定当前已验证artifact与branch的持久前缀；尚无持久entry时不伪称已建立水位。后续context、compact ack、turn_end/evidence read验证旧entry hashes，防止替换、迁移、rewind或篡改后重新baseline。`GoalEvidenceRead`只接受当前SessionManager branch，支持entry ID、toolCall ID和字面关键词定位，可分页读取完整entry。`offset=0`建立单次有界main-only快照，固定当时的branch ID、source hash与命中集合；后续`nextOffset`页沿用命中集合，不会把当前工具产生的新receipt纳入原查询。每页仍重新解析当前artifact，验证session/workspace/artifact identity、当前branch ancestry、已有hash及合同revision；新root或mode/query selector变化、source变化、branch rewind、合同revision变化、功能关闭或query revoke会清空/失效旧快照。新`offset=0`会对当前branch重新搜索。快照JSON不超过16 MiB，不通过utility/工具结果暴露。扫描上限128 MiB、最多50,000 entries（只在内存保留ID、parent、toolCall定位元数据，不建立无界文本索引）、单行256 KiB、输出页512 KiB/最多20条；关键词遍历完整对象值与数组，在16层/10,000节点预算内字面匹配，预算耗尽明确返回不完整/too-large，不误报not-found。超大媒体行只解析有界ID/parent前缀并完整流式hash。越限、文件变化、错误branch/session均返回明确too-large/changed/invalid/not-found，不会静默声称没有证据。旧branch不继承；不支持跨session读取。

## 压缩行为与未实现项

Pi `session_before_compact`扩展覆盖`manual`、`threshold`、`overflow`三类原因，通过main-owned capability等待SQLite `compaction_acks`，并要求回复严格为`acknowledged===true`。主进程capability首次请求绑定到单一`queryId`，并在run结束/失败/取消时撤销；跨query、关闭后及await期间已撤销的迟到写入拒绝。compact ack的utility/hook等待为5秒；有界全artifact的context/evidence/turn_end capability utility等待放宽到60秒，取消仍受query signal和上限约束。hook拒绝、false ack、超时或事件取消时abort本次capability请求、明确cancel并设置当前Pi run fail latch：transform阻挡后续provider请求、`tool_call`返回block，query队列报告错误。SQLite使用main线程同步小事务，JS event loop同步段不可由Promise.race/deadline抢占；取消可阻止utility继续等待及迟到回执后的继续运行，但不能中止已开始的同步事务。定向故障注入测试覆盖三种reason与失败路径；另有开发实例真实utility与模型验证，摘要生成usage未由接口报告。

每次provider transform向主进程capability请求恢复包，以隐藏Symbol标识单份provider-only user task-data message，不写回持久Pi transcript；用户真实正文即使以相似marker开头也不会被过滤；保留previous transform、项目指令与image budget链。注入兼容合法压缩切分上下文：若`buildSessionContext`没有原始user（例如只有`compactionSummary`、assistant与toolResult），则放在最后system/summary之后；system-only时放在system后，空上下文时放在起始处。正常存在原始user时仍按原位置规则注入。安装版Pi SDK的`buildSessionContext`→`convertToLlm`回归直接验证cut-turn路径与单份完整包；独立边界单元测试覆盖system-only与empty上下文。utility只传owner descriptor与有界DTO，完整checkpoint watermark/hash索引仅留在host，SQLite只在主进程capability handler访问。`GoalCheckpointRead`逐项分页；较长单值以显式`partIndex/partCount`分页。每个query的main capability closure最多持有一份序列化体积不超过16 MiB的progress-only分页快照，不含entryWatermark/entryHashes。无cursor的root Read与成功Report捕获/刷新快照；cursor页只读该快照，不随Pi `turn_end`、context或compact刷新而改变，即使每个tool round的host sequence和水位持续推进，已发出的cursor仍可完整读完该快照。再次无cursor读取会开启当前进度的新快照；成功Report刷新到报告后的快照。合同revision变化、Goal Memory关闭或query revoke会清空快照并使旧cursor失效。Read/Report仍维持host sequence与modelSequence各自CAS，不跳过turn_end。checkpoint DTO 8 KiB上限，含重复Pi `content/details`的Read/Report/turn_end模型结果限制32 KiB。证据原文页有独立512 KiB上限，不套用checkpoint DTO预算。turn_end对整个当前branch持久化hash watermark；模型报告CAS使用独立modelSequence，避免host observation造成必然冲突，同时拒绝重复/迟到报告。每次provider context和compact ack均携带SessionManager当前artifact/leaf/branch；主进程检查artifact identity/workspace和checkpoint leaf是当前branch祖先，并对所有旧entry hashes逐个校验。普通追加允许；旧entry变化、artifact替换、workspace迁移或rewind在provider调用/压缩ack前fail closed，且新turn不得覆盖旧hash形成rebaseline。

## 验证记录与局限（截至 2026-11-04）

以下原始M0全仓/构建/真实模型记录均来自本轮 Codex round 1 与父复现修复之前，保留为历史证据，不代表修复后代码已重跑这些验证。修复后状态单独列在后文。

- 父会话独立验证：30个不同案例×10次sidecar恢复装载；这只验证确定性持久化/装载，不是300次真实模型压缩。另有15项evidence capability、21项hook边界及4类核心不变量变异检查通过。
- 全仓870 pass / 0 fail，typecheck与personal script tests通过；main、runtime、preload、renderer、web-preload构建通过。
- 开发实例中完成3次真实manual摘要（耗时34,062 / 43,883 / 51,535 ms；另1次noop不计）。三次模型均回读原始旧entry `66e97bf6`，逐字保留5条约束及待用户问题；父核对合同、branch、entry完整hash及3个durable ack均先于摘要落盘。上下文估算压缩前70,945 / 77,736 / 77,446 tokens，压缩后37,990 / 38,002 / 38,140 tokens。验证为合成会话中的3轮观察，不证明模型永久遵循合同。
- 实际utility网络transport观察到2次provider请求各注入单份12,000-byte预算内Goal包，必需字段完整、原用户marker保留；revision 2返回checkpoint sequence 0、observed/modelReported为空，未继承旧状态。环境开关关闭与`/goal off`后的普通请求未带Goal包/工具，数据库字节不变且历史保留；宿主命令不调用provider或标题生成，stale expectedRevision拒绝、合法revision 1→2成功。
- 摘要接口未暴露生成摘要的usage；手动压缩结果usage显示的合成零值不能解释为摘要无token成本。同步SQLite提交不能被Promise deadline抢占。
- 修复前的Codex round 1 独立代码审查与父级复现发现了reader、DTO、source binding、查询身份、模型CAS与来源门禁等问题；前述原始结果不覆盖这些问题。
- 此前review修复后的定向验证：`bun test apps/electron/src/main/lib/personal-goal-memory.test.ts` 通过（1个Bun test通过；内部Electron临时HOME断言覆盖超大hash-only leaf、超限正文、最大50,000项水位、关键词嵌套/数组第4,001项、DTO分页与32 KiB结果上限、modelSequence/旧revision CAS、query撤销/迟到请求、首次历史证据绑定、来源门禁与restore来源提示等）。此前全仓 `bun run typecheck` 通过；不等于重跑全仓测试或构建。
- 本轮分页生命周期修复后再次运行同一定向测试通过（1个Bun test）。该回归通过 `buildGoalMemoryTools` 实际工具定义构造Read/Report循环；每页后向临时JSONL追加toolResult并调用真实main capability `turn_end`，断言host sequence每轮递增、Report cursor与root Read cursor均跨轮次完整重建Unicode/反斜杠长值；还覆盖旧modelSequence拒绝、新root刷新、revision变化、功能关闭与revoke时游标失效。`bun run typecheck` 与 `git diff --check` 本轮通过。以上不等于重跑全仓测试或构建。
- 2026-11-03本轮复审追加：EvidenceRead使用≤16 MiB的main-only固定命中快照，新增实际工具definition跨receipt/turn_end分页不递归扩张测试，并覆盖selector重置/失效、revision/off/revoke、源hash篡改与branch rewind；定向测试再次通过（1个Bun test）。活跃queue路径新增`queueMessage`函数体顺序probe与管理命令识别测试；workspace优先级通过宿主命令、query contract lookup与capability bootstrap的源码接线probe验证。该轮全仓`bun run typecheck`与`git diff --check`通过；未运行模型/开发实例。
- 前一修复快照（`f568c35c`）由父会话重新验证：旧6项缺陷、query身份、28页跨tool-round分页及首次扫描中途revoke无迟到写通过；30×10装载、15项evidence、21项hook及4类mutation全部重跑通过。全仓870 pass / 0 fail（2316 assertions），typecheck、personal scripts和五目标构建通过；源码hash在验证前后相同，版本与lock未改。
- 前一快照另获准完成一次短模型run（28,283 ms，不重复长压缩）：真实utility依次调用EvidenceRead、CheckpointRead和Report；4次provider请求均各带单份预算内恢复包，工具content/details结果为6,492 / 1,114 / 1,126 bytes。Report实际提交goalId/revision/expectedModelSequence，sidecar为waiting_user、保留待用户问题；父核对持久原文、全部hash及branch ancestry，不靠模型自述。宿主set耗时16 ms，无provider/utility或标题调用。原三轮真实压缩仍仅是修复前证据；最终版未重跑长压缩，不推断长期语义可靠性。
- 前次短回归结束已删当轮新会话、撤销新设备、清理新原文/sidecar并关闭测试空间与dev/8443，正式443保留。启动时既有逻辑又清理空草稿并生成disabled预设，停机后仅恢复原草稿、撤回本轮自动预设；20个原会话ID及4份无关配置hash恢复，备份保留。索引迁移/排序不声称字节相同。原始合成审计材料仅保留于私有工作台，不进Git。
- 上一轮三项P2修复快照（`1664e7f1`）：父独立复现从失败转通过，Evidence固定查询在两页后终止，实际orchestrator方法探针的活跃命令/metadata归属共10项通过；旧6项、query绑定、28页checkpoint、撤销无迟到写及30×10/15/21/4矩阵全部重跑通过。全仓870 pass / 0 fail、2316 assertions，typecheck、personal scripts和五目标构建通过；改动源码hash在测试与模型实验前后核对一致。
- 2026-11-04另获准的第二次真实短run为33,230 ms：同一utility依次执行EvidenceRead两页、CheckpointRead、Report，共5次provider请求，每次单份≤12,000-byte包且必需约束齐全；两页只包含检索开始时的user和assistant原文，没有递归加入新receipt，第二页无nextOffset。实际工具content/details为8,606 / 2,226 / 1,114 / 1,128 bytes。活跃期间经真实远程IPC发送管理命令被拒绝，未入Pi原文或provider；sidecar仍启用且仅waiting_user/modelSequence 1。请求workspace为过时值时，宿主set/status仍绑定持久metadata归属，耗时21/9 ms且无utility/provider/标题调用。父独立核对原文、hash、ancestry和模型CAS参数，不依赖模型自述。此真实模型run早于本轮最后三项P2修改，不能视作对本轮代码的验证。
- 第二次新会话通过应用删除，新增设备撤销、测试空间结束、own live artifact/sidecar及配对材料清理，dev/8443关闭而正式443保留。恢复20个原会话ID和4配置hash；草稿metadata与本次启动备份完全相同。原备份及本次恢复前的index/channel备份保留，不重建整个fixture。所有合成审计材料仅在私有工作台。
- 2026-11-04最后三项review P2修复：`injectGoalTaskData`支持无原始user的Pi cut-turn上下文；测试通过安装版Pi SDK `buildSessionContext`与`convertToLlm`实测compactionSummary/assistant/toolResult cut-turn与单份恢复包；独立边界单元测试覆盖system-only/empty上下文，另检查重复包、相似用户marker及previous-transform/图片处理顺序。sidecar改用统一`config-paths.getConfigDir()`，并以临时HOME、mock `app.isPackaged`覆盖未打包默认/合法开发目录名/非法名称/打包版/显式测试override；验证flag=0不创建正式或开发配置根。合同创建会预留固定短进度省略标记预算；新增父11,650 ASCII复现、最大合法进度与状态、ASCII/Unicode精确边界及CAS失败不改现有合同回归。最终`bun test apps/electron/src/main/lib/personal-goal-memory.test.ts`为2 pass；`bun run typecheck`所有包通过；`git diff --check`通过。未启动dev、未新增真实模型调用、未改schema/自动迁移/版本/lock/依赖，未commit。
- 最后三项修复后的父独立验证：同版SDK实际cut-turn context为compactionSummary/assistant/toolResult，转换后恰一份完整Goal包，空/system-only、重复注入、原始marker及图片对象保留；官方配置根的未打包默认/合法fixture名/非法名/打包态及flag0均通过（临时HOME、Electron API stub，不是完整GUI启动）。ASCII/Unicode各二分至接受边界，本文测试合同的必需原文11,676 bytes、包正文恰12,000 bytes，模型三组数组各100×5,000 bytes、nextAction 5,000 bytes，在active/waiting_user/blocked/paused/claimed_done五态均只省略可选进度，不阻断或截必需字段。旧6项、query、28页checkpoint、revoke无迟到写、Evidence两页与host10项全部重跑；30×10/15/21/4矩阵通过。全仓871 pass/0 fail、2322 assertions，typecheck、personal scripts、五目标构建与diff-check通过；源码hash前后相同。
- 额外Codex复审3已完成：CLI0.165.0、310秒，针对903fb8eb，未发现需要报告的缺陷；只读快照缺依赖，未重跑父完整矩阵。随后全新Astra只读验收（初次额度失败无结论，09:15重试）裁决需要返工：A的扫描CPU工作仍在Electron主线程，不满足批准计划第16行；B/C/D通过；E的审查结论缺记已由父补齐本节及相关文档。没有据此声称全部通过或擅自放宽条款。当前不新增实验、改代码或追加复审，等待用户选择线程隔离返工或明确调整条款。
- 未新增真实模型调用、未重做长压缩。真实自动threshold/overflow故障、图片附件provider共存及大历史UI负载仍未测；异步流式读取不等于worker隔离，也未证明实际UI卡顿。既有结果不构成合入/发布许可或长期语义遵循证明。

## 回滚

将 `PROMA_PERSONAL_GOAL_MEMORY` 取消或设为非 `1` 即关闭新功能路径。关闭不清除 sidecar 文件，不影响旧会话与旧格式；数据删除须另行审批。
