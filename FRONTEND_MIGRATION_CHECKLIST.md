# 前端重构基线：断点清单与三工作面迁移计划

> 日期：2026-03-27
> 目的：在“上游前端基线 + 当前后端能力”的前提下，找出真实断点，并给出前端三工作面改造顺序。

## 0. 当前状态更新

- `Phase 0` 已完成：
  - 页面/组件层已无裸 `fetch`
  - 页面/组件层已无 `api/core` 直连
  - 前端主访问链路已全部走 domain adapter
  - 删除公司链路已补齐前后端契约
- `Phase 1` 已启动并落地第一步：
  - `App.tsx` 已切成 `AppLayout / WorkspaceLayout / AdminLayout`
  - `workspace` 已建立 `/enterprise/info|llm|tools|skills|quotas|users|org|approvals|audit|invitations`
  - `EnterpriseSettings` 已支持被子路由按 tab 驱动
- 当前最重要的剩余工作：
  - 把 `EnterpriseSettings` 从“按 tab 驱动的大页”继续拆成真正的独立页面
  - 清理旧 `Layout` 中残留的 workspace/admin 导航耦合
  - 做 route-level lazy loading，处理大 chunk warning

## 1. 当前前端基线判断

当前前端不需要再“重拉一次源码”才能开始，因为源码已经处于上游基线：

- `git diff --stat upstream/main -- frontend/src` 结果为空

真正需要重建的是：

- 前端对当前后端的契约层
- 前端工作面结构
- 页面与后端能力的映射关系

## 2. 当前主路由现状

当前主路由见 `frontend/src/App.tsx`：

| 当前路由 | 页面 | 真实角色/心智 | 建议 surface |
|---|---|---|---|
| `/login` | `Login` | 公开入口 | public |
| `/setup-company` | `CompanySetup` | onboarding | public |
| `/dashboard` | `Dashboard` | 个人/团队使用面 | app |
| `/plaza` | `Plaza` | 个人/团队使用面 | app |
| `/agents/new` | `AgentCreate` | app/workspace 交界 | app |
| `/agents/:id` | `AgentDetail` | app/workspace 交界 | app |
| `/agents/:id/chat` | `Chat` | app | app |
| `/messages` | `Messages` | app | app |
| `/enterprise` | `EnterpriseSettings` | 企业管理面 | workspace |
| `/invitations` | `InvitationCodes` | 企业管理面 | workspace |
| `/admin/platform-settings` | `AdminCompanies` | 平台管理面 | admin |

当前问题：

- 所有页面仍挂在同一个 `Layout`
- app/workspace/admin 三种心智共用一个壳
- 侧边栏、通知、个人设置、平台入口仍然耦合

## 3. 页面级真实断点

以下断点来自真实代码扫描，不是推测。

### 3.1 已失效或不匹配的接口

| 文件 | 断点 | 现状 | 处理建议 |
|---|---|---|---|
| `frontend/src/pages/AgentDetail.tsx` | `/api/tools/agents/*` | 后端旧 `tools.py` 已移除 | 第一阶段直接下线 `ToolsManager` 的旧调用，改接新的 tool governance/packs 设计，未完成前不要继续扩散 |
| `frontend/src/services/api.ts` | `/agents/templates` | 后端不存在 | 明确业务含义后改接 `role-templates` 或直接删掉模板入口 |
| `frontend/src/services/api.ts` | `PUT /messages/{id}/read` | 后端当前实际是 `POST /notifications/{id}/read` | 将消息中心统一收敛到 notifications 域，不再新增 `messages` 已读逻辑 |
| `frontend/src/services/api.ts` | `PUT /messages/read-all` | 后端当前实际是 `POST /notifications/read-all` | 同上 |
| `frontend/src/pages/Layout.tsx` | `/api/version` | 后端不存在 | 要么补 `GET /api/version`，要么删掉版本角标组件 |
| `frontend/src/pages/PlatformDashboard.tsx` | `/api/admin/metrics/timeseries` | 后端不存在 | 该页面先归档，不纳入第一阶段 |
| `frontend/src/pages/PlatformDashboard.tsx` | `/api/admin/metrics/leaderboards` | 后端不存在 | 同上 |
| `frontend/src/pages/EnterpriseSettings.tsx` | `/api/notifications/broadcast` | 后端不存在 | 通知广播若要保留，应先补后端或删 UI |

### 3.2 已完成的契约清理

以下工作已完成，不再是当前阶段阻塞项：

- `Layout`
- `AgentDetail`
- `EnterpriseSettings`
- `InvitationCodes`
- `AdminCompanies`
- `Chat`
- `Plaza`
- `UserManagement`
- `ChannelConfig`
- `OpenClawSettings`

结论：

- 当前阶段可以正式进入页面拆分与壳层分离
- 不需要再把主要精力投入页面级裸请求治理

## 4. 当前前端与后端的断点类型

### 4.1 契约断点

- 前端使用 `any` 较多，无法靠类型系统发现 drift
- 后端很多接口没有 `response_model`
- 页面对“字段形状”的假设写死在组件内部

### 4.2 语义断点

- 老前端心智里有 `tools`、`templates`、`platform metrics`
- 当前后端已经转向 capability / packs / desktop / config-history / tenant-channels
- 如果不先做 adapter 映射，页面会继续按旧语义生长

