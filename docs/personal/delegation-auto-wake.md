# 协作子 Agent 自动唤醒

个人版默认在协作子 Agent 结束后自动向父会话发起一轮，让父 Agent 读取结果并继续原任务。完成、失败、取消状态都会触发；唤醒消息列出标题、状态和 `delegationId`，并要求用 `get_delegation_results` 读取终态结果。

## 关闭开关

在当前数据目录的 `personal-settings.json` 设置：

```json
{
  "delegationAutoWake": false
}
```

开发实例读取 `~/.proma-dev/personal-settings.json`，正式版读取 `~/.proma/personal-settings.json`。缺少配置、读取失败或未设置该字段时默认开启。设置为 `false` 后，后续新结束的委派不再自动唤醒；无需重启应用。

## 防重复与调度

父会话通过 `wait_for_delegations` 或 `get_delegation_results` 取回终态结果后，该委派被标记为已消费，不再触发自动唤醒。父会话被用户停止、已归档或不存在时跳过；忙碌时会等到空闲再检查。相同父会话 30 秒内结束的子任务会合并为一轮，每小时最多自动唤醒 10 次。跳过和触发原因可在 main.log 的 `[子任务唤醒]` 记录中查看；开发实例会输出到开发进程日志。

## 跨渠道委派

先调用 `list_available_agent_models` 查看 `channels[]` 中的已启用渠道与模型（Proma 官方渠道不列入）。`delegate_agent` 或 `delegate_agents.items[]` 可按需传入 `channelId` 与 `modelId`；省略 `channelId` 时沿用父会话渠道，指定 `channelId` 但省略 `modelId` 时选择该渠道第一个启用模型。显式目标渠道必须启用且不能是 Proma 官方渠道，显式模型必须属于目标渠道并处于启用状态。子会话及其后续 `continue_delegation` 保留子会话自己的渠道/模型；结束后的自动唤醒仍按父会话元数据运行父 Agent。

示例：

```json
{
  "task": "检查独立模块中的接口调用并返回结论",
  "channelId": "从 list_available_agent_models.channels[].channelId 获取",
  "modelId": "从对应 channels[].models[].id 获取"
}
```

自动通知轮次使用 `triggeredBy: 'external'`，而不是 `delegation`：它仍是无人值守自动来源，但不会把父会话误当作受限协作子会话，因此不会丢失父 Agent 的委派、工作区 MCP、视觉中继与规划能力。headless 事件 source 使用 `bridge`，Web Remote 将 `run_completed` 映射为常规“运行已完成”推送；事件仍经主进程现有 headless 路径发往桌面和手机。
