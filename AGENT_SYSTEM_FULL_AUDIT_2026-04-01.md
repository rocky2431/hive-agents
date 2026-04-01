# Agent System Full Audit

Date: 2026-04-01
Repo: `Clawith`
Audit scope: HR-agent 问答建人 -> agent 初始化 -> 对话执行 -> 工具调用 -> 上下文/记忆/压缩 -> 输出 -> trigger/heartbeat -> feedback/evolution

## 1. 审计结论

### 1.1 总判断

这套系统 **现在可以顺利跑起来**，而且核心 web 路径已经不是“到处断”的状态了：

- 后端全量测试通过：`435 passed`
- 前端测试通过：`40 passed`
- 前端构建通过：`vite build` 成功
- `bash restart.sh --source` 成功拉起 backend/frontend/proxy
- 启动日志没有再出现 `agents.execution_mode does not exist`、默认 secret、连接回收告警这类已知阻断

但如果问题是：

> “它是否已经达到高可靠 agent runtime，上下文/记忆/压缩/工具/执行/反馈/进化都闭环到可以放心上线？”

我的结论是：

- **核心人工对话执行链路：可以上线**
- **自动执行链路：可以用，但还不算高鲁棒**
- **多 agent async orchestration：可用，但还不是分布式可靠运行时**
- **自我进化：已有闭环雏形，但还没到工程化自进化平台**

### 1.2 置信度

本报告对“核心运行状态”和“主要断点”的结论置信度约 **95%**。

理由：

- 我重新读了创建、初始化、统一 runtime、memory、compression、tool registry、A2A、trigger daemon、heartbeat、frontend HR 流程的真实代码。
- 我重跑了 backend 全量、frontend 全量、frontend build、restart 脚本和启动日志检查。

仍然不在这 95% 里的部分：

- 外部渠道真实联调：Feishu / Slack / Discord / WeCom
- 外部资源安装链路：Smithery MCP / ClawHub skill
- 多进程/多 worker/重启中的 in-flight async delegation 恢复

## 2. 我实际验证了什么

### 2.1 运行验证

执行结果：

- `cd backend && pytest -q` -> `435 passed in 2.10s`
- `cd frontend && npm test` -> `40 passed`
- `cd frontend && npm run build` -> 成功
- `bash restart.sh --source` -> backend ready / frontend ready / proxy working

启动日志检查：

- `.data/log/backend.log` 显示：
  - `SecretsProvider initialized with Fernet encryption`
  - `Database tables ready`
  - `Trigger Daemon started`
  - `Application startup complete`
  - `/api/health` 返回 `200`

### 2.2 重点代码路径

我重点核查了这些文件：

- `backend/app/api/agents.py`
- `backend/app/tools/handlers/hr.py`
- `backend/app/services/agent_manager.py`
- `backend/app/runtime/invoker.py`
- `backend/app/kernel/engine.py`
- `backend/app/services/memory_service.py`
- `backend/app/memory/retriever.py`
- `backend/app/memory/assembler.py`
- `backend/app/services/agent_tools.py`
- `backend/app/services/agent_tool_domains/messaging.py`
- `backend/app/agents/orchestrator.py`
- `backend/app/services/trigger_daemon.py`
- `backend/app/services/heartbeat.py`
- `backend/app/api/websocket.py`
- `backend/app/services/agent_context.py`
- `frontend/src/pages/AgentCreate.tsx`
- `frontend/src/pages/AgentDetail.tsx`
- `frontend/src/pages/workspace/WorkspaceHrAgentSection.tsx`

## 3. 全链路现状

### 3.1 HR-agent 问答建人

现状：

- `/agents/new` 不是直接创建页，而是先取 `/agents/system/hr`，再把用户送到 HR agent 聊天页。
- HR agent 是懒创建的 system agent。
- 真正创建员工的动作由 `create_digital_employee` 工具完成。

确认成立的能力：

