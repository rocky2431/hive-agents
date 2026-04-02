# HR Agent 诊断报告 2026-04-02

## 结论

当前 HR-agent 的问题不是单点 bug，而是 **创建协议、能力发现、安装执行、交付确认** 四件事被耦合进了一条过长且脆弱的链路。

我对这个判断的置信度是 **95%**。依据来自当前代码的真实实现，而不是使用体验猜测。

当前状态可以概括成一句话：

- **HR-agent 很会“继续问”，但不够会“收敛成一个可用 agent”。**

这会直接导致你现在看到的四类现象：

1. 问得多，但产出的 agent 质量差
2. `soul.md` 很空，缺少真正的角色操作合同
3. MCP / ClawHub / skill 找得到但装不稳，或者根本装偏
4. 重复搜索、重复安装、部分成功后仍然返回“创建成功”

---

## 代码证据范围

这次诊断主要基于以下文件：

- `/Users/rocky243/vc-saas/Clawith/backend/hr_agent_template/soul.md`
- `/Users/rocky243/vc-saas/Clawith/backend/hr_agent_template/focus.md`
- `/Users/rocky243/vc-saas/Clawith/backend/hr_agent_template/skills/CREATE_EMPLOYEE.md`
- `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/hr.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_manager.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/services/resource_discovery.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/api/agents.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/api/skills.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/models/tool.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/models/skill.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/services/tool_seeder.py`
- `/Users/rocky243/vc-saas/Clawith/backend/tests/tools/test_hr_handler.py`

---

## 当前真实数据流

### 1. HR-agent 对话协议

当前 HR-agent 的 `soul.md` 强制一套 **5 轮协议**：

- Round 1 DEFINE
- Round 2 EQUIP
- Round 3 SCHEDULE
- Round 4 CUSTOMIZE
- Round 5 REVIEW & DELIVER

并且要求：

- 会话一开始先 `write_file` 一个 `workspace/draft_YYYYMMDD_HHMM.md`
- 每轮都 `read_file -> write_file` 全量重写
- 最后再从 draft 中读取全部字段去调用 `create_digital_employee`

对应文件：

- `/Users/rocky243/vc-saas/Clawith/backend/hr_agent_template/soul.md`
- `/Users/rocky243/vc-saas/Clawith/backend/hr_agent_template/focus.md`

### 2. 能力发现链路

Round 2 的默认顺序是：

1. `load_skill(name="create_employee")`
2. `search_clawhub(...)`
3. `discover_resources(...)`

也就是：

- 先外部找 marketplace skill
- 再找 MCP server
- 再决定最终 `skill_names / clawhub_slugs / mcp_server_ids`

对应文件：

- `/Users/rocky243/vc-saas/Clawith/backend/hr_agent_template/skills/CREATE_EMPLOYEE.md`

### 3. 真正创建 agent

`create_digital_employee` 当前行为是：

1. 创建 `Agent`
2. 创建 `Participant`
3. 写权限
4. 赋默认工具
5. 初始化 agent 文件
6. 写 `focus.md`
7. 拷贝默认 skills + 额外 `skill_names`
8. 启动容器
9. `db.commit()`
10. **commit 之后** 再安装 MCP 与 ClawHub skill
11. 无论安装是否完整成功，最终都返回 `"status": "success"`

对应文件：

- `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/hr.py`

### 4. `soul.md` 的生成方式

创建出来的 agent 的 `soul.md` 不是由 HR 会话内容进行深度综合，而是：

- 先复制基础模板 `/backend/agent_template/soul.md`
- 再做几个 placeholder 替换
- 再把用户传入的 `personality`、`boundaries` 直接 append 到文件后面

对应文件：

