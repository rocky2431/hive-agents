# Agent Context / Memory / Compression / Evolution 全链路复审

日期：2026-04-01  
范围：只看业务执行效果，不讨论超出业务收益的“极致工程化”。  
审计基线：以 `256k` 上下文模型为目标基线。  
报告置信度：**95%**

---

## 1. 结论

一句话结论：

**当前系统已经具备上线级主链路，不是“断链系统”；但它还没有达到你要的“上下文注入足够强、压缩恢复极高保真、记忆架构极清晰、进化闭环足够深”的目标状态。**

更准确地说：

1. **主链路是通的。**  
   从 HR 建人，到初始化 agent 工作区，到 Web Chat 多轮执行，到工具调用，到会话压缩，到记忆回写，到 heartbeat 反馈，到 auto-dream 整合，这条链路当前是存在且可工作的。

2. **真正的问题已经不再是“有没有能力”，而是“强度不够”。**  
   现在的主要短板是：
   - 动态上下文预算仍然偏保守；
   - 压缩仍然是 `summary-first`，不是 `state-first`；
   - 记忆召回已经成体系，但在 256k 基线下仍偏紧；
   - 进化闭环已经存在，但还不是“完全自主自我进化”。

3. **系统现在可以稳定完成真实任务，但还会在长任务、重上下文任务、重检索任务上损失质量。**  
   这些损失主要不是来自 runtime 崩掉，而是来自：
   - 注入不够多；
   - 压缩丢状态；
   - 恢复不够厚；
   - 记忆筛选仍然过窄。

4. **“完全自主自我进化”目前不成立。**  
   它已经具备真实反馈闭环和一定的自我校正能力，但还没有达到“策略可稳定沉淀、自动验证、自动提升到长期 policy 层”的成熟度。

我的诚实判断：

- 如果标准是“这套 agent 系统现在能不能顺利跑业务任务，并把结果、记忆、反馈串起来”：**能，已经可上线。**
- 如果标准是“是不是已经把上下文/压缩/记忆/进化做到业务上接近最优”：**没有。当前最大业务瓶颈是上下文预算策略和压缩策略，而不是 runtime 结构。**

---

## 2. 置信基础

### 2.1 本次实际复核的代码链路

我这轮重新核验的核心文件包括：

- `backend/app/tools/handlers/hr.py`
- `backend/app/api/websocket.py`
- `backend/app/runtime/invoker.py`
- `backend/app/runtime/prompt_builder.py`
- `backend/app/services/agent_context.py`
- `backend/app/kernel/engine.py`
- `backend/app/services/agent_tools.py`
- `backend/app/services/memory_service.py`
- `backend/app/memory/retriever.py`
- `backend/app/memory/assembler.py`
- `backend/app/services/conversation_summarizer.py`
- `backend/app/services/heartbeat.py`
- `backend/app/services/auto_dream.py`
- `backend/app/services/trigger_daemon.py`

### 2.2 本次重新执行的验证

#### A. 上下文 / 记忆 / hooks / 压缩主链路

```bash
cd /Users/rocky243/vc-saas/Clawith/backend
pytest tests/runtime/test_prompt_builder.py \
  tests/runtime/test_memory_query_routing.py \
  tests/kernel/test_prompt_cache_integration.py \
  tests/services/test_memory_service.py \
  tests/services/test_heartbeat.py \
  tests/services/test_auto_dream.py \
  tests/kernel/test_parallel_tool_batch.py \
  tests/runtime/test_hooks.py -q
```

结果：

```text
70 passed in 0.71s
```

#### B. HR 建人 / websocket 入口 / heartbeat / auto-dream

```bash
cd /Users/rocky243/vc-saas/Clawith/backend
pytest tests/tools/test_hr_handler.py \
  tests/api/test_websocket_call_llm.py \
  tests/api/test_chat_api_surface.py \
  tests/services/test_heartbeat.py \
  tests/services/test_auto_dream.py -q
```

结果：

```text
33 passed in 0.42s
```

#### C. 当前后端全量回归

```bash
cd /Users/rocky243/vc-saas/Clawith/backend
pytest -q
```

结果：

```text
446 passed in 2.17s
```

### 2.3 95% 置信度的边界

这份报告的 95% 置信度，指的是：

- 对**当前仓库内部代码链路**的判断；
- 对**默认单进程部署模型**下的行为判断；
- 对**已覆盖回归 + 重新阅读代码的数据流**的判断。

