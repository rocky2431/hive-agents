# Prompt Engineering Audit Against Claude Code (2026-04-01)

## 结论

我的结论是：**Hive 当前提示词体系已经可用，但明显没有达到 Claude Code 级别的 prompt engineering 成熟度。**

如果只看“能不能跑”，答案是能。
如果看“提示词是否已经非常贴合真实场景、是否把多代理/工具/记忆/压缩/进化都做到了高精度指挥”，答案是**还没有**。

我对这个判断的置信度是 **92%**。

原因不是我只看了几段 prompt，而是我对比了两边四层结构：

1. 主系统提示词
2. 子代理 / 执行模式提示词
3. 工具提示词 / 工具 schema 描述
4. 记忆 / 压缩 / 进化相关提示词

同时我不是只看文案，而是看了它们和运行时结构是否一致。

---

## 核心判断

### 1. Hive 的最大问题不是“不会写 prompt”，而是 **prompt 架构分层不够成熟**

Claude Code 的强点，不在单句写得多华丽，而在于它把不同职责拆到了不同 prompt 层里：

- 主系统 prompt 负责稳定的全局 contract、风险边界、工具使用哲学、输出风格、缓存边界。
- 子代理 prompt 负责角色边界和任务契约。
- 工具 prompt 负责具体工具的使用约束、反模式、前置条件。
- 记忆 / session memory prompt 负责结构化更新、压缩与恢复约束。

对应源码：

- 主 prompt 有明确静态/动态边界和 section cache：`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 与 `systemPromptSection(...)`  
  见 `/Users/rocky243/Context Engineering/claude-code/src/constants/prompts.ts:105`，`/Users/rocky243/Context Engineering/claude-code/src/constants/prompts.ts:491`，`/Users/rocky243/Context Engineering/claude-code/src/constants/prompts.ts:560`
- 主 prompt 中明确约束工具使用哲学、并行调用、风险动作确认、输出风格  
  见 `/Users/rocky243/Context Engineering/claude-code/src/constants/prompts.ts:186`，`/Users/rocky243/Context Engineering/claude-code/src/constants/prompts.ts:255`，`/Users/rocky243/Context Engineering/claude-code/src/constants/prompts.ts:269`，`/Users/rocky243/Context Engineering/claude-code/src/constants/prompts.ts:403`
- 子代理 prompt 高度角色化  
  见 `/Users/rocky243/Context Engineering/claude-code/src/tools/AgentTool/built-in/planAgent.ts:21`
- 工具 prompt 不是“功能介绍”，而是“执行合同”  
  见 `/Users/rocky243/Context Engineering/claude-code/src/tools/FileWriteTool/prompt.ts:10`，`/Users/rocky243/Context Engineering/claude-code/src/tools/PowerShellTool/prompt.ts:78`，`/Users/rocky243/Context Engineering/claude-code/src/tools/ToolSearchTool/prompt.ts:27`
- 会话记忆 prompt 是结构化模板 + 严格编辑规则  
  见 `/Users/rocky243/Context Engineering/claude-code/src/services/SessionMemory/prompts.ts:11`，`/Users/rocky243/Context Engineering/claude-code/src/services/SessionMemory/prompts.ts:43`
- 记忆提取 prompt 是专门的 memory subagent contract  
  见 `/Users/rocky243/Context Engineering/claude-code/src/services/extractMemories/prompts.ts:29`

而 Hive 现在更像是：

- 一个很大的主系统 prompt，里面同时塞了身份、组织信息、记忆、技能、关系、focus、规则、自我进化约束；
- 再在任务/A2A/coordinator 上补几个相对较短的 suffix；
- 工具 schema 提供的是“工具是什么”，不是“何时该用、何时不该用、前置条件是什么、失败后怎么办”的强合同。

对应 Hive 源码：

- 主 prompt 大量聚合上下文与规则  
  见 `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_context.py:221`
- `Core Rules` 直接把 WAL、自我改进、进化系统、技能 vetting、消息路由都塞进主 prompt  
  见 `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_context.py:339`
- 动态 suffix 已有 pack/retrieval/suffix 结构，但仍较薄  
  见 `/Users/rocky243/vc-saas/Clawith/backend/app/runtime/prompt_builder.py:107`

**结论**：Hive 的主要问题是 **职责聚合过度，局部 contract 过弱**。

---

### 2. Hive 主系统 prompt 的“业务上下文注入”是强项，但也已经开始过载

Hive 的主 prompt 有 Claude Code 不需要承担的企业业务信息：

- 角色描述
- 已配置 channel
- Company Information
- Organization Structure
- Personality
- Memory
- Skills
- Relationships
- Focus
- Core Rules

对应位置：

- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_context.py:222`
- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_context.py:244`
- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_context.py:296`
- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_context.py:305`
- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_context.py:315`

