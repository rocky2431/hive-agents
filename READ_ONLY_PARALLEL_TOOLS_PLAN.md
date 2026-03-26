# Read-only Parallel Tools Plan

## 目标

把当前 kernel 中“同一轮多个 tool call 顺序执行”的模式，升级成：

- 只读工具自动并行
- 写工具仍然串行
- 事件流与结果顺序保持稳定

目标很明确：

1. 降低用户等待时间
2. 不牺牲执行可解释性
3. 不引入高风险并发副作用

## 当前状态

真实执行位置：

- [engine.py](/Users/rocky243/vc-saas/Hive/backend/app/kernel/engine.py)
- [service.py](/Users/rocky243/vc-saas/Hive/backend/app/tools/service.py)
- [runtime.py](/Users/rocky243/vc-saas/Hive/backend/app/tools/runtime.py)

当前行为：

- 一个 round 内如果模型返回多个 tool calls
- kernel 仍然按 `for tc in response.tool_calls` 顺序执行
- 没有 safe batch 判断
- 没有并发控制

## 非目标

这轮不做：

- 写工具并行
- 跨 round 并行
- 多 agent 并发调度
- 工具级 speculative execution

## 设计原则

1. **只并行只读工具**
2. **任何有副作用的工具保持串行**
3. **任何工具治理拦截仍然逐个生效**
4. **输出顺序稳定**
   - 即使并行执行，也按原 tool call 顺序写回 tool results

## 工具分层

### A. 永远可并行

- `read_file`
- `glob_search`
- `grep_search`
- `read_document`
- `list_files`
- `list_triggers`
- `web_search`
- `jina_search`
- `jina_read`

### B. 永远串行

- `write_file`
- `edit_file`
- `delete_file`
- `execute_code`
- `load_skill`
- `tool_search`
- `discover_resources`
- `import_mcp_server`
- `set_trigger`
- `update_trigger`
- `cancel_trigger`
- `send_message_to_agent`
- `send_channel_file`
- `send_feishu_message`

### C. 后续再评估

- `read_webpage`
- 某些 MCP 只读工具

## 目标设计

### 1. Tool Definition 增加执行属性

在 [types.py](/Users/rocky243/vc-saas/Hive/backend/app/tools/types.py) 增加：

```python
@dataclass(slots=True)
class ToolDefinition:
    name: str
    description: str
    parameters: dict[str, Any]
    category: str
    raw_schema: dict[str, Any]
    read_only: bool = False
    parallel_safe: bool = False
```

### 2. Registry 提供能力判断

在 [registry.py](/Users/rocky243/vc-saas/Hive/backend/app/tools/registry.py) 增加：

- `is_parallel_safe(name)`
- `is_read_only(name)`

### 3. Kernel 提供 batch executor

在 [engine.py](/Users/rocky243/vc-saas/Hive/backend/app/kernel/engine.py) 中新增：

- `_execute_tool_batch_sequential(...)`
- `_execute_tool_batch_parallel(...)`
- `_can_parallelize_tool_batch(tool_calls, tools_for_llm)`

### 4. 并发控制

使用：

- `asyncio.gather`
- `asyncio.Semaphore(max_parallel=4)`

只允许一个 round 内最多 4 个并发工具。

## 执行算法

### 1. 先判断 batch 是否可并行

条件：

- batch 内所有工具都 `parallel_safe=True`
- 没有 `load_skill`
- 没有 `import_mcp_server`
- 没有写操作

### 2. 并行执行时仍逐个做治理

每个工具内部仍然经过：

- runtime resolver
- governance runner
- actual executor

只是不再按顺序阻塞。

### 3. 结果写回顺序固定

即使并行执行，也按 LLM 原始 tool call 顺序：

1. 发 `running`
2. 收集结果
3. 按原顺序 append 回 `api_messages`

## 实施阶段

### Phase 1: Metadata

改动文件：

- [types.py](/Users/rocky243/vc-saas/Hive/backend/app/tools/types.py)
- [registry.py](/Users/rocky243/vc-saas/Hive/backend/app/tools/registry.py)

### Phase 2: Kernel Batch Execution

改动文件：

- [engine.py](/Users/rocky243/vc-saas/Hive/backend/app/kernel/engine.py)

### Phase 3: 扩大白名单

后续根据稳定性把更多读工具纳入。

## TDD 计划

先写这些测试：

1. `backend/tests/kernel/test_parallel_tool_batch.py`
   - 两个只读工具同 round 并行执行
   - 总耗时小于顺序执行

2. `backend/tests/kernel/test_parallel_tool_order.py`
   - 并行执行后 tool result 仍按原顺序写回

3. `backend/tests/kernel/test_parallel_tool_guardrails.py`
   - 只要 batch 中有写工具，整个 batch 回退串行

4. `backend/tests/kernel/test_parallel_tool_events.py`
   - `running/done` 事件仍完整可见

## 验收标准

1. `read_file + grep_search` 同轮可并行
2. `read_file + write_file` 自动回退串行
3. 并行执行不会破坏 tool result 顺序
4. governance 结果与串行时一致
5. `pytest -q backend/tests` 全绿

## 预期收益

1. 多读取场景显著降延迟
2. 保持最小风险，不碰写操作并发
3. 为后续更完整的资源预算调度打基础
