# Hive 上下文工程优化方案（校准版）

> 基于当前仓库代码现状重新校准。
> 目标不是复刻 Claude Code，而是在 Hive 现有架构上做最小风险、最高收益的上下文工程改进。
> 日期: 2026-04-01

---

## 一、校准结论

原方案的**方向大体正确**，但存在三个明显问题：

1. **低估了当前已有能力**
   Hive 不是“几乎没有上下文工程基础”，而是已经具备：
   - frozen/dynamic prompt split
   - session 级 prompt prefix cache
   - Anthropic `cache_control` hints
   - 4 层记忆检索
   - 会话结束后的 summary + fact extraction
   - 70% 预压缩 + 85% mid-loop compaction
   - large tool result eviction
   - post-compact restoration
   - minimal-by-default tool surface + delayed capability expansion
   - depth-limited sync/async agent delegation
   - heartbeat 驱动的 evolution writeback

2. **把“增强”写成了“从 0 到 1”**
   很多建议不是新系统，而是对现有系统的二次增强。比如：
   - 延迟工具加载：已部分存在，不应按全新系统估算
   - Post-compact 恢复：已存在，不应按从零设计估算
   - Evolution 闭环：已存在基础写回，只是还不够结构化

3. **优先级偏理想化，缺少现网可落地排序**
   真正适合先做的不是 `Coordinator Mode`、`Auto-Dream`、`Cross-Agent Cache Sharing`，而是：
   - Prompt-too-long 优雅降级
   - model-aware prompt budget
   - memory freshness warning
   - 上下文/压缩/缓存命中率观测

---

## 二、当前代码已具备的能力

以下结论均来自仓库当前实现，而不是方案假设。

### 2.1 Prompt 组装与缓存

当前已经有三层结构：
- Frozen Prefix: identity / soul / memory snapshot
- Dynamic Suffix: active packs / retrieval / suffix
- Per-turn Messages: 普通对话消息

已实现能力：
- `backend/app/runtime/prompt_builder.py`
  - `build_frozen_prompt_prefix()`
  - `build_dynamic_prompt_suffix()`
  - `assemble_runtime_prompt()`
- `backend/app/kernel/engine.py`
  - `SessionContext.prompt_prefix` 复用 frozen prefix
  - `_memory_hash` 变更时自动失效缓存
- `backend/app/services/llm_client.py`
  - Anthropic `cache_control: ephemeral` hints

当前缺口：
- system prompt 总预算仍是固定 `60000 chars`
- 没有 section-level invalidation
- 没有 cache hit rate / cache saved tokens 观测
- 没有跨 session / 跨 agent cache-safe prefix 机制

### 2.2 记忆系统

当前已经有四层检索：
- Working: `focus.md`
- Episodic: `ChatSession.summary`
- Semantic: `memory.sqlite3` / `memory.json`
- External: OpenViking

已实现能力：
- `backend/app/memory/retriever.py`: 四层检索与排序
- `backend/app/memory/assembler.py`: 分层组装与 budget trim
- `backend/app/services/memory_service.py`
  - 对话结束后生成 session summary
  - LLM fact extraction 或 fallback extraction
  - semantic memory merge / dedup / expiry
- `backend/app/memory/store.py`
  - SQLite + FTS5
  - legacy JSON 兼容
  - WAL / corruption recovery

当前缺口：
- 记忆没有显式类型字段（user/feedback/project/reference）
- relevance 选择仍是规则打分，没有 LLM/reranker 二次筛选
- 没有 freshness warning
- 没有团队级共享记忆
- 没有真正的“增量后台提取游标”机制

注意：原方案中“semantic_facts 无上限增长”这一判断不成立。当前 `_merge_memory_facts(..., max_facts=50, expiry_days=180)` 已经有限制。

### 2.3 压缩与淘汰

当前已经不是单层压缩：
- 对话入口压缩：`memory_service.maybe_compress_messages()`
  - 默认读取 tenant 配置，默认阈值 70%
