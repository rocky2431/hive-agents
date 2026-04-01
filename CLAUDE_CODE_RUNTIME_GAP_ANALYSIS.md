# Claude Code 对标下的 Hive Agent Runtime 差距分析

## 结论

一句话判断：

**Hive 现在不是“没有 agent 能力”，而是“缺少让这些能力稳定复用、可恢复、可组合、可观测的 runtime contract”。**

如果只看功能点，Hive 已经有不少东西：

- 会话级 prompt prefix cache
- 四层 memory retrieval
- 70% 会话压缩 + 85% mid-loop compaction
- tool result eviction + post-compact restoration
- progressive tool loading
- agent-to-agent delegation
- heartbeat/evolution 闭环

但和 Claude Code 的真实差距，不在这些“有没有”，而在下面五个底层抽象：

1. **子代理生命周期是不是一等公民**
2. **prompt cache / compaction 是否是统一 contract，而不是零散优化**
3. **memory 是否是带类型、带 freshness、带行为约束的系统**
4. **hooks / permissions 是否是平台级事件总线**
5. **coordinator 是否是独立 runtime mode，而不是普通 agent 提示词**

我对当前局面的诚实判断是：

- Hive 当前更像一个**企业多租户 agent 平台**，强在 tenant、channel、trigger、workspace、governance。
- Claude Code 当前更像一个**agent runtime 产品内核**，强在 task system、subagent state、cache-safe context、hooks、resume、background lifecycle。
- 如果 Hive 要追上“agent 框架本身”的工程化能力，接下来 1 到 2 个季度不应该继续堆散点功能，而应该先补 runtime contract。


## 本次对标范围

### Claude Code 侧

重点阅读了这些实现：

- `src/context.ts`
- `src/Tool.ts`
- `src/QueryEngine.ts`
- `src/Task.ts`
- `src/tasks.ts`
- `src/tasks/DreamTask/DreamTask.ts`
- `src/tools/AgentTool/forkSubagent.ts`
- `src/tools/AgentTool/resumeAgent.ts`
- `src/utils/forkedAgent.ts`
- `src/query.ts`
- `src/services/compact/autoCompact.ts`
- `src/services/compact/microCompact.ts`
- `src/memdir/memdir.ts`
- `src/memdir/memoryTypes.ts`
- `src/memdir/findRelevantMemories.ts`
- `src/utils/hooks/hookEvents.ts`
- `src/types/hooks.ts`
- `src/coordinator/coordinatorMode.ts`
- `src/utils/task/framework.ts`
- `src/tools/ToolSearchTool/ToolSearchTool.ts`

### Hive 侧

重点阅读了这些实现：

- `backend/app/runtime/session.py`
- `backend/app/runtime/prompt_builder.py`
- `backend/app/runtime/invoker.py`
- `backend/app/kernel/engine.py`
- `backend/app/services/agent_tools.py`
- `backend/app/services/agent_tool_domains/workspace.py`
- `backend/app/services/agent_tool_domains/messaging.py`
- `backend/app/services/memory_service.py`
- `backend/app/memory/retriever.py`
- `backend/app/memory/store.py`
- `backend/app/agents/orchestrator.py`
- `backend/app/services/heartbeat.py`
- `backend/app/models/task.py`
- `backend/app/services/task_executor.py`


## 先说不是差距的部分

下面这些点，Claude Code 不是从 0 到 1，而 Hive 也不是没有：

### 1. 延迟工具加载

Hive 已经是 `minimal-by-default` 的 core tool surface，`tool_search` 只返回延迟能力摘要，`load_skill` / `import_mcp_server` / 读 `SKILL.md` 后会触发工具扩展。

结论：

- **不是“缺失能力”**
- 是**缺少更强的检索、缓存、状态继承和观测**

### 2. Prompt cache

Hive 已经有：

- 会话级 frozen prefix cache
- memory hash invalidation
- Anthropic cache hints

结论：

- **不是“没有 prompt cache”**
- 是**没有把 cache-safe state 设计成跨主线程/子线程共享的 runtime contract**

