# Goal Memory（M0）功能 SSOT 草稿

状态：**实现仍在未合入分支；此前 review 修复与本轮分页生命周期修复已完成，定向生命周期测试、全仓 typecheck 与 diff-check 已通过；修复后真实模型压缩尚未重跑，Codex独立复审与最终计划验收待完成**。本文件只描述当前代码实际具备的能力，不代表 M1 Goal 控制器或可合入结论。

## 范围与启用

Goal Memory 将本会话用户明确提交的目标作为版本化恢复合同，并在后续请求中附带一份有界恢复包。它不自动安排任务、不自动续跑、不创建子任务，也不授权任何外部操作。`claimed_done` 是待核验报告，不等于已完成。

默认关闭。只有 `PROMA_PERSONAL_GOAL_MEMORY=1` 时宿主命令、Goal 数据库与恢复包才启用；关闭时不创建/读取 sidecar，也不改变普通请求上下文。关闭不会删除已保存数据。功能当前没有界面开关；环境变量用于阶段性验证。

## 用户命令

- `/goal set <JSON合同>`：保存一个新合同 revision，保留用户原文及当前用户消息引用。
- `/goal revise <JSON合同>`：追加新 revision；上一 revision 不覆盖。
- `/goal status`：显示当前 revision、hash 与 checkpoint 状态。
- `/goal restore`：只返回当前恢复包，不发起模型请求或继续执行。
- `/goal off`：解除本会话当前合同绑定，数据库中的历史合同与 checkpoint 保留。

命令由主进程编排器解析。`set`/`revise` 的 JSON schema 要求 `expectedRevision`（非负整数）、`originalText`（字符串）、`scope`、`nonGoals`、`hardConstraints`、`acceptance`（均为字符串数组，可为空）；未知字段拒绝而非忽略。`expectedRevision` 必须等于已存最新版本，CAS 在 SQLite `BEGIN IMMEDIATE` 事务内完成。命令来源 gate 拒绝 automation、delegation、带 `automationContext` 的运行及已知子任务自动唤醒通知；保留手动用户和人类 web-remote `external` 入口，不把所有 `external` 一概拒绝。模型没有创建或修订合同的工具。合同字段另含用户消息引用与 hash。`/goal restore` 会把 `userMessageRef` 标为历史来源，说明 checkpoint 只是历史快照、本命令未核验当前artifact/branch，待下次query验证，并明确不构成本轮新授权。

## 存储与一致性

使用独立 SQLite sidecar，schemaVersion=1、DELETE journal、`synchronous=FULL`。合同记录以 `(goal_id, revision)` 追加保存，当前会话只维护指向当前 revision 的索引。Checkpoint 的宿主观察使用单调递增 `sequence` 做严格 CAS；模型报告使用独立 `modelSequence` CAS，因此合法 `turn_end` observation 不会使报告必然冲突，而同一旧 model token 的并发/迟到报告会被拒绝。模型工具必须提交读取时的 `goalId`、合同 `revision` 与 `expectedModelSequence`，不会先读最新checkpoint再把旧报告重基线到新合同。报告在事务中保留最新 host `observed`/artifact hash，不可写host-only事实。旧合同revision写入拒绝。模型状态最多`claimed_done`，没有`verified/completed`。历史schemaVersion=1 checkpoint 缺少 `modelSequence` 时按初值0读取；存在但无效的值会 fail closed。

默认路径为当前用户数据根目录下 `goal-memory/goals.sqlite`；开发环境遵循 `PROMA_DEV_DATA_DIR_NAME`，测试可使用 `PROMA_PERSONAL_GOAL_DATA_DIR` 覆盖到临时目录。未开功能不初始化数据库。

## 恢复包与原文证据

每次provider请求的 transformContext 从主进程 capability 重载一份恢复包；默认 UTF-8 字节预算 12,000。用户原文、合同 hash、scope、non-goals、硬约束、验收字段为必需内容。必需部分超预算时抛出阻塞错误，不截断约束；可选进度字段在预算不足时省略，并指向有界分页的 `GoalCheckpointRead`。恢复包明确把模型报告标为未验证，并将其作为任务数据而非系统指令。

