# 前端重构基线：后端能力矩阵

> 日期：2026-03-27
> 目的：以当前后端真实能力作为前端重构基线，避免继续按旧前端心智倒推接口。

## 1. 基线事实

- 当前 `frontend/src` 与 `upstream/main` 没有源码差异，可直接作为“上游原版前端基线”。
- 当前仓库 `backend` 相对 `upstream/main` 已有大量扩展，包含多租户、Desktop、能力治理、内存、Packs、配置版本、OIDC、通知等新增能力。
- 当前基线可正常运行：
  - `cd frontend && npm run build`
  - `cd backend && pytest -q`
  - 结果：前端构建通过，后端 `322 passed`

## 2. 路由总量与契约成熟度

基于运行中的 FastAPI app 扫描 `/api/v1/*` 唯一路由：

| 指标 | 数值 |
|---|---:|
| `/api/v1` 唯一路由数 | 240 |
| 带 `response_model` 的路由 | 79 |
| 无 `response_model` 的路由 | 161 |

结论：

- 后端能力面已经很大，足够支撑“云端单后端 + 多工作面前端”。
- 但接口契约还没有统一规范化，当前前端不能直接把“后端能力多”理解为“前端可低成本接入”。
- 前端重构必须先建立 adapter 层，不能继续页面直连接口。

## 3. 顶层业务域分布

按 `/api/v1/<top-level>` 聚合后端路由数量：

| 顶层域 | 路由数 | 说明 |
|---|---:|---|
| `agents` | 86 | Agent CRUD、权限、任务、日程、触发器、文件、会话、关系、渠道、审批、Gateway |
| `enterprise` | 49 | 企业配置、LLM、组织、审批、审计、邀请码、系统设置、OIDC、内存、能力策略 |
| `skills` | 16 | 技能库、导入、浏览、ClawHub |
| `auth` | 15 | 密码登录、注册、Feishu/OIDC、Desktop exchange |
| `channel` | 8 | 渠道 webhook/callback |
| `desktop` | 7 | Desktop bootstrap/sync/agents/audit |
| `tenants` | 7 | 自助建租户、加入租户、平台级租户管理 |
| `org` | 6 | 部门、组织用户 |
| `plaza` | 6 | 广场帖子、评论、点赞、统计 |
| `admin` | 5 | 公司管理、平台设置 |
| `gateway` | 5 | OpenClaw Gateway |
| `feature-flags` | 4 | 功能开关 |
| `notifications` | 4 | 通知中心 |
| `role-templates` | 4 | 角色模板 |
| `config-history` | 3 | 配置版本/回滚 |
| `chat` | 2 | 上传、会话摘要 |
| `llm` | 2 | LLM proxy |
| `messages` | 2 | Agent inbox |
| `guard-policies` | 2 | 守卫策略 |
| `packs` | 1 | Packs 列表 |
| `tenant-channels` | 4 | 租户级渠道配置 |
| `users` | 2 | 用户配额 |

## 4. 面向 Web 前端的核心能力矩阵

下面只列前端重构第一阶段真正需要承接的域。

