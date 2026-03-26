# Hive 最终方案：Cloud Control + Desktop Runtime

> Date: 2026-03-26
> Status: Final
> This document is the only active plan for Hive Cloud + Desktop integration.
> Supersedes: `INTEGRATION.md`, `ARCHITECTURE_PROPOSAL.md`

---

## 1. 最终结论

Hive 的最终产品形态确定为：

- Cloud：企业控制平面
- Desktop：员工本地运行时

这不是“两套独立产品”，而是“一套企业控制面 + 一套本地执行面”。

当前代码现实决定了实施策略必须分阶段：

1. 先保留 HiveDesktop 的本地 Agent Runtime。
2. 先让 Cloud 接管认证、模型、配额、策略、审计。
3. 再把 Cloud 的 Agent 定义投影到 Desktop。
4. 最后才考虑实时桥接、本地工具远程调度、Tauri 重构。

本方案明确拒绝两件事：

- 不在 Phase 1 就做 Cloud Kernel 远程执行 Desktop 工具。
- 不在 Phase 1 就重写 Desktop 壳为 Tauri。

---

## 2. 基本判断

### 2.1 当前真实基础

Clawith 已具备：

- 多租户、用户、部门、权限、配额、审计基础
- WebSocket 聊天入口
- OpenAI-compatible LLM proxy
- 企业后台与渠道基础设施

HiveDesktop 已具备：

- 本地 Agent Runtime
- 主/子 Agent 配置模型
- 本地工具、MCP、技能系统
- Zone Guard / Egress Guard
- 桌面启动壳和本地 Web 控制台

### 2.2 当前真实断层

当前最大问题不是“能力缺失”，而是“职责切分尚未统一”：

- Cloud 现在仍会直接运行完整 Agent Runtime
- Desktop 现在也会直接运行完整 Agent Runtime
- 两边都像“大脑”，而不是“Cloud 决策 + Desktop 执行”

所以最终方案的关键不是继续写概念文档，而是收敛真源、减少双写、分阶段迁移。

---

## 3. 最终设计原则

### 3.1 唯一真源

以下信息只允许 Cloud 作为真源：

- 用户身份
- 租户与部门
- 角色
- Main Agent / Sub-Agent 定义
- Role Template
- LLM 模型池与配额
- Guard 策略
- 企业级审计
- 企业渠道配置

以下信息允许 Desktop 本地持有，但只作为缓存或本地状态：

- AgentProfileConfig 投影
- AGENTS.md / 本地工作区
- 本地会话历史
- 本地 Guard 缓存
- MCP 配置
- 本地偏好设置

### 3.2 先统一控制面，再考虑执行桥

先做：

- Auth Bridge
- Bootstrap / Sync
- Policy Sync
- Audit Upload
- Main/Sub Agent 云端模型

后做：

- Cloud -> Desktop 工具桥接
- Channel 实时转发桥
- Tauri 重构

### 3.3 兼容现有代码，不强行统一框架

Cloud 使用 Clawith 现有 FastAPI + SQLAlchemy + AgentKernel 体系。

Desktop 使用 HiveDesktop 现有 CoPaw Runtime 体系。

两边不要求统一为一个运行时框架。统一的是：

- Agent 定义数据
- 认证
- 模型出口
- Guard 策略
- 审计协议

---

## 4. 最终职责边界

| 领域 | Cloud | Desktop |
|------|-------|---------|
| 身份认证 | 真源 | 仅消费 |
| JWT/刷新 | 真源 | 仅持有 |
| 租户/角色/部门 | 真源 | 仅缓存 |
| Main/Sub Agent 定义 | 真源 | 投影成本地配置 |
| Role Template | 真源 | 不编辑 |
| LLM Provider/API Key | 真源 | 不持有第三方密钥 |
| LLM 调用 | 统一出口 | 经 Cloud 代理调用 |
| 本地文件/MCP/命令执行 | 不执行 | 真执行 |
| Guard 策略定义 | 真源 | 本地 enforce |
| Guard 决策 | 汇总审计 | 真执行 |
| Conversation 全量内容 | 不保存全文 | 本地保存 |
| 审计事件 | 真汇总 | 上报 |
| 企业渠道 | 真源 | 后续接收转发 |

---