### 3. Memory retrieval

Hive 已经有：

- working / episodic / semantic / external 四层 retrieval
- SQLite + FTS5 semantic store
- 事实抽取和过期/上限控制

结论：

- **不是“没有长期记忆”**
- 是**memory discipline 不够强，memory representation 对模型不够明确**

### 4. 压缩

Hive 已经有：

- 会话压缩
- mid-loop compaction
- tool result eviction
- post-compact restoration

结论：

- **不是“没有 compaction”**
- 是**压缩链条还没有像 Claude Code 一样统一成多阶段、可恢复、可缓存友好的系统**


## 真正的架构差距

## 1. 子代理生命周期还不是一等公民

### Claude Code 在做什么

Claude Code 把子代理当成 runtime 基元，而不是一次性 helper：

- `Task.ts` 定义统一的 task type / status / id
- `utils/task/framework.ts` 统一注册、轮询、通知、淘汰、恢复
- `forkSubagent.ts` 明确 fork worker 的 prefix 构造规则
- `resumeAgent.ts` 明确 resume 语义
- `forkedAgent.ts` 明确 parent/child context 的共享与隔离边界

它不是“能开子 agent”就结束了，而是把这些问题都做成了框架层语义：

- 如何 spawn
- 如何 background
- 如何通知父线程
- 如何继续已有 worker
- 如何恢复挂起 worker
- 如何保证 parent/child cache 共享
- 如何让 task 生命周期被 UI 和 SDK 感知

### Hive 当前状态

Hive 有 delegation，但更接近“runtime helper”：

- `backend/app/agents/orchestrator.py` 用进程内字典 `_async_tasks` 保存后台 delegation
- `delegate_async()` / `check_async_delegation()` / `list_async_delegations()` 只在当前 worker 进程内成立
- `backend/app/services/agent_tool_domains/messaging.py` 的 `send_message_to_agent()` 是一次 request-response RPC，不是持久子任务
- `backend/app/runtime/session.py` 只有最薄的一层 session state，没有 task state
- `backend/app/models/task.py` + `backend/app/services/task_executor.py` 解决的是“业务任务执行”，不是“subagent runtime lifecycle”

### 真实差距

差的不是“能不能把请求发给另一个 agent”，而是：

- **没有持久 task registry**
- **没有 resume / continue / wait / stop 的统一语义**
- **没有 task notification protocol**
- **没有 sidechain state reconstruction**
- **没有 parent/child exact tool pool inheritance**
- **没有前台会话和后台任务共享一套 runtime state**

### 后果

- 后台 agent 只能算“临时并发执行”，不能算“可管理的 worker”
- 进程重启或 worker 迁移时，状态会断
- 很难做 coordinator mode，因为 coordinator 需要稳定的 worker lifecycle
- 很难做 cache-safe subagent，因为没有稳定的 child state model

### 判断

这是 **Hive 当前最大的 agent runtime 差距**。


## 2. Prompt cache / compaction 还不是统一 contract

### Claude Code 在做什么

Claude Code 的关键不是“有 compaction”，而是把以下几个状态打通了：

- `renderedSystemPrompt`
- `contentReplacementState`
- `applyToolResultBudget`
- `microcompact`
- `autocompact`
- `session memory compact`
- fork child 的 placeholder tool_result discipline

它的设计核心是：

**任何会影响 prefix bytes 的行为，都必须被 runtime 显式追踪。**

这就是为什么它会在：

- `forkSubagent.ts`
- `forkedAgent.ts`
- `resumeAgent.ts`
- `query.ts`
- `microCompact.ts`

里反复强调：

- exact rendered prompt bytes
- identical placeholder tool results
- cloned replacement state
- reconstructed replacement state on resume

### Hive 当前状态

Hive 当前有这些局部优化：

- `runtime/prompt_builder.py` 的 frozen/dynamic split
- `kernel/engine.py` 的 prompt prefix fingerprint
- tool result eviction
- per-round aggregate budget
- 会话压缩 + mid-loop compaction
- post-compact soul/focus restoration

