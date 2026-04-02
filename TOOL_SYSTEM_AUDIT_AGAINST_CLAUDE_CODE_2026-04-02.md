# TOOL_SYSTEM_AUDIT_AGAINST_CLAUDE_CODE_2026-04-02

## 结论

- **Hive 当前工具系统已经达到可上线运行状态。**
- **与 Claude Code 的剩余差距，主要不在“有没有某个 provider”，而在默认原语厚度、tool contract、以及任务推进原语。**
- **当前推荐的搜索/网页栈应是 Exa / Tavily / DuckDuckGo + web_fetch / Firecrawl / XCrawl。**

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

## 1. 当前 Hive 默认工具面

### 1.1 默认核心工具

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
- `run_command`
- `execute_code`
- `web_fetch`

### 1.2 HR / 扩展路径

- `create_digital_employee`
- `discover_resources`
- `search_clawhub`
- `web_search`
- `firecrawl_fetch`
- `xcrawl_scrape`

## 2. Claude Code 的真实优势

Claude Code 的优势不在工具名字，而在：

1. 默认工具更接近工作现场
2. 本地确定性原语更厚
3. tool contract 更像操作协议
4. 默认已知 URL 读取路径更直接

## 3. 当前 Hive 和 Claude Code 的真实差距

### 3.1 默认高频原语仍偏薄

Hive 现在已经补上了 `run_command` 和 `web_fetch`，但仍缺：

- 会话级任务推进原语
- 更强的本地任务拆解 / 状态更新能力

### 3.2 外部能力仍需更强治理

当前已经把搜索与页面抓取收敛到：

- `web_search`
- `web_fetch`
- `firecrawl_fetch`
- `xcrawl_scrape`

但 provider 失败治理、成功率观测、自动降级策略仍有继续优化空间。

### 3.3 deferred capability 路径仍偏长

Hive 当前仍更多依赖：

1. `tool_search`
2. `load_skill` / pack 激活
3. 再实际调用工具

Claude Code 在 deferred schema 拉取和立刻执行上更顺。

### 3.4 缺少强 session task primitive

Claude Code 的 `TodoWriteTool` 对复杂任务推进帮助很大。
Hive 现在虽然有 trigger / async task / focus / tasks.json，但会话内轻量任务推进原语仍偏弱。

## 4. 当前推荐优化方向

### P0

1. 继续增强 `web_search` 的 provider telemetry
2. 强化 `firecrawl_fetch` / `xcrawl_scrape` 的失败分类与自动降级
3. 继续提升 `run_command` 的安全边界和常见工程命令体验

### P1

1. 增加会话级 task/todo primitive
2. 进一步缩短 deferred capability 使用链路

## 5. 当前判断

如果目标是“业务可上线、云端稳定、减少 provider 失败”，那么当前工具体系已经达标。

如果目标是“对齐 Claude Code 的工具工程深度”，剩余重点是：

- 本地原语继续做厚
- task/todo primitive
- 更强的 provider 治理和观测