## 5. 最终技术路线

### 5.1 Cloud

Cloud 是企业控制平面，负责：

- 登录与单点身份
- 角色与部门分配
- Role Template 管理
- 员工 Main Agent 自动分配
- Sub-Agent 元数据管理
- LLM 路由、配额、计量
- Guard 策略管理
- 审计聚合
- 企业级渠道管理

### 5.2 Desktop

Desktop 是员工本地运行时，负责：

- 本地聊天界面
- 本地 Agent Runtime
- 本地文件与命令工具
- 本地 MCP
- 本地 Guard 执行
- 本地工作区与会话缓存
- 审计回传

### 5.3 LLM 调用

最终决策：

- Desktop 不直连 OpenAI / Anthropic / DeepSeek
- Desktop 不存第三方模型密钥
- Desktop 一律经 Cloud `/api/llm/v1/*` 调用模型

离线策略：

- 当前主线方案接受“Cloud 不可达时，LLM 推理不可用”
- 离线状态下，Desktop 仍可访问本地工作区、历史会话、MCP 配置和 Guard 缓存
- 但任何需要模型推理的能力默认不可用
- 本地主模型 fallback 不是当前主线的一部分，只能作为后续企业可选能力，并且必须由 Cloud 策略显式开启

### 5.4 桌面壳

最终决策：

- 当前阶段继续使用 HiveDesktop 现有桌面壳
- 不把 Tauri 作为近期前置条件
- Tauri 只作为后续可选优化项

理由：

- 现在最值钱的是企业控制平面集成，不是换壳
- 换壳不能解决身份、策略、审计、数据真源问题

---

## 6. 最终数据模型

### 6.1 Cloud `agents` 表

保留现有 `agent_type`，其语义继续表示执行后端：

- `native`
- `openclaw`

新增字段：

```sql
ALTER TABLE agents
  ADD COLUMN agent_kind VARCHAR(10) NOT NULL DEFAULT 'main',
  ADD COLUMN parent_agent_id UUID NULL REFERENCES agents(id),
  ADD COLUMN owner_user_id UUID NULL REFERENCES users(id),
  ADD COLUMN channel_perms BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN config_version INTEGER NOT NULL DEFAULT 1;
```

语义：

- `agent_type`：运行后端类型
- `agent_kind`：业务形态，`main|sub`
- `owner_user_id`：该 Agent 归属的员工
- `parent_agent_id`：Sub-Agent 指向 Main Agent

约束：

- 每个 `owner_user_id` 只能有一个 `agent_kind='main'`
- 只有 `main` 可以拥有 `channel_perms=true`

前置关系：

- 该表扩展是 `/api/desktop/bootstrap` 正确返回 `main_agent` 与 `sub_agents` 的前提
- 因此它属于主线早期基础改造，不应晚于 Bootstrap 实现

### 6.2 Cloud `agent_templates` 表

扩展为 Role Template：

```sql
ALTER TABLE agent_templates
  ADD COLUMN tenant_id UUID REFERENCES tenants(id),
  ADD COLUMN department_id UUID REFERENCES departments(id),
  ADD COLUMN model_id UUID REFERENCES llm_models(id),
  ADD COLUMN config_version INTEGER NOT NULL DEFAULT 1;
```

用途：

- 按部门自动为员工分配 Main Agent
- 提供 system prompt / skills / default model

### 6.3 Cloud `guard_policies` 表

新增：