不包括：

- 外部依赖实时成功率本身，例如 OpenViking、外部 LLM、ClawHub、Smithery、外部 HTTP 源；
- 生产环境里非代码因素导致的问题，例如第三方 API 限流、网络抖动、密钥配置错误。

---

## 3. 先回答你最关心的五个问题

### 3.1 现在有没有核心断点？

**没有“主流程断裂”的核心断点。**

当前我没有看到会导致这条业务主链路直接失效的结构性断点：

`HR 建人 -> 初始化工作区 -> chat 执行 -> 工具调用 -> 压缩 -> 记忆回写 -> heartbeat 反馈 -> auto-dream`

但是有 4 个仍然会影响任务质量的**业务断点**：

1. **动态检索注入太薄**  
   retrieval / company knowledge / active packs 的预算明显偏低，模型拿到的信息量不够。

2. **压缩仍然是 summary-first**  
   一旦进入长任务或多工具任务，很多状态会被“概述化”，不是“结构化保留”。

3. **恢复预算仍偏紧**  
   中途压缩后虽然有 restore，但 `20k chars` 对复杂任务仍然偏少。

4. **进化是闭环，但不是 durable policy learning**  
   heartbeat 和 auto-dream 已经存在，但还没到“系统可以长期自主演化策略”的程度。

### 3.2 256k 基线下，当前限制是否过于苛刻？

**是，部分限制明显过于苛刻。**

尤其是下面这些：

- retrieval 注入 `3000 chars`
- company knowledge 注入 `1500 chars`
- active packs 注入 `2000 chars`
- post-compaction restore `20000 chars`
- semantic rerank 最终最多只选 `5` 条
- auto-dream 仍然是 `24h + 5 sessions`，而且 gate 是内存态

这些限制对 `32k/64k` 时代是保守合理的，对 `256k` 已经偏紧。

### 3.3 当前上下文注入是不是已经“动态且准确”？

**动态性已经成立，准确性中等偏上，充分性还不够。**

现在每轮都会动态重新加载：

- 当前用户
- 当前时间
- active triggers
- query-aware memory recall
- enterprise knowledge

这说明“动态注入”已经不是口号，而是真实运行时行为。  
但“准确”不等于“足够”。当前的主要问题不是注入错，而是**注入太少**。

### 3.4 当前压缩是不是“极致保真”？

**不是。**

当前压缩已经可用，但核心策略仍然是：

- 把旧消息折叠成 summary；
- 保留最近若干消息；
- 必要时再补一层 restoration。

这不是极致保真方案。极致保真的方向应该是：

- 任务状态单独保留；
- 文件/资源/ID/决定/待办分层保留；
- summary 只做“叙述视图”，不做唯一恢复源。

### 3.5 现在 agent 能不能“完全自主自我进化”？

**不能。**

更准确的表述是：

**它已经有“真实的自反馈 + 自纠错 + 记忆整合”能力，但还不是“完全自主的长期自演化系统”。**

---

## 4. 真实数据流审计

## 4.1 HR Agent 问答式搭建 -> 创建初始化

`create_digital_employee` 当前已经不是脆弱字符串协议，而是返回结构化 JSON envelope，包含：

- `agent_id`
- `agent_name`
- `features`
- `skills_dir`
- `message`

见：`backend/app/tools/handlers/hr.py:15-39`

创建流程里，当前实际会做：

1. 校验和归一化 name / heartbeat / trigger / array 参数  
   `backend/app/tools/handlers/hr.py:141-206`
2. 解析租户默认模型；若无模型，明确失败  
   `backend/app/tools/handlers/hr.py:227-254`
3. 创建 Agent / Participant / Permission / 默认工具  
   `backend/app/tools/handlers/hr.py:256-319`
4. 初始化 agent 文件系统  
   `backend/app/tools/handlers/hr.py:320-325`
5. 写初始 `focus.md`  
   `backend/app/tools/handlers/hr.py:329-336`
6. 创建 trigger  
   `backend/app/tools/handlers/hr.py:338-380`
7. 复制默认 skills + 请求 skills  
   `backend/app/tools/handlers/hr.py:382-418`
8. best-effort 启动 runtime  
   `backend/app/tools/handlers/hr.py:419-429`
9. post-commit best-effort 安装 MCP / ClawHub  
   `backend/app/tools/handlers/hr.py:446-539`

### 审计判断

