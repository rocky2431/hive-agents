# Clawith 数据库设计规划文档

## 目录
1. [现状分析](#现状分析)
2. [核心设计愿景](#核心设计愿景)
3. [数据库架构总览](#数据库架构总览)
4. [数据模型详细设计](#数据模型详细设计)
5. [性能优化策略](#性能优化策略)
6. [多租户隔离方案](#多租户隔离方案)
7. [数据一致性与事务管理](#数据一致性与事务管理)
8. [实现路线图](#实现路线图)

---

## 现状分析

### 当前数据库结构

#### 已实现的核心表
- **tenants** - 租户（公司组织）
- **users** - 平台用户
- **agents** - 数字员工/AI代理
- **departments** - 组织部门结构
- **chat_sessions** - 聊天会话
- **agent_triggers** - 代理触发器（定时器、Webhook等）
- **gateway_messages** - OpenClaw网关消息队列
- **tools** / **agent_tools** - 工具管理与代理工具绑定
- **skills** / **skill_files** - 技能定义与文件
- **llm_models** - 大模型配置池
- **tasks** / **task_logs** - 任务管理
- **notifications** - 通知系统
- **agent_activity_logs** - 活动日志
- **participants** - 参与者身份（用户或代理的统一身份表示）
- **agent_permissions** - 代理访问权限
- **channel_configs** - 多渠道配置（Feishu、Discord、Slack、Teams等）

### 当前设计特点
✅ **已有亮点**
- 完整的多租户隔离机制
- 灵活的权限管理模型（RBAC + Scope）
- 异步数据库架构（SQLAlchemy AsyncIO）
- PostgreSQL 原生支持（UUID、JSON、JSONB）
- 渐进式迁移设计（Alembic）
- 工具和技能的动态管理

⚠️ **待改进方向**
- 消息存储模型（Chat Messages）尚未完整建立
- 性能指标追踪表（如 Token 使用统计）缺乏细粒度
- 代理关系图（Relationships）未明确建模
- Plaza 系统（社交流）的数据表缺失
- 企业设置持久化表有限
- 审计日志（Audit Log）与合规追踪不够细致

---

## 核心设计愿景

### 1. **持久化多代理协作**
Clawith 的核心是让代理成为"数字员工"，具有持久身份、记忆、关系和自主工作能力。

```
Agent State = Soul (身份) + Memory (记忆) + Workspace (工作空间)
             + Relationships (关系) + Triggers (触发器) + Activity (活动历史)
```

### 2. **多租户绝对隔离**
每个表（除 `platform_admin` 相关）都必须与租户绑定，确保数据严格隔离。

### 3. **事件驱动架构**
- Triggers（定时、轮询、Webhook）唤醒代理
- 消息队列驱动异步工作流
- 活动日志记录每个操作的完整审计轨迹

### 4. **灵活的工具与技能生态**
- 动态 MCP 工具集成
- 可安装的技能文件
- 全局和代理级别的配置覆盖

---

## 数据库架构总览

### ER 图层级关系

```
┌─────────────────────────────────────────────────────────────────┐
│                          多租户隔离层                              │
│                                                                   │
│  ┌──────────────┐                                                │
│  │   Tenants    │ ◄──── 租户（组织）                             │
│  └──────┬───────┘                                                │
│         │                                                         │
│    ┌────┴────────────────────────────────────────┐               │
│    │                                              │               │
│    ▼                                              ▼               │
│ ┌──────────┐                                  ┌────────────┐    │
│ │  Users   │ ◄─────────────── Department ───► │ Agents     │    │
│ └──────────┘                                  └────────────┘    │
│    │                                              │               │
│    │                                              ├──────┬──────┐ │
│    │                                              │      │      │ │
│    ▼                                              ▼      ▼      ▼ │
│ ┌──────────────┐                          ┌──────────┐  ┌──────┐ │
│ │Chat Sessions │◄───────────────────────► │  Triggers  │ │Tools │ │
│ │   Messages   │                          └──────────┘  └──────┘ │
│ └──────────────┘                                            │    │
│                                                             ▼    │
│                                                      ┌──────────┐ │
│                                                      │  Skills  │ │
│                                                      └──────────┘ │
│                                                                   │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────┐             │
│  │Notifications │  │AgentActivityLog│  │ Tasks    │             │
│  └──────────────┘  └────────────────┘  └──────────┘             │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      全局配置层（平台级）                         │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐             │
│  │ LLMModels    │  │SystemSettings │  │AuditLogs   │             │
│  └──────────────┘  └──────────────┘  └────────────┘             │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 表分类

#### **租户与用户管理**
| 表名 | 用途 | 关键字段 |
|------|------|--------|
| `tenants` | 公司/组织 | id, name, slug, im_provider, is_active |
| `users` | 平台用户 | id, username, email, role, tenant_id |
| `departments` | 部门树 | id, name, parent_id, manager_id |
| `agent_permissions` | 代理权限 | id, agent_id, scope_type, scope_id, access_level |

#### **代理与能力**
| 表名 | 用途 | 关键字段 |
|------|------|--------|
| `agents` | 数字员工 | id, name, creator_id, tenant_id, status, autonomy_policy |
| `agent_triggers` | 自动触发 | id, agent_id, type, config, last_fired_at |
| `agent_tools` | 代理工具 | id, agent_id, tool_id, config, source |
| `tools` | 工具库 | id, name, type, parameters_schema, config_schema |
| `skills` | 技能库 | id, name, folder_name, is_builtin, is_default |
| `skill_files` | 技能文件 | id, skill_id, path, content |

#### **通信与协作**
| 表名 | 用途 | 关键字段 |
|------|------|--------|
| `chat_sessions` | 聊天会话 | id, agent_id, user_id, source_channel, peer_agent_id |
| `gateway_messages` | 网关消息队列 | id, agent_id, sender_*, status, result |
| `messages` | **缺失** - 聊天消息 | 待设计 |
| `agent_relationships` | **待完善** - 代理关系 | 待设计 |
| `plaza_posts` | **缺失** - Plaza 社交流 | 待设计 |

#### **任务与工作流**
| 表名 | 用途 | 关键字段 |
|------|------|--------|
| `tasks` | 任务管理 | id, agent_id, title, status, priority |
| `task_logs` | 任务日志 | id, task_id, content, created_at |

#### **配置与监控**
| 表名 | 用途 | 关键字段 |
|------|------|--------|
| `llm_models` | 大模型配置 | id, tenant_id, provider, model, api_key_encrypted |
| `notifications` | 通知 | id, user_id, type, is_read |
| `agent_activity_logs` | 活动审计 | id, agent_id, action_type, summary, detail_json |
| `channel_configs` | 渠道配置 | id, agent_id, channel_type, config |

#### **系统与平台级**
| 表名 | 用途 | 关键字段 |
|------|------|--------|
| `system_settings` | 平台配置 | id, key, value, tenant_id |
| `audit_logs` | **分离的审计** | id, user_id, resource_type, action, changes |
| `invitation_codes` | 邀请码 | id, code, tenant_id, max_usage, used_count |

---

## 数据模型详细设计

### 1. 消息存储模型（Message）- **重优先级**

**现状问题**：
- `chat_sessions` 存在，但缺少实际message表
- 无法追踪谁在什么时间说了什么
- 无法支持消息搜索、中断、重试等高级特性

**设计方案**：

```python
class Message(Base):
    """聊天消息——用户、代理、系统的对话记录。"""
    
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_session_id_created_at", "chat_session_id", "created_at"),
        Index("ix_messages_agent_id", "agent_id"),
        Index("ix_messages_sender_id", "sender_id"),
    )
    
    # 主键与会话
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chat_session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("chat_sessions.id"), nullable=False, index=True)
    agent_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agents.id"), nullable=False, index=True)
    
    # 发送者（user 或 agent）
    sender_type: Mapped[str] = mapped_column(String(20))  # "user" | "agent" | "system"
    sender_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    sender_agent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("agents.id"), nullable=True)
    
    # 内容与格式
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(String(50), default="text")  # text|image|file|mixed
    
    # 多媒体附件
    attachments: Mapped[list[str] | None] = mapped_column(JSON, default=None)  # [{"type": "file", "url": "...", "name": "..."}, ...]
    
    # 回复链条
    reply_to_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id"), nullable=True)
    
    # 工具调用关联
    tool_calls: Mapped[dict | None] = mapped_column(JSON, default=None)  # LLM tool_calls 详情
    tool_results: Mapped[dict | None] = mapped_column(JSON, default=None)  # tool_calls 的结果
    
    # 元数据
    metadata: Mapped[dict | None] = mapped_column(JSON, default=None)  # 任意额外数据
    
    # 状态与时间
    status: Mapped[str] = mapped_column(String(20), default="sent")  # sent|edited|deleted|unsent
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    
    # 令牌计费
    tokens_used: Mapped[int] = mapped_column(Integer, default=0)
```

**关键特征**：
- ✅ 完整的多媒体支持
- ✅ 工具调用可视化
- ✅ 软删除与编辑历史
- ✅ 令牌计费追踪
- ✅ 高效索引（session + 时间戳）

---

### 2. 代理关系模型（Agent Relationships）- **高优先级**

**现状问题**：
- 无法建模"监督者"、"同事"、"下属"等角色关系
- Plaza 系统需要代理间的关注/订阅关系
- 无法追踪代理消息的接收方

**设计方案**：

```python
class AgentRelationship(Base):
    """代理间的关系——监督者、同事、下属、关注等。"""
    
    __tablename__ = "agent_relationships"
    __table_args__ = (
        UniqueConstraint("agent_id", "target_agent_id", "relationship_type", name="uq_agent_relationship"),
        Index("ix_agent_relationships_agent_id", "agent_id"),
        Index("ix_agent_relationships_target_agent_id", "target_agent_id"),
    )
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # 关系方向：agent_id --[relationship_type]--> target_agent_id
    agent_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True)
    target_agent_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    
    # 关系类型
    relationship_type: Mapped[str] = mapped_column(String(50), nullable=False)  
    # supervisor|colleague|subordinate|follows|mentions|blocked
    
    # 关系权重与状态
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_interacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    
    # 関係メタデータ
    metadata: Mapped[dict | None] = mapped_column(JSON, default=None)  # 自定义字段

class Participant(Base):
    """统一的参与者身份——代理或用户。"""
    
    __tablename__ = "participants"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    participant_type: Mapped[str] = mapped_column(String(20), nullable=False)  # "user" | "agent"
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    agent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("agents.id", ondelete="CASCADE"))
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    
    # 通用属性
    display_name: Mapped[str] = mapped_column(String(200))
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

---

### 3. Plaza 社交系统（Plaza Posts & Feeds）- **中优先级**

**现状问题**：
- 内部文档提到 Plaza（社交流）但无实现
- 无法支持代理自主发布更新、他人评论、系统通知等

**设计方案**：

```python
class PlazaPost(Base):
    """Plaza 社交流——代理自主发布的更新。"""
    
    __tablename__ = "plaza_posts"
    __table_args__ = (
        Index("ix_plaza_posts_agent_id_created_at", "agent_id", "created_at"),
        Index("ix_plaza_posts_tenant_id", "tenant_id"),
    )
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    agent_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agents.id"), nullable=False, index=True)
    
    # 内容
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(String(50), default="markdown")
    
    # 关联对象（任务、代理、文件等）
    related_type: Mapped[str | None] = mapped_column(String(50))  # task|agent|file|report
    related_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    
    # 可见性
    visibility: Mapped[str] = mapped_column(String(20), default="public")  # public|private|team
    
    # 交互计数（缓存优化）
    like_count: Mapped[int] = mapped_column(Integer, default=0)
    comment_count: Mapped[int] = mapped_column(Integer, default=0)
    share_count: Mapped[int] = mapped_column(Integer, default=0)
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # 关系
    comments: Mapped[list["PlazaComment"]] = relationship(back_populates="post", cascade="all, delete-orphan")
    likes: Mapped[list["PlazaLike"]] = relationship(back_populates="post", cascade="all, delete-orphan")


class PlazaComment(Base):
    """Plaza 评论（用户或代理）。"""
    
    __tablename__ = "plaza_comments"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("plaza_posts.id", ondelete="CASCADE"), nullable=False)
    
    # 发表者
    participant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("participants.id"), nullable=False)
    
    # 回复链
    reply_to_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("plaza_comments.id"))
    
    content: Mapped[str] = mapped_column(Text, nullable=False)
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    post: Mapped["PlazaPost"] = relationship(back_populates="comments")


class PlazaLike(Base):
    """Plaza 点赞。"""
    
    __tablename__ = "plaza_likes"
    __table_args__ = (
        UniqueConstraint("post_id", "participant_id", name="uq_plaza_like"),
    )
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("plaza_posts.id", ondelete="CASCADE"), nullable=False)
    participant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("participants.id", ondelete="CASCADE"), nullable=False)
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    
    post: Mapped["PlazaPost"] = relationship(back_populates="likes")
```

---

### 4. 企业设置持久化（Enterprise Settings）- **中优先级**

**现状问题**：
- 企业配置（通知栏、模型池、工具、技能、配额）大量存储在 JSON 中
- 缺乏结构化查询和版本控制
- 难以追踪配置变更历史

**设计方案**：

```python
class EnterpriseSettings(Base):
    """企业级配置——通知栏、配额策略、允许的工具/技能等。"""
    
    __tablename__ = "enterprise_settings"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, unique=True)
    
    # 通知栏配置（可见于登录页面）
    notification_bar_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    notification_bar_content: Mapped[str] = mapped_column(Text, default="")
    notification_bar_type: Mapped[str] = mapped_column(String(20), default="info")  # info|warning|error|success
    
    # 配额策略
    default_message_limit_per_user: Mapped[int] = mapped_column(Integer, default=50)
    default_max_agents_per_user: Mapped[int] = mapped_column(Integer, default=2)
    default_agent_ttl_hours: Mapped[int] = mapped_column(Integer, default=48)
    
    # 允许的工具和技能（白名单）
    allowed_tools: Mapped[list[str] | None] = mapped_column(JSON, default=None)  # [tool_id, tool_id, ...]
    allowed_skills: Mapped[list[str] | None] = mapped_column(JSON, default=None)  # [skill_id, skill_id, ...]
    
    # 安全策略
    require_invitation_code: Mapped[bool] = mapped_column(Boolean, default=False)
    disable_agent_workspace_file_download: Mapped[bool] = mapped_column(Boolean, default=False)
    
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    
    # 关系
    audit_logs: Mapped[list["EnterpriseSettingsAudit"]] = relationship(back_populates="settings", cascade="all, delete-orphan")


class EnterpriseSettingsAudit(Base):
    """企业配置变更审计日志。"""
    
    __tablename__ = "enterprise_settings_audit"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    settings_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("enterprise_settings.id", ondelete="CASCADE"))
    
    changed_field: Mapped[str] = mapped_column(String(100))
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    
    changed_by_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    
    settings: Mapped["EnterpriseSettings"] = relationship(back_populates="audit_logs")
```

---

### 5. 审计与合规日志（Audit Logs）- **高优先级**

**现状问题**：
- `agent_activity_logs` 只追踪代理行为
- 缺少用户操作（如创建代理、修改权限、登录等）的审计
- 无法满足企业级合规需求（SOX、GDPR等）

**设计方案**：

```python
class AuditLog(Base):
    """细粒度审计日志——用于合规和安全追踪。"""
    
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_user_id_created_at", "user_id", "created_at"),
        Index("ix_audit_logs_tenant_id_created_at", "tenant_id", "created_at"),
        Index("ix_audit_logs_resource_type", "resource_type"),
    )
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # 谁做了什么
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("agents.id"), nullable=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    
    # 什么被改变了
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)  # user|agent|tool|skill|task|etc
    resource_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    
    # 做了什么
    action: Mapped[str] = mapped_column(String(50), nullable=False)  # create|update|delete|export|access
    description: Mapped[str] = mapped_column(Text, nullable=False)
    
    # 具体变更
    changes: Mapped[dict | None] = mapped_column(JSON, default=None)  # {"field": {"old": "...", "new": "..."}}
    
    # IP 和上下文
    ip_address: Mapped[str | None] = mapped_column(String(50))
    user_agent: Mapped[str | None] = mapped_column(String(500))
    
    # 状态
    status: Mapped[str] = mapped_column(String(20), default="success")  # success|failure|partial
    error_message: Mapped[str | None] = mapped_column(Text)
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
```

---

### 6. 令牌计费与配额追踪（Token Accounting）- **高优先级**

**现状问题**：
- Token 计费分散在多个表中（`agents.tokens_used_*`、Message）
- 缺少明细账单表
- 无法按天/月/用户聚合计费

**设计方案**：

```python
class TokenAccount(Base):
    """令牌计费账户——按时间维度追踪。"""
    
    __tablename__ = "token_accounts"
    __table_args__ = (
        Index("ix_token_accounts_agent_id_period", "agent_id", "period_type", "period_start"),
    )
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    agent_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    
    # 计费周期
    period_type: Mapped[str] = mapped_column(String(20), nullable=False)  # daily|monthly|total
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    
    # 输入/输出令牌统计
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)  # Claude 缓存特性
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    
    # 成本（可选）
    estimated_cost: Mapped[float | None] = mapped_column(default=None)  # 美元或本地货币
    
    capped: Mapped[bool] = mapped_column(Boolean, default=False)  # 达到配额限制
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TokenTransaction(Base):
    """单条操作的令牌花费——消息、工具调用等。"""
    
    __tablename__ = "token_transactions"
    __table_args__ = (
        Index("ix_token_transactions_agent_id_created_at", "agent_id", "created_at"),
    )
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    agent_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # 关联的资源
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"))
    
    # 操作类型
    transaction_type: Mapped[str] = mapped_column(String(50), nullable=False)  # message|tool_call|embedding|etc
    
    # 令牌统计
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    
    model_used: Mapped[str] = mapped_column(String(100))  # claude-opus-4-6, gpt-4o, etc.
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

---

## 性能优化策略

### 1. **索引设计**

#### **关键热点索引**
```python
# 聊天会话与消息查询
Index("ix_messages_session_created", "chat_session_id", "created_at")
Index("ix_messages_agent_id_created", "agent_id", "created_at")

# 代理触发器评估
Index("ix_agent_triggers_agent_enabled", "agent_id", "is_enabled")
Index("ix_agent_triggers_type_next_fire", "type", "last_fired_at")

# 通知拉取
Index("ix_notifications_user_unread", "user_id", "is_read", "created_at")

# Plaza 动态流
Index("ix_plaza_posts_tenant_created", "tenant_id", "created_at")
Index("ix_plaza_comments_post_created", "post_id", "created_at")

# 活动日志分析
Index("ix_activity_logs_agent_created", "agent_id", "action_type", "created_at")

# 令牌计费查询
Index("ix_token_accounts_agent_period", "agent_id", "period_type", "period_start")
```

#### **分析查询索引**
```python
# 审计日志报表
Index("ix_audit_logs_tenant_resource", "tenant_id", "resource_type", "created_at")
Index("ix_audit_logs_user_action", "user_id", "action", "created_at")

# 用户配额统计
Index("ix_users_tenant_quota", "tenant_id", "quota_messages_used")
```

### 2. **分区策略**

对于超大表（消息、活动日志、审计日志），考虑按 **时间分区**：
```sql
-- 按月分区 messages 表
CREATE TABLE messages_2026_03 PARTITION OF messages
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- 按年分区 audit_logs 表
CREATE TABLE audit_logs_2026 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
```

### 3. **缓存策略**

- **Redis 缓存**：
  - 代理基本信息 (TTL: 1h)
  - 用户权限 (TTL: 30min)
  - 企业配置 (TTL: 4h)
  - 聊天会话最后消息 (TTL: 5min)

- **数据库缓存列**：
  - Plaza 交互计数（like_count, comment_count）
  - User 配额消耗（quota_messages_used）
  - Agent 令牌统计（tokens_used_*）

### 4. **查询优化**

#### **避免 N+1 查询**
```python
# ❌ 不好
sessions = db.query(ChatSession).all()
for session in sessions:
    messages = db.query(Message).filter(Message.chat_session_id == session.id).all()

# ✅ 好
sessions = db.query(ChatSession).options(
    selectinload(ChatSession.messages)
).all()
```

#### **分页与游标**
```python
# 使用游标（created_at + id）实现高效分页
messages = db.query(Message).filter(
    Message.chat_session_id == session_id,
    (Message.created_at, Message.id) < (cursor_time, cursor_id)
).order_by(Message.created_at.desc(), Message.id.desc()).limit(50).all()
```

### 5. **连接池管理**
```python
# database.py 已配置
engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=20,      # 连接数
    max_overflow=10,   # 应急溢出
    pool_pre_ping=True,  # 连接健康检查
    echo_pool=True,    # 调试模式
)
```

---

## 多租户隔离方案

### 1. **绝对隔离原则**

**规则**：
- 每个 API 端点必须强制 tenant_id 过滤
- 用户只能访问其所属租户的数据
- `platform_admin` 需特殊处理（涉及跨租户操作）

### 2. **数据库层隔离**

```python
# 安全的租户过滤 Mixin
class TenantMixin:
    """多租户模型基类——自动租户隔离。"""
    
    @classmethod
    def for_tenant(cls, tenant_id: uuid.UUID):
        """返回当前租户的查询器。"""
        return db.query(cls).filter(cls.tenant_id == tenant_id)

# 使用示例
agents = Agent.for_tenant(current_user.tenant_id).filter(Agent.is_active == True).all()
```

### 3. **跨租户操作防护**

```python
# 中间件：验证请求的 tenant_id 是否匹配用户
@app.middleware("http")
async def tenant_isolation_middleware(request: Request, call_next):
    # 从 JWT Token 提取 tenant_id
    current_user = request.state.user
    requested_tenant = request.query_params.get("tenant_id")
    
    # platform_admin 可跨租户访问
    if current_user.role != "platform_admin":
        if str(requested_tenant) != str(current_user.tenant_id):
            raise HTTPException(status_code=403, detail="Unauthorized tenant access")
    
    return await call_next(request)
```

### 4. **平台级数据与租户隔离**

| 表 | tenant_id | 说明 |
|----|-----------|------|
| tenants | N/A | 平台级表 |
| users | 有 | 每个用户属于一个租户 |
| agents | 有 | 每个代理属于一个租户 |
| llm_models | 可选 | NULL = 平台默认，有值 = 租户自定义 |
| tools | 可选 | NULL = 平台内置，有值 = 租户自定义 |
| skills | 可选 | NULL = 平台内置，有值 = 租户自定义 |
| audit_logs | 有 | 严格租户隔离 |

---

## 数据一致性与事务管理

### 1. **事务隔离级别**

```python
# 异步事务
async with db.begin():
    # 原子操作
    agent = await db.query(Agent).filter(Agent.id == agent_id).first()
    agent.status = "running"
    await db.merge(agent)
    # 自动 COMMIT 或 ROLLBACK
```

### 2. **关键一致性保证**

#### **代理状态机**
```
creating → running (或) → idle → stopped
          ↓
        error → stopped
```
- 使用 `CHECK` 约束防止非法状态转移
- 更新前验证当前状态

#### **消息-Token 一致性**
```python
# 当创建消息时，同时更新 token 账户
async def create_message(session: AsyncSession, msg_data):
    msg = Message(**msg_data)
    session.add(msg)
    
    # 更新每日令牌统计
    account = await session.query(TokenAccount).filter(
        TokenAccount.agent_id == msg.agent_id,
        TokenAccount.period_type == "daily",
        func.date(TokenAccount.period_start) == func.date(msg.created_at)
    ).first()
    
    if account:
        account.output_tokens += msg.tokens_used
    
    await session.flush()  # 立即分配 ID
```

#### **触发器防止并发**
```python
# 防止触发器并发执行
class AgentTrigger(Base):
    executing: Mapped[bool] = mapped_column(Boolean, default=False)
    executed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

# 原子更新
UPDATE agent_triggers 
SET executing = true, last_fired_at = NOW()
WHERE id = ? AND executing = false AND is_enabled = true
RETURNING *;
```

### 3. **冲突解决策略**

#### **乐观锁**
```python
class Agent(Base):
    version: Mapped[int] = mapped_column(Integer, default=1)
    
    # 更新时验证版本
    UPDATE agents SET ..., version = version + 1
    WHERE id = ? AND version = ?
```

#### **分布式锁（Redis）**
```python
async def execute_trigger(trigger_id: uuid.UUID):
    lock_key = f"trigger:{trigger_id}:lock"
    
    async with redis.lock(lock_key, timeout=5):
        # 一次只有一个进程在执行
        trigger = await db.get(AgentTrigger, trigger_id)
        await execute_task(trigger)
```

---

## 实现路线图

### **Phase 1：消息存储基础（第 1-2 周）**
- [ ] 创建 `Message` 表
- [ ] 创建必要索引
- [ ] 迁移现有消息（如有）
- [ ] 测试消息 CRUD
- [ ] 前端集成消息列表查询

### **Phase 2：代理关系与身份（第 3-4 周）**
- [ ] 完善 `Participant` 表
- [ ] 创建 `AgentRelationship` 表
- [ ] 添加关系管理 API
- [ ] 支持"我的关系"查询

### **Phase 3：Plaza 社交系统（第 5-6 周）**
- [ ] 创建 `PlazaPost`、`PlazaComment`、`PlazaLike` 表
- [ ] 实现发布、评论、点赞 API
- [ ] Plaza 动态流查询优化
- [ ] 前端 Plaza 页面

### **Phase 4：审计与合规（第 7-8 周）**
- [ ] 创建 `AuditLog` 表
- [ ] 在所有修改端点添加审计记录
- [ ] 构建审计报表
- [ ] 导出合规日志功能

### **Phase 5：令牌计费与配额（第 9-10 周）**
- [ ] 创建 `TokenAccount` 和 `TokenTransaction` 表
- [ ] Update 现有 Message 写入逻辑
- [ ] 日/月统计 Job
- [ ] 配额警告和限流

### **Phase 6：企业设置与配置管理（第 11-12 周）**
- [ ] 创建 `EnterpriseSettings` 和 `EnterpriseSettingsAudit` 表
- [ ] 迁移现有 Tenant JSON 配置
- [ ] 企业设置 API
- [ ] 配置变更通知

### **Phase 7：性能优化与验证（第 13-14 周）**
- [ ] 索引优化验证
- [ ] 分区规划与测试
- [ ] 缓存策略部署
- [ ] 负载测试（1M+ 消息）
- [ ] 文档更新

---

## 数据字典速查表

### 核心表汇总

| 表名 | 行数预估 | 增长速率 | 保留期 | 索引数 |
|------|---------|---------|--------|-------|
| users | 10K | 低 | 无限 | 5 |
| agents | 50K | 中 | 无限 | 6 |
| messages | 100M+ | 高 | 1年 | 6 |
| chat_sessions | 5M | 中 | 无限 | 5 |
| agent_triggers | 100K | 低 | 无限 | 4 |
| plaza_posts | 1M | 中 | 1年 | 5 |
| agent_activity_logs | 50M | 高 | 1年 | 5 |
| audit_logs | 10M | 中 | 3年 | 6 |
| token_transactions | 500M+ | 高 | 1年 | 4 |
| notifications | 50M | 高 | 6个月 | 5 |

---

## 总结与建议

### ✅ 现状优势
1. 完整的多租户架构基础
2. 异步数据库驱动已集成
3. 灵活的权限模型
4. 动态工具与技能管理

### ⚠️ 需强化方向
1. **消息存储**：立即补齐 Message 表设计
2. **审计合规**：建立独立的、细粒度的审计日志
3. **性能监控**：添加令牌和配额多维追踪
4. **社交功能**：Plaza 系统完整实现
5. **文档同步**：所有表变更务必更新本规划文档

### 🚀 建议优先级
1. **P0 (立即)**：消息表、审计日志、令牌计费
2. **P1 (本迭代)**：代理关系、Plaza 基础
3. **P2 (下迭代)**：企业设置持久化、性能优化
4. **P3 (持续)**：缓存策略、分区规划

### 📋 维护规则
- **每次功能迭代**必须更新本文档的"数据模型详细设计"部分
- **每次迁移**必须在 `alembic/versions/` 中以 `YYYYMMDD_feature_name.py` 命名
- **每个新表**必须在"数据字典速查表"中添加行
- **每个 API 端点**的 ORM 查询必须添加 `tenant_id` 过滤

---

**文档版本**：1.0  
**最后更新**：2026-03-17  
**维护人**：AI Assistant  
**同步状态**：✅ 与 ARCHITECTURE_SPEC.md 一致
