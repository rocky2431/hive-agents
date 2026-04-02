# Prompt Engineering Optimization Plan (2026-04-02)

## 当前状态

截至当前代码状态，这份计划的执行结论是：

- `P0`: 已完成
- `P1`: 已完成
- `P2`: 待办，进入 backlog

这意味着提示词工程主链路已经达到可上线、可持续迭代的状态。
后续是否进入 `P2`，取决于你是否要补 prompt 可观测性和长期治理，而不是业务可用性本身。

## 目标

基于当前 Hive 提示词系统与 Claude Code 的源码级对比，继续缩小剩余差距。

优化目标不是“写得更像 Claude Code”，而是让 Hive 在真实业务场景下具备更强的：

1. 上下文分层与缓存稳定性
2. mode-specific 执行契约
3. 工具调用成功率
4. 长任务压缩与恢复保真
5. 记忆提取与进化指令清晰度

## 当前判断

截至 2026-04-02，提示词工程层已经明显好于 2026-04-01 审计时的状态，但仍保留约 `35% - 45%` 的差距。

主要不是文风问题，而是：

1. 主 prompt 仍偏“单体大合同”
2. tool contract 仍不均匀
3. A2A / task / coordinator prompt 仍偏薄
4. memory / summarization / evolution prompt family 仍未完全统一

## 当前已具备能力

### 1. 主 prompt 基础质量已提升

- `backend/app/services/agent_context.py`
- 已具备 mode-aware identity
- 已具备 mode-aware risk confirmation rule
- 已将核心规则按 `Honesty / Risk / Failure / Tools / Communication / Evolution` 分组

### 2. prompt cache 边界已基本正确

- `backend/app/runtime/prompt_builder.py`
- 已引入 `PROMPT_CACHE_BOUNDARY`
- 已区分 frozen prefix 和 dynamic suffix
- 超预算截断路径已保留边界，不再静默丢失缓存分段

### 3. 压缩 prompt 已明显增强

- `backend/app/services/conversation_summarizer.py`
- 已使用 `<analysis>/<summary>` scratchpad 分离
- 已引入更高保真 summary schema
- 已纳入 code snapshot / user messages / error ledger

### 4. 记忆 consolidation prompt 已增强

- `backend/app/services/auto_dream.py`
- 已加入 recency preference
- 已加入 `What NOT to consolidate`
- 已减少无意义泛化和重复合并

### 5. 部分工具 contract 已补强

- `backend/app/tools/handlers/filesystem.py`
- `backend/app/tools/handlers/search.py`
- `read_file / write_file / edit_file / execute_code / web_search` 已比旧版本强很多

## 剩余真实差距

### Gap A. 主 prompt 仍然是聚合式结构

问题：

- `agent_context.py` 仍把 identity、business context、memory、skills、focus、rules 放在一个大 prompt 中
- section 已有，但“主合同”和“上下文材料”仍未彻底解耦
- 对模型来说，操作规则仍可能被大量业务描述稀释

应对方向：

- 不增加总字数前提下，把主 prompt 明确拆成三层：
  1. Identity & Mission
  2. Operating Contract
  3. Context Material

### Gap B. 工具 contract 覆盖仍不均匀

问题：

- `filesystem` 和 `web_search` 提升明显
- 但 `communication`、`trigger`、`skills catalog`、`jina_search`、`jina_read`、`discover_resources` 仍偏“功能说明”
- 还没有系统性写出：
  - 何时使用
  - 何时不使用
  - 输入质量要求
  - 失败后的 fallback
  - 输出预期

### Gap C. mode prompt 还没做到“mode = protocol”

问题：

- `TASK_EXECUTION_ADDENDUM` 仍偏泛化
- `A2A_SYSTEM_PROMPT_SUFFIX` 仍偏短
- 缺少更明确的：
  - handoff 约束
  - status vs final answer 的区分
  - artifact / path / evidence 回传格式
  - stop condition

### Gap D. memory / evolution prompt family 未完全统一

问题：

- `summarizer` 和 `auto_dream` 已强很多
- 但提取、合并、进化、策略保留仍未形成统一 family
- 同一事实在 summary、memory、evolution 间的角色边界还不够清晰

## 优化原则

1. 不为“像 Claude Code”而改，必须直接提升 Hive 真实任务成功率
2. 优先写 contract，不优先堆字数
3. 优先补“失败时如何判断和切换策略”，不优先补泛泛原则
4. 所有 prompt 改动都必须有测试锁定关键文本和分层行为

## P0

状态：`Done`

### P0.1 主 prompt 三层化

目标：

- 将 `build_agent_context()` 组装逻辑明确拆为：
  - Identity & Mission
  - Operating Contract
  - Context Material

落点：

- `backend/app/services/agent_context.py`
- `backend/tests/services/test_agent_context.py`

验收：

