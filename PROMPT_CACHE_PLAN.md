# Prompt Cache Plan

## 目标

把 Hive 当前“每次都全量重建 system prompt”的模式，升级成：

- `session 内冻结的 prompt 前缀`
- `每轮可变的动态尾部`
- `provider-aware cache hint`

这件事的目标不是单纯省 token，而是同时解决 3 个问题：

1. 降低重复输入成本
2. 稳定 prefix，减少同一 session 内的提示漂移
3. 为后续 memory engine 和 pack runtime 提供稳定的 prompt 容器

## 当前状态

当前链路的真实实现：

- [prompt_builder.py](/Users/rocky243/vc-saas/Hive/backend/app/runtime/prompt_builder.py)
- [engine.py](/Users/rocky243/vc-saas/Hive/backend/app/kernel/engine.py)
- [agent_context.py](/Users/rocky243/vc-saas/Hive/backend/app/services/agent_context.py)

当前问题：

1. `build_runtime_prompt()` 每次调用都重新拼接完整 system prompt
2. `memory_context` 和 `knowledge inject` 混在同一构建过程里，没有冻结边界
3. `active_packs` 已经是 runtime 状态，但它们现在还是直接拼进 prompt，而不是作为动态 suffix 管理
4. `llm_client` 没有把 prompt cache 作为一等能力来对待

## 非目标

这轮不做：

- capability / approval / security 语义重构
- 前端 prompt 可视化
- 完整的 compiled prompt system
- 跨 provider 的统一缓存层

## 目标设计

引入 `PromptEnvelope` 概念，把 prompt 分成 3 层：

1. `Frozen Prefix`
   - session 内稳定
   - 构成 Anthropic/OpenAI 等 provider cache 的主前缀

2. `Dynamic Runtime Suffix`
   - 每轮允许变化
   - pack 激活、最新 recall、临时任务提示都在这里

3. `Per-turn Messages`
   - 正常消息、tool call、tool result

### Frozen Prefix 包含

- Agent identity / soul / role
- stable skill catalog
- kernel tools catalog
- session-start memory snapshot
- workspace/static notes

### Dynamic Runtime Suffix 包含

- `active_packs`
- 当前 invocation 的 retrieval results
- compaction hints
- `system_prompt_suffix`

## 设计原则

1. **session 冻结**
   - 同一个 `session_id` 第一次进入 kernel 时生成 frozen prefix
   - 同 session 后续调用直接复用

2. **写入不回写前缀**
   - 中途 `memory`/`focus` 写盘不重建 frozen prefix
   - 只影响下一 session 或显式 refresh

3. **provider-aware，但 fallback 优雅**
   - Anthropic：优先加 cache 控制提示
   - 其他 provider：至少复用本地 prompt snapshot，哪怕不支持 server-side cache

4. **动态段显式可见**
   - `active_packs` 和 retrieval 结果不许偷偷污染 frozen prefix

## 需要新增/改造的结构

### 1. `backend/app/runtime/session.py`

新增字段：

```python
@dataclass(slots=True)
class SessionContext:
    session_id: str | None = None
    source: str = "runtime"
    channel: str | None = None
    active_packs: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    prompt_snapshot_id: str | None = None
    prompt_prefix: str | None = None
    prompt_fingerprint: str | None = None
```

### 2. `backend/app/runtime/prompt_builder.py`

拆成 3 个函数：

- `build_frozen_prompt_prefix(...)`
- `build_dynamic_prompt_suffix(...)`
- `build_runtime_prompt(...)`

### 3. `backend/app/kernel/engine.py`

在 `handle()` 中增加：

- session 首次调用时生成 prefix
- 后续轮次只重建 dynamic suffix
- tool expansion 后不重建整个 prompt，只更新 dynamic suffix

### 4. `backend/app/services/agent_context.py`

拆出静态 section builder：

- identity
- workspace/static memories
- skill catalog
- kernel tool catalog

避免 `build_agent_context()` 继续承担所有动态拼接责任。

### 5. `backend/app/services/llm_client.py`

新增 provider cache hint 接口：

```python
def apply_prompt_cache_hints(messages: list[LLMMessage], provider: str) -> list[LLMMessage]:
    ...
```

## 实施阶段

### Phase 1: Session Prompt Snapshot

目标：

- 先做到 `session 内冻结`
- 不接 provider cache

改动文件：

- [session.py](/Users/rocky243/vc-saas/Hive/backend/app/runtime/session.py)
- [prompt_builder.py](/Users/rocky243/vc-saas/Hive/backend/app/runtime/prompt_builder.py)
- [engine.py](/Users/rocky243/vc-saas/Hive/backend/app/kernel/engine.py)

### Phase 2: Dynamic Suffix

目标：

- `active_packs`
- retrieval
- compaction
- runtime suffix

全部从 frozen prefix 中剥离。

改动文件：

- [prompt_builder.py](/Users/rocky243/vc-saas/Hive/backend/app/runtime/prompt_builder.py)
- [memory_service.py](/Users/rocky243/vc-saas/Hive/backend/app/services/memory_service.py)
- [knowledge_inject.py](/Users/rocky243/vc-saas/Hive/backend/app/services/knowledge_inject.py)

### Phase 3: Provider Cache Hints

目标：

- Anthropic prefix cache
- 其他 provider no-op fallback

改动文件：

- [llm_client.py](/Users/rocky243/vc-saas/Hive/backend/app/services/llm_client.py)

## TDD 计划

先写这些测试：

1. `backend/tests/runtime/test_prompt_cache.py`
   - 同 session 第二次调用不重建 frozen prefix
   - 新 session 会重建 frozen prefix

2. `backend/tests/runtime/test_prompt_suffix.py`
   - `active_packs` 只出现在 dynamic suffix
   - retrieval 变化不会改 frozen prefix

3. `backend/tests/runtime/test_prompt_cache_hints.py`
   - Anthropic provider 注入 cache hint
   - 非 Anthropic provider 不报错

### Red

先写断言：

- `build_frozen_prompt_prefix()` 结果在 session 内稳定
- `build_dynamic_prompt_suffix()` 会随 `active_packs` 变化

### Green

最小实现：

- session 上挂 `prompt_prefix`
- dynamic suffix 独立构建

### Refactor

- 清理 `build_runtime_prompt()` 责任
- 去掉 engine 里的重复重建逻辑

## 验收标准

1. 同一个 `session_id` 多轮调用时，静态 prefix 文本一致
2. `active_packs` 更新只影响动态段
3. memory 中途写盘不会重建 session prompt prefix
4. Anthropic provider 能接入 cache hint
5. `pytest -q backend/tests` 全绿

## 预期收益

1. 相同 session 的输入 token 成本明显下降
2. prompt 更稳定，调试更容易
3. 为 memory engine 升级提供稳定入口
4. 为后续意图路由和轻量聊天路径提供基础设施
