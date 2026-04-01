# Hive Agent Context / Memory / Tool / Evolution 优化方案（校正版 v2）

日期：2026-04-01  
范围：围绕业务效果优化，不为“极致工程化”而工程化。  
目标基线：以 `256k` 上下文模型为默认设计基线。  
依据：当前仓库真实代码、当前本地运行状态、当前测试基线。  
文档性质：面向落地的修正版路线图，不是概念性蓝图。  

---

## 1. 一句话结论

**Hive 当前已经不是“上下文 / 压缩 / 记忆 / 进化到处断裂”的状态。**

现在的真实情况是：

- 主链路已经打通
- 一部分旧断点已经被修复
- 仍然存在若干高价值但更具体的缺口
- 原方案把部分“已具备能力”继续当成“当前硬断点”，优先级偏重、偏旧

因此，本次方案不再按“推倒重做一个 Context Graph / Event Store 大系统”来写，而是按：

1. 已具备能力
2. 真实断点
3. 修正后的 P0 / P1 / P2
4. 具体改造文件与验收标准

来重新组织。

---

## 2. 当前系统的真实状态

以下结论均基于当前代码，不是基于历史印象。

### 2.1 已经明确具备的能力

当前系统已经具备这些基础能力：

1. `model-aware + task-aware` 的上下文预算
2. session 级 prompt cache 与 frozen prefix
3. memory snapshot + retrieval + external knowledge 的统一注入路径
4. `state-first` 倾向的压缩摘要，而不再只是纯 narrative summary
5. post-compaction restoration
6. adaptive memory recall 雏形
7. heartbeat 反馈写回 semantic memory
8. auto-dream 的持久化 gate 状态
9. minimal-by-default 的工具面与动态扩展能力

### 2.2 对应代码锚点

- 上下文预算与动态注入：`backend/app/runtime/context_budget.py`、`backend/app/runtime/invoker.py`
- 压缩摘要：`backend/app/services/conversation_summarizer.py`
- 记忆召回：`backend/app/services/memory_service.py`、`backend/app/memory/retriever.py`
- heartbeat 学习写回：`backend/app/services/heartbeat.py`
- auto-dream 持久化：`backend/app/services/auto_dream.py`

### 2.3 这意味着什么

这意味着当前真正的问题已经不是：

- “系统没有动态预算”
- “系统完全没有 state-first 压缩”
- “heartbeat 学习和 normal chat 完全断裂”
- “auto-dream 完全是内存态”

当前真正的问题是：

- 这些能力还不够强
- 若干关键链路还没有闭环
- 有些高价值上下文仍没有稳定进入长期记忆
- 某些恢复逻辑和配置链路仍有明确 bug 或缺口

---

## 3. 原方案中需要纠正的判断

### 3.1 不是当前硬断点，但原方案写得过重的项

以下项目需要降级为“现有能力仍可加强”，而不是继续定义为“当前硬断点”。

1. `summary-first`  
   当前压缩摘要已经包含 `Task / Decision / Artifact / Tool / Preference / Pending` ledger，不再只是叙述性 summary。

2. `256k 预算完全没有利用起来`  
   当前已经有按 `context_window_tokens` 和任务类型分配预算的实现，不是固定常量硬切。

3. `heartbeat 学习结果没有进入统一记忆入口`  
   当前 heartbeat outcome 已经写入 semantic memory，并会通过正常 memory retrieval 路径参与后续对话。

4. `auto-dream 是纯内存态`  
   当前 gate 状态已经落到 `auto_dream_state.json`，重启后仍会恢复。

### 3.2 仍然真实存在，且优先级高的项

这些是当前仍然成立的业务断点：

1. 最近文件恢复顺序有 bug
2. `rerank_model_id` 配置 API 没打通
3. tool result / file write / external read 还没有系统进入长期记忆主链
4. 中文 retrieval 的 lexical scoring 仍然偏弱
5. compaction 后恢复仍然偏薄，离“高保真恢复”还有差距
6. evolution 还不是真正统一的 event-native 管线

---

## 4. 当前最真实的业务断点

### 4.1 断点 A：最近文件恢复顺序错误

