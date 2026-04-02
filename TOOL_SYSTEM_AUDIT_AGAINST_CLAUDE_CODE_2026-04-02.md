# TOOL_SYSTEM_AUDIT_AGAINST_CLAUDE_CODE_2026-04-02

## 结论

我的结论是：

- **Hive 当前工具系统可运行，但默认工具面仍然偏薄，且过度依赖外部 API 包装工具。**
- **Claude Code 的领先点不是“工具更多”这么简单，而是“更多本地确定性原语 + 更强的 tool contract + 更少外部依赖”。**
- **你看到的大量 400 / 402，不能简单归因为模型笨或者提示词差。更真实的原因是：Hive 当前有不少高频工具本质上是第三方服务 wrapper，错误会直接透传回来。**

我对这个判断的置信度是 **93%**。


## 审计范围

本次对比基于以下真实源码：

- Hive：
  - `backend/app/services/agent_tools.py`
  - `backend/app/tools/handlers/filesystem.py`
  - `backend/app/tools/handlers/search.py`
  - `backend/app/tools/handlers/communication.py`
  - `backend/app/tools/handlers/skills.py`
  - `backend/app/tools/service.py`
  - `backend/app/services/agent_tool_domains/web_mcp.py`
  - `backend/app/services/agent_tool_domains/code_exec.py`
  - `backend/app/services/mcp_client.py`
  - `backend/app/tools/packs.py`
  - `backend/app/kernel/engine.py`
  - `backend/app/services/llm_client.py`

- Claude Code：
  - `src/tools.ts`
  - `src/tools/BashTool/prompt.ts`
  - `src/tools/FileReadTool/prompt.ts`
  - `src/tools/FileEditTool/prompt.ts`
  - `src/tools/FileWriteTool/prompt.ts`
  - `src/tools/WebFetchTool/prompt.ts`
  - `src/tools/TodoWriteTool/prompt.ts`
  - `src/tools/ToolSearchTool/prompt.ts`
  - `src/tools/SkillTool/prompt.ts`
  - `src/tools/AgentTool/prompt.ts`

另外，我也检查了当前本地运行日志：

- `/.data/log/backend.log`

当前日志里**没有直接保留** `HTTP 400 / HTTP 402 / invalid_request_error / insufficient_quota` 的现成命中，因此下面关于 400/402 的判断，主要来自**代码路径审计**，不是基于现成日志样本统计。


## 1. 当前 Hive 默认工具面

Hive 当前默认工具面是 **minimal-by-default**，核心思路是：

1. 先给一个小核心工具集合
2. 再通过 `load_skill` / `tool_search` / tool pack / MCP / channel 配置扩展

### 1.1 默认核心工具

当前核心默认工具共 **16 个**：

- `list_files`
- `read_file`
- `write_file`
- `edit_file`
- `glob_search`
- `grep_search`
- `load_skill`
- `set_trigger`
- `send_message_to_agent`
- `delegate_to_agent`
- `check_async_task`
- `cancel_async_task`
- `list_async_tasks`
- `get_current_time`
- `send_channel_file`
- `tool_search`

### 1.2 HR 扩展工具

HR / 招聘路径额外暴露 **7 个**：

- `create_digital_employee`
- `discover_resources`
- `search_clawhub`
- `web_search`
- `jina_search`
- `jina_read`
- `execute_code`

### 1.3 条件化 Feishu 工具

Feishu channel 配置后再引入 **11 个**左右的条件工具。

这套设计的优点是：

- 初始 prompt 负担更轻
- 幻觉乱用工具的概率更低
- 平台级权限和 pack 更好管理

这套设计的代价是：

- agent 在真实任务里经常要先“找能力、激活能力、再执行”
- 实际有效执行轮次会变多
- 一旦能力依赖外部配置或第三方 API，就会显著抬高失败率


## 2. Claude Code 的真实优势是什么

Claude Code 的差距，不是“它写得更会说话”，而是**工具原语本身更接近工作现场**。

### 2.1 Claude Code 默认工具面更厚

从 `src/tools.ts` 看，Claude Code 的 base tool pool 大约在 **40+ 个入口** 量级，且很多是 coding / execution 任务的直接原语：

