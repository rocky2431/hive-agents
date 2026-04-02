# CLOUD_TOOL_STABILITY_AUDIT_2026-04-02

## 结论

如果基线明确为：

- 云端部署
- 纯 Docker 容器
- agent 在容器内运行
- 工作目录是持久卷 `/data/agents`
- 没有桌面级整机权限

那么当前工具体系的正确判断是：

- **真正稳定、应该作为主力默认原语的，是本地确定性工具。**
- **Jina / Smithery / ModelScope / Feishu / Email 这类 provider 或渠道依赖工具，不应该再被视为默认主链路。**
- **Claude Code 在这个问题上的启发，不是“照搬它的工具名”，而是“把默认工作流尽量建立在本地原语上”。**

我的置信度：**94%**


## 1. 云端容器里真正稳定的主力工具

这些工具的共同特点是：

- 主要依赖本地文件系统和容器内已安装程序
- 不依赖第三方 API quota / billing / auth
- 出错时更容易恢复

### A. 文件与代码工作流主力

- `list_files`
- `read_file`
- `write_file`
- `edit_file`
- `glob_search`
- `grep_search`
- `read_document`
- `execute_code`
- `run_command`

### 为什么它们稳定

- 它们主要依赖本地 workspace
- 云端容器镜像里已经有：
  - `python3`
  - `node`
  - `git`
  - `bash`
  - `curl`
  - `npm`
- 这些工具不依赖 Jina、Smithery、搜索 API 或渠道 OAuth

### 推荐分工

- `run_command`：云端主力工程执行原语
  - 适合 `git status`、`pytest -q`、`npm test`、`node script.js`
- `execute_code`：短脚本、快速数据处理、小段 Python/Bash/Node
- `read/edit/write/glob/grep`：主文件工作流
- `read_document`：Office/PDF 文档读取


## 2. 云端里“能用，但不该当主力”的工具

### A. `web_search`

当前状态：

- **能用**
- 但稳定性一般

原因：

- 当前实现本质上仍然依赖 DuckDuckGo HTML 抓取或外部搜索 provider
- 抓取路径容易受 HTML 结构变化、限流、封锁影响

建议定位：

- 保留
- 作为“有关键词但没有 URL”时的入口
- **不要**当最终阅读工具

### B. `web_fetch`

当前状态：

- **应该提升为云端主力 web 工具**

原因：

- 它不依赖 Jina
- 只依赖普通 HTTP 获取
- known URL 场景下更稳定、更直接

建议定位：

- 已知 URL → `web_fetch`
- 不要再默认走 `jina_read`

### C. `search_clawhub`

当前状态：

- **能用，但属于次级工具**

原因：

- 它是 marketplace 搜索，不是任务主链路执行工具
- 更适合招聘/扩展/技能发现，而不是日常工作流


## 3. 云端里“条件可用”的工具

这些工具不是不能用，而是**只有在配置完整、provider 正常时才有意义**。

### A. Jina 系列

- `jina_search`
- `jina_read`

判断：

- **不应该再作为默认主路径**
- 只能作为增强路径

原因：

- 强依赖 `JINA_API_KEY`
- 即使有 key，也受 provider 可用性、限流、计费状态影响
- 你已经实际观察到了“Jina 一直出错”，这和代码路径完全一致

新的建议顺序：

1. 有关键词：`web_search`
2. 有 URL：`web_fetch`
3. 只有在明确需要 Jina 结果质量时，才尝试 `jina_search` / `jina_read`

### B. MCP / 资源发现

- `discover_resources`
- `import_mcp_server`
- `list_mcp_resources`
- `read_mcp_resource`

判断：

- **不适合作为普通 agent 默认执行主链路**

原因：

- 强依赖 Smithery / ModelScope / 远程 MCP 服务
- 依赖 key、连接、授权状态
- 最容易出现 auth 过期、transport fail、schema mismatch

适合场景：

- 管理员扩展能力
- HR / 平台运营 / 特定 agent 安装扩展

不适合场景：

- 普通任务执行中临时救火式默认调用

### C. Feishu / Email / 外部渠道类

- `send_feishu_message`
- `feishu_*`
- `send_email`
- `read_emails`
- `reply_email`

判断：

- **明确是配置依赖工具**

原因：

- 依赖渠道配置、token、账号状态
- 并不适合在未确认配置状态下作为默认能力

建议：

- 只在 agent 已配置对应 channel / email 后暴露
- 不要出现在一般-purpose agent 的默认核心工具判断中


