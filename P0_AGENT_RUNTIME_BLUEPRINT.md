# P0 Agent Runtime 蓝图

## 目标

把 Hive 当前的 agent-to-agent 和 delegation 能力，从：

- 一次性 request-response
- 进程内 async helper
- 零散的 prompt/cache 优化

升级成：

- **可持久化的 subagent runtime**
- **可恢复的 worker lifecycle**
- **可继承的 cache-safe context contract**
- **可观测的任务与事件协议**

这份蓝图只覆盖 P0，不扩展到 typed memory、hooks 平台、coordinator mode 本体。


## 设计原则

### 1. 不复用业务 Task 模型

当前的 [task.py](/Users/rocky243/vc-saas/Clawith/backend/app/models/task.py) 是业务任务，不是 runtime worker。

它解决的是：

- 待办任务
- 督办任务
- 定时执行任务

它不适合承载：

- subagent 生命周期
- prompt/cache 元数据
- 父子任务关系
- resume/continue/wait/stop
- runtime event log

**结论：P0 必须新增 runtime task 模型，不要硬复用现有 `Task` / `TaskLog`。**

### 2. 保留现有 `send_message_to_agent`

当前 [communication.py](/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/communication.py) 的 `send_message_to_agent` 和 [messaging.py](/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_tool_domains/messaging.py) 的实现，已经被系统和 agent prompt 使用。

P0 不应该直接删掉它，而应该：

- 保持 schema 兼容
- 内部改成 `spawn + wait` 的 sync wrapper

这样能减少回归面。

### 3. 大对象走文件，状态索引走 DB

Hive 本身就是 file-based workspace 平台。

因此 P0 建议：

- **状态索引、查询字段、父子关系放 DB**
- **rendered prompt / state blob / event transcript 放 workspace 文件**

原因：

- DB 适合查状态和过滤
- 文件适合大文本和调试恢复
- 和现有 `AGENT_DATA_DIR` 体系一致


## P0 输出范围

P0 完成后，Hive 应该具备以下能力：

1. 主 agent 可以启动后台 worker，并得到稳定 `task_id`
2. worker 状态可跨进程、跨重启查询
3. 主 agent 可以继续、等待、停止、恢复某个 worker
4. worker 的关键上下文状态可持久化
5. worker completion / failure / progress 可通过统一 event surface 回到 websocket/chat
6. `send_message_to_agent` 仍可工作，但底层走新 runtime
7. prompt-too-long 可 reactive compact + retry
8. system prompt budget 按模型上下文窗口动态分配


## 一、数据模型

## 1. `agent_runtime_tasks`

建议新增模型文件：

- `backend/app/models/agent_runtime_task.py`

建议表名：

- `agent_runtime_tasks`

建议字段：

```python
id: UUID PK
tenant_id: UUID NOT NULL

root_task_id: UUID NULL
parent_task_id: UUID NULL

owner_agent_id: UUID NULL
target_agent_id: UUID NULL
initiator_user_id: UUID NULL

parent_session_id: str NULL
session_id: str NOT NULL
trace_id: str NOT NULL

entrypoint: str NOT NULL
mode: str NOT NULL              # sync | async | resume
status: str NOT NULL            # queued | running | waiting | completed | failed | cancelled | timed_out

description: str NOT NULL
prompt_excerpt: str NULL
result_excerpt: str NULL
error_excerpt: str NULL

tool_pool_fingerprint: str NULL
prompt_fingerprint: str NULL
memory_fingerprint: str NULL

state_dir: str NULL
metadata_json: JSON NULL

started_at: datetime NULL
finished_at: datetime NULL
created_at: datetime NOT NULL
updated_at: datetime NOT NULL
```

索引建议：

- `(tenant_id, created_at desc)`
- `(target_agent_id, status)`
- `(owner_agent_id, status)`
- `(parent_task_id)`
- `(trace_id)`
- `(session_id)`

说明：

- `root_task_id` 用来追踪整棵子任务树
- `parent_task_id` 用来支持 resume / continue / coordinator fan-out
- `state_dir` 指向文件系统状态目录
- `tool_pool_fingerprint` / `prompt_fingerprint` 用于 cache-safe restore


## 2. `agent_runtime_events`

建议新增模型文件：

- `backend/app/models/agent_runtime_event.py`

建议表名：

- `agent_runtime_events`

建议字段：

```python
id: UUID PK
task_id: UUID NOT NULL
tenant_id: UUID NOT NULL

seq: int NOT NULL
event_type: str NOT NULL        # task_started | task_progress | tool_call | task_waiting | task_completed | task_failed | task_cancelled | task_resumed
status: str NULL
title: str NULL
summary: str NULL

payload_json: JSON NULL

created_at: datetime NOT NULL
```