- `Bash`
- `Read`
- `Edit`
- `Write`
- `Glob`
- `Grep`
- `WebFetch`
- `WebSearch`
- `TodoWrite`
- `Agent`
- `AskUserQuestion`
- `TaskStop`
- `Skill`
- `ListMcpResources`
- `ReadMcpResource`
- 以及 plan / task / workflow / monitor / trigger / browser 等一整层功能

### 2.2 Claude Code 更依赖“本地确定性工具”

Claude Code 最关键的不是工具数量，而是**高频任务主要依赖本地可控原语**：

- 文件读写：本地
- 文本搜索：本地
- shell 执行：本地
- 任务跟踪：本地
- URL 抓取：内建 `WebFetch`
- 子代理：内建 `AgentTool`

这意味着：

- 少很多 API key / quota / auth / vendor 状态带来的不稳定
- 更少 400 / 402 / 401 / transport error
- 错误更容易被诊断和恢复

### 2.3 Claude Code 的 tool contract 更像“操作协议”

几个典型例子：

- `FileEditTool` 明确要求**必须先 Read 再 Edit**
- `FileWriteTool` 明确强调**已有文件优先 Edit，不要乱新建**
- `BashTool` 明确规定：
  - 什么时候批量并行
  - 什么时候不要用 bash 而应用内建工具
  - git 操作安全边界
  - sandbox 行为
  - 后台任务语义
- `ToolSearchTool` 明确规定：
  - deferred tool 只有名字时不能调用
  - 必须先 fetch schema
  - exact select 和 keyword search 的 query 形式
- `TodoWriteTool` 把复杂任务拆解和状态推进也做成了一等工具 contract

Claude Code 的工具提示词不是“说明书”，而是**直接控制执行行为的协议层**。


## 3. Hive 当前和 Claude Code 的主要差距

### 3.1 最大差距：默认高频原语不够强

对 coding / research / agent execution 这类高频场景来说，Claude Code 默认就有：

- shell
- file ops
- search
- web fetch
- todo/task tracking

Hive 默认核心里虽然有文件工具，但**缺少真正强势的本地执行原语**：

- `execute_code` 不在默认核心里
- `execute_code` 不是完整 BashTool 替代品
- `execute_code` 还带强限制：
  - 无网络
  - 最长 60 秒
  - Python/Bash/Node 受危险模式拦截
  - 更像“受限脚本执行器”，不是通用操作原语

这会直接导致：

- 模型在复杂任务里缺乏低摩擦执行手段
- 本该一轮 bash / fetch / grep 搞定的事情，变成多轮 search + read + external API

### 3.2 第二大差距：Hive 的 web/research 工具过于依赖第三方服务

Hive 当前常用 research 工具：

- `web_search`
- `jina_search`
- `jina_read`
- `discover_resources`
- `import_mcp_server`

其中至少一半本质上是外部服务 wrapper：

- DuckDuckGo HTML 抓取
- Tavily
- Google Custom Search
- Bing Search API
- Jina Search / Reader
- Smithery / MCP

这些路径天然容易出现：

- quota / billing
- API key 缺失
- auth 过期
- 供应商返回 400 / 401 / 402 / 403 / 429
- transport fail
- 返回格式变化

Claude Code 的 `WebFetch` 则是一个**更收敛的 URL 获取 + 内容处理原语**，并且“先 fetch 再二次总结”的 contract 很稳定，不需要在搜索和抓取之间依赖太多第三方跳板。

### 3.3 第三大差距：Hive 的 deferred capability 路径更长

Hive 当前延迟能力发现链路是：

1. `tool_search`
2. 返回 pack / skill 摘要
3. 再 `load_skill` 或激活 pack / MCP
4. 再真正调用工具

Claude Code 的 `ToolSearch` 更像：

1. 已知有 deferred tools
2. `ToolSearch` 直接拉回**完整 schema**
3. 该工具立刻变成可调用

Hive 的 `tool_search` 目前只返回摘要，不返回 schema。  
这会导致：

- 多一轮能力确认
- 多一轮 prompt 消耗
- 多一轮执行不确定性

### 3.4 第四大差距：Hive 还缺少强 session task primitive

Claude Code 的 `TodoWriteTool` 不是装饰性功能，而是：

- 复杂任务拆解
- 单任务 in_progress
- 完成即时更新
- blockers 显式暴露

