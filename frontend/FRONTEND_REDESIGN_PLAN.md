# Hive 前端重构方案 — 置信度 94%

> 生成日期: 2026-03-26
> 基于后端 37 Router / 100+ 端点完整审计

## 一、当前状态审计

### 1.1 后端 API 全景（37 个 Router）

| 域 | Router | 前端覆盖 |
|---|--------|---------|
| Auth | auth, oidc, tenants | 完整 |
| Agent 核心 | agents, tasks, files, triggers, schedules, chat_sessions | 完整 |
| Agent 协作 | relationships, collaboration, gateway | 完整 |
| 企业管理 | enterprise, org, capabilities, packs, memory, onboarding | 完整 |
| 通知 | notification, messages | 完整 |
| 社交 | plaza | 完整 |
| 渠道 | feishu, slack, discord, dingtalk, wecom, teams, atlassian, webhooks | 部分（仅 channel config UI） |
| 管理 | admin, feature_flags, config_history, users | 完整 |
| 技能 | skills (含 ClawHub marketplace) | 完整 |
| 审计 | audit (含 chain verification) | 完整 |

**结论：前端 API 层覆盖率 ~95%，不存在大面积"后端有前端没有"的功能断层。**

### 1.2 前端代码指标

| 指标 | 值 |
|------|-----|
| 总 LOC（pages） | 12,419 |
| 路由数 | 13 |
| Agent Detail 子 Tab | 15 个文件，~4,300 LOC |
| Enterprise Settings 子 Tab | 20 个文件，~3,200 LOC |
| 最大文件 | settings-tab.tsx (996), chat-tab.tsx (952) |
| UI 组件库 | shadcn/ui (Radix + Tailwind v4) |
| 状态管理 | Zustand (auth + app) + TanStack Query |
| 路由 | React Router v7 |

### 1.3 核心 UX 问题诊断

| # | 问题 | 严重度 | 根因 |
|---|------|--------|------|
| 1 | **Admin Panel 感** — 全站 CRUD 表格风格，像内部工具不像产品 | 高 | 无设计系统，无品牌视觉层 |
| 2 | **Agent 中心页超载** — 15 个 tab 文件挤在一个页面，认知负荷极高 | 高 | 功能堆叠式增长 |
| 3 | **Chat 体验弱** — 952 LOC 的 chat-tab 嵌在 Agent Detail 内，不是独立沉浸式体验 | 高 | Chat 被当成"一个 tab"而非核心场景 |
| 4 | **Settings 巨石** — 996 LOC，所有 agent 配置项平铺在一个 tab | 中 | 缺乏配置分层 |
| 5 | **导航扁平** — 侧边栏直接列所有 agent，无分组/搜索/快速操作 | 中 | 没有 Command Palette / 全局搜索 |
| 6 | **Dashboard 数据展示但不可操作** — 看到数字但无法直接处理 | 中 | 缺乏 actionable card |
| 7 | **无 Onboarding 引导** — 新用户注册后直接扔进空 Plaza | 低 | onboarding API 存在但前端未实现 |
| 8 | **移动端几乎不可用** — grid-cols-4 等硬编码 | 低 | 没有响应式设计考量 |

---

## 二、重构设计哲学

### 2.1 定位转换

```
当前: Admin Panel (管理后台) → 看数据、改配置
目标: Agent Command Center (指挥中心) → 指挥、协作、监控
```

### 2.2 三个设计原则

1. **Chat-First** — 对话是一等公民，Agent 的核心交互入口是 Chat，不是 Settings
2. **Progressive Disclosure** — 新用户 3 分钟上手，高级功能按需展开
3. **Spatial Navigation** — 用空间而非列表组织 Agent，让用户"看到"自己的数字员工团队

### 2.3 设计系统参数

| Dial | 值 | 理由 |
|------|-----|------|
| DESIGN_VARIANCE | 7 | 企业 SaaS 需要专业感但不能死板 |
| MOTION_INTENSITY | 5 | 适度动效增加品质感，不分散注意力 |
| VISUAL_DENSITY | 5 | 信息丰富但不压迫 |

---

## 三、信息架构重设计

### 3.1 新路由结构