- `/Users/rocky243/vc-saas/Clawith/backend/agent_template/soul.md`
- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_manager.py`

这就是为什么你会觉得创建出来的 `soul.md` 很“薄”。

---

## 核心问题

## P0-1. HR-agent 会话协议过重，导致收敛能力差

### 现象

- 问题很多
- 每轮都要维持 draft 文件
- 每轮都要全量重写内容
- 容易出现中途漂移、漏字段、反复确认

### 根因

当前协议把下面几类任务都塞进了同一条对话链：

- 需求访谈
- 角色设计
- 能力选型
- 安装决策
- 定时任务设计
- 交付验收

这不是“咨询流程”，而是“全栈创建流水线”。

### 影响

- 用户疲劳
- LLM 在长对话里更容易忘记前文
- draft 文件本身成了负担，而不是帮助
- 最后生成的 spec 经常是拼接出来的，而不是收敛出来的

### 建议

把 5 轮协议改成 **2 阶段模型**：

#### 阶段 A：生成结构化 Agent Spec

目标只做一件事：产出一个结构化 spec。

建议字段：

```json
{
  "name": "",
  "role_description": "",
  "primary_operating_style": "",
  "boundaries": [],
  "permission_scope": "self|company",
  "builtin_capabilities": [],
  "extra_skill_candidates": [],
  "mcp_candidates": [],
  "triggers": [],
  "welcome_message": "",
  "focus_seed": "",
  "heartbeat_topics": []
}
```

#### 阶段 B：预览 + 确认 + 创建

只展示：

- 核心角色
- 会装什么
- 哪些需要额外配置
- 哪些项还没准备好

确认后才调用创建。

不要再让 HR-agent 在会话中维护一个逐轮全文重写的 markdown draft。

---

## P0-2. 能力发现默认走 marketplace，路径错了

### 现象

HR-agent 当前在 Round 2 默认鼓励：

- 搜 ClawHub
- 搜 MCP marketplace

### 根因

默认策略是“先扩展能力，再创建 agent”，而不是“先尽量用平台内建能力”。

### 当前代码里的证据

`CREATE_EMPLOYEE.md` 明确让 HR-agent：

1. `discover_resources(...)`
2. `search_clawhub(...)`

而且 `create_digital_employee` 参数里把：

- `skill_names`
- `clawhub_slugs`
- `mcp_server_ids`

都当成创建时可以直接塞进去的标准配置。

### 影响

- 为了“找更合适的能力”而频繁外搜
- 经常把 agent 设计问题变成 marketplace 搜索问题
- 很容易过装、错装、重复装

### 建议

把能力匹配策略彻底改成：

1. **默认能力优先**
   - 默认 builtin tools
   - 默认 builtin skills
   - 已有 office/search/feishu/email 能力优先
2. **只有 builtin 不够时** 才进入：
   - 非默认 platform skills
   - MCP
   - ClawHub
3. **HR-agent 默认不主动外搜**
   - 只有用户明确说“需要连接一个当前平台没有的外部系统”
   - 或 spec 检测到平台缺能力
   - 才触发 `discover_resources / search_clawhub`

一句话：

- **HR-agent 应该先做能力路由，不应该先做能力采购。**

---

## P0-3. 创建返回“成功”，但能力安装其实还是半成品

### 现象

现在创建接口成功，不代表 agent 真的 ready。

### 根因

`create_digital_employee` 在 `db.commit()` 之后才做：

- MCP install
- ClawHub install

这意味着：

- agent 已经存在
- 返回 JSON 里 `status = success`
- 但扩展能力仍可能只装了一半，甚至完全失败

### 影响

- 用户以为创建成功了
- 但新 agent 根本没有预期能力
- “初始化出来的 agent 基本上不太能用” 这个反馈完全符合当前代码

### 建议

把创建流程拆成：

#### `preview_agent_blueprint`

只生成预览，不落库。

输出：

- 将创建的 agent spec
- 将使用的 builtin/default skills
- 将尝试安装的 MCP / ClawHub
- 需要额外密钥/认证的项
- 风险与未准备项

#### `create_agent_from_blueprint`

执行真正创建，并把安装过程建模成状态机：

- `draft`
- `provisioning`
- `ready`
- `ready_with_warnings`
- `failed`

并返回结构化结果：

```json
{
  "agent_id": "...",
  "status": "ready_with_warnings",
  "created_core": true,
  "skills": [...],
  "mcp": [...],
  "warnings": [...],
  "manual_steps": [...]
}
```

不要再用一句“Successfully created”掩盖后续安装失败。

---

## P0-4. `soul.md` 生成太弱，是当前 agent 质量差的核心原因之一

### 现象

创建出来的 `soul.md` 很简陋。

### 根因

当前逻辑只是：

- 用 `/backend/agent_template/soul.md` 作为基底
- 替换 `{{agent_name}} / {{role_description}} / {{creator_name}} / {{created_at}}`
- append `personality`
- append `boundaries`

而基础模板本身就非常薄：

- Identity
- 默认 Personality 三条
- 默认 Boundaries 两条

### 影响

即使 HR-agent 问了很多问题，创建出的 agent 仍然拿不到：

- 角色任务边界
- 输出标准
- 决策原则
- 工具使用优先级
- 沟通风格
- 风险行为限制

### 建议

把 `soul.md` 改成 **由结构化 spec 合成**，不是模板替换。

推荐结构：

```md
# Soul — <name>