```sql
CREATE TABLE guard_policies (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id),
  version INTEGER NOT NULL DEFAULT 1,
  zone_guard JSONB NOT NULL DEFAULT '{}'::jsonb,
  egress_guard JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

说明：

- Guard 策略真源只在 Cloud
- Desktop 只做缓存与执行

### 6.4 Desktop `AgentProfileConfig`

保留现有 `agent_type=main|sub` 字段。

新增建议字段：

```json
{
  "cloud_agent_id": "uuid",
  "cloud_config_version": 7,
  "managed_by": "cloud",
  "channel_perms": true
}
```

语义：

- `cloud_agent_id`：映射 Cloud `agents.id`
- `cloud_config_version`：用于增量同步
- `managed_by=cloud`：该 Agent 是云端投影对象
- `channel_perms`：仅 Main Agent 为 true

### 6.5 JWT 存储

最终决策：

- Cloud JWT 不存入普通 `config.json`
- Cloud JWT 存到 Desktop secret 存储目录
- `HiveCloudConfig` 中只保留非敏感配置：`enabled/base_url`

### 6.6 同步版本模型

最终决策：

- `/api/desktop/sync?v={n}` 中的 `v` 定义为租户级全局 `sync_version`
- 任何会影响 Desktop 可见状态的资源变化，都要 bump 这个全局版本
- 包括：Agent 定义、Role Template 投影结果、Guard 策略、LLM 默认配置

同时保留资源级版本号：

- `agents.config_version`
- `agent_templates.config_version`
- `guard_policies.version`

语义分工：

- `sync_version`：用于 Desktop 快速判断“是否需要重新同步”
- 资源级版本：用于调试、冲突排查、局部比对和审计

---

## 7. 最终 API 设计

### 7.1 Auth Bridge

新增 Cloud 端点：

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/auth/feishu/authorize` | 为 Desktop 发起飞书登录 |
| GET | `/api/auth/feishu/callback-desktop` | 飞书回调后 302 到 Desktop deep link |
| POST | `/api/auth/desktop/exchange` | 刷新 Desktop JWT |
| GET | `/api/auth/me` | 返回当前用户基础信息 |

最终流程：

```text
Desktop -> Cloud authorize
Cloud -> Feishu OAuth
Feishu -> Cloud callback
Cloud -> copaw://auth/callback?token=...
Desktop 保存 Cloud JWT
Desktop 后续访问 Cloud API 全部带该 JWT
```

最终要求：

- Desktop 不再直接请求飞书 OAuth
- Desktop 本地认证体系不再作为企业登录真源

### 7.2 Bootstrap / Sync

新增 Cloud 端点：

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/desktop/bootstrap` | 全量初始化 |
| GET | `/api/desktop/sync?v={n}` | 增量同步 |

`bootstrap` 返回：

- sync_version
- user
- main_agent
- sub_agents
- policy
- llm_config

Desktop 收到后执行：

1. 建立或更新本地 Main Agent
2. 建立或更新本地 Sub-Agent
3. 写入 `AGENTS.md`
4. 设置 `active_model = hive-cloud`
5. 应用 Guard 策略缓存

`sync` 版本语义：

- `v` 是全局 `sync_version`
- 当 `sync_version` 未变化时，Cloud 返回 `not_modified=true`
- 当 `sync_version` 变化时，Cloud 返回新的 `sync_version` 以及所有已变化资源

### 7.3 Desktop Agent 管理

新增 Cloud 端点：

| Method | Path | 用途 |
|--------|------|------|
| POST | `/api/desktop/agents` | 创建 Sub-Agent |
| PATCH | `/api/desktop/agents/{id}` | 更新 Sub-Agent |
| DELETE | `/api/desktop/agents/{id}` | 删除 Sub-Agent |

规则：

- Desktop 只能创建和管理 Sub-Agent
- Main Agent 由 Cloud 自动下发

### 7.4 Guard 策略管理

新增 Cloud 管理端点：

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/guard-policies` | 获取 Guard 策略 |
| PUT | `/api/guard-policies` | 更新 Guard 策略 |

### 7.5 审计接收

新增 Cloud 端点：

| Method | Path | 用途 |
|--------|------|------|
| POST | `/api/desktop/audit/events` | 批量工具/操作审计 |
| POST | `/api/desktop/audit/guard-events` | Guard 拦截事件 |

### 7.6 已有可复用端点

保持使用：

| Method | Path |
|--------|------|
| GET | `/api/llm/v1/models` |
| POST | `/api/llm/v1/chat/completions` |

---

## 8. 最终同步规则

### 8.1 Cloud -> Desktop 投影规则

Cloud 管理字段覆盖本地：

- name
- description
- system prompt
- active model
- agent_type
- parent_id
- channel_perms
- cloud_config_version

Desktop 本地字段保留：

- workspace 内容
- 本地会话
- MCP 配置
- 用户偏好
- 本地缓存

### 8.2 冲突规则

最终规则：

- `managed_by=cloud` 的 Agent，云端字段优先
- 本地对云管字段的修改，在下一次 sync 被覆盖
- 仅本地扩展配置允许保留

