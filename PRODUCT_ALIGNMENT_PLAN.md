# Hive 产品对齐实施稿

## 目标

把当前已经成型的 agent kernel，真正对齐到产品层表达。

当前后端内核的真实心智已经是：

- `minimal-by-default`
- `kernel tools + capability packs`
- `skill / MCP 显式扩展`
- `capability policy / approval / audit`
- `active_packs` 作为运行时状态

但前端和部分管理交互还停留在旧模型：

- 逐个工具开关
- 创建 Agent 时选择工具
- 用 `autonomy_policy` 表达权限
- 没有第一等的 `pack` 视图

所以这次对齐的目标不是“再重做一套 agent 框架”，而是：

> 把产品界面的语言、配置方式、管理方式，统一到新的 agent runtime 心智上。


## 结论

### 不需要大改的部分

- Chat 主时间线
- WebSocket / history 协议
- `parts / event / tool_call` 结构
- `active_packs` 事件链本身

这些部分方向已经对了，只需要继续产品化增强，不需要推倒重做。

### 必须改的部分

1. Agent 创建页
2. Agent 详情页中的 Tools / Settings / Approvals 相关交互
3. Enterprise Settings 中的工具治理表达
4. 后端面向前端的 pack/capability 读取接口


## 当前错位

### 1. 运行时已经是 pack 模型，但前端还是 tool 模型

后端当前已经有：

- `ToolPackSpec`
- `tool_search`
- `active_packs`
- `capability gate`

但前端仍然主要围绕：

- `Platform Tools`
- `Agent-Installed Tools`
- 单工具 enable/disable

这会导致用户理解偏差：

- 用户以为 agent 默认携带很多工具
- 用户以为配置的基本对象是“工具”
- 实际运行时却是“极简内核 + 按需激活能力包”

### 2. 创建 Agent 时仍然要求用户选工具

这和当前内核原则冲突。

现在更合理的创建对象应该是：

- 身份与定位
- 默认 skill
- 默认能力包入口
- 风险与审批边界
- 渠道连接

而不是：

- 勾选一堆工具

### 3. 权限模型表达还停留在旧 autonomy policy

当前系统里同时存在：

- `autonomy_policy`
- `capability policy`

运行时已经越来越靠 `capability` 收口，但前端 Agent 设置页仍在以动作级 L1/L2/L3 展示。

这会造成两个问题：

1. 同一套权限存在两种说法
2. 用户无法建立“能力包 -> capability -> approval -> audit”的完整认知

### 4. active_packs 已存在，但没有产品级展示层

现在 `active_packs` 已经能进入 chat timeline，但仍然更像运行时事件，而不是产品的一等对象。

产品层还缺：

- 当前 Agent 默认可激活哪些 packs
- 某个 skill 会带来哪些 packs
- 某个 pack 受哪些 capability/approval 限制
- 某个会话当前激活了哪些 packs


## 产品对齐原则

后续所有产品交互，统一遵守这 5 条原则：

1. 默认不讲“很多工具”，只讲“少量核心原语”
2. 默认不配置“单个工具”，优先配置“能力包”
3. 权限治理以 `capability` 为主，不再以工具名为主
4. `skill` 是能力入口，不只是文件模板
5. 渠道接入、skill、MCP 都是 pack 的激活来源


## 产品信息架构重构

### A. AgentCreate 重构

当前步骤：

- basicInfo
- personality
- skills
- permissions
- channel

建议改成：

1. `Identity`
   - 名称
   - 角色说明
   - 人设/职责
   - 服务对象

2. `Starter Capabilities`
   - 默认 skills
   - 推荐 capability packs
   - 默认工作方式说明

3. `Risk & Approval`
   - 风险档位
   - capability policy 模板
   - 是否允许自主触发/外部发送

4. `Channels`
   - Feishu / Slack / Discord / Teams / WeCom / DingTalk

5. `Review`
   - 最终摘要
   - 将创建出的 Agent 边界说明

明确删掉：

- 创建时选 `tool_ids`
- 创建时展示大工具表


### B. AgentDetail 重构

当前 tab:

- status
- aware
- mind
- tools
- skills
- relationships
- workspace
- chat
- activityLog
- approvals
- settings