Pi `turn_end` hook只提交SDK提供的持久`messageEntryId/toolResultEntryIds`、当前branch entry IDs和leaf；主进程从当前会话metadata解析Pi artifact路径，校验session/workspace/sdkSessionId、规范session目录、symlink及文件身份，并扫描有界JSONL artifact验证branch的ID/parent链与已有hash。超大leaf可走hash-only水位校验，不读取/返回正文；正文读取仍受单行上限约束并明确返回too-large，绝不截断。新合同在首次有持久历史的context/evidence读取前，绑定当前已验证artifact与branch的持久前缀；尚无持久entry时不伪称已建立水位。后续context、compact ack、turn_end/evidence read验证旧entry hashes，防止替换、迁移、rewind或篡改后重新baseline。`GoalEvidenceRead`只接受当前SessionManager branch，支持entry ID、toolCall ID和字面关键词定位，可分页读取完整entry。扫描上限128 MiB、最多50,000 entries（只在内存保留ID、parent、toolCall定位元数据，不建立无界文本索引）、单行256 KiB、输出页512 KiB/最多20条；关键词遍历完整对象值与数组，在16层/10,000节点预算内字面匹配，预算耗尽明确返回不完整/too-large，不误报not-found。超大媒体行只解析有界ID/parent前缀并完整流式hash。越限、文件变化、错误branch/session均返回明确too-large/changed/invalid/not-found，不会静默声称没有证据。旧branch不继承；不支持跨session读取。

## 压缩行为与未实现项

Pi `session_before_compact`扩展覆盖`manual`、`threshold`、`overflow`三类原因，通过main-owned capability等待SQLite `compaction_acks`，并要求回复严格为`acknowledged===true`。主进程capability首次请求绑定到单一`queryId`，并在run结束/失败/取消时撤销；跨query、关闭后及await期间已撤销的迟到写入拒绝。compact ack的utility/hook等待为5秒；有界全artifact的context/evidence/turn_end capability utility等待放宽到60秒，取消仍受query signal和上限约束。hook拒绝、false ack、超时或事件取消时abort本次capability请求、明确cancel并设置当前Pi run fail latch：transform阻挡后续provider请求、`tool_call`返回block，query队列报告错误。SQLite使用main线程同步小事务，JS event loop同步段不可由Promise.race/deadline抢占；取消可阻止utility继续等待及迟到回执后的继续运行，但不能中止已开始的同步事务。定向故障注入测试覆盖三种reason与失败路径；另有开发实例真实utility与模型验证，摘要生成usage未由接口报告。

每次provider transform向主进程capability请求恢复包，以隐藏Symbol标识单份provider-only user task-data message，不写回持久Pi transcript；用户真实正文即使以相似marker开头也不会被过滤；保留previous transform、项目指令与image budget链。utility只传owner descriptor与有界DTO，完整checkpoint watermark/hash索引仅留在host，SQLite只在主进程capability handler访问。`GoalCheckpointRead`逐项分页；较长单值以显式`partIndex/partCount`分页。每个query的main capability closure最多持有一份序列化体积不超过16 MiB的progress-only分页快照，不含entryWatermark/entryHashes。无cursor的root Read与成功Report捕获/刷新快照；cursor页只读该快照，不随Pi `turn_end`、context或compact刷新而改变，即使每个tool round的host sequence和水位持续推进，已发出的cursor仍可完整读完该快照。再次无cursor读取会开启当前进度的新快照；成功Report刷新到报告后的快照。合同revision变化、Goal Memory关闭或query revoke会清空快照并使旧cursor失效。Read/Report仍维持host sequence与modelSequence各自CAS，不跳过turn_end。checkpoint DTO 8 KiB上限，含重复Pi `content/details`的Read/Report/turn_end模型结果限制32 KiB。证据原文页有独立512 KiB上限，不套用checkpoint DTO预算。turn_end对整个当前branch持久化hash watermark；模型报告CAS使用独立modelSequence，避免host observation造成必然冲突，同时拒绝重复/迟到报告。每次provider context和compact ack均携带SessionManager当前artifact/leaf/branch；主进程检查artifact identity/workspace和checkpoint leaf是当前branch祖先，并对所有旧entry hashes逐个校验。普通追加允许；旧entry变化、artifact替换、workspace迁移或rewind在provider调用/压缩ack前fail closed，且新turn不得覆盖旧hash形成rebaseline。

## 验证记录与局限（截至 2026-11-03）

以下原始M0全仓/构建/真实模型记录均来自本轮 Codex round 1 与父复现修复之前，保留为历史证据，不代表修复后代码已重跑这些验证。修复后状态单独列在后文。