- mid-loop compaction: `kernel/engine.py`
  - 每 3 轮检查一次
  - 85% 阈值触发
- large tool result eviction
  - 超大结果落盘到 `workspace/tool_results/`
  - inline 只保留 preview
- post-compact restoration
  - 自动恢复 `soul.md` 与 `focus.md`

当前缺口：
- 没有 PTL retry
- 没有“轻量级微压缩 old tool results by age”
- 恢复内容只有 soul/focus，没有 recent files / active skills / pack deltas
- 没有 compaction 成功率、恢复效果、丢失率观测

### 2.4 工具体系

当前已经有明显的渐进式披露：
- `CORE_TOOL_NAMES` 最小工具面
- `tool_search` 只返回延迟能力摘要
- `load_skill` / `import_mcp_server` / 读取 skill file 后按需扩展工具
- pack activation 会回写 active packs 并刷新 dynamic suffix

当前缺口：
- 缺少对“延迟加载节省了多少 token”的观测
- 没有通用 hook 机制
- skill catalog budget 控制仍偏粗

### 2.5 Agent 协调

当前已经有：
- sync delegation
- async delegation
- max depth 控制
- timeout 控制
- trace_id / parent metadata

当前缺口：
- delegation 状态仅在进程内 registry 中保留，不持久化
- 没有结构化 task lifecycle / token accounting / result summary 存储
- 没有 coordinator-only execution mode
- 没有跨 agent cache-safe prefix 共享

### 2.6 自我进化

当前已经有：
- heartbeat 读取 `evolution/scorecard.md` / `blocklist.md` / `lineage.md`
- activity pattern analysis
- heartbeat outcome 反写 scorecard / lineage
- crash 也会进入 evolution writeback

当前缺口：
- 仍然主要是文件化经验沉淀，不是结构化策略抽取
- 没有将 evolution 成果同步进入 typed semantic memory
- 没有 auto-dream 式后台合并

---

## 三、对原建议的校准

| 原建议 | 调整后判断 | 新优先级 | 说明 |
|--------|-----------|---------|------|
| 1.1 Dynamic Boundary | 保留，但不算从 0 到 1 | P1 | 当前已有 frozen/dynamic + cache hints，应做 finer-grained invalidation，而不是只加分隔符 |
| 1.2 Section Registry | 保留 | P2 | 有价值，但不应先于观测与 PTL retry |
| 1.3 上下文预算自适应 | 保留，缩小范围 | P0 | 重点是 `system prompt budget model-aware`，历史预算已部分自适应 |
| 2.1 后台记忆自动提取 | 保留，但降级 | P2 | 当前已在 session end 提取，下一步应先做增量游标，再考虑 perfect fork |
| 2.2 LLM 相关性选择 | 保留 | P1 | 建议 feature flag + cheap model/reranker，不要默认每轮强开 |
| 2.3 记忆新鲜度告警 | 保留 | P0 | 成本低、风险低、收益明确 |
| 2.4 记忆淘汰策略 | 删除原表述 | 已有基础 | 现有 `max_facts=50 + expiry` 已覆盖基础淘汰，应改成“typed retention policy” |
| 2.5 记忆类型化 | 强烈保留 | P1 | 是后续 private/team/reference 分流的基础 |
| 3.1 5-layer compaction | 拆分后保留 | P1 | 不建议一次性上 5 层，优先补 PTL retry 和 restoration 扩展 |
| 3.2 Post-Compact 恢复 | 保留，但改为增强现有实现 | P1 | 当前已有 soul/focus restore，下一步补 recent files / active skills |
| 3.3 PTL 优雅降级 | 强烈保留 | P0 | 这是当前最明确的缺口之一 |
| 4.1 Coordinator 模式 | 延后 | P3 | 在没有 task persistence 与 delegation observability 前容易放大复杂度 |
| 4.2 跨 Agent 缓存共享 | 延后 | P3 | 需要 byte-identical prefix discipline，工作量被低估 |
| 4.3 结构化任务追踪 | 保留 | P1 | 应先做 delegation persistence，再谈 coordinator |
| 5.1 延迟工具加载 | 改写 | P1 | 不是新系统，应改成“补齐缺口 + 增加指标” |
| 5.2 Skill 预算化截断 | 保留 | P2 | 小优化，但不是主矛盾 |
| 5.3 Hook 系统 | 延后 | P3 | 治理链路已足够，hook 应基于明确需求再扩展 |
| 6.1 Auto-Dream | 延后 | P3 | 更像平台级项目，不应排在一线稳定性问题之前 |
| 6.2 Evolution 反馈闭环 | 保留，但改成结构化 synthesis | P1 | 基础闭环已存在，缺的是“写回 semantic memory 的结构化经验” |
| 6.3 跨 Agent 知识共享 | 保留，但延后 | P3 | 需先解决记忆类型化与 secret hygiene |