| 域 | 关键路径 | 当前作用 | 契约等级 | 说明 |
|---|---|---|---|---|
| 身份认证 | `/auth/*` | 登录、注册、获取当前用户、密码修改、OIDC/Feishu | B+ | 核心能力稳定，但并非所有接口都显式声明响应模型 |
| 租户/公司 | `/tenants/*`, `/admin/companies`, `/admin/platform-settings` | 自建公司、加入公司、平台管理公司 | B | 足够支撑 onboarding 与 admin surface |
| Agent 核心 | `/agents/`, `/agents/{id}` | 列表、详情、创建、更新、启动、停止 | B | 核心可用，但仍有部分 `None` response_model |
| Agent 协作 | `/agents/{id}/collaborators`, `/collaborate/*`, `/handover*` | 协作、交接、观察性 | B- | 能力丰富，前端现状接入很浅 |
| 会话与聊天 | `/agents/{id}/sessions*`, `/chat/upload`, `/chat/{agent_id}/history` | Chat、历史会话、附件 | B | 当前可以支撑 app surface |
| 任务 | `/agents/{id}/tasks/*` | 待办、监督、触发 | B+ | 适合作为 AgentDetail 子域继续保留 |
| 日程与触发器 | `/agents/{id}/schedules/*`, `/agents/{id}/triggers*` | 自动化与 Aware Engine | B | 现有能力够用，前端需要重新组织信息架构 |
| 文件与知识库 | `/agents/{id}/files/*`, `/enterprise/knowledge-base/*` | Agent workspace、企业知识库 | B | 企业 KB 在 `files.py` 第二 router 中，能力真实存在 |
| 通知 | `/notifications*` | 通知抽屉、已读状态 | B | 比 `messages` 更适合作为统一消息中心契约 |
| 企业工作台 | `/enterprise/*` | LLM、组织、审批、审计、OIDC、系统设置 | B- | 能力广但结构偏厚，前端应分组分层而不是继续塞大页 |
| 广场 | `/plaza/*` | 社交广场、动态流 | B | app surface 可直接承接 |
| 技能 | `/skills/*` | 技能库、导入、ClawHub、browse | B | 当前前端接入较多，但仍缺统一 type |
| 功能治理 | `/enterprise/capabilities*`, `/guard-policies`, `/feature-flags`, `/config-history` | 能力策略、守卫、开关、版本回滚 | C+ | 后端已有，但前端还未系统化暴露 |

契约等级说明：

- `A`：主要接口有清晰 schema，可直接生成前端 typed client
- `B`：接口可用，但 response_model 不完整，需前端 adapter 兜底
- `C`：后端已有能力，但前端尚未形成稳定契约/页面结构

## 5. 前端当前实际消费的后端域

当前 `frontend/src/services/api.ts` 已有 13 组 client：

- `authApi`
- `tenantApi`
- `adminApi`
- `agentApi`
- `taskApi`
- `fileApi`
- `channelApi`
- `enterpriseApi`
- `activityApi`
- `messageApi`
- `scheduleApi`
- `skillApi`
- `triggerApi`

问题不在“完全没有 client”，而在：

- `request<any>` 仍然大量存在
- 多个页面绕过 client 直接 `fetch()`
- 老接口与新后端能力混在一起

## 6. 当前后端已具备但前端未形成稳定入口的能力

这些能力不应该在第一阶段 UI 重构时强行全面打开，但必须在架构设计里预留位置：

- Desktop：`/desktop/*`
- Packs：`/packs`
- Role Templates：`/role-templates/*`
- Tenant Channels：`/tenant-channels/*`
- Guard Policies：`/guard-policies`
- LLM Proxy：`/llm/v1/*`
- Config History：`/config-history/*`
- Enterprise Memory：`/enterprise/memory/*`

建议处理策略：

- 第一阶段只在 adapter 层建 domain stub
- 第二阶段再决定是否进入 workspace/admin surface

## 7. 对前端分离的直接影响

后端已经天然支持“单后端多工作面”：

- 多租户边界：`tenant_id`
- 角色边界：`platform_admin / org_admin / agent_admin / member`
- 接口前缀已经能按域拆分

因此不应再做：

- 第二套后端
- 第二套数据库
- 第二套前端工程

应该做的是：

1. 保留一个后端
2. 在前端建立统一 contract/adapter 层
3. 再基于 adapter 层拆为 `app / workspace / admin` 三工作面

## 8. 建议的前端 adapter 分层

推荐目录：

```text
frontend/src/api/
  core/
    request.ts
    auth.ts
    errors.ts
  domains/
    auth.ts
    tenants.ts
    agents.ts
    chat.ts
    tasks.ts
    schedules.ts
    triggers.ts
    files.ts
    enterprise.ts
    notifications.ts
    skills.ts
    plaza.ts
    admin.ts
```

原则：

- 页面禁止直接 `fetch('/api/...')`
- 页面禁止继续读取后端原始 `any` 结构
- 所有跨 surface 共享能力统一走 `domains/*`

## 9. 建议的验证命令

```bash
cd /Users/rocky243/vc-saas/Clawith/frontend && npm run build
cd /Users/rocky243/vc-saas/Clawith/backend && pytest -q
cd /Users/rocky243/vc-saas/Clawith && git diff --stat upstream/main -- frontend/src
```