## Identity & Mission
## What Good Looks Like
## Operating Style
## Decision Rules
## Tool Preferences
## Communication Contract
## Boundaries & Red Lines
## Early Focus
```

其中：

- `What Good Looks Like` 来自 role + output expectations
- `Decision Rules` 来自 personality + boundaries + permission_scope
- `Tool Preferences` 来自 builtin-first routing
- `Early Focus` 来自 `focus_content + heartbeat_topics`

这一步必须在创建时自动完成，而不是靠后续 agent 自己慢慢学。

---

## P0-5. `focus.md` 目前只是“初始备注”，不是启动引导

### 现象

当前只会把：

- `focus_content`
- `heartbeat_topics`

简单写进 `focus.md`

### 根因

`focus.md` 现在只是一个文本承载点，不是 onboarding contract。

### 建议

把 HR 创建时的 `focus.md` 改成结构化启动文档：

```md
# Focus

## Initial Mission
## First 3 Tasks
## Required Capabilities Already Installed
## Capabilities Still Needing Human Setup
## Heartbeat Exploration Topics
## First Success Check
```

这样用户第一次打开新 agent，就能知道：

- 这个 agent 该先做什么
- 哪些能力已经 ready
- 哪些还差配置

---

## P0-6. 安装链路没有统一的“幂等安装模型”

### 现象

你提到“后台挤满重复 MCP 和 skill”，这个反馈和当前代码结构是对得上的。

### MCP 当前问题

`import_mcp_from_smithery` 有 dedup，但它是：

- 基于 `Tool.name` 前缀
- 再加上 `mcp_tool_name + mcp_server_name`
- 最后再判断 `AgentTool` 是否已有

这属于 **启发式 dedup**，不是稳定的安装身份模型。

对应文件：

- `/Users/rocky243/vc-saas/Clawith/backend/app/services/resource_discovery.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/models/tool.py`

### ClawHub 当前问题

HR-agent 安装 ClawHub skill 时 **绕过了全局 skill registry**，直接：

- 拉 ClawHub metadata
- 拉 GitHub 文件
- 写进 `agent_dir/skills/<slug>/`

这意味着：

- 没有统一安装记录
- 没有统一幂等层
- 没有统一版本/来源状态
- 没有统一失败恢复

对应文件：

- `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/hr.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/api/skills.py`

### 更关键的一点

`skill_names` 里如果传了不存在的 skill，当前逻辑会 **静默忽略**。

这会进一步让“创建成功但能力不对”更隐蔽。

### 建议

新增一个一等公民安装表，建议叫：

`agent_capability_installs`

字段建议：

```text
agent_id
kind                # builtin_skill | platform_skill | clawhub_skill | mcp_server
source_key          # folder_name / slug / server_id
normalized_key      # 规范化后的幂等键
status              # pending | installed | failed | skipped
version_or_hash
installed_via       # hr_agent | manual | trigger | migration
error_code
error_message
metadata_json
created_at
updated_at
```

然后统一规则：

- 创建 agent 时先生成 install plan
- plan 里每个 capability 都算一条 install record
- 真正 apply 时按 `normalized_key` 去重
- 重复请求时只更新状态，不再重复安装

---

## P0-7. HR-agent 当前“推荐安装”与“可实际使用”没有闭环

### 现象

HR-agent 会推荐能力，但没有真正校验：

- key 是否存在
- provider 是否可用
- channel/CLI/auth 是否 ready

### 影响

最后生成的 agent 看起来很完整，但实际上：

- Feishu 可能没 auth
- Email 可能没配
- MCP 可能没 key
- ClawHub skill 可能只是复制了文件

### 建议

HR 预览阶段必须把能力分成三类：

1. `Ready now`
2. `Will be installed`
3. `Needs setup after creation`

例如：

```md
Ready now:
- web_search
- web_fetch
- run_command
- feishu docs/wiki (CLI ready)

Will install:
- atlassian_rovo MCP