```
/                         → 重定向到 /home
/login                    → 登录/注册 (保留，视觉升级)
/setup                    → 公司初始化 + 首次引导

/home                     → 新 Dashboard (Agent Command Center)
  ├── 全局统计 Bento Grid
  ├── 快速操作栏
  └── Agent 状态总览 (按部门/标签分组)

/agents                   → Agent 列表 (卡片视图 / 表格视图切换)
  /agents/new             → 创建向导 (保留 5 步，视觉升级)
  /agents/:id             → Agent Profile (重组 tabs)
    ├── overview          → 身份卡 + 能力摘要 + 状态仪表盘
    ├── chat              → 沉浸式对话 (从 tab 提升为主场景)
    ├── capabilities      → 能力包 + 工具 + 治理策略 (合并 3 个 tab)
    ├── knowledge         → 技能 + 文件 + 记忆 (合并 3 个 tab)
    ├── automation        → 触发器 + 定时 + 任务 (合并 3 个 tab)
    ├── connections       → 渠道 + 关系 + 协作 + OpenClaw (合并 4 个 tab)
    ├── activity          → 活动日志 + 审计 (保留)
    └── settings          → 模型/Token/心跳/过期 (精简为关键配置)

/chat/:sessionId          → 独立全屏 Chat (从 agent detail 独立出来)

/plaza                    → 社交广场 (保留，视觉升级)

/messages                 → 消息收件箱 (保留)

/workspace                → 企业管理 (重组 Enterprise Settings)
  ├── /workspace/team     → 组织架构 + 成员管理 (合并 org-tab + quotas)
  ├── /workspace/models   → LLM 模型池
  ├── /workspace/skills   → 技能市场 (含 ClawHub)
  ├── /workspace/security → 审计 + 能力策略 + SSO (合并安全相关)
  ├── /workspace/kb       → 企业知识库
  ├── /workspace/mcp      → MCP 服务器
  └── /workspace/settings → 公司信息 + 通知栏 + 配色 + 内存配置

/admin                    → 平台管理 (platform_admin only)
  ├── /admin/companies    → 公司管理
  ├── /admin/flags        → Feature Flags
  └── /admin/platform     → 平台设置
```

### 3.2 Tab 合并策略（关键决策）

| 当前 Agent Detail (15 tabs) | 合并后 (8 tabs) | 理由 |
|---|---|---|
| overview | **overview** | 保留 |
| chat-tab (952 LOC) | **chat** + 独立 `/chat/:id` 页面 | Chat 是核心场景，需要全屏沉浸模式 |
| capabilities-view + capability-policy-manager + 部分 settings | **capabilities** | 能力相关的散落在 3 处 |
| skills-tab + file-editor + memory-insights | **knowledge** | Agent 的"大脑"：技能、文件、记忆 |
| triggers + schedules (from settings) + tasks (from settings) | **automation** | Agent 的"定时任务"系统 |
| channel-config + relationships + collaboration + openclaw-gateway | **connections** | Agent 与外界的连接 |
| activity-tab | **activity** | 保留 |
| settings-tab (996 LOC) → 拆出触发器/定时/渠道后 | **settings** | 精简为：模型选择、Token 配额、心跳、过期时间 |

**预期效果：settings-tab 从 996 LOC 降到 ~300 LOC，chat-tab 独立为全屏页面。**

---

## 四、组件架构

### 4.1 新组件层次