---

## 四、修正版优先级

### P0: 应立即投入

#### 4.1 Prompt-Too-Long 优雅降级

目标：
- 捕获 provider 返回的超长错误
- 根据 token gap 或启发式估算，按 round 丢弃最旧消息组后重试
- 最多重试 2 到 3 次

原因：
- 这是明确缺口
- 对长会话稳定性直接有效
- 不依赖大规模架构改造

#### 4.2 Model-Aware System Prompt Budget

目标：
- 将 `prompt_builder.py` 的固定 `60000 chars` 改成按 `max_input_tokens` 派生的 budget
- 为不同 provider/model 设置最小/最大上限
- 与 history / tool / output reserve 协调

原因：
- 当前系统 prompt 预算确实不是 model-aware
- 多模型租户下收益确定

#### 4.3 Memory Freshness Warning

目标：
- semantic / episodic memory 注入时按时间增加 `verify before acting` 提示
- 默认阈值 1 天或 3 天可配置

原因：
- 小改动
- 直接减少使用过期记忆的风险

#### 4.4 可观测性补齐

至少增加以下指标：
- prompt prefix cache reuse count
- prompt prefix invalidation reason
- compaction trigger count / success count
- tool result eviction count
- average system prompt chars / estimated tokens
- memory context chars / history chars / tools chars 分布

原因：
- 当前文档中很多收益数字没有代码内证据
- 先做指标，后做大改，才知道优化是否真实生效

---

### P1: 第二阶段投入

#### 4.5 Typed Semantic Memory

建议字段：
- `category`: `user | feedback | project | reference | general`
- `confidence`
- `last_accessed_at`（可选）

收益：
- 为 retention policy、team sharing、feedback synthesis 打基础

#### 4.6 Relevance Rerank / Cheap Selector

建议：
- 先在 semantic top-N 后做 rerank
- 仅当候选超过阈值时触发
- 先走 feature flag

不要：
- 默认每轮多打一层昂贵 LLM
- 在没有 typed memory 前就做复杂 memory manifesto

#### 4.7 增强现有 Post-Compact Restore

在当前 `soul + focus` 基础上增加：
- 最近读取文件预览
- 当前 active skills 摘要
- 最近 pack activation 摘要

前提：
- 先把“最近读取文件”和“活跃 skill”事件记到 session/activity

#### 4.8 Delegation 持久化追踪

目标：
- 将 async delegation 从进程内 registry 升级为可持久化查询的 task record
- 记录 parent/child/trace/status/summary/tokens/duration

原因：
- 这是 coordinator mode 的前置条件
- 对排障和运营价值都高

#### 4.9 Evolution -> Structured Feedback Memory

目标：
- heartbeat 成功/失败后，把可复用策略抽取进 semantic memory
- 不再只写 scorecard/lineage 文本

原因：
- 现有 evolution 已有写回，但难以在对话期稳定重用

#### 4.10 补齐“已存在 delayed loading”的度量与边界