建议保留大框架，但改其中 4 个页签的语义。

#### 1. Tools -> Capabilities

原 `tools` tab 改成 `capabilities` 视图，分 4 块：

- `Kernel`
  - 固定只读
  - 显示 `read/write/edit/glob/grep/skill/agent/trigger/send_output/tool_search`

- `Capability Packs`
  - 显示 pack 卡片
  - 每张卡片展示：
    - pack 名称
    - summary
    - 来源：system / skill / channel / mcp
    - 暴露工具
    - 是否需要渠道配置
    - 是否受 capability gate 限制

- `Installed MCP / External`
  - 仅展示已安装的外部扩展
  - 不与核心 pack 混在一起

- `Session Activations`
  - 展示最近会话中激活过的 packs
  - 帮助理解 agent 实际怎么工作

#### 2. Skills

保留技能文件浏览和导入能力，但 UI 语言改成：

- “技能会扩展哪些能力”
- “技能会激活哪些 packs”
- “技能依赖哪些渠道或外部资源”

避免只把 skill 当文件夹。

#### 3. Settings

拆成：

- `Execution & Boundaries`
  - 渠道身份
  - 是否允许外部发送
  - trigger 边界
  - workspace 边界

- `Capability Policy`
  - capability allow / deny / approval
  - 替代旧 autonomy action list

- `Access`
  - 谁能使用、谁能管理

#### 4. Approvals

审批页不只列记录，要能解释：

- 是哪个 capability 被卡住
- 对应哪个 tool / pack
- 由什么执行身份触发
- 批准后会实际执行什么


### C. EnterpriseSettings 重构

企业后台不再把重点放在“工具仓库”，而是放在治理与装配：

1. `Capability Policies`
2. `Approval Center`
3. `Audit`
4. `Channel Identities`
5. `Skill Registry`
6. `Pack Catalog`
7. `SSO / Organization`

其中 `Pack Catalog` 是新的一等页面，展示：

- 系统内建 packs
- 激活来源
- 暴露工具
- 风险说明
- 当前租户可用性


## 后端配套改造

这次不是只改前端，后端也要补 3 个面向产品层的接口。

### 1. Pack Catalog API

新增建议：

- `GET /api/v1/packs`
- `GET /api/v1/agents/{agent_id}/packs`
- `GET /api/v1/sessions/{session_id}/packs`

返回建议字段：

```json
{
  "name": "feishu_pack",
  "summary": "飞书消息、文档、日历与用户查询能力。",
  "source": "channel",
  "activation_mode": "通过 feishu skill 或已配置飞书渠道后显式使用",
  "tools": ["send_feishu_message", "feishu_doc_read"],
  "requires_channel": "feishu",
  "capabilities": ["channel.feishu.message", "channel.feishu.document"]
}
```

### 2. Agent Capability Summary API

新增建议：

- `GET /api/v1/agents/{agent_id}/capability-summary`

输出：

- kernel tools
- available packs
- active channel-backed packs
- skill-declared packs
- capability policies
- pending approvals count

这个接口会成为 AgentDetail 的核心数据源。

### 3. Session Runtime Summary API

新增建议：

- `GET /api/v1/chat/sessions/{session_id}/runtime-summary`

输出：

- activated packs
- used tools
- blocked/approved capabilities
- compaction count

这样前端不必从零散消息里拼全部状态。


## 前端实施顺序

### Phase 1: 可视化对齐

目标：先让用户看到新的真实模型。

改动：

1. AgentDetail 新增 `Capability Packs` 卡片区域
2. Chat / AgentDetail 的时间线事件增强
3. EnterpriseSettings 新增 `Pack Catalog` 页面

这一步不先删除旧工具页，只先加入新视图。

### Phase 2: 配置入口切换

目标：把用户配置对象从 tool 切到 pack/capability。

改动：

1. AgentCreate 删除工具选择
2. AgentDetail 的 ToolsManager 改成 CapabilityManager
3. Settings 中逐步隐藏旧 autonomy_policy 交互

### Phase 3: 治理统一

目标：权限、审批、审计全部用同一套语言。

改动：