- HR agent 存在真实后端入口，不是前端假流程。
- HR tool 会创建 agent、participant、permission、default tools、default skills、focus、heartbeat、triggers。
- 创建完成后会尝试安装额外 MCP/ClawHub 资源。

关键事实：

- `frontend/src/pages/AgentCreate.tsx`
- `backend/app/api/agents.py`
- `backend/app/tools/handlers/hr.py`

### 3.2 初始化与引导

现状：

- 新 agent 会写 `soul.md`、`memory/memory.md`、`HEARTBEAT.md`、`relationships.md`、`evolution/`、`workspace/`。
- 系统启动时还会 push default skills 到已有 agent。
- trigger daemon 是当前实际启动的自动执行引擎。

确认成立的能力：

- 初始化不再只有 DB 记录，workspace/evolution 结构也会落盘。
- 启动时的 seed / migrate / daemon 拉起是通的。

关键事实：

- `backend/app/services/agent_manager.py`
- `backend/app/services/skill_seeder.py`
- `backend/app/main.py`
- `backend/app/services/trigger_daemon.py`

### 3.3 对话执行

现状：

- WebSocket 聊天、task execution、heartbeat、trigger invocation、supervision 都在复用统一 runtime。
- runtime 已经有：
  - prompt cache
  - tool expansion
  - coordinator mode
  - PTL reactive retry
  - tool result eviction
  - mid-loop compaction
  - post-compaction restoration
  - cancel/abort

确认成立的能力：

- 这不是“每个入口各自跑一套”的系统。
- 核心 agent runtime 已经统一到了 `invoker.py + engine.py`。

关键事实：

- `backend/app/api/websocket.py`
- `backend/app/services/task_executor.py`
- `backend/app/services/heartbeat.py`
- `backend/app/services/trigger_daemon.py`
- `backend/app/runtime/invoker.py`
- `backend/app/kernel/engine.py`

### 3.4 上下文 / 记忆 / 压缩

现状：

- memory 现在是四层 retrieval：working / episodic / semantic / external
- assembler 已经有 freshness warning
- conversation end 会生成 session summary，并增量抽取 semantic facts
- compaction 不再只有单点 summary，而是：
  - pre-round compression
  - PTL retry compression
  - time-based microcompact
  - mid-loop compaction
  - compaction summary writeback
  - post-compact restoration

关键事实：

- `backend/app/services/memory_service.py`
- `backend/app/memory/retriever.py`
- `backend/app/memory/assembler.py`
- `backend/app/kernel/engine.py`

### 3.5 反馈 / 进化

现状：

- heartbeat 会：
  - 读取 `scorecard.md / blocklist.md / lineage.md`
  - 分析 recent activities
  - 生成 evolution context
  - 回写 evolution files
  - 把高价值 heartbeat outcome 写回 semantic memory

确认成立的能力：

- 现在已经不是“只有 heartbeat，没有 server-side feedback loop”。
- feedback 到 memory 的闭环也已经存在。

关键事实：

- `backend/app/services/heartbeat.py`
- `backend/app/services/activity_logger.py`

## 4. 已确认的强项

### 4.1 核心 runtime 已经不是 demo 级

- `invoke_agent()` 已经成为统一入口。
- tool hooks、parallel-safe batch、tool expansion、coordinator filtering 都是真接线。
- PTL retry 和 compaction 已经不是文档概念，而是内核行为。

### 4.2 工具面设计方向是对的

- 默认是 `minimal-by-default`，不是一开始把所有工具扔给模型。
- `load_skill` / `discover_resources` / `import_mcp_server` 会按需扩展工具面。
- tool registry 也有 read-only / parallel-safe 元数据。

### 4.3 memory / evolution 已经形成真实闭环

- session summary、semantic fact extraction、freshness warning、heartbeat outcome writeback 都已经存在。
- 现在最大问题不是“没有 memory/evolution”，而是“这些机制还没有完全工程化到稳定、统一、分布式可恢复”。

