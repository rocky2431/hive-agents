# Hive Cloud ↔ Desktop Integration Plan

> Date: 2026-03-26
> Status: Confirmed direction, ready for implementation

---

## 1. Auth Flow: Desktop 通过 Cloud 认证

Desktop 不直接对接飞书。所有认证走 Cloud。

```
员工打开 Desktop → 点飞书登录
  → Desktop 打开浏览器到 Cloud:
    GET {CLOUD}/api/auth/feishu/authorize?redirect_uri=copaw://auth/callback
  → Cloud 302 重定向到飞书 OAuth
  → 员工在飞书授权
  → 飞书回调到 Cloud
  → Cloud 执行 login_or_register (已有逻辑)
  → Cloud 302 重定向到 Desktop:
    copaw://auth/callback?token={cloud_jwt}
  → Desktop 存储 Cloud JWT
  → 后续所有 API 调用用这个 JWT
```

Cloud JWT 已包含: `{sub: user_id, role: "member", tid: tenant_id}`
Desktop 解析 JWT 得到角色，决定显示什么页面。

### Cloud 需新增的端点

| Method | Path | 说明 |
|--------|------|------|
| GET | /api/auth/feishu/authorize | 重定向到飞书 OAuth（给 Desktop 用）|
| GET | /api/auth/feishu/callback-desktop | 飞书回调，302 到 Desktop deep link |
| POST | /api/auth/desktop/exchange | 刷新 JWT |

### Desktop 改动

- `feishu_auth.py`: 重写为 Cloud 委托模式（不再直连飞书）
- `auth.py`: Cloud JWT 验证路径（hive_cloud.enabled 时）
- 存 Cloud JWT 到 `HiveCloudConfig.api_key`

---

## 2. Agent 模板同步: Cloud Template → Desktop Agent Config

### 框架不兼容的解决方案

Cloud (AgentKernel) 和 Desktop (AgentScope ReActAgent) 是不同框架。
不需要统一框架——只需要统一 **Agent 定义数据**。

```
Cloud 存储 (DB):                    Desktop 消费 (文件):
─────────────                      ─────────────────
agent_templates 表                  AgentProfileConfig
  soul_template (text)     →→→      AGENTS.md (system prompt)
  default_skills (json)    →→→      active_skills/ 目录
  model_id → llm_models    →→→      active_model: {provider: "hive-cloud", model: "gpt-4o-mini"}
  department_id            →→→      自动按部门分配
```

### Bootstrap 端点: `GET /api/desktop/bootstrap`

员工登录后 Desktop 调用一次，拿到所有需要的数据：

```json
{
  "user": {
    "id": "uuid", "username": "wangwu", "role": "member",
    "tenant_id": "uuid", "department_id": "uuid"
  },
  "main_agent": {
    "cloud_agent_id": "uuid",
    "name": "Sales Assistant",
    "system_prompt": "# You are a sales assistant...",
    "skills": ["customer-research", "email-drafting"],
    "model_id": "gpt-4o-mini",
    "channel_perms": true,
    "config_version": 7
  },
  "sub_agents": [...],
  "policy": {
    "version": 12,
    "zone_guard": { "enabled": true, "zones": [...] },
    "egress_guard": { "enabled": true, "sensitive_keywords": [...] }
  },
  "llm_config": {
    "provider_id": "hive-cloud",
    "default_model": "gpt-4o-mini"
  }
}
```

Desktop 收到后:
1. 把 `system_prompt` 写成 `AGENTS.md`
2. 设 `active_model` 为 `{provider: "hive-cloud", model: model_id}`
3. 应用 Guard 策略到本地 config
4. Agent 就绑定了——用 AgentScope 框架运行，但 LLM 走 Cloud 代理

### Cloud 数据库改动