1. Agent 侧 capability policy 面板
2. capability -> approval -> audit 链接跳转
3. 审批页显示 execution identity / capability / pack 来源

### Phase 4: 清理旧心智

目标：把旧工具化配置语言彻底移除。

改动：

1. 删除 AgentCreate 中 `tool_ids`
2. 删除旧 ToolsManager 的逐工具主交互
3. 前端文案统一从 `tool` 改为 `capability` / `pack`


## 推荐 PR 拆分

### PR1: Pack Catalog Read APIs

后端：

- `backend/app/api/packs.py`
- `backend/app/tools/packs.py`
- `backend/app/services/capability_gate.py`

前端：

- `frontend/src/services/api.ts`

目标：

- 拿到可展示的 pack catalog

### PR2: AgentDetail 新能力页

前端：

- `frontend/src/pages/AgentDetail.tsx`
- `frontend/src/components/CapabilityPackCard.tsx`

目标：

- 先把 `Capability Packs` 做出来
- 保留现有 tools tab 兼容

### PR3: AgentCreate 去工具化

前端：

- `frontend/src/pages/AgentCreate.tsx`

后端：

- 如有必要，允许创建接口完全不依赖 `_tool_ids`

目标：

- 创建 Agent 时不再选择工具

### PR4: Capability Settings 替换旧 autonomy 设置

前端：

- `frontend/src/pages/AgentDetail.tsx`
- `frontend/src/pages/EnterpriseSettings.tsx`

后端：

- `backend/app/api/capabilities.py`

目标：

- 让 Agent 侧权限设置和 Enterprise 侧治理语言一致

### PR5: 审批与审计链产品化

前端：

- `frontend/src/pages/AgentDetail.tsx`
- `frontend/src/pages/EnterpriseSettings.tsx`

后端：

- 审批链补更多上下文字段

目标：

- 审批和审计不再只是记录，而是可解释的运行轨迹


## 页面级建议

### Chat 页

只做增强，不做重写。

建议：

- 将 `pack_activation` 事件显示得更产品化
- 把工具细节默认折叠
- 对 `permission` 事件显示“等待审批”状态
- 顶部增加当前会话已激活 packs 胶囊

### AgentDetail 页

这是主战场。

优先级最高：

1. 能力包
2. capability policy
3. 审批解释
4. skill -> pack 关联

### EnterpriseSettings 页

这里是治理面，不是调试面。

需要突出：

- capability
- approval
- audit
- SSO
- channel identity

而不是把“工具列表”作为最显眼的入口。


## 数据语义统一

以后产品语言统一为：

- `Kernel Tools`
- `Capability Packs`
- `Skills`
- `Capabilities`
- `Approvals`
- `Execution Identity`
- `Audit Trail`

尽量减少这些旧说法：

- “给 Agent 打开某个工具”
- “Agent 默认拥有哪些工具”
- “L1/L2/L3 就是权限系统”

因为这会持续把产品拉回旧框架。


## 不该现在做的事

1. 不重做聊天时间线
2. 不重新设计整个 AgentDetail 框架
3. 不把 pack 系统做成复杂市场/商店
4. 不在这一轮引入 Local Connector 相关交互
5. 不继续强化“工具开关中心”这类旧概念


## 验收标准

完成这轮产品对齐后，应满足以下标准：

1. 创建 Agent 时，不再需要用户理解一堆工具
2. Agent 详情页能直接解释：
   - 核心原语是什么
   - 当前有哪些能力包
   - 哪些来自 skill
   - 哪些来自渠道
3. 权限页能直接解释：
   - 允许什么 capability
   - 什么需要审批
   - 被拒绝会发生什么
4. 审批与审计页能解释：
   - 哪个 capability 被触发
   - 对应哪个 pack / tool
   - 谁批准了它
5. 用户不再需要通过“平台工具列表”理解 Agent 能力


## 最终判断

当前最需要的不是继续改 runtime，而是把产品表达追上 runtime。

一句话说：

> 后端已经进入 `agent kernel + packs + capabilities` 时代，
> 前端和管理交互还停留在 `tool toggles + autonomy actions` 时代。

这轮产品对齐，本质上就是把这两个时代统一起来。