- 父会话独立验证：30个不同案例×10次sidecar恢复装载；这只验证确定性持久化/装载，不是300次真实模型压缩。另有15项evidence capability、21项hook边界及4类核心不变量变异检查通过。
- 全仓870 pass / 0 fail，typecheck与personal script tests通过；main、runtime、preload、renderer、web-preload构建通过。
- 开发实例中完成3次真实manual摘要（耗时34,062 / 43,883 / 51,535 ms；另1次noop不计）。三次模型均回读原始旧entry `66e97bf6`，逐字保留5条约束及待用户问题；父核对合同、branch、entry完整hash及3个durable ack均先于摘要落盘。上下文估算压缩前70,945 / 77,736 / 77,446 tokens，压缩后37,990 / 38,002 / 38,140 tokens。验证为合成会话中的3轮观察，不证明模型永久遵循合同。
- 实际utility网络transport观察到2次provider请求各注入单份12,000-byte预算内Goal包，必需字段完整、原用户marker保留；revision 2返回checkpoint sequence 0、observed/modelReported为空，未继承旧状态。环境开关关闭与`/goal off`后的普通请求未带Goal包/工具，数据库字节不变且历史保留；宿主命令不调用provider或标题生成，stale expectedRevision拒绝、合法revision 1→2成功。
- 摘要接口未暴露生成摘要的usage；手动压缩结果usage显示的合成零值不能解释为摘要无token成本。同步SQLite提交不能被Promise deadline抢占。
- 修复前的Codex round 1 独立代码审查与父级复现发现了reader、DTO、source binding、查询身份、模型CAS与来源门禁等问题；前述原始结果不覆盖这些问题。
- 此前review修复后的定向验证：`bun test apps/electron/src/main/lib/personal-goal-memory.test.ts` 通过（1个Bun test通过；内部Electron临时HOME断言覆盖超大hash-only leaf、超限正文、最大50,000项水位、关键词嵌套/数组第4,001项、DTO分页与32 KiB结果上限、modelSequence/旧revision CAS、query撤销/迟到请求、首次历史证据绑定、来源门禁与restore来源提示等）。此前全仓 `bun run typecheck` 通过；不等于重跑全仓测试或构建。
- 本轮分页生命周期修复后再次运行同一定向测试通过（1个Bun test）。该回归通过 `buildGoalMemoryTools` 实际工具定义构造Read/Report循环；每页后向临时JSONL追加toolResult并调用真实main capability `turn_end`，断言host sequence每轮递增、Report cursor与root Read cursor均跨轮次完整重建Unicode/反斜杠长值；还覆盖旧modelSequence拒绝、新root刷新、revision变化、功能关闭与revoke时游标失效。`bun run typecheck` 与 `git diff --check` 本轮通过。以上不等于重跑全仓测试或构建。
- 最终修复快照由父会话重新验证：旧6项缺陷、query身份、28页跨tool-round分页及首次扫描中途revoke无迟到写通过；30×10装载、15项evidence、21项hook及4类mutation全部重跑通过。全仓870 pass / 0 fail（2316 assertions），typecheck、personal scripts和五目标构建通过；源码hash在验证前后相同，版本与lock未改。
- 最终快照另获准完成一次短模型run（28,283 ms，不重复长压缩）：真实utility依次调用EvidenceRead、CheckpointRead和Report；4次provider请求均各带单份预算内恢复包，工具content/details结果为6,492 / 1,114 / 1,126 bytes。Report实际提交goalId/revision/expectedModelSequence，sidecar为waiting_user、保留待用户问题；父核对持久原文、全部hash及branch ancestry，不靠模型自述。宿主set耗时16 ms，无provider/utility或标题调用。原三轮真实压缩仍仅是修复前证据；最终版未重跑长压缩，不推断长期语义可靠性。
- 短回归结束已删本轮新会话、撤销新设备、清理新原文/sidecar并关闭测试空间与dev/8443，正式443保留。启动时既有逻辑又清理空草稿并生成disabled预设，停机后仅恢复原草稿、撤回本轮自动预设；20个原会话ID及4份无关配置hash恢复，备份保留。索引迁移/排序不声称字节相同。原始合成审计材料仅保留于私有工作台，不进Git。
- 修复后的Codex独立复审与父级最终计划验收尚未完成；以上验证不构成可合入、发布或长期语义遵循证明。

## 回滚

将 `PROMA_PERSONAL_GOAL_MEMORY` 取消或设为非 `1` 即关闭新功能路径。关闭不清除 sidecar 文件，不影响旧会话与旧格式；数据删除须另行审批。