目标：
- 统计 core-only vs expanded tool count
- 统计 `tool_search` / `load_skill` / `import_mcp_server` 的触发率
- 明确哪些 pack 一定延迟、哪些一定常驻

原因：
- 当前不是没有 delayed loading，而是缺少量化和边界管理

---

### P2: 架构增强，谨慎推进

#### 4.11 增量后台记忆提取

建议路径：
1. 先做 cursor-based delta extraction
2. 再做 in-process background task
3. 最后再考虑 perfect-fork / shared prefix cache

原因：
- 当前已存在 session-end extraction
- 真缺口是“增量提取”和“不中断主链路”

#### 4.12 Team Memory

前置条件：
- typed memory 已上线
- secret scanning 策略明确
- tenant scope 与 access policy 明确

#### 4.13 Hook System

建议仅在下列需求出现时再做：
- 特定工具参数改写
- tool 级审计扩展
- 租户自定义 block / transform 规则

#### 4.14 Skill Catalog Budget Control

是合理的小优化，但不应挤占主链路稳定性工作。

---

### P3: 暂缓，不建议近期优先

#### 4.15 Coordinator Mode

结论：
- 不是不能做
- 但它应该建立在 delegation persistence、task lifecycle、token accounting、result summarization 之上

否则风险：
- 可观测性差
- 失败恢复差
- 复杂度上升快于收益

#### 4.16 Cross-Agent Prompt Cache Sharing

结论：
- 方向正确
- 当前工作量明显被低估

前置条件：
- byte-identical prompt prefix discipline
- exact tool schema discipline
- delegation worker 边界稳定
- cache metrics 先存在

#### 4.17 Auto-Dream

结论：
- 可以作为长期项目
- 但不应先于 PTL retry、budget、自观测、typed memory

---

## 五、建议实施路线图

### Phase 1: 稳定性与观测（1 个迭代）

- P0.1 PTL retry
- P0.2 model-aware system prompt budget
- P0.3 memory freshness warning
- P0.4 prompt/compaction/tool-eviction metrics

交付标准：
- 长对话不再因 PTL 直接失败
- dashboard / logs 可看到 prompt cache reuse 与 compaction 触发情况
- 不同模型的 system prompt budget 可解释

### Phase 2: 记忆质量（1 到 2 个迭代）

- P1.1 typed semantic memory
- P1.2 rerank / cheap selector
- P1.3 evolution -> structured feedback memory
- P1.4 richer post-compact restore

交付标准：
- memory 注入更可解释
- 过期信息有提示
- feedback 能进入可检索记忆而不是只留在 lineage 文本里

### Phase 3: 协调与平台化（按需）

- P1.5 delegation persistence
- P2.1 background delta extraction
- P2.2 team memory
- P3.1 coordinator mode
- P3.2 cross-agent cache sharing
- P3.3 auto-dream

交付标准：
- delegation 可追踪、可统计、可恢复
- 后台任务不污染主链路
- 高阶能力建立在已有指标和稳定性基础之上

---

## 六、明确不建议现在做的事

1. **不要把 delayed tool loading 当成全新系统重做**
   当前已经有 core-only + skill/pack expansion，应先补指标和边界。

2. **不要在没有 metrics 的情况下承诺 cache hit 提升 30% 或 token 节省 40%**
   先观测，再给收益结论。

3. **不要把 auto-dream 排到 P0**
   这不是一线稳定性缺口。

4. **不要先做 coordinator，再补任务追踪**
   顺序应该反过来。

5. **不要先做 cross-agent cache sharing**
   当前连 cache-safe prefix discipline 都还没有被显式建模。

---

## 七、最终判断

如果只用一句话概括：

**原方案的战略方向是对的，但战术排序需要重排。**

更准确的落地顺序应当是：

1. 先补稳定性缺口与观测
2. 再提升记忆质量与恢复质量
3. 最后再做 coordinator、team memory、auto-dream 这类平台级增强

这条路线更符合 Hive 当前代码现实，也更容易在每个阶段拿到可验证收益。
