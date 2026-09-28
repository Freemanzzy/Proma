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

父会话通过 `wait_for_delegations` 或 `get_delegation_results` 取回终态结果后，该委派被标记为已消费，不再触发自动唤醒。父会话被用户停止、已归档或不存在时跳过；忙碌时会等到空闲再检查。相同父会话 30 秒内结束的子任务会合并为一轮，每小时最多自动唤醒 10 次。跳过和触发原因可在 main.log 的 `[子任务唤醒]` 记录中查看。