索引建议：

- `(task_id, seq)`
- `(tenant_id, created_at desc)`

说明：

- DB 里只保留事件索引和必要摘要
- 大块输出仍然进 `state_dir/events.jsonl`


## 3. `agent_runtime_sidechains`

如果你想把状态目录完全文件化，也可以不建这张表；但我更建议建一个轻量 sidechain 索引表。

建议新增模型文件：

- `backend/app/models/agent_runtime_sidechain.py`

建议字段：

```python
task_id: UUID PK
tenant_id: UUID NOT NULL

rendered_system_prompt_path: str NULL
replacement_state_path: str NULL
transcript_path: str NULL
tool_pool_snapshot_path: str NULL
last_checkpoint_path: str NULL

created_at: datetime NOT NULL
updated_at: datetime NOT NULL
```

这张表的价值：

- resume 时不用猜文件结构
- 后续可以迁移到对象存储而不改调用方


## 4. 状态目录布局

每个 runtime task 的文件目录建议：

```text
<AGENT_DATA_DIR>/<target_agent_id>/runtime/tasks/<task_id>/
  metadata.json
  rendered_system_prompt.txt
  tool_pool_snapshot.json
  replacement_state.json
  checkpoint.json
  events.jsonl
  transcript.jsonl
  result.txt
```

其中：

- `metadata.json`：task 固定元数据镜像
- `rendered_system_prompt.txt`：cache-safe resume 的关键输入
- `tool_pool_snapshot.json`：exact tool inheritance
- `replacement_state.json`：后续 tool-result budget 状态
- `checkpoint.json`：resume 需要的小状态
- `events.jsonl`：调试和恢复
- `transcript.jsonl`：可选，保留 worker 的内部对话片段


## 二、运行时 contract

## 1. `SessionContext` 扩展

当前 [session.py](/Users/rocky243/vc-saas/Clawith/backend/app/runtime/session.py) 太薄。

建议新增字段：

```python
runtime_task_id: str | None = None
parent_runtime_task_id: str | None = None
root_runtime_task_id: str | None = None

tool_pool_fingerprint: str | None = None
rendered_system_prompt_path: str | None = None
replacement_state_path: str | None = None
state_dir: str | None = None

entrypoint: str | None = None   # websocket | task | delegation | runtime_tool
```

目的：

- 把当前 session 和 runtime task 绑定
- 让 engine / invoker / websocket 拿到统一上下文


## 2. `InvocationRequest` 扩展

当前 [contracts.py](/Users/rocky243/vc-saas/Clawith/backend/app/kernel/contracts.py) 的 `InvocationRequest` 不够表达 worker runtime 语义。

建议新增字段：

```python
runtime_task_id: uuid.UUID | None = None
parent_runtime_task_id: uuid.UUID | None = None

exact_tool_snapshot: list[dict] | None = None
rendered_system_prompt: str | None = None

resume_from_checkpoint: dict | None = None
replacement_state: dict | None = None
```

设计意图：

- `exact_tool_snapshot`：resume / fork 时不再重新按 DB 计算工具集
- `rendered_system_prompt`：resume / child fork 时不再重新拼 prompt
- `replacement_state`：后续为 tool-result budget state 留口子


## 3. `AgentKernel` event contract 扩展

当前 [chat_message_parts.py](/Users/rocky243/vc-saas/Clawith/backend/app/services/chat_message_parts.py) 只有：

- `permission`
- `session_compact`
- `pack_activation`

P0 至少要新增：

- `task_started`
- `task_progress`
- `task_waiting`
- `task_resumed`
- `task_completed`
- `task_failed`
- `task_cancelled`

建议统一 part 结构：

```json
{
  "type": "event",
  "event_type": "task_completed",
  "title": "Worker Completed",
  "text": "Task xyz completed",
  "status": "success",
  "task_id": "uuid",
  "parent_task_id": "uuid",
  "target_agent_id": "uuid",
  "summary": "short summary"
}
```


## 三、工具面设计

## 1. 保留兼容工具

继续保留：

- `send_message_to_agent`

内部重写成：

- 创建 runtime task
- 启动 worker
- wait 到完成或超时
- 返回结果

这样上层 prompt 和已有技能不需要立刻改。


## 2. 新增 worker runtime tools

建议新增文件：

- `backend/app/tools/handlers/agent_runtime.py`

建议新增工具：

### `spawn_agent`

用途：

- 启动一个后台 worker

建议参数：