### 8.3 策略同步

最终规则：

- Desktop 定时轮询 `/api/desktop/sync`
- 版本变化才拉新策略
- 离线时继续使用最近一次缓存

同步粒度：

- 轮询基于全局 `sync_version`
- 资源内部仍保留各自的 `config_version`
- Desktop 不使用单一资源版本号替代全局版本号

---

## 9. 最终安全方案

### 9.1 身份

- 只认 Cloud JWT
- Desktop 本地 user auth 不再作为企业身份真源
- 本地 auth 仅保留为开发模式或单机兼容模式

### 9.2 Guard

- Guard 定义在 Cloud
- Guard 执行在 Desktop
- Guard 事件回传到 Cloud

### 9.3 审计

- Cloud 只保留审计与摘要，不保留本地全文对话
- Desktop 保留本地完整会话

### 9.4 密钥

- 企业模型 API Key 只在 Cloud
- Desktop 不保存第三方模型密钥
- Desktop 只保存 Cloud JWT / refresh token

---

## 10. 最终实施顺序

### Phase 1: Auth Bridge

目标：

- Desktop 登录全部走 Cloud

交付：

- Cloud Desktop OAuth 端点
- Desktop 改为 Cloud 委托登录
- Cloud JWT 安全存储

### Phase 2: Schema Foundation + Bootstrap + Agent Projection

目标：

- 为 Cloud -> Desktop Agent 投影建立最小可用数据基础，并完成首轮同步

交付：

- `agents` 表扩展：`agent_kind / parent_agent_id / owner_user_id / channel_perms / config_version`
- `agent_templates` 表扩展：`tenant_id / department_id / model_id / config_version`
- Cloud `/api/desktop/bootstrap`
- Desktop `hive_sync.py`
- 本地 `AgentProfileConfig` 扩展

### Phase 3: Policy Sync

目标：

- Guard 策略云端统一管理，本地下发执行

交付：

- `guard_policies` 表
- Cloud Guard API
- Desktop 定时 sync

### Phase 4: Audit Upload

目标：

- Desktop 行为可审计

交付：

- Desktop `hive_audit.py`
- Cloud 审计接收端点

### Phase 5: Role Template Automation + Main Agent Provisioning

目标：

- 完成基于部门和模板的自动分配，真正让 Cloud 成为 Agent 业务定义真源

交付：

- Role Template 管理闭环
- 部门 -> 模板映射
- 首次登录自动下发 Main Agent

### Phase 6: Company-level Channel Routing

目标：

- 渠道由“每 Agent 配置”迁移到“每企业一个 Bot + 按发信人路由”

交付：

- 企业级 channel config
- sender -> Main Agent 路由

### Phase 7: Optional Bridge / Optional Tauri

目标：

- 只在前 6 个阶段稳定后，再评估是否需要：

可选项：

- Cloud -> Desktop WebSocket bridge
- 实时 channel forwarding
- Tauri 重构

---

## 11. 明确不做

当前阶段明确不做：

- 不先重写为 Tauri
- 不先做 Cloud Kernel 远程调本地工具
- 不让 Desktop 持有第三方模型密钥
- 不让 Desktop 成为身份真源
- 不保留多份平行架构文档

---

## 12. 验收标准

达到以下条件，视为主线方案成立：

1. Desktop 可以通过 Cloud 完成飞书登录。
2. Desktop 启动后能从 Cloud 获取 Main Agent、Sub-Agent、策略、模型配置。
3. 本地 Agent 的模型出口统一切到 Cloud `/api/llm/v1/*`。
4. 本地文件/MCP/命令工具仍然可用。
5. 管理员修改 Guard 策略后，Desktop 可在一个同步周期内生效。
6. Desktop 工具执行和 Guard 拦截可回传审计。
7. 新员工首次登录后，Cloud 能自动分配 Main Agent。

---

## 13. 文档治理

本仓库关于 Hive Cloud + Desktop 主线方案，只保留本文件：

- `ARCHITECTURE.md`

以下文档已被本文件吸收并废弃：

- `INTEGRATION.md`
- `ARCHITECTURE_PROPOSAL.md`

其他与本主线无直接关系的 proposal / plan 文件暂不处理。