## 4. 云端里“不该默认暴露为主链路”的工具

### A. `discover_resources` / `import_mcp_server`

不该默认主暴露的原因：

- 这不是“完成任务”的工具，而是“扩展平台”的工具
- 它会把普通任务引向外部依赖和安装流程
- 成本高、错误多、恢复差

### B. Jina 作为主 reader

`jina_read` 最大的问题不是“偶尔失败”，而是：

- 它不是本地原语
- 它不是通用互联网原语
- 它是第三方增强 reader

所以在云端 agent 里，它应该从“主 reader”降级成“高级可选 reader”。

### C. `execute_code` 作为唯一执行原语

在云端里，如果只有 `execute_code`，那 agent 的真实工程能力仍然太弱。

因为它更像：

- 运行短脚本

而不是：

- 正常工程命令工作流

因此它必须和 `run_command` 配合，而不能单独承担默认执行主力。


## 5. Claude Code 在云端场景给我们的真正启发

Claude Code 最值得借鉴的不是具体某个第三方 provider，而是：

### 1. 默认靠本地原语工作

- `Read`
- `Edit`
- `Write`
- `Glob`
- `Grep`
- `Bash`
- `WebFetch`

这些工具的共同点是：

- 尽量不依赖外部服务
- 能直接完成大部分真实工作

### 2. 把外部能力降级成补充，而不是主链路

Claude Code 虽然也有 `WebSearch`、MCP、Agent 等高级能力，但真正稳定的执行核心始终是：

- 文件系统
- shell
- 本地任务推进

### 3. 已知 URL 时优先直接 fetch，不绕远路

Claude Code 的 `WebFetch` 思路非常适合云端 agent：

- 有 URL 就直接抓
- 不要先 search 再 provider reader 再总结

这个思路比当前“关键词 -> Jina/Search -> Jina Read -> 总结”的路径稳定得多。


## 6. 我对当前 Hive 工具的云端分级

### S 级：应作为主力默认工具

- `list_files`
- `read_file`
- `write_file`
- `edit_file`
- `glob_search`
- `grep_search`
- `read_document`
- `run_command`
- `execute_code`
- `send_message_to_agent`
- `delegate_to_agent`
- `check_async_task`
- `cancel_async_task`
- `list_async_tasks`
- `get_current_time`
- `load_skill`
- `tool_search`
- `web_fetch`

### A 级：能用，但作为辅助

- `web_search`
- `search_clawhub`
- `send_web_message`
- `send_channel_file`
- `set_trigger`
- `cancel_trigger`
- `update_trigger`
- `list_triggers`

### B 级：仅在配置完整时使用

- `jina_search`
- `jina_read`
- `discover_resources`
- `import_mcp_server`
- `list_mcp_resources`
- `read_mcp_resource`
- `send_feishu_message`
- `feishu_*`
- `send_email`
- `read_emails`
- `reply_email`

### C 级：不该作为默认主链路

- `discover_resources`
- `import_mcp_server`
- `jina_read` 作为默认网页阅读主路径


## 7. 更稳定的推荐工作流

### 场景一：代码与仓库任务

推荐顺序：

1. `glob_search` / `grep_search`
2. `read_file`
3. `edit_file` / `write_file`
4. `run_command`
5. `execute_code` 仅用于小脚本

### 场景二：已知 URL 的网页任务

推荐顺序：

1. `web_fetch`
2. 必要时再 `jina_read`

### 场景三：未知 URL 的互联网检索

推荐顺序：

1. `web_search`
2. 选定 URL
3. `web_fetch`
4. 只有明确需要时再尝试 `jina_read`

### 场景四：平台扩展 / 外部连接

推荐顺序：

1. 先确认配置状态
2. 再用 `discover_resources` / `import_mcp_server`
3. 不要在普通任务主循环里默认触发


## 8. 最终建议

如果只保留一句话：

**云端 agent 的默认工作核心，应该是 `read/edit/write/glob/grep/run_command/web_fetch`，而不是 `Jina + MCP + 渠道工具`。**

对当前系统，我建议的治理原则是：

1. 本地原语优先
2. 已知 URL 优先 `web_fetch`
3. Jina 降级为增强路径
4. MCP/资源发现降级为管理员/安装路径
5. 渠道与 Email 严格按配置状态暴露

这样做，才是真正把工具体系改成适合云端 agent 的样子，而不是继续沿用桌面型或第三方依赖型默认心智。