这个方向本身没有错。对于 Hive 这样的“企业数字员工”系统，业务身份和组织语境必须比 Claude Code 重。

但问题是：

1. **主 prompt 承担的职责太多**
2. **其中一部分是稳定身份信息，另一部分是行为规约，另一部分是 runtime 策略**
3. **这些内容混在一起后，操作性指令会被业务背景稀释**

Claude Code 在这点上更克制：

- 主 prompt 重“行为合同”
- 环境信息与动态指令走后半段
- session-specific guidance 单独作为动态 section

见：

- `/Users/rocky243/Context Engineering/claude-code/src/constants/prompts.ts:343`
- `/Users/rocky243/Context Engineering/claude-code/src/constants/prompts.ts:491`

**结论**：Hive 主 prompt 的业务适配是对的，但现在已经开始挤压执行型指令密度。  
不是“信息不够”，而是“重要操作约束没有被足够聚焦地表达”。

---

### 3. Hive 的工具提示词层明显弱于 Claude Code，这会直接影响真实任务成功率

这是我认为最确定、最关键的差距之一。

Claude Code 的工具 prompt 不是简单描述功能，而是把工具使用的**最佳实践、硬约束、反模式、并行策略、失败语义**都写进去。

例如：

- `Write` 明确要求：已有文件必须先读、优先用 Edit、禁止没被要求就写文档  
  `/Users/rocky243/Context Engineering/claude-code/src/tools/FileWriteTool/prompt.ts:10`
- `PowerShell` 明确要求：不用它做文件读写、列出 PowerShell edition 差异、交互式命令禁止、后台任务怎么跑、何时并行、何时链式  
  `/Users/rocky243/Context Engineering/claude-code/src/tools/PowerShellTool/prompt.ts:78`
- `ToolSearch` 明确解释 deferred tool 的可见性、何时不可调用、查询格式  
  `/Users/rocky243/Context Engineering/claude-code/src/tools/ToolSearchTool/prompt.ts:27`

Hive 这层明显更轻：

- 文件工具主要是功能描述  
  `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/filesystem.py:12`
- 通信工具主要是功能说明  
  `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/communication.py:86`

例如 Hive 的 `write_file` 只说“写或更新文件”，没有明确：

- 修改已有文件前是否必须先读
- 何时优先 `edit_file` 而不是 `write_file`
- 何时不该改 `memory` / `focus`
- 是否应该避免生成无请求文档
- 写入失败或找不到 snippet 时的下一步策略

对应：

- `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/filesystem.py:67`
- `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/filesystem.py:97`

同样，Hive 的 `delegate_to_agent` / `send_message_to_agent` 描述了做什么，但没有像 Claude Code `AgentTool` 那样明确：

- 何时适合 fork / 何时适合 fresh worker
- 何时不要重复研究
- 如何写出高质量 delegation prompt
- “never delegate understanding”
- 中途不要猜测 worker 结果

Claude Code 这里非常强：

- `/Users/rocky243/Context Engineering/claude-code/src/tools/AgentTool/prompt.ts:80`
- `/Users/rocky243/Context Engineering/claude-code/src/tools/AgentTool/prompt.ts:99`
- `/Users/rocky243/Context Engineering/claude-code/src/tools/AgentTool/prompt.ts:201`

而 Hive 对应层主要靠 coordinator suffix 和工具描述拼起来，不够强。

**结论**：如果只做一类优化，**优先级最高的应该是 Hive 核心工具的 prompt contract 重写**。这比继续堆主 prompt 文案更有用。

---

### 4. Hive 的子代理 / 模式提示词明显偏薄，尤其是 A2A 和 task execution

这是第二个非常明确的差距。

#### 4.1 A2A 提示词太薄

Hive 当前 A2A suffix 基本只有：

- 你收到另一个数字员工的消息
- 简洁回答
- 聚焦请求

对应：

- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_tool_domains/messaging.py:14`

Claude Code 对 teammate communication 至少明确了：

- 纯文本别人看不见
- 必须使用 `SendMessage`
- 用户主要跟 team lead 交互
- 你的工作通过任务系统和 teammate messaging 协调

对应：

- `/Users/rocky243/Context Engineering/claude-code/src/utils/swarm/teammatePromptAddendum.ts:8`

Hive 这里缺少的不是“文案更长”，而是缺少：

- 可见性约束
- 协作边界
- 回复格式预期
- 何时回传结论、何时回传状态、何时需要附 artifact/path

#### 4.2 Task execution mode 还是偏泛化

Hive 的 task 执行 addendum 目前只有 6 条泛规则：

- 认真完成
- 拆步骤
- 先 minimal kernel tools
- 最后给 execution report
- 外部搜索先 load skill
- 不要追问用户

对应：

- `/Users/rocky243/vc-saas/Clawith/backend/app/services/task_executor.py:18`

相比之下，Claude Code 的 `Plan` agent 是真正的执行合同：

- 明确 read-only
- 明确禁止哪些动作
- 明确探索流程
- 明确输出结构

对应：

- `/Users/rocky243/Context Engineering/claude-code/src/tools/AgentTool/built-in/planAgent.ts:21`
- `/Users/rocky243/Context Engineering/claude-code/src/tools/AgentTool/built-in/planAgent.ts:37`
- `/Users/rocky243/Context Engineering/claude-code/src/tools/AgentTool/built-in/planAgent.ts:60`

#### 4.3 Coordinator prompt 有一定能力，但还存在提示词与运行时契约轻微错位

Hive coordinator prompt 明确说：

- 自己负责编排，不直接执行 domain tools
- 必须 synthesize
- verification 要分离 worker

对应：

- `/Users/rocky243/vc-saas/Clawith/backend/app/runtime/coordinator.py:38`

但允许工具集合里仍然包含：

- `read_file`
- `write_file`
- `list_files`

对应：

- `/Users/rocky243/vc-saas/Clawith/backend/app/runtime/coordinator.py:23`

这不一定是 bug，但说明 prompt contract 还没有完全精确表达“哪些直做是允许的、哪些不允许”。

**结论**：Hive 的多代理提示词目前是“能工作”，但还没有达到 Claude Code 那种**每个 mode 都是独立且高约束 contract** 的水平。

---

### 5. Hive 的压缩与记忆 prompt 已经比以前强很多，但“链路设计”仍弱于 Claude Code

#### 5.1 Hive 的压缩 prompt 现在已经是对的方向

这一点要明确肯定。

当前 Hive summarizer 已经不是泛摘要，而是 state-first ledger：

- `Task Ledger`
- `Decision Ledger`
- `Artifact Ledger`
- `Tool Ledger`
- `Preference Ledger`
- `Pending Ledger`
- `Narrative Snapshot`

对应：

- `/Users/rocky243/vc-saas/Clawith/backend/app/services/conversation_summarizer.py:283`

这个方向是正确的，明显优于很多通用“帮我总结一下以上对话”的写法。

#### 5.2 Hive 的事实抽取 prompt 也已经不错

当前 fact extraction 已经有：

- category taxonomy
- priority extraction targets
- 明确把 tool execution / file artifacts / external findings 纳入候选

对应：

- `/Users/rocky243/vc-saas/Clawith/backend/app/services/memory_service.py:619`

这说明 Hive 在“记忆提取 prompt”上已经不是弱项底线。

#### 5.3 但 Claude Code 在“记忆 prompt 架构”上仍然更成熟

Claude Code 的 session memory 和 extract memory 是两套明确职责：

- session memory：维护结构化连续工作笔记，有固定 section 模板和更新规则  
  `/Users/rocky243/Context Engineering/claude-code/src/services/SessionMemory/prompts.ts:11`
- extract memories：作为 memory subagent，在有限 turn budget 下读写 memory 目录，有明确工具限制、写入流程、去重流程、类型系统  
  `/Users/rocky243/Context Engineering/claude-code/src/services/extractMemories/prompts.ts:29`

Hive 这条链路当前是：

- summarizer
- fact extractor
- retriever rerank
- auto_dream consolidator

它们各自方向不差，但提示词层面存在两个问题：

1. **彼此职责没有 Claude Code 那么清晰**
2. **每一段 prompt 都偏短，更多靠后处理代码兜底**

例如：

- rerank prompt 很薄，只是“Select the most relevant memories. Return only JSON.”  
  `/Users/rocky243/vc-saas/Clawith/backend/app/memory/retriever.py:156`
- auto_dream consolidation prompt 也比较基础，主要是 merge/dedup/category  
  `/Users/rocky243/vc-saas/Clawith/backend/app/services/auto_dream.py:203`

Claude Code 的 memory prompt 更像“操作手册”，Hive 更像“让模型做个结构化输出”。

**结论**：Hive 在压缩/记忆 prompt 上已经达到“方向正确、可上线”，但还没达到 Claude Code 的**分工清晰、约束细密、长期稳定可维护** 的级别。

---

### 6. Hive 的进化 prompt 还不能叫“成熟的自我进化提示词体系”

Hive 现在在主 prompt 中直接告诉 agent：

- 失败要写入 `memory/learnings/`
- heartbeat 会跑 evolution protocol
- 可以写 `evolution/blocklist.md`

对应：

- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_context.py:347`