- **创建主链路是通的。**
- **初始化主链路是通的。**
- 这里没有业务级主断点。

要诚实指出的边界只有两个：

1. MCP / ClawHub 安装是 `post-commit best-effort`，所以“建人成功”不等于“外部能力全装好”。
2. 如果某类 agent 强依赖外部 runtime，本系统不会把外部安装失败当成创建失败。

结论：  
**HR 建人问答式搭建，当前是可用的，不是系统断点。**

---

## 4.2 对话执行 -> Web chat 多轮上下文

当前 websocket chat 已经为 `agent_id + session_id` 复用稳定的 `SessionContext`，不是每轮重建。

见：

- `backend/app/api/websocket.py:26-100`
- `backend/app/api/websocket.py:413`

此外它会：

- 根据模型上下文动态加载历史消息条数  
  `backend/app/api/websocket.py:329-345`
- 重放历史 `tool_call` 成 assistant/tool 对，维持 tool-using 行为模式  
  `backend/app/api/websocket.py:361-399`

### 审计判断

这是一个非常关键的变化：

- 现在的 web chat 已经不是“单轮临时 runtime”；
- prompt cache / active packs / recent files / loaded skills 已经具备跨轮次复用基础。

结论：  
**Web chat 主链路是通的，且上下文行为已经是 session 级，而不是 request 级。**

---

## 4.3 上下文注入：动态性、准确性、充分性

### 当前真实结构

当前 runtime prompt 已明确拆成三层：

1. `Frozen Prefix`
2. `Dynamic Suffix`
3. `Per-turn Messages`

见：`backend/app/runtime/prompt_builder.py:1-7`