当前 `SessionContext.track_file_read()` 会把最新文件追加到列表末尾，只保留最后 5 个唯一文件。  
但 restoration 逻辑使用的是：

```python
reversed(session_context.recent_files[:3])
```

这会取“最旧的 3 个”再反转，而不是“最新的 3 个”。

结果：

- 压缩后恢复的不是最近最相关文件
- 长任务中恢复上下文会偏旧
- 工具调用后刚读过的关键文件不一定能回来

这是一个真实 bug，不是概念问题。

### 4.2 断点 B：memory rerank 有实现，但配置链不完整

当前 memory retrieval 逻辑已经支持 rerank model。  
但管理 API 里只暴露了 `summary_model_id`，没有把 `rerank_model_id` 暴露出来。

结果：

- 后端能力存在
- 租户级配置层无法真正启用这部分能力
- 线上行为和代码能力不一致

### 4.3 断点 C：工具结果没有进入长期记忆主链

当前 runtime 会：

- 跟踪部分工具行为
- 在 compaction 后恢复部分文件/技能

但还没有把以下高价值结果系统性沉淀进长期记忆：

1. `tool.result`
2. `write_file` 产生的产物摘要
3. `external.read` 或资料摄取结果
4. 结构化执行 outcome

结果：

- agent 做过事，但下一轮不一定“真正记住”
- “执行过”和“学到了”之间没有稳定桥梁
- 记忆抽取过度依赖 user/assistant message 文本

### 4.4 断点 D：中文检索质量仍然偏弱

当前语义召回并不完全是 embedding-first。  
在关键排序逻辑里，仍然有显著的 `.split()` 词重叠打分。

这对英文较友好，对中文场景存在天然劣势：

- 中文没有稳定空格分词
- 用户 query 与 memory fact 即使语义相关，也可能 overlap 很低
- 长中文任务更容易出现“明明记住了但召回不到”

### 4.5 断点 E：压缩已升级，但恢复仍然不够厚

当前摘要已经不是纯 narrative，但 restoration 仍主要恢复：

- 一小段 summary
- 最近文件
- active skills

这离“高保真任务恢复”还有距离。  
真正丢失的常见内容包括：

1. 关键 tool result 的结构化结论
2. 最近写入产物的摘要
3. 被采用或被拒绝的策略
4. 当前任务未完成的 pending queue
5. 最近外部阅读的证据引用

### 4.6 断点 F：evolution 已存在闭环，但还不够统一

当前 heartbeat、memory、auto-dream 之间已经有一部分联动。  
但 evolution 仍不是统一事件流：

- normal chat 的 learnings
- tool 执行后的 learnings
- heartbeat outcome
- trigger 执行结果

还没有统一成同一种“可检索、可去重、可投影”的事实结构。

所以当前系统还不能称为“完全自主自我进化”，更准确的说法是：

**它已经具备自我校正闭环，但还没有具备 policy-level 的统一自我进化系统。**

---

## 5. 修正后的设计原则

### 5.1 不推翻当前 runtime

当前 runtime 已经有足够多可复用的正确基础：

- `ContextBudget`
- `build_memory_snapshot`
- `build_memory_context`
- state-first summarizer
- heartbeat feedback writeback
- auto-dream consolidation

本轮优化应该是吸收式升级，而不是重造平行系统。

### 5.2 先修真实断点，再做重架构

如果当前 bug、恢复缺口、记忆摄取缺口没补齐，直接上完整 `Context Graph / Event Store`，收益不成比例。

### 5.3 Prompt 只是投影视图，不是真相源

这个方向仍然成立。  
但当前阶段不需要先做一套超重型 `Context Graph` 才能前进。

更现实的做法是先做：

1. richer structured memory ingestion
2. richer recovery manifest
3. adaptive projection quota

### 5.4 256k 要花在“高价值恢复”上

256k 不意味着把所有东西都塞进去。  
它意味着要更主动地把预算花在：

- 最近真实执行状态
- 高价值长期记忆
- 高信号反馈模式
- 最近外部证据
- pending work

而不是保守地做过早裁剪。

---

## 6. 修正后的优先级

## 6.1 P0：必须先完成的业务修复

### P0.1 修复 restoration 最近文件顺序 bug