- conversation / task / heartbeat / coordinator 仍保持 mode-aware 差异
- risk rule、tool rule、evolution rule 不被业务上下文打散
- 不引入 prompt cache 语义回退

### P0.2 A2A / Task contract 补强

目标：

- 把 `A2A_SYSTEM_PROMPT_SUFFIX` 和 `TASK_EXECUTION_ADDENDUM` 从“说明”提升成“协议”

必须补的点：

- A2A:
  - 何时给状态，何时给结论
  - 结果必须尽量包含 artifact / file path / evidence
  - 阻塞时说明具体缺什么
  - 禁止嵌套委托
- Task:
  - 完成标准
  - 三次失败停止原则
  - 外部协作和外部搜索时的准备要求
  - 最终报告结构

落点：

- `backend/app/services/agent_tool_domains/messaging.py`
- `backend/app/services/task_executor.py`

### P0.3 communication/search/skill catalog contract 补强

目标：

- 统一把“工具说明”改成“工具合同”

优先工具：

- `send_feishu_message`
- `send_web_message`
- `send_message_to_agent`
- `delegate_to_agent`
- `jina_search`
- `jina_read`
- `discover_resources`
- `SkillRegistry.render_catalog()`

要求：

- 写清 `when to use / when not to use / fallback / output expectations`

落点：

- `backend/app/tools/handlers/communication.py`
- `backend/app/tools/handlers/search.py`
- `backend/app/skills/registry.py`

### P0.4 输出约束与 fallback 一致化

目标：

- 对 mode prompt 与 tool contract 中的“失败”和“fallback”表达统一口径
- 减少模型因为不同 prompt 短语冲突而摇摆

落点：

- `backend/app/services/agent_context.py`
- `backend/app/services/task_executor.py`
- `backend/app/services/agent_tool_domains/messaging.py`
- `backend/app/tools/handlers/search.py`
- `backend/app/tools/handlers/communication.py`

## P1

状态：`Done`

### P1.1 coordinator contract 精细化

- 明确什么可以亲自做，什么必须委托
- 明确 verification worker 的使用时机
- 明确 synthesize 输出格式

文件：

- `backend/app/runtime/coordinator.py`
- `backend/tests/runtime/test_coordinator.py`

### P1.2 memory / evolution prompt family 重构

- summary prompt
- memory extraction prompt
- memory consolidation prompt
- strategy evolution prompt

目标：

- 清晰区分 state、fact、lesson、policy

文件：

- `backend/app/services/conversation_summarizer.py`
- `backend/app/services/auto_dream.py`
- 相关 memory/evolution prompt 实现与测试

### P1.3 工具 contract 全覆盖

- `triggers`
- `skills`
- 其余读写型、通信型、外部资源型工具

## P2

状态：`Backlog / Optional`

### P2.1 prompt telemetry

- 记录各 section 长度
- 记录 mode prompt 与 tool prompt 使用命中
- 记录是否出现 fallback / repeated failure / dead-end

### P2.2 prompt family 文档化

- 为主 prompt、mode prompt、tool contract、memory prompt 建立统一命名和维护规范

建议：

- 如果当前重点是业务运行质量，`P2` 可以暂缓。
- 如果接下来要长期迭代 agent 质量、做 A/B prompt 优化、或交给多人维护，`P2` 值得进入下一阶段。

## 实施顺序

当前建议顺序：

1. 先以当前 `P1 complete` 状态进入真实业务运行与观察
2. 将 `P2` 标记为后续治理项，而不是当前阻断项
3. 只有在你需要 prompt telemetry 或 prompt family 维护规范时，再启动 `P2`

原始实施顺序（历史记录）：

1. 先做 P0.1
2. 再做 P0.2
3. 再做 P0.3
4. 然后做 P0.4 收口
5. 最后进入 P1

## 测试策略

### 必加测试

- `backend/tests/services/test_agent_context.py`
- `backend/tests/runtime/test_prompt_builder.py`
- `backend/tests/services/test_skill_loading.py`
- 新增 `backend/tests/services/test_prompt_contracts.py`

### 关键断言

- 主 prompt 必须保留分层 section
- task / heartbeat 不得继承 conversation 的确认规则
- A2A prompt 必须包含非嵌套委托、阻塞说明、结果证据约束
- task prompt 必须包含 final report 结构
- communication/search/skill catalog 必须包含 fallback 或 when-not-to-use 规则

## 完成定义

当以下条件同时满足时，提示词优化第一阶段视为完成：

1. P0.1 - P0.4 全部落地
2. 对应测试全部为绿
3. prompt cache、mode behavior、tool surface 没有回退
4. 与 2026-04-01 审计相比，剩余差距压缩到 `20% - 25%`

## 当前结论

按当前仓库状态，这个“第一阶段”已经完成。

因此现在更准确的项目状态是：

- 第一阶段提示词优化：完成
- 第二阶段提示词治理与观测：可选，未开始