```json
{
  "target_agent_name": "string",
  "message": "string",
  "description": "string",
  "timeout_seconds": 120,
  "inherit_tools": true,
  "inherit_prompt_prefix": true
}
```

返回：

```json
{
  "task_id": "uuid",
  "status": "queued",
  "target_agent_name": "Morty"
}
```

### `send_input`

用途：

- 继续一个已有 worker

参数：

```json
{
  "task_id": "uuid",
  "message": "string"
}
```

### `wait_agent`

用途：

- 等待某个 worker 完成

参数：

```json
{
  "task_id": "uuid",
  "timeout_seconds": 30
}
```

### `stop_agent`

用途：

- 停掉正在执行的 worker

参数：

```json
{
  "task_id": "uuid"
}
```

### `resume_agent`

用途：

- 恢复一个可恢复的 worker

参数：

```json
{
  "task_id": "uuid"
}
```

### `list_agent_tasks`

用途：

- 查看当前可见 worker

参数：

```json
{
  "status": "running"
}
```


## 3. `CORE_TOOL_NAMES` 调整

当前 [agent_tools.py](/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_tools.py) 的 core tool 里只有：

- `send_message_to_agent`

P0 建议逐步改成：

第一阶段保守方案：

- 继续保留 `send_message_to_agent`
- 新增 `spawn_agent`
- 新增 `wait_agent`
- 新增 `stop_agent`
- `send_input` / `resume_agent` 先不进 core，按 skill/policy 暴露

这样风险更低。


## 四、服务分层

## 1. 新增 `RuntimeTaskService`

建议新增：

- `backend/app/services/runtime_task_service.py`

负责：

- create task
- append event
- update status
- write state dir
- load checkpoint
- list visible tasks

它应该是 P0 的核心服务，不要把逻辑散落在：

- orchestrator
- messaging
- websocket


## 2. `orchestrator.py` 收敛成执行器，不再做状态源

当前 [orchestrator.py](/Users/rocky243/vc-saas/Clawith/backend/app/agents/orchestrator.py) 的问题是：

- `_async_tasks` 是事实状态源

P0 改造目标：

- 让 DB + state_dir 成为事实状态源
- `orchestrator.py` 只负责：
  - 调度
  - 启动后台协程
  - 响应 stop/cancel

换句话说：

**orchestrator 应该从 registry 退化成 executor。**


## 3. `messaging.py` 收敛成 compatibility layer

当前 [messaging.py](/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_tool_domains/messaging.py) 里 `_send_message_to_agent()` 直接做了：

- session 查找
- 历史拼接
- invoke_agent
- 写入 ChatMessage

P0 后建议变成：

- 兼容层把 request 转成 `spawn_agent(..., mode='sync')`
- 等待完成
- 把 worker 结果映射回原返回值

这样 agent-to-agent 和 worker runtime 才不会变成两套系统。


## 五、cache-safe 子代理 contract

## 1. 先做最小版本，不追 Claude Code 全量

P0 不需要一次做完 Claude Code 那整套 `contentReplacementState`，但要先把关键支点打进去：

### 必做

- 持久化 `rendered_system_prompt`
- 持久化 `tool_pool_snapshot`
- 持久化 `prompt_fingerprint`
- resume 时优先使用上述快照，而不是重新拼

### 暂缓

- 完整 replacement state 重建
- time-based microcompact
- cached cache-edit API

### 原因

如果 P0 一口气做太满，复杂度会爆炸。先把“子代理恢复后 prompt 尽量不漂移”解决掉，已经能拿到很大收益。


## 2. `invoker.py` 改造点

当前 [invoker.py](/Users/rocky243/vc-saas/Clawith/backend/app/runtime/invoker.py) 每次都动态构建：

- system prompt
- tool set

P0 应新增两条优先级规则：

1. 如果 `InvocationRequest.rendered_system_prompt` 存在，优先使用
2. 如果 `InvocationRequest.exact_tool_snapshot` 存在，优先使用

否则才走当前逻辑。


## 3. `engine.py` 改造点

当前 [engine.py](/Users/rocky243/vc-saas/Clawith/backend/app/kernel/engine.py) 已经有：

- prefix fingerprint
- aggregate tool budget
- tool eviction
- mid-loop compaction

P0 新增要求：

- 每次 runtime task 的关键 event 持久化
- `on_event` 同时写 websocket 和 runtime event store
- completion/failure 时生成标准 task outcome


## 六、PTL reactive retry + model-aware budget

## 1. reactive PTL retry

目标：

- 当 LLM 返回 prompt-too-long 类错误时，不直接失败
- 先压缩，再 retry 一次

建议位置：

- `backend/app/kernel/engine.py`

建议逻辑：