### 真实差距

Hive 缺少 Claude Code 那种统一的 cache-safe contract：

- `SessionContext` 太薄，只存了 `prompt_prefix` / `fingerprint` / `memory_hash`
- 没有 `rendered system prompt bytes` 这类可跨 subagent 继承的状态
- 没有 `content replacement state`
- 没有 resume 时重建 replacement decisions 的机制
- 没有 time-based microcompact
- 没有 reactive prompt-too-long retry 流程
- 系统 prompt 预算还是固定 `60000 chars`，不是 model-aware

### 后果

- Hive 的 cache 优化大多只对“单线程、同一 session、稳定路径”有效
- 一旦进入 subagent / delegation / resume 场景，缓存收益会明显掉
- 压缩虽然存在，但没有形成一套可组合的上下文治理流水线

### 判断

这是 **第二大的 runtime gap**。


## 3. Memory 是可检索的，但还不是可治理的

### Claude Code 在做什么

Claude Code 的 memory 设计有三个很关键的特点：

1. **typed memory taxonomy**
   - `user`
   - `feedback`
   - `project`
   - `reference`

2. **行为约束写进 prompt**
   - 什么该记
   - 什么不该记
   - 如何写 frontmatter
   - 何时读取
   - 忽略 memory 时怎么做
   - 发现 stale memory 时怎么处理

3. **relevance selection 和 freshness surface**
   - `findRelevantMemories.ts` 用 side query 选最多 5 个 memory
   - 返回 `mtimeMs`
   - 明确把 freshness 暴露给调用方

### Hive 当前状态

Hive 的 memory 实现更偏“后端数据结构”：

- `memory_service.py` 负责提取、压缩、持久化
- `retriever.py` 负责四层检索
- `store.py` 负责 SQLite/FTS5

它在后端层面不弱，但模型视角下仍然偏模糊：

- semantic facts 基本是扁平 item
- 没有 memory type taxonomy
- 没有 scope/private/team 的结构
- 没有 freshness 告警注入
- 没有 side-query reranker
- 没有明确告诉模型“哪些东西不该记”

### 真实差距

差距不是“存不住”，而是：

- **模型不知道 memory 的语义边界**
- **系统不知道哪些 memory 更应该进入当前回合**
- **memory stale 之后缺少轻量提醒**
- **memory 和 project-state 的边界没有被教给模型**

### 后果

- 容易把可从当前代码推导的内容也写进 memory
- 容易把已经过期的 project facts 当成稳定事实
- recall 质量更多依赖 retrieval 分数，缺少 memory governance

### 判断

这是 **第三大的 gap**。不是数据库问题，是 memory contract 问题。


## 4. Hooks / permissions 还不是平台

### Claude Code 在做什么

Claude Code 的 hooks 不是一个“审批回调”，而是一套平台级事件系统：

- `SessionStart`
- `Setup`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `PermissionRequest`
- `PermissionDenied`
- `SubagentStart`
- `FileChanged`
- `CwdChanged`
- `WorktreeCreate`
- `Elicitation`

并且 hook 可以：

- 追加 context
- 修改 tool input
- 修改 permission decision
- 设置 watch paths
- 异步执行
- 发 started/progress/response 事件

### Hive 当前状态

Hive 有权限治理与审批：

- `app/tools/governance.py`
- websocket 里能展示 permission event

但没有通用 hook runtime：

- 没有统一 event bus
- 没有 pre/post tool extensibility
- 没有 file/system watcher driven hook
- 没有 async hook protocol

### 真实差距

Hive 当前的 permission/governance 更像“安全阀”，不是“可编排 runtime 插件层”。

### 后果

- 很难做用户级工作流注入
- 很难做 session start augmentation
- 很难做 external policy / audit / enrichment integration
- 很难让平台随着客户需求扩展，而不不断侵入 kernel

### 判断

这是 **第四大的 gap**。它关系到平台扩展性，不是单个 feature。


## 5. Coordinator 还只是方向，不是 mode