这个做法的优点是“有意图、有链路”。
但问题是它还比较**宣言式**：

- 什么场景写 blocklist
- 什么场景写 strategy
- 何时该更新旧经验而不是新增
- 哪些经验是局部 session 的，哪些是 agent-level durable

这些没有形成像 Claude Code memory agent 那样细粒度、具备工具约束与更新策略的 prompt contract。

另外，auto_dream consolidation prompt 目前更像“合并事实”，不是“策略层进化”：

- `/Users/rocky243/vc-saas/Clawith/backend/app/services/auto_dream.py:203`

**结论**：Hive 现在有 feedback loop，但提示词层还没有把“自我进化”做成真正强约束、可持续、可控的策略系统。  
当前更准确的表述是：**有学习闭环，不是成熟的 evolution prompt architecture**。

---

## 哪些部分已经做对了

这次对比里，我认为 Hive 有几块已经明显站住：

1. **企业场景上下文注入是对的**
   - 角色、组织、公司信息、技能、关系、focus 都是数字员工所需要的，不是无意义膨胀。

2. **动态 suffix 结构是对的**
   - active packs、retrieval context、likely packs、suffix 已经开始分层。  
   - `/Users/rocky243/vc-saas/Clawith/backend/app/runtime/prompt_builder.py:107`

3. **压缩 prompt 已经从 narrative-first 进化到 state-first**
   - 这一点比很多系统强。  
   - `/Users/rocky243/vc-saas/Clawith/backend/app/services/conversation_summarizer.py:283`

4. **记忆抽取已经开始覆盖 tool/file/external 结果**
   - 说明不是只记“用户说过什么”。  
   - `/Users/rocky243/vc-saas/Clawith/backend/app/services/memory_service.py:635`

5. **coordinator mode 至少已经有独立 prompt 与独立 tool 过滤**
   - 虽然还不够精细，但不是没有。  
   - `/Users/rocky243/vc-saas/Clawith/backend/app/runtime/coordinator.py:38`

---

## 真正需要优化的地方

### P0.1 把主 prompt 从“大而全”改成“主合同 + 模式合同 + 工具合同”

不要继续往 `build_agent_context()` 里加规则。

应该拆成三层：

1. `identity/context layer`
   - agent name
   - role
   - company/org
   - personality
   - relationships

2. `operating contract layer`
   - 真实性
   - 工具使用原则
   - 何时必须写 focus/memory
   - 何时必须承认未验证

3. `mode-specific layer`
   - chat mode
   - task mode
   - coordinator mode
   - A2A mode
   - possibly HR/ops/research mode

目前这些内容在 Hive 里混得太厉害。

### P0.2 重写核心工具描述，把工具 schema 升级成行为合同

优先级最高的工具：

1. `read_file`
2. `write_file`
3. `edit_file`
4. `glob_search`
5. `grep_search`
6. `send_message_to_agent`
7. `delegate_to_agent`
8. `check_async_task`
9. `cancel_async_task`
10. `tool_search`
11. `load_skill`

每个工具描述至少要补四类内容：

1. 什么时候优先用它
2. 什么时候不要用它
3. 前置条件
4. 常见错误和替代路径

Hive 当前最缺的是这一层。

### P0.3 重写 A2A / task / coordinator prompt，使其成为强契约而不是短 suffix

建议：