## 5. 已确认的断点

下面这些不是“也许”，而是我认为当前系统里最真实的断点。

### P0-1 Web chat 的 session 级上下文缓存没有跨轮次生效

现象：

- `SessionContext` 支持 `prompt_prefix`、`active_packs`、`recent_files`、`active_skills`。
- 但 web chat 每次 `call_llm()` 都重新 new 一个 `SessionContext(...)`。

影响：

- frozen prefix cache 主要只在 **单次 invocation 的多轮 tool loop** 里生效。
- 对用户连续多轮聊天来说，prompt cache、active packs、skill activation 不会真正跨轮次延续。
- 这直接削弱上下文稳定性、成本收益和工具延续性。

证据：

- `backend/app/runtime/session.py`
- `backend/app/api/websocket.py`
- `backend/tests/kernel/test_prompt_cache_integration.py`

判断：

- 这是 **真实运行时问题**，不是测试问题。
- 现有测试是通过手工复用同一个 `SessionContext` 来验证 cache 命中，但生产 web path 没这么做。

### P0-2 Async delegation 仍然不是可恢复的可靠运行时

现象：

- `delegate_async()` 会先写 DB record，但真正执行仍然是 `asyncio.create_task(...)`。
- in-flight 状态仍在 `_async_tasks` 这个进程内字典里。
- task 丢到别的进程、worker 重启、父进程重启时，都没有真正的恢复/接管机制。

影响：

- 背景 subagent 任务在进程重启时会丢。
- `check_async_task` 可以读 DB 看到一些状态，但这不等于任务真的还活着。
- `cancel_async_task` 遇到不在当前 worker 的任务时，只能返回 `not_running_here`。

证据：

- `backend/app/agents/orchestrator.py`
- `backend/app/services/runtime_task_service.py`
- `backend/app/services/agent_tool_domains/messaging.py`

判断：

- 这已经比纯内存版本强很多，但依然不是“上线级多 worker subagent runtime”。
- 如果后续要大量依赖 coordinator + background workers，这个点必须优先补。

### P0-3 Heartbeat 仍然缺少 in-flight lease / 单 agent 互斥

现象：

- `_heartbeat_tick()` 直接 `asyncio.create_task(_execute_heartbeat(agent.id))`
- 触发前没有给 agent 打“heartbeat 正在执行”的 lease
- `last_heartbeat_at` 是在 heartbeat 完成后，或者异常时，才更新

影响：

- 长 heartbeat 或短 interval 下，存在同一个 agent 被重复并发 heartbeat 的风险。
- 这类重入最容易放大 token 消耗、重复写 evolution、重复发消息。

证据：

- `backend/app/services/heartbeat.py`

判断：

- 这是当前自动执行链路里最实际的鲁棒性缺口之一。
- trigger daemon 对 trigger 的状态预更新比 heartbeat 更稳，heartbeat 反而还留在弱互斥模型。

### P0-4 没有真正的全链路 E2E 测试守住生产契约

现象：

- 现有测试很多是 unit/integration，质量不低。
- 但缺少一条真实覆盖：
  - HR agent 建人
  - 首次初始化
  - 发一条真实对话消息
  - 触发工具
  - memory/persist
  - trigger/heartbeat
  - evolution writeback

影响：

- “局部全绿，但真实链路断在接口拼接处”这种问题仍然可能漏过。
- 前面发现的 `SessionContext` 问题，本质上就是测试模型和真实入口不一致。

证据：

- 测试分布在 `backend/tests/*`，但没有完整端到端流水线。
- `backend/tests/kernel/test_prompt_cache_integration.py` 证明了测试容易高估真实缓存命中。

判断：

- 这不是代码 bug，但它是上线前必须补的工程缺口。

### P1-1 Provisioning/初始化路径不统一，长期会漂

现象：