```
src/
├── app/                          # 路由 (React Router v7)
│   ├── (auth)/
│   │   ├── login.tsx
│   │   └── setup.tsx
│   ├── (main)/                   # Layout wrapper
│   │   ├── layout.tsx            # 新 Shell：Command Bar + Sidebar + Content
│   │   ├── home.tsx              # Command Center
│   │   ├── agents/
│   │   │   ├── page.tsx          # Agent 列表
│   │   │   ├── new.tsx           # 创建向导
│   │   │   └── [id]/
│   │   │       ├── layout.tsx    # Agent Profile Shell
│   │   │       ├── overview.tsx
│   │   │       ├── chat.tsx
│   │   │       ├── capabilities.tsx
│   │   │       ├── knowledge.tsx
│   │   │       ├── automation.tsx
│   │   │       ├── connections.tsx
│   │   │       ├── activity.tsx
│   │   │       └── settings.tsx
│   │   ├── chat/
│   │   │   └── [sessionId].tsx   # 全屏 Chat
│   │   ├── plaza.tsx
│   │   ├── messages.tsx
│   │   └── workspace/            # 企业管理
│   │       ├── layout.tsx
│   │       ├── team.tsx
│   │       ├── models.tsx
│   │       ├── skills.tsx
│   │       ├── security.tsx
│   │       ├── kb.tsx
│   │       ├── mcp.tsx
│   │       └── settings.tsx
│   └── admin/
│       ├── companies.tsx
│       ├── flags.tsx
│       └── platform.tsx
├── components/
│   ├── ui/                       # shadcn/ui (保留)
│   ├── shell/                    # 新：应用 Shell
│   │   ├── command-bar.tsx       # Cmd+K 全局搜索/命令面板
│   │   ├── sidebar.tsx           # 可折叠侧边栏
│   │   ├── sidebar-agent-list.tsx
│   │   └── notification-tray.tsx
│   ├── agent/                    # Agent 域组件
│   │   ├── agent-card.tsx        # 统一 Agent 卡片
│   │   ├── agent-status.tsx
│   │   ├── capability-pack-card.tsx
│   │   ├── tool-governance-badge.tsx
│   │   └── session-list.tsx
│   ├── chat/                     # Chat 域组件
│   │   ├── chat-shell.tsx        # 对话外框
│   │   ├── message-list.tsx      # 虚拟滚动消息列表
│   │   ├── message-bubble.tsx    # 消息气泡
│   │   ├── chat-input.tsx        # 输入框 + 附件
│   │   ├── tool-call-card.tsx    # 工具调用展示
│   │   └── thinking-indicator.tsx
│   ├── workspace/                # 企业管理域组件
│   │   ├── org-tree.tsx
│   │   ├── llm-model-card.tsx
│   │   └── audit-chain-badge.tsx
│   └── domain/                   # 保留现有通用域组件
├── hooks/                        # 保留 + 新增
│   ├── use-command-palette.ts    # Cmd+K
│   ├── use-agent-status.ts      # WebSocket 实时状态
│   └── use-chat-stream.ts       # WebSocket 流式对话
├── services/
│   ├── api.ts                    # 保留，不变
│   └── queries/                  # 保留，不变
├── stores/                       # 保留，不变
├── types/                        # 保留，不变
└── i18n/                         # 保留，不变
```

### 4.2 关键新增组件

| 组件 | 用途 | LOC 估算 |
|------|------|----------|
| `command-bar.tsx` | Cmd+K 命令面板 — 搜索 Agent、快速操作、导航 | ~200 |
| `chat-shell.tsx` | 全屏对话外框 — 支持 sidebar 会话列表 + 主对话区 | ~300 |
| `agent-card.tsx` | 统一 Agent 卡片 — 替代 Dashboard/列表中的重复实现 | ~150 |
| `capability-summary.tsx` | 能力摘要卡 — 合并 capabilities-view + policy-manager | ~250 |

---

## 五、视觉设计方向

### 5.1 配色方案（保留当前 dark/light 主题切换机制）

```css
/* 在现有 CSS 变量基础上升级 */
:root[data-theme="dark"] {
  --surface-primary: #0a0a0b;      /* 更深的背景 */
  --surface-secondary: #141416;    /* 卡片背景 */
  --surface-elevated: #1c1c1f;     /* 弹窗/下拉 */
  --edge-subtle: #27272a;          /* 边框 */
  --accent-primary: #3b82f6;       /* 蓝色强调 */
  --accent-success: #22c55e;
  --accent-warning: #f59e0b;
  --accent-danger: #ef4444;
}
```

### 5.2 字体

```
标题: Geist Sans (tracking-tighter)
正文: Geist Sans (text-base leading-relaxed)
代码/数据: Geist Mono
```

### 5.3 关键视觉模式

| 区域 | 设计模式 |
|------|----------|
| Dashboard | **Bento Grid** — 不等大小卡片，Agent 状态气泡 |
| Agent 列表 | **卡片视图 / 表格视图切换** — 默认卡片，高级用户切换表格 |
| Agent Profile | **Split View** — 左侧身份卡固定，右侧 Tab 内容区 |
| Chat | **全屏沉浸** — 会话列表左侧窄栏，主区域对话流 |
| 企业管理 | **左侧 Tab 导航** — 类 Settings 页面范式 |