### Claude Code 在做什么

Claude Code 的 coordinator mode 不是一个普通 prompt，而是一个单独运行模式：

- 明确 coordinator 与 worker 的角色差异
- 明确允许使用哪些工具
- 明确 task notification 协议
- 明确 worker failure / continue / stop 语义
- 明确“先综合再下发实现 prompt”的责任边界

### Hive 当前状态

Hive 有这些前置条件：

- delegation
- messaging
- async orchestration helper
- task executor

但没有独立 coordinator runtime：

- 没有 coordinator 专属 tool policy
- 没有统一 worker notification 协议
- 没有结构化的 research -> synthesis -> implementation -> verification 流程
- 没有“继续同一个 worker”的强语义

### 判断

Coordinator mode 在 Hive 现在**不应该先做成 prompt feature**，应该先建立在 task runtime 之上。


## 6. Auto-dream 是后置能力，不是当前第一优先级

Claude Code 有 `DreamTask`，但注意它能成立，是因为前面已经有：

- task registry
- background lifecycle
- resume/kill
- memory contract
- compaction pipeline

Hive 当前如果直接上 auto-dream，会遇到的问题不是“能不能写个后台 consolidation job”，而是：

- consolidation 结果怎么进入当前 runtime
- 如何避免 stale memory 扩散
- 如何观测是否真的提升 recall
- 如何与 compaction、heartbeat、task runtime 协调

### 判断

这项可以做，但必须排在 typed memory 和 task runtime 之后。


## 诚实的优先级重排

## P0：先补 runtime contract，不要先堆高级 feature

### 1. 持久化子代理任务系统

目标：

- 把 Hive 的 delegation 从“进程内 helper”升级成“平台级 worker runtime”

应该新增或改造：

- `backend/app/runtime/session.py`
- `backend/app/agents/orchestrator.py`
- `backend/app/services/agent_tool_domains/messaging.py`
- `backend/app/tools/handlers/communication.py`
- `backend/app/models/` 下新增 runtime task / event / sidechain model

注意：

- 不建议直接复用当前 `backend/app/models/task.py`
- 当前 `Task` / `TaskLog` 是业务层任务，不适合承载 subagent runtime state

建议能力面：

- `spawn_agent`
- `send_input`
- `wait_agent`
- `list_agents` 或 `list_tasks`
- `stop_agent`
- `resume_agent`

关键要求：

- DB 持久化，不依赖进程内字典
- parent_session_id / parent_agent_id / trace_id 持久化
- worker 状态机标准化
- tool pool fingerprint 持久化
- prompt fingerprint 持久化
- websocket / chat event 统一通知

### 2. cache-safe subagent contract

目标：

- 让 Hive 的 delegation 也能享受 prompt cache，而不是每次重新拼接完整上下文

应该改造：

- `backend/app/runtime/session.py`
- `backend/app/kernel/engine.py`
- `backend/app/runtime/invoker.py`

关键要求：

- 显式保存 rendered system prompt 或其稳定序列化结果
- exact tool pool inheritance
- placeholder tool_result prefix discipline
- child resume 时重建同一份 replacement decisions

### 3. PTL reactive retry + model-aware prompt budget

目标：

- 先解决最容易出事故的上下文失败路径

应该改造：

- `backend/app/kernel/engine.py`
- `backend/app/runtime/prompt_builder.py`
- `backend/app/services/memory_service.py`

关键要求：

- 捕获 prompt-too-long 后走 reactive compact / retry
- `_SYSTEM_PROMPT_CHAR_BUDGET` 改成按 model context window 动态分配
- 压缩与 retry 事件要有观测指标


## P1：把 memory 和 compaction 从“有功能”升级到“有系统”

### 4. typed memory contract

目标：

- 让模型知道该记什么、不该记什么、何时读取、如何判断陈旧

建议方案：

- 保留 Hive 当前 SQLite/FTS store，不要推翻
- 在其上新增 typed schema
- 引入四类 memory：
  - `user`
  - `feedback`
  - `project`
  - `reference`