- 现在至少有四套建 agent 路径：
  - `/agents/system/hr` + HR agent 聊天
  - `create_digital_employee`
  - `POST /agents`
  - `auto_provision.ensure_main_agent()`
  - 以及 `seed_default_agents()`

影响：

- 默认文件、skills、tools、heartbeat 初始化规则容易漂移。
- 新增一个初始化步骤时，很容易只补了一条路径。

证据：

- `backend/app/api/agents.py`
- `backend/app/tools/handlers/hr.py`
- `backend/app/services/auto_provision.py`
- `backend/app/services/agent_seeder.py`

判断：

- 这是当前“创建成功但后续体验不一致”的重要根因之一。

### P1-2 create_digital_employee 成功协议过于脆弱

现象：

- `create_digital_employee` 返回的是人类可读字符串。
- 前端成功 banner 靠正则从 tool result 里匹配 `ID: <uuid>`。

影响：

- 一旦 tool 文案改了，前端“创建成功跳转”就会悄悄失效。
- 这是典型的字符串协议断点。

证据：

- `backend/app/tools/handlers/hr.py`
- `frontend/src/pages/AgentDetail.tsx`

判断：

- 运行不一定会挂，但产品链路很脆。
- 应改成结构化 tool payload 或专门事件。

### P1-3 Memory rerank 代码存在，但生产路径没接上

现象：

- `MemoryRetriever.retrieve()` 支持 `rerank_model_config`
- `_rerank_semantic_items()` 也已经写完
- 但 `build_memory_context()` 调用 retriever 时没有传 rerank 配置

影响：

- 当前 semantic recall 主要还是 lexical overlap + recency。
- 在真实复杂任务中，memory 命中质量会低于代码表面上能做到的水平。

证据：

- `backend/app/memory/retriever.py`
- `backend/app/services/memory_service.py`

判断：

- 这是典型的“能力已实现，但没接到生产链路”的差距。

### P1-4 记忆源头是双轨的，容易重复或冲突

现象：

- `build_agent_context()` 还会把 `memory/memory.md` 读进 system prompt
- 同时 runtime 还会通过 `build_memory_snapshot()` 注入 structured memory

影响：

- 同一个事实可能在 `memory.md` 和 semantic memory 里重复出现
- 更糟的是两边可能相互矛盾
- 这会放大 prompt 体积，也会让模型看到“双份不同版本的记忆”

证据：

- `backend/app/services/agent_context.py`
- `backend/app/runtime/invoker.py`

判断：

- 这是 memory 设计上还没完全收敛的地方。

### P1-5 Frozen prefix 的边界还不纯

现象：

- `build_agent_context()` 把 `Current Time`、active triggers、company/org 信息都拼进 agent context
- kernel 把这个结果视作 frozen prefix 的一部分

影响：

- prefix 中混入了部分波动信息，cache purity 不够高。
- 这会降低真正的 prefix cache 命中价值，也让边界更难观测。

证据：

- `backend/app/services/agent_context.py`
- `backend/app/runtime/prompt_builder.py`
- `backend/app/kernel/engine.py`

判断：

- 这不是立即阻断，但会限制 context engineering 的进一步优化。

### P1-6 Native agent 初始化仍然耦合到可选 container sidecar

现象：

- 新建 `agent_type="native"` 的 agent，仍然会执行 `agent_manager.start_container()`
- 但当前真实 native runtime 并不依赖这个容器才能工作
- 日志里也显示 `Docker not available — agent containers will not be managed`，系统依然正常启动

影响：

- agent 生命周期契约不够清晰
- 创建链路带了不必要的外部依赖和状态分叉

证据：

- `backend/app/api/agents.py`
- `backend/app/tools/handlers/hr.py`
- `backend/app/services/agent_manager.py`
- `.data/log/backend.log`

判断：

- 更像架构债，不一定马上炸，但会持续制造“为什么这个 agent 需要 container”这样的混乱。