---

## 六、执行分期

### Phase 1: 基础设施 + Design System（~2,500 LOC 增改）

| 任务 | 内容 | 估算 |
|------|------|------|
| 1.1 | 安装 Geist 字体 + framer-motion，配置 Tailwind 主题 token | 50 LOC |
| 1.2 | 新建 `components/shell/` — command-bar + sidebar 重构 | 400 LOC |
| 1.3 | 路由重组 — `/home` 替代 `/dashboard`，`/workspace` 替代 `/enterprise` | 100 LOC |
| 1.4 | Layout.tsx 重写 — 新 Shell 结构 | 400 LOC |

### Phase 2: Agent Command Center（~2,000 LOC 增改）

| 任务 | 内容 | 估算 |
|------|------|------|
| 2.1 | 新 Home (Dashboard) — Bento Grid + 快速操作 | 350 LOC |
| 2.2 | Agent 列表页 — 卡片/表格双视图 | 300 LOC |
| 2.3 | Agent Profile 重组 — 15 tabs → 8 tabs | 800 LOC 净减 |
| 2.4 | settings-tab 拆分 — 触发器/定时/渠道独立出去 | 600 LOC 重组 |

### Phase 3: Chat 独立化（~1,500 LOC 增改）

| 任务 | 内容 | 估算 |
|------|------|------|
| 3.1 | `/chat/:sessionId` 全屏 Chat 页面 | 400 LOC |
| 3.2 | chat-shell + message-list + message-bubble 组件化 | 500 LOC |
| 3.3 | 工具调用卡片、思考指示器重做 | 300 LOC |
| 3.4 | Agent Profile chat tab 降级为入口（跳转全屏 Chat） | -500 LOC |

### Phase 4: 企业管理重组（~1,000 LOC 重组）

| 任务 | 内容 | 估算 |
|------|------|------|
| 4.1 | `/workspace` 路由 + layout | 100 LOC |
| 4.2 | Security 合并页（审计 + 能力策略 + SSO） | 300 LOC |
| 4.3 | Team 合并页（组织架构 + 成员 + 配额） | 300 LOC |
| 4.4 | EnterpriseSettings.tsx 降级为路由壳 | 净减 |

### Phase 5: 动效 + 打磨（~800 LOC）

| 任务 | 内容 | 估算 |
|------|------|------|
| 5.1 | 页面过渡动效 (framer-motion layout) | 200 LOC |
| 5.2 | Agent 卡片交互 (hover tilt, 状态脉动) | 200 LOC |
| 5.3 | 移动端响应式适配 | 200 LOC |
| 5.4 | prefers-reduced-motion 适配 | 100 LOC |

---

## 七、风险评估 + 置信度

| 维度 | 置信度 | 风险 | 缓解 |
|------|--------|------|------|
| API 层 — 无需改动 | **98%** | 前端 api.ts 和 queries 完全不动，零风险 | — |
| 路由重组 — 向后兼容 | **95%** | 旧 URL 需要 redirect | 添加 Navigate redirects |
| Tab 合并 — 功能不丢失 | **90%** | 合并过程中可能遗漏边缘功能 | 逐 tab 审计 checklist |
| 设计系统 — 与现有 Tailwind v4 兼容 | **95%** | Tailwind v4 CSS-first 配置 | 已确认 @tailwindcss/vite 在用 |
| i18n — 双语同步 | **92%** | 新增 key 需要中英同步 | Phase 完成时批量检查 |
| 状态管理 — Zustand + TanStack Query 不动 | **98%** | 零改动 | — |
| 动效 — framer-motion 新引入 | **88%** | 可能与 tw-animate-css 冲突 | 渐进引入 |

**总体置信度: 94%**

---

## 八、不改动的部分

| 组件/层 | 原因 |
|---------|------|
| `services/api.ts` | 后端 API 契约不变，零改动 |
| `services/queries/` | React Query hooks 不变 |
| `stores/index.ts` | Zustand store 不变 |
| `types/index.ts` | TypeScript 类型不变 |
| `components/ui/` | shadcn/ui 组件保留 |
| `lib/` | 工具函数保留 |
| `hooks/use-websocket.ts` | WebSocket hook 保留 |