1. 捕获 provider error
2. 判断是否为 PTL / context overflow
3. 触发一次 reactive compact
4. 重建消息
5. retry 一次
6. 如果还失败，再返回错误

建议 event：

- `task_progress` 或 `session_compact` 增加 `reason: reactive_retry`


## 2. model-aware system prompt budget

当前 [prompt_builder.py](/Users/rocky243/vc-saas/Clawith/backend/app/runtime/prompt_builder.py) 的 `_SYSTEM_PROMPT_CHAR_BUDGET = 60000` 是固定值。

P0 建议：

- 把 budget 改成 `provider/model/max_input_tokens` 驱动

建议规则：

```text
context_window <= 32k   -> system prompt budget ~ 18k chars
context_window <= 128k  -> system prompt budget ~ 60k chars
context_window > 128k   -> system prompt budget ~ 90k chars
```

更稳妥的做法：

- 先估算 token，而不是只按 chars


## 七、事件与 websocket 集成

当前 [websocket.py](/Users/rocky243/vc-saas/Clawith/backend/app/api/websocket.py) 已经能转发 runtime event，但只覆盖少数事件。

P0 建议：

- 统一通过 `runtime_event_to_ws` 分发 task event
- 把 task event 也写入 `ChatMessage(role='system')`
- 前端通过 `event_type` 区分展示

这样后续不需要专门再造一套 worker 通知通道。


## 八、迁移顺序

## Phase 1：建状态模型和服务

新增：

- `backend/app/models/agent_runtime_task.py`
- `backend/app/models/agent_runtime_event.py`
- `backend/app/models/agent_runtime_sidechain.py`
- `backend/app/services/runtime_task_service.py`
- alembic migration

不改 tool surface。

## Phase 2：把 orchestrator 改成 DB-backed

改造：

- `backend/app/agents/orchestrator.py`

目标：

- 去掉进程内 `_async_tasks` 作为事实状态源

## Phase 3：新增 worker runtime tools

新增：

- `backend/app/tools/handlers/agent_runtime.py`

接入：

- `get_combined_openai_tools()`
- `CORE_TOOL_NAMES` 或 pack policy

## Phase 4：兼容层改写

改造：

- `backend/app/services/agent_tool_domains/messaging.py`
- `backend/app/tools/handlers/communication.py`

目标：

- `send_message_to_agent` 内部切到新 runtime

## Phase 5：cache-safe contract

改造：

- `backend/app/runtime/session.py`
- `backend/app/kernel/contracts.py`
- `backend/app/runtime/invoker.py`
- `backend/app/kernel/engine.py`

## Phase 6：PTL retry + budget

改造：

- `backend/app/kernel/engine.py`
- `backend/app/runtime/prompt_builder.py`


## 九、测试蓝图

P0 上线前至少补这些测试。

## 1. Runtime task service

新增：

- `backend/tests/services/test_runtime_task_service.py`

覆盖：

- 创建 task
- 状态迁移
- 事件 append 顺序
- sidechain 路径落盘

## 2. Orchestrator

新增：

- `backend/tests/agents/test_runtime_worker_orchestrator.py`

覆盖：

- async spawn 后 DB 状态正确
- stop 后状态正确
- resume 使用 checkpoint

## 3. Messaging compatibility

新增：

- `backend/tests/services/test_agent_message_runtime_compat.py`

覆盖：

- `send_message_to_agent` 仍返回兼容格式
- 内部确实创建 runtime task

## 4. Kernel cache-safe behavior

新增：

- `backend/tests/kernel/test_subagent_cache_contract.py`

覆盖：

- `rendered_system_prompt` 优先级
- `exact_tool_snapshot` 优先级
- resume 不重新计算 prompt/tool pool

## 5. PTL retry

新增：

- `backend/tests/kernel/test_prompt_too_long_retry.py`

覆盖：

- 第一次 PTL
- 触发 compaction
- 第二次成功

## 6. Websocket event surface

新增：

- `backend/tests/api/test_websocket_runtime_task_events.py`

覆盖：

- task_started / task_completed / task_failed 序列化
- 事件写入 chat history


## 十、明确不做的内容

P0 不做：

- typed memory taxonomy
- hook runtime
- coordinator mode prompt
- team/private memory scope
- dream task
- 跨 agent prompt cache sharing的极致优化

P0 只做一个核心目标：

**先让 Hive 有一套真正能承载 worker、resume、cache-safe subagent 的 runtime 内核。**


## 最后一句

如果 P0 只能选一个中心对象来组织整个改造，我建议就是：

**`RuntimeTaskService`**

因为真正缺的不是更多 helper，而是一个稳定的状态中心。