目标：

- 恢复真正最近的 3 个文件，而不是最旧的 3 个

涉及文件：

- `backend/app/runtime/session.py`
- `backend/app/kernel/engine.py`
- `backend/tests/kernel/test_engine.py`

验收标准：

- 先读 A、B、C、D、E 后，restoration 只恢复 `E/D/C`

### P0.2 打通 `rerank_model_id` 配置链

目标：

- 租户 memory config 可以配置 rerank model
- UI/API/后端 retrieval 行为一致

涉及文件：

- `backend/app/api/memory.py`
- `backend/app/services/memory_service.py`
- `frontend/src/types/index.ts`
- `frontend/src/api/domains/...`（按实际前端入口）

验收标准：

- 通过 API 配置 rerank model 后，retriever 能拿到对应模型配置

### P0.3 把 tool/file/external 结果纳入长期记忆主链

目标：

- 不再只从 user/assistant 文本抽事实
- 至少把高价值 runtime outcome 纳入 structured memory ingestion

第一批应纳入的事件：

1. `tool.result`
2. `write_file`
3. `external.read`

建议做法：

- 不必先建完整 event store
- 先做轻量 `RuntimeMemoryEvent` 结构
- 在现有 memory extraction 前增加事件到 fact 的投影层
- `heartbeat outcome` 当前已存在写回 semantic memory 的旧路径，P0 不重复新增第二条写入链，只做兼容与对齐

涉及文件：

- `backend/app/kernel/engine.py`
- `backend/app/services/memory_service.py`
- `backend/app/services/heartbeat.py`
- `backend/app/services/agent_tool_domains/...`

验收标准：

- 工具执行后的高价值结论在下一轮 `build_memory_context()` 中能被召回

### P0.4 提升中文 retrieval 排序

目标：

- 让中文 query 对 semantic memory 的召回不再过度依赖空格词重叠

建议做法：

1. 采用中英双路 lexical scoring，而不是直接上更重的 n-gram
2. 英文路径继续保留现有 `.split()` 词重叠
3. 中文路径新增 character-level overlap 打分，用于弥补无空格分词场景
4. 最终取 `max(word_overlap, char_overlap)` 作为 lexical relevance
5. 同步修正 `_content_similar()`，避免检索打分改善了，但去重/相似判断仍然英文偏置
6. 继续保留 recency / category boost
7. 如果有 rerank model，再做二次精排

建议实现细则：

- query 明显包含 CJK 时才启用 character-level 路径
- 过滤空白和低价值标点，避免噪声字符抬分
- 这一阶段不引入额外中文分词库
- `n-gram` 可作为后续增强项，但不作为 P0 首选

涉及文件：

- `backend/app/memory/retriever.py`
- `backend/tests/...memory...`

验收标准：

- 中文 query 与相关中文 facts 的排序明显优于当前基线
- 英文 query 的既有排序行为不出现明显回退

### P0.5 扩厚 post-compaction restoration

目标：

- compaction 后恢复的不只是 summary + recent files + skills
- 增加最近 tool result、最近写入产物摘要、pending queue、关键外部引用

建议做法：

- 先做轻量 `RecoveryManifest`
- 从现有 `SessionContext.metadata` 和 runtime event 投影构建

涉及文件：

- `backend/app/runtime/session.py`
- `backend/app/kernel/engine.py`
- `backend/app/services/conversation_summarizer.py`

验收标准：

- 长任务压缩后，agent 能明显更稳定地续接未完成工作

---

## 7. P1：高价值增强，但不属于第一刀

### P1.1 轻量 Recovery Manifest

这不是新建超大系统，而是把以下项结构化：

- critical facts
- recent reads
- recent writes
- recent tool outcomes
- pending items
- active skills / active packs
- recent external refs

### P1.2 统一 evolution fact schema

把以下入口统一投影为 typed facts：

1. heartbeat success/failure
2. normal chat 的显式 learnings
3. tool 执行后的策略结论
4. trigger / automation outcome

统一后至少要支持：

- 去重
- 可检索
- freshness
- confidence
- category-aware injection

迁移原则：