Hive 虽然有 trigger / async task / focus / tasks.json 等能力，但**缺一个直接面向当前会话执行链路的轻量任务推进工具**。  
这会让 agent 在长任务里：

- 更容易漂移
- 更容易重复调用工具
- 更容易在失败后丢失当前 plan

### 3.5 第五大差距：Hive 的错误结果大多是“原始字符串透传”

Hive 当前多个路径直接把外部错误拼成字符串返回：

- `Tool execution error (...)`
- `❌ Jina Search error HTTP xxx`
- `❌ Jina Reader error HTTP xxx`
- `❌ MCP tool execution error: ...`
- `❌ MCP connection failed: ...`
- `LLMError("HTTP xxx: ...")`

这会带来两个问题：

1. 模型拿不到结构化失败语义
2. 平台无法系统区分：
   - retryable
   - credential issue
   - quota/billing issue
   - malformed args
   - provider-side bad request

Claude Code 不是没有错误，但它更多是**本地原语失败**，错误空间更小，也更容易被模型恢复。


## 4. 为什么你会频繁看到 400 / 402

这个问题必须拆开。

### 4.1 第一类：LLM Provider 侧 400

Hive 的 `llm_client.py` 多条 provider 路径在 HTTP >= 400 时，都会抛出或返回类似：

- `HTTP 400: ...`
- `HTTP 429: ...`

而 `engine.py` 已经专门处理了部分 prompt-too-long / request-too-large 类错误。

所以，**部分你看到的 400，根本不是工具报错，而是模型请求本身报错**：

- prompt 太长
- schema 不兼容
- arguments 形状不合法
- provider 不接受某种 payload

### 4.2 第二类：外部工具 Provider 侧 400 / 402 / 401 / 403

Hive 当前最容易出现这类问题的是：

- `jina_search`
- `jina_read`
- Tavily / Google / Bing 搜索引擎
- Smithery / MCP 服务器

代码上这些路径会直接把 HTTP 状态透传回来。  
因此 402 的最可能来源不是 Hive 本身，而是：

- 供应商 quota / billing
- 付费额度不足
- API key 状态异常

尤其是 Jina / Tavily / 某些 MCP SaaS，很容易把业务层限制表现成 HTTP 错误。

### 4.3 第三类：Hive 自己的业务校验 400

Hive 内部还有很多“非 HTTP provider”的 400 型失败，本质是参数或配置问题，例如：

- search engine config 格式不对
- 缺参数
- `Google search requires API key in format 'API_KEY:SEARCH_ENGINE_ID'`
- 缺少 Smithery API key
- MCP server URL 未配置
- tool arguments 不完整

这些不一定最终出现在日志里，但会直接出现在 tool result 字符串里。

### 4.4 第四类：并非真正的 HTTP 402

代码里还能看到类似：

- Feishu 错误码 `99992402`

这不是 HTTP 402，而是业务错误码。  
如果用户从产品表面只看到“402”，很容易误判成支付问题。


## 5. 为什么当前工具执行效率偏低

### 5.1 工具路径太长

很多任务路径不是：

- 直接执行

而是：

- 发现能力
- 激活能力
- 再执行
- 再处理第三方错误

链路越长，失败概率越高。

### 5.2 默认工具更像“平台工具”，不是“现场工具”

Hive 的默认核心更偏：

- workspace
- delegation
- trigger
- capability discovery

Claude Code 的默认核心更偏：

- 立即读
- 立即改
- 立即查
- 立即跑
- 立即记任务

前者适合平台治理，后者适合模型完成真实工作。

### 5.3 Web/research 依赖第三方，稳定性天然差

只要 research 主链路依赖：

- Jina
- Bing
- Tavily
- Google CSE
- Smithery
- 远程 MCP

那就一定比本地原语更容易出问题。

### 5.4 错误没有结构化恢复语义

模型只看到一串错误字符串时，很难稳定判断：

- 要不要重试
- 应不应该换工具
- 是不是缺配置
- 现在该向用户解释什么

这会直接放大“连续乱试工具”的问题。


## 6. 我认为现在最该做的优化

下面是业务优先级，不是极致工程化优先级。

### P0.1 把常用 coding / research agent 的默认原语做厚

目标：减少“先找能力再做事”的轮次。

建议：