Needs setup after creation:
- email SMTP config
- Feishu channel binding
```

这样用户才能知道交付的是“可运行 agent”还是“半成品 skeleton”。

---

## P0-8. HR-agent 的测试覆盖几乎只保证“工具存在”，不保证“创建质量”

### 当前测试事实

`backend/tests/tools/test_hr_handler.py` 目前只验证：

- `create_digital_employee` 已注册
- schema 有这些字段
- HR tools 集合包含某些工具
- 返回结构化 JSON

它没有覆盖：

- 过长 5 轮协议是否真的收敛
- `skill_names` 不存在时是否报错
- MCP/ClawHub 半失败时是否仍报告 success
- `soul.md` / `focus.md` 生成质量
- 重复安装是否幂等

### 建议

新增测试分层：

1. `test_hr_blueprint_generation.py`
2. `test_hr_install_plan.py`
3. `test_hr_agent_soul_generation.py`
4. `test_hr_agent_focus_generation.py`
5. `test_hr_capability_idempotency.py`

---

## 我建议的整改方案

## Phase 1：先把 HR-agent 从“重咨询流程”改成“结构化招聘器”

### 目标

- 少问
- 快收敛
- 明确区分默认能力和扩展能力
- 创建前就知道哪些会 ready

### 具体改动

#### 1. 重写 HR-agent `soul.md`

文件：

- `/Users/rocky243/vc-saas/Clawith/backend/hr_agent_template/soul.md`
- `/Users/rocky243/vc-saas/Clawith/backend/hr_agent_template/focus.md`
- `/Users/rocky243/vc-saas/Clawith/backend/hr_agent_template/skills/CREATE_EMPLOYEE.md`

改法：

- 5 轮改成 2 阶段
- 停止要求逐轮维护 draft markdown
- 内建优先，不默认 marketplace 搜索

#### 2. 引入 `preview_agent_blueprint`

新增工具：

- `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/hr.py`

作用：

- 不创建 agent
- 只输出结构化 blueprint + install plan + warnings

#### 3. `create_digital_employee` 只接受 blueprint apply

当前工具改成：

- 严格校验 spec
- 先做 install plan
- 再执行 create
- 最终返回 ready/warnings/failed 状态

---

## Phase 2：补强创建后产物质量

### 目标

- `soul.md` 变成真正可工作的合同
- `focus.md` 变成 onboarding guide

### 具体改动

文件：

- `/Users/rocky243/vc-saas/Clawith/backend/app/services/agent_manager.py`

改法：

- 把简单 placeholder 替换改成 spec-driven synthesis
- 单独抽一个：
  - `_render_agent_soul_from_blueprint(...)`
  - `_render_agent_focus_from_blueprint(...)`

---

## Phase 3：重构安装系统，解决重复安装和半成功

### 目标

- MCP / ClawHub / 平台 skill 安装有统一幂等层
- 安装状态可见
- 不再“创建成功但能力没齐”

### 具体改动

新增：

- `agent_capability_installs` model
- `CapabilityInstallService`

涉及文件：

- `/Users/rocky243/vc-saas/Clawith/backend/app/models/`
- `/Users/rocky243/vc-saas/Clawith/backend/app/services/resource_discovery.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/api/skills.py`
- `/Users/rocky243/vc-saas/Clawith/backend/app/tools/handlers/hr.py`

原则：

- ClawHub 安装不要再在 HR handler 里直接下载写文件
- 统一走安装服务
- MCP dedup 不再只看工具名猜测

---

## 优先级

### 必须先做

1. 重写 HR 对话协议
2. 新增 blueprint preview/apply
3. 改 `soul.md` / `focus.md` 生成方式
4. 把 marketplace 安装改成统一 install plan/apply

### 第二批再做

1. 能力状态 UI
2. 安装状态 UI
3. 更细的评分和回访

---

## 我对现状的最终判断

### 现在最真实的问题不是：

- “某个 MCP 装不上”
- “某个 skill 提示词不够好”

### 而是：

- **HR-agent 现在承担了太多职责，但没有统一的 spec 和 install 状态模型。**

因此它会表现成：

- 问很多
- 推荐很多
- 安装很多
- 但交付质量不稳定

---

## 下一步实施顺序

如果现在直接开始修，我建议严格按这个顺序：

```bash
1. 先重写 HR-agent prompt/template（2阶段 blueprint）
2. 再给 hr.py 增加 preview/apply 双工具
3. 再重构 soul/focus 生成
4. 最后重构 capability install 幂等层
```

这是 ROI 最高、也最能快速改善“第一入口体验”的顺序。