统一 runtime 在 `_build_system_prompt()` 中构建 frozen prefix 时，已经**不再把 `memory.md` / runtime metadata / focus` 直接塞进固定前缀**，而是：

- agent identity / role / skills / company intro 等进入前缀
- memory snapshot 单独由 memory pipeline 构建
- runtime metadata / retrieval / company knowledge 每轮动态加载

见：

- `backend/app/runtime/invoker.py:180-201`
- `backend/app/runtime/invoker.py:212-274`

### 当前每轮动态注入的内容

每轮会重新解析：

- 当前用户
- 当前时间
- active triggers
- 当前 query 对应的 memory recall
- 当前 query 对应的 company knowledge

见：

- `backend/app/services/agent_context.py:105-158`
- `backend/app/runtime/invoker.py:239-274`

### 审计判断

这说明：

- **动态注入已经成立**
- **query-aware 注入已经成立**
- **固定前缀和动态后缀的边界已经比之前清楚很多**

但这里真正的问题是：

**注入量仍偏保守。**

当前关键预算：

| 模块 | 当前上限 | 结论 |
|---|---:|---|
| system prompt 总预算 | `120000 chars`（256k 下） | 合理 |
| history messages | `500 messages`（256k 下） | 合理 |
| active packs | `2000 chars` | 偏紧 |
| retrieval context | `3000 chars` | 明显偏紧 |
| company knowledge | `1500 chars` | 明显偏紧 |
| memory assemble | `20000 chars` | 中等，仍可提升 |
| post-compaction restore | `20000 chars` | 偏紧 |
| skills catalog | `4000 chars` | 中等偏紧 |

对应代码：

- `backend/app/runtime/prompt_builder.py:23-27`
- `backend/app/runtime/prompt_builder.py:137-156`
- `backend/app/services/memory_service.py:114-148`
- `backend/app/memory/assembler.py:48-52`
- `backend/app/services/knowledge_inject.py:17-18`
- `backend/app/kernel/engine.py:334-336`

### 结论

当前上下文注入的问题不是“静态化”或者“错注入”，而是：

**对 256k 模型来说，动态注入配额仍然太吝啬。**

---

## 4.4 工具调用：是否还存在业务断点

### 当前真实状态

Kernel 里的工具执行现在已经统一走 hook 语义：

- `PRE_TOOL_USE`
- `POST_TOOL_USE`
- `POST_TOOL_FAILURE`

而且 parallel / sequential 路径都共用这套包装。

见：`backend/app/kernel/engine.py:221-282`

同时，最小核心工具面已经包含：

- 文件操作
- `load_skill`
- trigger 设置
- agent messaging / delegation
- async task 查询 / 取消 / 列表
- `get_current_time`
- `tool_search`

见：`backend/app/services/agent_tools.py:151-170`

### 工具调用的真正业务问题

当前工具系统已经**稳定**，但仍有一个很现实的业务限制：

**它是 minimal-by-default。**

这意味着复杂任务在起步阶段，往往还要消耗 1-2 轮去：

- `tool_search`
- `load_skill`
- 激活 capability pack

这不是 runtime 断点，但它会影响真实任务的推进效率。

### 结论

- **工具调用稳定性：可上线**
- **工具调用效率：还可以更主动**

如果你的目标是更像“强 agent”，下一步应做的不是再补稳定性，而是：

**让系统更早、更主动地展开工具面。**

---

## 4.5 压缩：当前是不是“极致保真”

### 当前真实机制

当前压缩的主链路是：

1. 接近上下文上限时触发压缩  
   `backend/app/services/memory_service.py:180-255`
2. 优先尝试 LLM summary；失败时走 extraction fallback  
   `backend/app/services/memory_service.py:222-255`
3. Kernel 中还有 mid-loop compaction  
   `backend/app/kernel/engine.py:31-37`
4. 大 tool result 会被 eviction 到文件并保留 preview  
   `backend/app/kernel/engine.py:51-69`
5. 压缩后会尝试 restore soul / focus / recent files / active skills / packs  
   `backend/app/kernel/engine.py:334-380`

会话摘要的结构目前能保留：

- Current Task
- Tools Used
- Key Decisions
- Files/Resources
- Pending
- Important Context

见：`backend/app/services/conversation_summarizer.py:167-224`

### 为什么它还不算“极致保真”

因为当前核心仍然是：

**旧上下文 -> summary -> 保留最近消息**

这意味着很多细粒度状态并没有独立持久层，例如：

- 工具返回里的具体 ID / path / schema 片段
- 文件之间的因果关系
- 待办列表的结构化状态
- 哪些 tool output 是“以后必须原样再看”的

虽然已有：

- tool result eviction
- recent file / skill tracking
- post-compaction restore

但这套系统仍然不是 `state-first`。

### 结论

当前压缩系统的真实定位应该是：

- **可用**
- **比之前强很多**
- **但仍然是 summary-first，不是极致保真恢复系统**

这是当前整个系统里**最值得优先升级**的一块。

---

## 4.6 记忆系统：是否已经清晰明确

### 当前真实架构

当前 memory 已经是四层结构：

1. `working`
2. `episodic`
3. `semantic`
4. `external`

见：`backend/app/memory/retriever.py:139-179`

并且当前已经有这些增强：

- query-aware semantic scoring
- category-aware boost（`feedback` / `user`）
- optional rerank model
- assemble 时按 kind 分组、按 score 去重、按 category 打前缀
- freshness warning

见：

- `backend/app/memory/retriever.py:57-71`
- `backend/app/memory/retriever.py:74-136`
- `backend/app/memory/assembler.py:14-16`
- `backend/app/memory/assembler.py:48-105`

另外，session 结束时会：

- 生成 session summary
- 更新 semantic facts
- 可选写入 OpenViking

见：`backend/app/services/memory_service.py:284-317`

### 现在比之前更好的地方

这部分是这轮审计里最值得明确区分“过去 vs 现在”的：

- memory assembly 预算已经是 `20000 chars`，不是之前更小的版本
- semantic retrieval limit 已到 `50`
- feedback / user 类 facts 已经有更高召回权重
- feedback 会从 heartbeat 写回 semantic memory
- cursor extraction 已经按 `agent + session` 维度，不再跨 session 漏抽

见：

- `backend/app/memory/retriever.py:151-179`
- `backend/app/services/memory_service.py:421-486`
- `backend/app/services/heartbeat.py:331-367`

### 仍然不够强的地方

尽管架构已经清晰，但业务上仍有 4 个限制：

1. `semantic rerank` 最终最多只留 `5` 条  
   `backend/app/memory/retriever.py:19-21`
2. episodic previous summaries 默认只拉 `3` 条  
   `backend/app/memory/retriever.py:230-260`
3. assemble 虽然是 `20k`，但 retrieval 注入总预算在 prompt builder 仍只有 `3k`
4. incremental extraction cursor 仍是内存态，进程重启后会丢游标  
   `backend/app/services/memory_service.py:421-486`

### 结论

当前记忆系统已经不是“混乱的 patchwork”，而是**有清晰层次的可用架构**。  
但在 256k 基线下，它仍然需要：

- 更大的动态注入配额；
- 更强的 adaptive top-k；
- 更 durable 的 extraction / consolidation 节奏。

---

## 4.7 反馈与进化：现在到底到哪一步

### 当前真实闭环

heartbeat 现在会读取：

- `evolution/scorecard.md`
- `evolution/blocklist.md`
- `evolution/lineage.md`
- `workspace/compaction_summary.md`

然后做 pattern analysis，并在执行后：

- 更新 evolution 文件
- 把高分成功 / 失败写入 semantic feedback memory

见：

- `backend/app/services/heartbeat.py:160-302`
- `backend/app/services/heartbeat.py:331-367`
- `backend/app/services/heartbeat.py:370-420`

同时，`auto_dream` 会在满足 gate 时：

- 读取 recent session summaries
- 读取 semantic facts
- 调用 LLM 做 consolidation
- 回写 consolidated facts

见：`backend/app/services/auto_dream.py:34-91`

### 为什么它还不算“完全自主自我进化”

当前闭环的问题不在“有没有 loop”，而在于：

1. `auto_dream` 的 gate 仍然是**内存态**  
   `_last_dream_time` / `_sessions_since_dream` 进程重启会清空  
   `backend/app/services/auto_dream.py:26-32`

2. 进化仍然是**启发式文件闭环**  
   有 scorecard / lineage / feedback memory，但还没有稳定的“策略对象”。

3. 系统还没有“自我评估 -> 生成新策略 -> 验证 -> 晋升为长期策略”的完整 policy 生命周期。

4. 系统不会根据任务类型，自动调优自己的 context budget / recall quota / compaction policy。

### 结论

当前系统已经具备：

- 自我记录
- 自我反馈
- 自我归纳
- 一定程度的自我避免重复失败

但仍然不能准确说成：

**“完全自主的自我进化 agent 系统”**

更准确的说法是：

**“具备真实反馈闭环的自我校正系统，但尚未形成 durable policy evolution”**

---

## 5. 256k 基线下，哪些限制过紧

这部分直接给出我最明确的判断。

### 5.1 明显过紧

| 限制 | 当前值 | 判断 | 原因 |
|---|---:|---|---|
| retrieval 注入 | `3000 chars` | 过紧 | query-aware memory + runtime context + knowledge 常常挤不下 |
| company knowledge | `1500 chars` | 过紧 | 真实企业知识通常远超这个量 |
| post-compact restore | `20000 chars` | 过紧 | 对 coding / research / ops 长任务不够厚 |
| semantic rerank select | `5` | 过紧 | 长会话下只取 5 条太保守 |

### 5.2 中度偏紧

| 限制 | 当前值 | 判断 | 原因 |
|---|---:|---|---|
| active packs | `2000 chars` | 偏紧 | 复杂 pack 多时说明不足 |
| memory assembler | `20000 chars` | 可用但偏紧 | 对 256k 可以更激进 |
| skills catalog | `4000 chars` | 偏紧 | 对复杂 agent 能力面仍薄 |
| episodic previous sessions | `3` | 偏紧 | 长期项目 continuity 仍有限 |

### 5.3 取决于业务类型

| 限制 | 当前值 | 判断 | 说明 |
|---|---:|---|---|
| poll 最小间隔 | `30 min` | 对监控型 agent 过紧 | 对普通任务合理 |
| 最多每小时触发 | `6` | 对高频监控过紧 | 对成本控制合理 |
| auto-dream gate | `24h + 5 sessions` | 对低频 agent 过紧 | 高频 agent 尚可 |

对应代码：

- `backend/app/runtime/prompt_builder.py:23-27`
- `backend/app/kernel/engine.py:334-336`
- `backend/app/memory/retriever.py:19-21`
- `backend/app/services/trigger_daemon.py:29-33`
- `backend/app/services/auto_dream.py:26-32`

---

## 6. 过去和现在，应该怎样综合判断

如果把“过去的问题”和“现在的系统”混在一起看，会误判。

### 6.1 过去成立、现在已经不成立的判断

下面这些现在再说“系统没有”，就不准确了：

- 没有 session 级 prompt cache
- 没有 frozen prefix / dynamic suffix
- 没有 mid-loop compaction
- 没有 post-compaction restoration
- 没有四层 memory
- 没有 feedback 回写
- 没有 auto-dream
- web chat 不复用 runtime session
- parallel tool path 不触发 hooks

### 6.2 过去和现在都成立，但严重程度下降了

- 记忆系统不够强：**现在是“强度不够”，不是“架构不清”**
- 进化系统不够强：**现在是“未达 policy 层”，不是“没有闭环”**
- 工具系统不够强：**现在是“展开偏慢”，不是“工具不可用”**

### 6.3 现在仍然必须认真对待的核心问题

真正还成立的主问题只有四个：

1. 动态上下文配额过小
2. 压缩不是 state-first
3. 记忆召回仍然偏窄
4. 进化闭环还没 durable 到 policy 层

---

## 7. 最终判断：是否已经达到业务上线标准

### 我给出的诚实判断

**达到了业务上线标准。**

理由不是“它已经完美”，而是：

- 创建链路通；
- 多轮 chat 通；
- 工具调用通；
- 压缩通；
- 记忆回写通；
- heartbeat 反馈通；
- auto-dream consolidation 通；
- 当前后端全量测试通过。

### 但它还没有达到的目标

它还没达到的是：

- 极致上下文注入
- 极致压缩保真恢复
- 极强记忆召回
- 完全自主自进化

也就是说：

**现在不是不能上线，而是上线后会在“长任务质量上限”上输。**

---

## 8. 业务优先级优化方案

下面只给我认为真正值得做的业务项，不谈纯工程炫技。

## P0.1 全动态预算控制器

目标：把所有关键注入预算改成真正的 `model-aware + task-aware`。

优先调整：

- retrieval：`3000 -> 12000~24000`
- company knowledge：`1500 -> 4000~8000`
- active packs：`2000 -> 4000~8000`
- post-compact restore：`20000 -> 60000~100000`

原则：

- 不再用静态小常量；
- 至少按上下文窗口比例分配；
- 再按任务类型二次修正。

这是**最直接影响任务完成率**的一项。

## P0.2 把压缩从 summary-first 改成 state-first

目标：让压缩后保留下来的不是“故事摘要”，而是“可恢复状态”。

建议拆成至少 5 类状态：

- task ledger：当前任务、子任务、pending
- artifact ledger：文件、URL、ID、资源句柄
- decision ledger：用户决定、系统决定、约束
- tool ledger：调用过什么工具、关键结果是什么
- preference ledger：用户偏好、纠正、行为规则

summary 继续保留，但只做 view，不做唯一恢复源。

这是**当前最关键的质量项**。

## P0.3 记忆召回做成 adaptive quota

目标：不是只加预算，而是让召回结构更聪明。

建议：

- semantic rerank max select 从 `5` 提到动态区间
- 不同 memory kind 有保底配额
- query classification 决定权重：
  - coding task 偏 files / decisions / tool artifacts
  - research task 偏 external / reference / project
  - ops task 偏 latest state / trigger context / feedback

## P0.4 让进化闭环 durable 化

目标：从“会自我记录”升级到“会长期积累”。

最先该做的不是复杂 worker，而是把关键 gate 持久化：

- auto-dream gate 持久化
- extraction cursor 持久化
- heartbeat 输出的成功策略沉淀成 strategy snapshot

做到这一步后，系统才更接近“真正会越来越像自己”。

## P1.1 工具展开更主动

目标：减少 agent 起步的 discovery round。

建议：

- 在 query classification 后，预激活更合适的 capability pack；
- 对高频任务类型直接展开必要工具，不必每次都先 `tool_search`。

## P1.2 trigger 限制按业务档位分层

目标：别让所有 agent 都被同一套低频限制绑定。

建议：

- 普通 agent 保持当前保守限制；
- 监控型 / 市场型 / 告警型 agent 允许更高频 profile。

---

## 9. 最后的诚实结论

如果只用一句最诚实的话来总结这次复审：

**当前系统已经从“有没有 agent runtime 主链路”这个阶段，进入到了“怎么把上下文、压缩、记忆、进化做强”的阶段。**

所以你现在不该再把精力花在“是不是还到处断”上。  
真正应该投入的是这 3 个业务核心：

1. **把动态上下文预算做大、做活**
2. **把压缩从 summary-first 改成 state-first**
3. **把记忆与进化做成 durable 的长期增益系统**

如果这三项做对了，这套 agent 框架的业务质量会明显再上一个台阶。  
如果不做，这套系统虽然能跑，但会在复杂任务里持续吃“信息注入不足 + 压缩丢状态”的亏。