1. A2A prompt 增加：
   - 可见性规则
   - 回复格式
   - 何时给答案、何时给状态、何时给 artifact
   - 对上游 agent 的协作责任

2. task execution prompt 增加：
   - 默认执行顺序
   - 何时 load skill
   - 何时记录中间状态
   - 结果报告结构
   - 遇到阻塞时如何自决策

3. coordinator prompt 增加：
   - 与 allowed tools 精确对齐
   - 明确允许直接读/写哪些 coordination 文件，禁止哪些 domain actions
   - delegation prompt 模板
   - worker 回传后的 synthesis checklist

### P0.4 把记忆/压缩/进化 prompt 统一成一个清晰的 prompt family

当前建议结构：

1. `session_snapshot_prompt`
   - 负责压缩恢复
2. `memory_extract_prompt`
   - 负责 durable facts
3. `memory_merge_prompt`
   - 负责去重/更新/冲突解析
4. `strategy_evolution_prompt`
   - 负责 strategy / blocked_pattern / reusable workflow

当前 Hive 有这些能力，但提示词家族没有被清楚命名和统一设计。

### P0.5 给 prompt 做“场景适配”，不要让所有 agent 都吃同一套大合同

Hive 是业务 agent 平台，不同 agent 的场景差异比 Claude Code 更大。

因此应该至少区分：

1. HR / 招聘类 agent
2. research / knowledge agent
3. operations / trigger agent
4. chat assistant agent
5. coordinator agent
6. worker agent

当前 Hive 的主 prompt 还是过于统一。

---

## 我认为不该优先做的事

### 1. 不要优先继续扩写主 prompt

这会进一步放大“主 prompt 过载”的问题。

### 2. 不要先做花哨的 prompt 技巧

比如更复杂的 XML wrapping、花式 meta-instructions、过多 few-shot。

当前最大的收益来自：

- 分层
- 对齐运行时
- 工具合同强化
- mode-specific contract

### 3. 不要只优化文案，不优化 prompt-to-runtime 对齐

如果 prompt 说“不要直接做 X”，但工具仍然暴露给模型且缺少说明，问题不会消失。

---

## 最终判断

### 现在的 Hive 提示词体系是否符合当前场景？

**部分符合。**

适合：

- 企业数字员工身份注入
- 多租户组织语境
- 有记忆、有 focus、有技能的业务 agent

不够强的场景：

- 复杂多代理协同
- 长任务自主执行
- 工具使用精度要求很高的 coding / ops / research
- 自我进化与策略沉淀

### 是否符合最佳 prompt engineering？

**还不能这么说。**

更准确地说：

- Hive 已经有一些正确方向
- 但整体还没有达到 Claude Code 那种“职责分层清楚、工具合同强、子代理合同强、记忆提示词体系成熟”的级别

### 与 Claude Code 的真实差距是什么？

不是“文风差距”，不是“写得不够长”。

而是这三件事：

1. **Prompt architecture**
2. **Tool-level contracts**
3. **Mode-specific operational prompts**

### 我给你的诚实结论

**Hive 当前提示词工程属于“业务可用、方向正确、但还有明显结构性优化空间”；Claude Code 则已经进入“prompt 作为运行时协议”的阶段。**

如果你要追上它，最该做的不是继续润色主 prompt，而是把 Hive 的 prompt 体系重构成：

- 一个更轻、更稳的主合同
- 一组更强的 mode prompt
- 一组更强的 tool contracts
- 一套更清晰的 memory/evolution prompt family

---

## 置信度与边界

我的结论置信度：**92%**

依据：

1. 我直接阅读并对比了 Hive 当前主 prompt、coordinator prompt、A2A prompt、task prompt、summarizer prompt、memory extraction prompt、retriever rerank prompt、auto_dream prompt。
2. 我直接阅读并对比了 Claude Code 当前主系统 prompt、dynamic boundary 机制、tool prompt、agent prompt、plan agent prompt、session memory prompt、memory extraction prompt、teammate addendum。
3. 我不是只看文案，而是结合了运行时装配方式一起判断。

边界：

1. 这是一份源码级 prompt 审计，不是线上 A/B 结果。
2. 我没有逐个模拟所有业务 agent 的真实对话回放，所以“最终线上效果差异”仍会受模型、工具、数据和用户输入影响。
3. 但对于“prompt 架构是否成熟、是否与当前场景匹配、是否明显弱于 Claude Code”，这个结论我认为已经足够稳定。