- 对 coding / ops / research 类 agent，默认直接暴露更强的本地执行原语
- 不一定非要照搬 Claude Code 的 BashTool，但至少要有一个：
  - 本地 shell / script 级能力
  - 明确超时 / 工作目录 / 安全边界
  - 不需要先走 HR / skill / pack 才能拿到

如果不做这一步，Hive 在真实任务里会一直输在“执行摩擦”。

### P0.2 给 tool failure 做结构化分类，不再只返回字符串

目标：让模型和平台都能识别错误类型。

建议统一返回 envelope，例如：

```json
{
  "ok": false,
  "error_class": "quota_or_billing",
  "http_status": 402,
  "provider": "jina",
  "retryable": false,
  "actionable_hint": "Jina API quota/billing issue. Fall back to web_search or ask for API key verification."
}
```

至少要能稳定区分：

- `bad_arguments`
- `provider_bad_request`
- `quota_or_billing`
- `auth_or_permission`
- `transport_failure`
- `timeout`
- `tool_not_configured`

### P0.3 给 web 工具建立 provider-aware fallback

当前不该只是“失败了就把错误回给模型”。

应该做成：

1. `jina_search` 失败且为 401/402/403
2. 自动提示或自动降级到：
   - `web_search`
   - 或已配置的其他搜索引擎
3. `jina_read` 失败时，至少明确告诉模型：
   - 这是 URL read fail
   - 是否值得换搜索结果
   - 是否应该缩短 URL / 去掉追踪参数 / 换源

### P0.4 预校验已知高频 400

在发请求前就拦掉明显坏输入：

- 空 query
- 非 URL 的 `jina_read`
- Google engine config 不合法
- MCP server 未配置
- 明显缺少必填字段

减少无意义 provider round-trip。

### P0.5 引入 `WebFetch` 风格的直接 URL 读取原语

Hive 当前很多任务会经历：

1. `web_search`
2. 选 URL
3. `jina_read`
4. 再让主模型总结

建议增加一个更像 Claude Code `WebFetch` 的原语：

- 输入 URL + extraction prompt
- 工具内部完成抓取 + 提取
- 返回任务相关的精简结果

这会显著减少 research 任务的 tool round 数。


## 7. 我不建议现在优先做的事

### 7.1 不建议先做“大而全”的 MCP 扩张

MCP 很强，但它不是当前效率低的核心解法。  
在默认原语不够强、错误分类又太弱的前提下，继续堆 MCP 只会放大失败面。

### 7.2 不建议把 400 / 402 全部归罪给提示词

提示词可以改善：

- 何时用工具
- 参数怎么写
- 失败后如何退让

但它解决不了：

- API key 缺失
- quota/billing
- provider bad request
- transport / auth / schema mismatch

所以这不是纯 prompt 问题。

### 7.3 不建议只补文案，不补工具 shape

当前最大问题不是“描述不够优雅”，而是：

- 默认工具 shape 不够强
- 错误返回不够结构化
- 外部依赖过重


## 8. 最终判断

### 现在的真实状态

- Hive 工具系统 **能跑**
- 但对真实 agent 任务来说，默认工具面仍然偏平台化、偏薄
- Claude Code 仍然明显更适合“让模型立刻动手干活”

### 对“为什么经常 400 / 402”的诚实结论

最核心的原因不是单一问题，而是四类问题叠加：

1. **模型请求本身的 400**
2. **外部工具 provider 的 400 / 402 / 401 / 403**
3. **Hive 自己的参数 / 配置型失败**
4. **错误语义没有结构化，导致模型恢复能力差**

### 一句话结论

**当前差距的本质是：Claude Code 主要靠本地确定性工具完成工作；Hive 还在用较薄的默认工具面去编排更多外部 API wrapper。**  
这正是“效率低”和“400/402 多”的根因。


## 9. 下一步建议

如果继续推进，我建议按这个顺序做，不要反过来：

1. `P0.1` 做厚默认执行原语
2. `P0.2` 做结构化错误分类
3. `P0.3` 做 web/search provider-aware fallback
4. `P0.4` 做高频 bad request 预校验
5. `P0.5` 增加 `WebFetch` 风格工具

做完这五件事，再回头看：

- tool success rate
- 400/402 占比
- 平均 tool rounds
- 首次完成率

再决定要不要继续扩张 MCP / skill / pack 生态。