应该改造：

- `backend/app/services/memory_service.py`
- `backend/app/memory/retriever.py`
- `backend/app/memory/store.py`
- `backend/app/services/agent_context.py`

关键要求：

- type + timestamp + freshness metadata
- 给模型显式 memory behavior prompt
- recall 时展示 freshness
- 冲突时默认信当前状态，不信旧 memory

### 5. relevance rerank + freshness warning

目标：

- 不是把所有 memory 都塞回 prompt，而是更像 Claude Code 那样选“这轮最该进来的”

建议方案：

- 先做轻量 side-query 选 Top-K
- 再决定是否上更贵的 reranker

### 6. compaction pipeline 分层化

目标：

- 从“会话压缩 + mid-loop 压缩”升级到多阶段 pipeline

建议顺序：

1. per-turn tool result budget state
2. time-based tool result clearing
3. session memory compact
4. reactive compact retry
5. 更强的 post-compact restoration


## P2：平台扩展性

### 7. hook/event bus

目标：

- 让 Hive 的 runtime 可以被平台、客户、插件、安全系统扩展

建议事件：

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `PermissionRequest`
- `PermissionDenied`
- `SubagentStart`
- `FileChanged`

应该改造：

- `backend/app/kernel/engine.py`
- `backend/app/runtime/invoker.py`
- 新增 `backend/app/runtime/hooks.py` 或类似模块

### 8. coordinator mode

前提：

- 必须建立在 P0 的 persistent task runtime 之上

否则 coordinator 只是一个“提示词上更会指挥”的 agent，不是工程上可靠的 orchestrator。


## P3：高级能力

### 9. auto-dream / background memory consolidation

前提：

- typed memory 已经落地
- task runtime 已经稳定
- compaction observability 已经有指标

### 10. team/private memory scope

这项值得做，但应该排在 typed memory 之后，不应该直接从平铺 facts 跨到 team memory。


## 不建议现在做的事

### 1. 不要先做“Coordinator Prompt”

没有 task runtime，做出来也只是更复杂的 prompt engineering。

### 2. 不要先做跨 agent cache sharing

如果没有 exact prompt bytes、exact tools、replacement state，这项几乎没有稳定收益。

### 3. 不要先做 auto-dream

没有 typed memory 和 task lifecycle，这项会先带来复杂度，再带来收益。

### 4. 不要推翻现有 memory store 重做一套

Hive 当前的 SQLite/FTS store 本身没问题，问题在 memory contract，不在存储层。


## 建议的 90 天路线

## 第 1 阶段：0 到 3 周

- 建 persistent subagent task runtime
- 建 wait/resume/stop/list 语义
- 建 task event/notification 协议
- 建 reactive PTL retry
- 建 model-aware prompt budget

验收指标：

- 子代理跨进程/重启后仍可查询状态
- prompt-too-long 错误率显著下降
- worker 完成事件能稳定回到父会话

## 第 2 阶段：4 到 8 周

- 上 typed memory contract
- 上 freshness warning
- 上 side-query memory selection
- 上 content replacement state
- 上 time-based microcompact

验收指标：

- memory recall 命中率提升
- stale memory 引发的错误下降
- 平均上下文体积下降但结果质量不降

## 第 3 阶段：8 到 12 周

- 上 hook/event bus
- 上 coordinator mode
- 上更成熟的 verification worker 流程

验收指标：

- 一个复杂任务可以稳定拆成 research / implementation / verification 三段
- coordinator 可以恢复/继续已有 worker，而不是重新起新 worker


## 最后的判断

如果 Hive 只是继续优化 retrieval、压缩比例、tool pack、heartbeat prompt，它会继续变成一个“能力很多但 runtime 不够结实”的平台。

如果 Hive 把未来 90 天主要投入到下面四件事上，它会真正接近 Claude Code 的 agent engineering 水平：

1. **persistent task runtime**
2. **cache-safe subagent contract**
3. **typed memory contract**
4. **hook/event bus**

这是我基于当前两边源代码后的诚实结论。
