# Proma 个人版 · 代码审查规则

> 供 Proma 会话调用 Codex 独立审查时传入（`codex-code-review` Skill 的 `--rules`）。只写 diff 里不容易看出、但漏掉代价高的项目约束；格式与机械检查交给测试和 lint。共同维护规则见 `docs/personal/maintenance.md`，本文件只摘录与代码审查相关的部分。

## 版本号（避免误报）

- 仓库根 `AGENTS.md` 来自上游，其中“每次改动递增版本号”不适用于个人版：`apps/electron/package.json` 的 `version` 必须等于所跟随的官方 tag。**不要因为版本号未递增而报告问题**；若 diff 擅自改了版本号，反而应报告。

## Web Remote 授权

- 新增或修改的 IPC 通道必须在 `apps/electron/src/main/lib/web-remote/full-ui/channel-policy.ts` 登记分级；手机端不应可用的通道（如 simulator）标记 `denied`。
- `session` / `workspace` 作用域的通道，只校验入参并不够：返回内容若聚合了其他会话（子会话、关联会话、按父子关系汇总），每个被聚合的会话都要校验在远程客户端的授权范围内。安全做法：把授权范围传入聚合过程，或聚合后逐个过滤。

## 主进程资源

- 主进程读取会话 JSONL 等可能达数百 MB 的文件时，不得整文件同步读入或一次性 `JSON.parse` 全部行；使用有界异步分块读取，并在解析前按前缀跳过不需要的行。`async` 处理函数内部的同步 I/O 仍会阻塞主进程。

## 数据与隐私

- 不得删除或覆盖 `~/.proma`、开发数据目录或任何备份；需要替换时先改名保留。
- 公开仓库：diff 不得包含密钥、令牌、`/Users/<用户名>` 绝对路径、IP、Tailscale 主机名或设备名、邮箱。日志输出同样不得打印密钥。
- 结束进程只按 PID，不得使用 `pkill` / `killall`。

## 上游改动面

- 个人版功能优先放在独立模块；修改上游文件时，若逻辑可以移到个人版模块，请作为低优先级建议指出（降低同步官方版本时的冲突）。