- 以当前 heartbeat 已写入 semantic memory 的实现为兼容起点
- P1 落地后，heartbeat / tool / normal chat learnings 统一走同一投影 schema
- 避免在 P0 与 P1 之间出现双写、重复召回、重复 dream consolidation

### P1.3 预算精调 / 观测 / quota rebalance

当前预算已经具备 task-driven 基础，但精度仍不够高。  
下一步不是“从零做任务态预算”，而是对现有预算系统继续精调：

- 增加 section 级命中率与截断观测
- 校准 char/token 估算误差
- 重新平衡 retrieval / restore / memory / knowledge 的配额
- 按任务态继续微调：
  - coding 更重 recent files / pending / write artifacts
  - research 更重 external refs / source summary / evidence
  - operations 更重 trigger state / failure pattern / runbook memory

---

## 8. P2：仅在 P0/P1 完成后考虑

以下项目不是不做，而是不该抢在前面：

1. 完整 `Context Graph`
2. 完整 `Event Store`
3. 完整 prompt projection DSL
4. 更重的跨入口统一事实总线

这些方向在长期是正确的。  
但如果 P0/P1 还没落地，直接做它们，很容易出现：

- 系统更复杂
- 业务收益不及时
- 继续绕开当前真正的质量瓶颈

---

## 9. 与旧方案的整合方式

旧方案里这些主张继续保留：

1. Prompt 不是状态本体
2. 状态优先于摘要
3. 记忆不应只从文本对话抽取
4. heartbeat 不该是孤立学习系统
5. 256k 预算需要重分配

旧方案里这些内容需要改写：

1. 把“summary-first”改成“已部分 state-first，但 restoration 不够厚”
2. 把“没有动态预算”改成“已有动态预算，但仍偏粗”
3. 把“heartbeat 与 normal chat 完全割裂”改成“已部分统一，但不是单一事实流”
4. 把“auto-dream 是内存态”删除
5. 把 `Context Graph / Event Store` 从 P0 降到 P2

---

## 10. 具体文件改造顺序

建议按下面顺序推进，而不是并行乱改。

### 第 1 批：立即修复真实断点

1. `backend/app/kernel/engine.py`
2. `backend/app/runtime/session.py`
3. `backend/app/api/memory.py`
4. `backend/app/memory/retriever.py`
5. `backend/app/services/memory_service.py`

### 第 2 批：补足恢复与长期记忆沉淀

1. `backend/app/services/conversation_summarizer.py`
2. `backend/app/services/heartbeat.py`
3. `backend/app/runtime/invoker.py`
4. `backend/app/services/agent_context.py`

### 第 3 批：再做更统一的 evolution / projection

1. `backend/app/services/auto_dream.py`
2. `backend/app/kernel/engine.py`
3. `backend/app/services/memory_service.py`

---

## 11. 验收标准

这份方案不是以“代码看起来更漂亮”为验收，而是以下业务指标。

### 11.1 上下文与恢复

1. 长任务压缩后，agent 能续接最近未完成工作
2. 最近读写文件、最近工具结论能被恢复
3. `256k` 下 retrieval / restore 明显更厚，不再过早裁剪

### 11.2 记忆

1. tool/file/external 结果能在下一轮被召回
2. 中文 query 对中文记忆的命中率明显提升
3. rerank model 可由租户配置并实际生效

### 11.3 进化

1. heartbeat / normal chat / tool learnings 能以统一 fact schema 存在
2. auto-dream 处理的是更完整的输入，而不只是会话摘要
3. agent 的后续决策能显著更多地利用历史成功/失败模式

---

## 12. 最终结论

修正后的判断是：

**Hive 当前不需要一套“从零开始的新 agent 架构”，而需要一套更诚实、更聚焦的增强路线。**

当前最值得做的不是：

- 先造完整 `Context Graph`
- 先造完整 `Event Store`
- 先推倒现有 prompt/runtime 结构

当前最值得做的是：

1. 修掉还真实存在的恢复和配置断点
2. 把工具/文件/外部阅读正式接入长期记忆主链
3. 把中文 retrieval 和 compaction restoration 做厚
4. 再逐步把 evolution 收敛成统一事实流

这条路线更符合当前代码现实，也更符合业务效果优先的目标。
