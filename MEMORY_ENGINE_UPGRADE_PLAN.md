# Memory Engine Upgrade Plan

## 目标

把 Hive 当前的 memory 从“兼容层 + 文件读取”升级成真正的 memory engine。

目标不是追求最复杂，而是做到：

1. 检索逻辑明确
2. memory 类型清晰
3. session 行为稳定
4. 逐步替换，不打断现有产品

最终方向：

- **更瘦的 OpenAkita**
  - 借它的 `UnifiedStore`、多层记忆、检索管线
- **更稳的 Hermes**
  - 借它的 frozen snapshot session memory

## 当前状态

当前关键文件：

- [memory/store.py](/Users/rocky243/vc-saas/Hive/backend/app/memory/store.py)
- [memory_service.py](/Users/rocky243/vc-saas/Hive/backend/app/services/memory_service.py)
- [prompt_builder.py](/Users/rocky243/vc-saas/Hive/backend/app/runtime/prompt_builder.py)

当前问题：

1. [store.py](/Users/rocky243/vc-saas/Hive/backend/app/memory/store.py) 只是 `Compatibility memory store`
2. semantic memory 仍主要来自 `memory.json` 最近 15 条
3. retrieval 没有独立排序/裁剪/组装层
4. working / episodic / semantic / external 还没有真正形成 pipeline
5. prompt 注入与 memory 构建耦合太紧

## 非目标

这轮不做：

- 企业权限边界
- OpenViking 安全隔离策略
- 前端 memory 面板重做
- 大规模向量数据库迁移

## 目标结构

### 1. 四层记忆

#### Working Memory

- `focus.md`
- 当前任务 scratchpad
- 临时工作态

#### Episodic Memory

- `ChatSession.summary`
- delegation summary
- compaction summary

#### Semantic Memory

- 结构化 facts
- 未来替换 `memory.json`

#### External Memory

- OpenViking recall
- 外部文档语义检索

## 设计原则

1. **session 内冻结快照**
   - 借 Hermes
   - session 开始时生成 memory snapshot
   - 中途写入不重构整段 prompt 前缀

2. **retrieval 是 pipeline，不是字符串拼接**
   - fetch
   - score
   - dedupe
   - assemble

3. **先兼容，后替换**
   - Phase 1 继续读现有 `memory.json` / `ChatSession.summary`
   - Phase 2 再引入 typed memory store

## 目标模块

### 1. `backend/app/memory/types.py`

补齐：

```python
class MemoryKind(StrEnum):
    WORKING = "working"
    EPISODIC = "episodic"
    SEMANTIC = "semantic"
    EXTERNAL = "external"

@dataclass(slots=True)
class MemoryItem:
    kind: MemoryKind
    content: str
    score: float = 0.0
    source: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
```

### 2. `backend/app/memory/store.py`

从当前的 file compatibility store 演进为接口层：

- `MemoryStore`
- `FileBackedMemoryStore`
- `HybridMemoryStore`

### 3. 新增 `backend/app/memory/retriever.py`

职责：

- query normalize
- fetch by layer
- recency + lexical + semantic merge

### 4. 新增 `backend/app/memory/assembler.py`

职责：

- budget 裁剪
- section render
- 去重

### 5. `backend/app/services/memory_service.py`

降级为 facade：

- `build_memory_context()` -> 改为调用 retriever + assembler
- `persist_runtime_memory()` -> 改为调用 typed store

## 检索流程

### 输入

- 当前 user message
- system prompt suffix
- active packs
- session metadata

### Step 1: Working Memory

优先注入：

- `focus.md`
- 当前任务摘要

### Step 2: Episodic Memory

优先级：

1. 当前 session summary
2. 前序 session summary
3. delegation summaries

### Step 3: Semantic Memory

策略：

- 关键词匹配
- recency
- 未来可加向量相似度

### Step 4: External Memory

策略：

- OpenViking / 外部检索
- 只拿 top-k

### Step 5: Assemble

输出形态：

```text
[Working memory]
...

[Relevant episodic memory]
...

[Relevant semantic memory]
...

[External recall]
...
```

## 存储演进

### Phase 1: Compatibility Adapter

继续沿用：

- `ChatSession.summary`
- `memory.json`
- `memory/memory.md`

但 retrieval 改成标准 pipeline。

### Phase 2: Typed Store

新增表：

- `memory_items`

字段建议：

- `id`
- `agent_id`
- `session_id`
- `kind`
- `content`
- `subject`
- `tags`
- `score`
- `created_at`
- `updated_at`
- `expires_at`
- `source`

### Phase 3: Hybrid Retrieval

在 typed store 基础上增加：

- lexical search
- vector search
- TTL / decay

## TDD 计划

先写这些测试：

1. `backend/tests/memory/test_retrieval_pipeline.py`
   - working / episodic / semantic / external 顺序正确

2. `backend/tests/memory/test_memory_snapshot.py`
   - session 内 memory snapshot 冻结
   - 中途写入不会影响 frozen prefix

3. `backend/tests/memory/test_semantic_selection.py`
   - 不再只是盲取最近 15 条
   - 会按 query 选相关 facts

4. `backend/tests/memory/test_memory_assembler.py`
   - budget 裁剪
   - 去重
   - 标题输出稳定

## 实施阶段

### Phase 1: Retrieval Pipeline

先不改底层存储，只把读取流程升级。

改动文件：

- [store.py](/Users/rocky243/vc-saas/Hive/backend/app/memory/store.py)
- [memory_service.py](/Users/rocky243/vc-saas/Hive/backend/app/services/memory_service.py)
- 新增 `retriever.py`
- 新增 `assembler.py`

### Phase 2: Session Snapshot

和 prompt cache 一起接：

- session start 构建 frozen memory snapshot
- runtime suffix 只显示动态 recall

### Phase 3: Typed Semantic Store

再引入 `memory_items` 表，逐步替换 `memory.json`

## 验收标准

1. retrieval 不再只是“读最近 15 条 facts”
2. working / episodic / semantic / external 四层顺序稳定
3. session 内 memory snapshot 稳定
4. `memory_service.py` 从主逻辑中心降级成 facade
5. `pytest -q backend/tests` 全绿

## 预期收益

1. memory 质量显著提高
2. prompt 更稳定
3. 为长期记忆和向量检索升级打基础
4. 不需要推翻当前产品即可逐步替换现有兼容层