### 4.3 架构断点

- 单一 `Layout` 承载三种工作面
- 公共状态和页面状态耦合
- `services/api.ts` 仍是“大一统文件”，难以支撑三工作面分域演进

## 5. 三工作面目标结构

建议目标：

```text
frontend/src/
  api/
    core/
    domains/
  surfaces/
    public/
    app/
    workspace/
    admin/
  shared/
    auth/
    shell/
    ui/
    domain/
```

### 5.1 `public` 工作面

范围：

- Login
- CompanySetup
- OIDC/SSO callback

特点：

- 不挂主 sidebar
- 只负责登录、注册、加入/创建公司

### 5.2 `app` 工作面

范围：

- Dashboard
- Plaza
- AgentCreate
- AgentDetail
- Chat
- Messages

特点：

- 这是“个人使用 + 团队协作”的主产品面
- 优先保证可用，不要先塞管理配置

### 5.3 `workspace` 工作面

范围：

- EnterpriseSettings
- InvitationCodes
- UserManagement
- 审批、审计、OIDC、LLM、内存、知识库、能力策略

特点：

- 这是租户/企业管理面
- 应按模块分组，而不是继续保留超大单页

### 5.4 `admin` 工作面

范围：

- AdminCompanies
- 平台级 feature flags
- 平台级公司治理

特点：

- 仅 `platform_admin`
- 不应混入普通 workspace 导航

## 6. 迁移顺序

### Phase 0：契约收口

状态：已完成

先做，不做这一步后面都会返工。

输出：

- `src/api/core/request.ts`
- `src/api/domains/*.ts`
- 页面停止直接 `fetch('/api/...')`
- 对缺失接口明确标记：替换 / 延后 / 删除

优先域：

1. `auth`
2. `tenants`
3. `agents`
4. `chat`
5. `files`
6. `notifications`
7. `enterprise`
8. `admin`

### Phase 1：路由壳拆分

状态：进行中（已完成三套 layout 与 workspace 子路由）

输出：

- `PublicLayout`
- `AppLayout`
- `WorkspaceLayout`
- `AdminLayout`

原则：

- 一个前端工程
- 一个 query client
- 一个 auth store
- 多个 surface layout

当前下一步：

- 把 `EnterpriseSettings` 从“forcedTab 大页”拆成真正的独立页面文件
- 让 `Layout` 只承担 app surface，不再承担 workspace/admin 入口职责

### Phase 2：优先迁移 `app`

顺序：

1. `Dashboard`
2. `Plaza`
3. `AgentCreate`
4. `AgentDetail`
5. `Chat`
6. `Messages`

原因：

- 这是可用 AI SaaS 的核心面
- 用户首先感知的是 app surface，不是 admin surface

### Phase 3：迁移 `workspace`

做法：

- 拆掉超大 `EnterpriseSettings`
- 按域拆成独立页面或子路由

建议分组：

- 概览：Info、Quotas
- 团队：Users、Invitations、Org、SSO
- AI：LLM、Skills、MCP、Memory、KB
- 治理：Approvals、Audit、Capabilities、Config History

### Phase 4：迁移 `admin`

只保留平台必需：

- Companies
- Platform settings
- Feature flags

像 `PlatformDashboard` 这种缺后端支撑且未挂路由的页面，先不恢复。

### Phase 5：清理与归档

- 删除死页面
- 删除旧 `services/api.ts` 大文件
- 删除页面里的裸 `fetch`
- 清理旧路由别名

## 7. 第一阶段不应该做的事

- 不要拆第二套前端工程
- 不要先做视觉重设计
- 不要先追求组件库大迁移
- 不要先把 Desktop、LLM proxy、全部治理能力都做成页面
- 不要继续在旧 `AgentDetail` 上叠功能

## 8. 第一阶段应该马上做的事

1. 建 `api/domains` adapter 层
2. 补一份前端接口兼容清单
3. 先把 `AgentDetail` 里失效的 `/api/tools/*` 调用隔离出去
4. 把 `messages` 与 `notifications` 语义统一
5. 拆 `App.tsx` 为多 surface route tree

## 9. 建议的验证命令

```bash
cd /Users/rocky243/vc-saas/Clawith/frontend && npm run build
cd /Users/rocky243/vc-saas/Clawith/backend && pytest -q
cd /Users/rocky243/vc-saas/Clawith && rg -n "fetch\\(" frontend/src/pages frontend/src/components
cd /Users/rocky243/vc-saas/Clawith && rg -n "/api/tools|/agents/templates|/api/version|notifications/broadcast" frontend/src
```

## 10. 下一步实现入口

按当前基线，最合理的第一批代码改动不是页面重写，而是：

1. 新建 `frontend/src/api/core/request.ts`
2. 新建 `frontend/src/api/domains/auth.ts`
3. 新建 `frontend/src/api/domains/agents.ts`
4. 新建 `frontend/src/api/domains/notifications.ts`
5. 新建 `frontend/src/api/domains/enterprise.ts`
6. 为这些 domain client 先补最小 smoke tests

等这一层稳定后，再拆 `app/workspace/admin` 三工作面。