```sql
-- 扩展 agent_templates
ALTER TABLE agent_templates
  ADD COLUMN tenant_id UUID REFERENCES tenants(id),
  ADD COLUMN department_id UUID REFERENCES departments(id),
  ADD COLUMN model_id UUID REFERENCES llm_models(id);

-- 扩展 agents
ALTER TABLE agents
  ADD COLUMN agent_kind VARCHAR(10) DEFAULT 'main',
  ADD COLUMN parent_agent_id UUID REFERENCES agents(id),
  ADD COLUMN owner_user_id UUID REFERENCES users(id);

-- 新表: guard_policies
CREATE TABLE guard_policies (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) UNIQUE,
  version INTEGER DEFAULT 1,
  zone_guard JSONB DEFAULT '{}',
  egress_guard JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 3. 完整 API 契约

### 新增 Cloud 端点 (给 Desktop 用)

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| GET | /api/desktop/bootstrap | JWT | 全量初始化：用户+Agent+策略+LLM |
| GET | /api/desktop/sync?v={n} | JWT | 增量同步（版本变了才返回数据）|
| POST | /api/desktop/agents | JWT | 员工创建 Sub-Agent |
| PATCH | /api/desktop/agents/{id} | JWT | 员工更新 Sub-Agent |
| DELETE | /api/desktop/agents/{id} | JWT | 员工删除 Sub-Agent |
| POST | /api/desktop/audit/events | JWT | 批量上报操作审计 |
| POST | /api/desktop/audit/guard-events | JWT | 上报 Guard 拦截事件 |

### 已有端点 (Desktop 直接用)

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| GET | /api/llm/v1/models | JWT | 可用模型列表 |
| POST | /api/llm/v1/chat/completions | JWT | LLM 代理（已实现）|

### 新增管理端点 (给 Console 管理员用)

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| GET | /api/guard-policies | Admin | 获取当前 Guard 策略 |
| PUT | /api/guard-policies | Admin | 更新 Guard 策略（version +1）|

---

## 4. 角色与页面可见性

### Desktop 端

| 角色 (JWT role) | 看到什么 | 隐藏什么 |
|----------------|---------|---------|
| member | 聊天、工作区、技能、工具、MCP | 智能体管理、模型、环境变量、频道 |
| org_admin | 全部 + 跳转 Cloud Console 链接 | 无 |

角色从 Cloud JWT 的 `role` 字段解析，已经在 `agentStore.userRole` 中实现了（Phase 2 的 EMPLOYEE_HIDDEN_KEYS）。

### Cloud Console 端

| 角色 | 看到什么 |
|------|---------|
| org_admin+ | 全部：Agent 模板、Guard 策略、LLM 池、审计、渠道 |
| member | 不需要访问 Console（用 Desktop）|

---

## 5. 策略同步流程

```
管理员在 Cloud Console 编辑 Guard 策略
  → PUT /api/guard-policies (version +1)

Desktop 每 60s 调用 GET /api/desktop/sync
  → Cloud 比较 version → 有变化 → 返回新策略
  → Desktop 应用到本地 config.json
  → Guard Pipeline 立即生效

离线时:
  → 使用上次缓存的策略继续 enforce
  → 下次联网时同步最新版本
```

---

## 6. 审计上报流程

```
Desktop 工具执行 / Guard 决策
  → 本地 buffer 收集事件
  → 每 30s 或 50 条 → 批量 POST /api/desktop/audit/events
  → Guard 拦截事件立即上报 POST /api/desktop/audit/guard-events

Cloud 端:
  → 写入 security_audit_events 表
  → 管理员在 Console 查看
```

---

## 7. 实施顺序

```
Phase 1: Auth Bridge (一切的基础)
  Cloud: 飞书 OAuth 重定向端点
  Desktop: 委托 Cloud 认证，存 Cloud JWT

Phase 2: Bootstrap + Agent Sync
  Cloud: DB migration + /api/desktop/bootstrap
  Desktop: hive_sync.py 转换 Cloud Agent → 本地 AgentProfileConfig

Phase 3: Policy Sync
  Cloud: guard_policies 表 + CRUD API
  Desktop: 定期 sync + 本地 enforce

Phase 4: Audit Reporting
  Cloud: 审计接收端点
  Desktop: hive_audit.py 缓冲上报

Phase 5: Token Metering
  Cloud: LLM proxy 计量 + 额度检查
```

### 关键决策: HTTP 轮询 vs WebSocket

先用 HTTP 轮询（简单、复用 JWT auth）。
WebSocket 留到需要实时渠道消息转发时再做。

---

## 8. Desktop 端新增文件

| 文件 | 职责 |
|------|------|
| `copaw/app/hive_sync.py` | Cloud bootstrap/sync 客户端 + Agent 数据转换 |
| `copaw/app/hive_audit.py` | 审计事件缓冲 + 批量上报 |
| `copaw/app/routers/feishu_auth.py` | 重写为 Cloud 委托模式 |

## 9. Cloud 端新增文件

| 文件 | 职责 |
|------|------|
| `app/api/desktop.py` | 所有 Desktop 端点 (bootstrap/sync/agents/audit) |
| `app/models/guard_policy.py` | guard_policies 表模型 |
| Alembic migration | agent_templates/agents 扩展 + guard_policies 新表 |