### P2-1 Trigger daemon 是主路径，但老 scheduler/reminder 还在仓库里

现象：

- `main.py` 启动的是 `trigger_daemon`
- `scheduler.py`、`supervision_reminder.py` 仍然保留

影响：

- 不懂上下文的人很容易读错主路径
- 维护成本高，未来容易在旧模块上修 bug 修错地方

证据：

- `backend/app/main.py`
- `backend/app/services/trigger_daemon.py`
- `backend/app/services/scheduler.py`
- `backend/app/services/supervision_reminder.py`

### P2-2 启动时 skill seeder 仍会扫到 `__pycache__`

现象：

- backend 启动日志里还有多条 `Skipping binary file: scripts/__pycache__/...pyc`

影响：

- 不是阻断，但说明 seed 目录扫描还不够干净

证据：

- `.data/log/backend.log`

## 6. 我对当前系统的实际评级

### 6.1 分维度评级

- HR-agent 创建体验：`7/10`
- Agent 初始化一致性：`6/10`
- Web 对话执行：`8/10`
- 上下文/压缩机制：`8/10`
- 记忆检索质量：`7/10`
- 工具调用/能力扩展：`8/10`
- Trigger 自动执行：`7.5/10`
- Heartbeat / feedback / evolution：`6.5/10`
- Async multi-agent orchestration：`6/10`

### 6.2 总体评级

- **“能否顺利运行”**：`是`
- **“能否支撑真实任务落地”**：`大部分可以`
- **“是否已经达到高鲁棒 agent 工程标准”**：`还没有`

我会把当前整体状态定义成：

> **上线可用，但离高可靠 agent runtime 仍差两层工程化。**

第一层差距是 runtime contract：

- session continuity
- subagent durability
- heartbeat mutual exclusion
- structured HR success contract

第二层差距是 engineering maturity：

- 真正的 E2E
- 初始化路径收敛
- memory source 收敛
- cache boundary purity

## 7. 优先级建议

### P0 先做

1. 把 `SessionContext` 从“单次调用对象”升级成真正的会话对象，至少在 web chat 跨轮次复用。
2. 给 heartbeat 加 per-agent lease / in-flight guard，避免并发 heartbeat。
3. 把 async delegation 从进程内 task 升级成真正可恢复的 worker runtime，或者明确收窄为单进程能力并加产品限制。
4. 补一条真实 E2E：HR create -> first chat -> tool call -> memory persist -> trigger/heartbeat -> evolution writeback。

### P1 接着做

1. 收敛 provisioning：`create_agent / create_digital_employee / auto_provision / seed_default_agents` 共用一套 initializer。
2. 把 HR 创建成功返回改成结构化 payload/event，不再靠字符串 regex。
3. 接通 memory rerank 的生产配置。
4. 收敛 memory 源，只保留一套主记忆通道，另一套降级为补充或迁移掉。
5. 清理 frozen prefix 边界，把 volatile context 从 prefix 里剥出去。
6. 澄清 native agent 与 container sidecar 的契约。

### P2 再做

1. 删除或归档旧 `scheduler.py / supervision_reminder.py`
2. 清理 skill seed 对 `__pycache__` 的扫描噪音
3. 补更细的 runtime observability dashboard

## 8. 最后的诚实判断

如果你的问题是：

> “这个系统现在是不是已经完全没有断点、agent 可以稳定做真实任务并自我进化？”

答案是：**不是。**

如果你的问题是：

> “这个系统现在是不是已经从‘一堆概念功能’走到了‘真实可运行的 agent 平台’，并且断点已经缩到少数关键工程问题上？”

答案是：**是。**

最该警惕的不是“没有 memory / 没有 compaction / 没有 heartbeat”，而是：

- 这些能力现在已经大多存在
- 但它们之间还没有被完全打磨成一个统一、稳定、可恢复、可验证的 runtime contract

这也是当前项目和 Claude Code 那类工程化 agent runtime 的真正差距所在。
