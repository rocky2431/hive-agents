/** Shared TypeScript types — mirrors backend Pydantic schemas */

// ─── Auth & User ───────────────────────────────────

export type UserRole = 'platform_admin' | 'org_admin' | 'agent_admin' | 'member';

export interface User {
    id: string;
    username: string;
    email: string;
    display_name: string;
    avatar_url?: string;
    role: UserRole;
    tenant_id?: string;
    department_id?: string;
    title?: string;
    feishu_open_id?: string;
    oidc_sub?: string;
    is_active: boolean;
    quota_message_limit?: number;
    quota_message_period?: 'permanent' | 'daily' | 'weekly' | 'monthly';
    quota_messages_used?: number;
    quota_max_agents?: number;
    quota_agent_ttl_hours?: number;
    agents_count?: number;
    source?: 'registered' | 'feishu';
    created_at: string;
}

export interface TokenResponse {
    access_token: string;
    token_type: string;
    user: User;
    needs_company_setup?: boolean;
}

// ─── Tenant ────────────────────────────────────────

export interface Tenant {
    id: string;
    name: string;
    slug: string;
    im_provider?: 'feishu' | 'dingtalk' | 'wecom' | 'microsoft_teams' | 'web_only';
    timezone?: string;
    is_active: boolean;
    default_message_limit?: number;
    default_message_period?: string;
    default_max_agents?: number;
    default_agent_ttl_hours?: number;
    default_max_llm_calls_per_day?: number;
    default_max_triggers?: number;
    min_poll_interval_floor?: number;
    max_webhook_rate_ceiling?: number;
    min_heartbeat_interval_minutes?: number;
    created_at: string;
}

// ─── Organization ──────────────────────────────────

export interface Department {
    id: string;
    name: string;
    parent_id?: string;
    manager_id?: string;
    sort_order: number;
    tenant_id?: string;
    created_at: string;
}

export interface DepartmentTree extends Department {
    children: DepartmentTree[];
    member_count: number;
}

// ─── Agent ─────────────────────────────────────────

export type AgentStatus = 'draft' | 'creating' | 'running' | 'idle' | 'stopped' | 'error';
export type AgentClass = 'internal_system' | 'internal_tenant' | 'external_gateway' | 'external_api';
export type SecurityZone = 'public' | 'standard' | 'restricted';
export type AgentType = 'native' | 'openclaw';

export interface Agent {
    id: string;
    name: string;
    avatar_url?: string;
    role_description: string;
    bio?: string;
    welcome_message?: string;
    status: AgentStatus;
    creator_id: string;
    creator_username?: string;
    tenant_id?: string;
    primary_model_id?: string;
    fallback_model_id?: string;
    tokens_used_today: number;
    tokens_used_month: number;
    tokens_used_total?: number;
    max_tokens_per_day?: number;
    max_tokens_per_month?: number;
    max_tool_rounds?: number;
    max_triggers?: number;
    min_poll_interval_min?: number;
    webhook_rate_limit?: number;
    heartbeat_enabled: boolean;
    heartbeat_interval_minutes: number;
    heartbeat_active_hours: string;
    last_heartbeat_at?: string;
    timezone?: string;
    context_window_size?: number;
    expires_at?: string;
    is_expired?: boolean;
    llm_calls_today?: number;
    max_llm_calls_per_day?: number;
    agent_type?: AgentType;
    agent_class?: AgentClass;
    security_zone?: SecurityZone;
    openclaw_last_seen?: string;
    created_at: string;
    last_active_at?: string;
}

export interface AgentCreateInput {
    name: string;
    role_description: string;
    bio?: string;
    welcome_message?: string;
    avatar_url?: string;
    personality?: string;
    boundaries?: string;
    primary_model_id?: string;
    fallback_model_id?: string;
    permission_scope_type?: 'company' | 'user';
    permission_scope_ids?: string[];
    permission_access_level?: 'use' | 'manage';
    tenant_id?: string;
    max_tokens_per_day?: number;
    max_tokens_per_month?: number;
    agent_class?: AgentClass;
    security_zone?: SecurityZone;
    skill_ids?: string[];
}

export interface AgentPermission {
    scope_type: 'company' | 'department' | 'user';
    scope_ids: string[];
    scope_names?: string[];
    access_level: 'use' | 'manage';
    is_owner: boolean;
}

// ─── Chat ──────────────────────────────────────────

export interface ChatSession {
    id: string;
    agent_id: string;
    user_id: string;
    username?: string;
    source_channel: string;
    title: string;
    created_at: string;
    last_message_at?: string;
    message_count?: number;
    peer_agent_id?: string;
    peer_agent_name?: string;
    participant_type?: 'user' | 'agent';
}

export interface ChatMessage {
    id: string;
    agent_id: string;
    user_id: string;
    role: 'user' | 'assistant' | 'system' | 'tool_call';
    content: string;
    thinking?: string;
    created_at: string;
}

export interface ChatAttachment {
    name: string;
    text: string;
    path?: string;
    imageUrl?: string;
}

// ─── Tasks ─────────────────────────────────────────

export type TaskType = 'todo' | 'supervision';
export type TaskStatus = 'pending' | 'doing' | 'done' | 'paused';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Task {
    id: string;
    agent_id: string;
    title: string;
    description?: string;
    type: TaskType;
    status: TaskStatus;
    priority: TaskPriority;
    assignee: string;
    created_by: string;
    creator_username?: string;
    due_date?: string;
    supervision_target_name?: string;
    supervision_channel?: string;
    remind_schedule?: string;
    created_at: string;
    updated_at: string;
    completed_at?: string;
}

export interface TaskLog {
    id: string;
    task_id: string;
    content: string;
    created_at: string;
}

// ─── Schedules ─────────────────────────────────────

export interface AgentSchedule {
    id: string;
    agent_id: string;
    name: string;
    instruction: string;
    cron_expr: string;
    is_enabled: boolean;
    last_run_at?: string;
    next_run_at?: string;
    run_count: number;
    created_by: string;
    creator_username?: string;
    created_at: string;
}

// ─── Triggers ──────────────────────────────────────

export type TriggerType = 'cron' | 'once' | 'interval' | 'poll' | 'on_message';

export interface AgentTrigger {
    id: string;
    name: string;
    type: TriggerType;
    config: Record<string, unknown>;
    reason: string;
    focus_ref?: string;
    is_enabled: boolean;
    fire_count: number;
    max_fires?: number;
    cooldown_seconds: number;
    last_fired_at?: string;
    created_at: string;
    expires_at?: string;
}

// ─── Approvals ─────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalRequest {
    id: string;
    agent_id: string;
    agent_name?: string;
    action_type: string;
    details: Record<string, unknown>;
    status: ApprovalStatus;
    created_at: string;
    resolved_at?: string;
    resolved_by?: string;
}

// ─── LLM Models ────────────────────────────────────

export interface LLMModel {
    id: string;
    provider: string;
    model: string;
    base_url?: string;
    label: string;
    api_key_masked?: string;
    max_tokens_per_day?: number;
    enabled: boolean;
    supports_vision: boolean;
    max_output_tokens?: number;
    max_input_tokens?: number;
    created_at: string;
}

// ─── Channel Config ────────────────────────────────

export type ChannelType = 'feishu' | 'wecom' | 'dingtalk' | 'slack' | 'discord' | 'atlassian' | 'microsoft_teams';

export interface ChannelConfig {
    id: string;
    agent_id: string;
    channel_type: ChannelType;
    app_id?: string;
    app_secret?: string;
    encrypt_key?: string;
    verification_token?: string;
    is_configured: boolean;
    is_connected: boolean;
    last_tested_at?: string;
    extra_config?: Record<string, unknown>;
    created_at: string;
}

// ─── Capability & Pack ─────────────────────────────

export interface CapabilityPolicy {
    id: string;
    capability: string;
    agent_id?: string;
    allowed: boolean;
    requires_approval: boolean;
    conditions?: Record<string, unknown>;
    created_at?: string;
}

export interface CapabilityDefinition {
    capability: string;
    tools: string[];
    description?: string;
}

export interface PackPolicy {
    pack_name: string;
    enabled: boolean;
}

// ─── Audit ─────────────────────────────────────────

export interface AuditLog {
    id: string;
    user_id?: string;
    agent_id?: string;
    action: string;
    details: Record<string, unknown>;
    ip_address?: string;
    created_at: string;
}

export interface SecurityAuditEvent {
    id: string;
    sequence_num: number;
    event_type: string;
    severity: 'critical' | 'warning' | 'info';
    actor_type: 'user' | 'agent' | 'system';
    actor_id?: string;
    tenant_id: string;
    resource_type?: string;
    resource_id?: string;
    action: string;
    details: Record<string, unknown>;
    ip_address?: string;
    user_agent?: string;
    created_at: string;
    prev_hash: string;
    event_hash: string;
    execution_identity_type?: 'agent_bot' | 'delegated_user';
    execution_identity_id?: string;
    execution_identity_label?: string;
}

// ─── Notifications ─────────────────────────────────

export type NotificationType = 'approval_pending' | 'approval_resolved' | 'plaza_comment' | 'skill_install_request' | 'system';

export interface Notification {
    id: string;
    user_id: string;
    type: NotificationType;
    title: string;
    body: string;
    link?: string;
    ref_id?: string;
    is_read: boolean;
    created_at: string;
}

// ─── Enterprise Info ───────────────────────────────

export interface EnterpriseInfo {
    id: string;
    info_type: string;
    content: Record<string, unknown>;
    version: number;
    visible_roles: string[];
    updated_at: string;
}

// ─── Config History ────────────────────────────────

export interface ConfigRevision {
    id: string;
    entity_type: string;
    entity_id: string;
    version: number;
    content_hash: string;
    content: Record<string, unknown>;
    diff_from_prev?: Record<string, unknown>;
    change_source: 'user' | 'system';
    changed_by_user_id?: string;
    changed_by_agent_id?: string;
    change_message: string;
    is_active: boolean;
    created_at: string;
}

// ─── Feature Flags ─────────────────────────────────

export interface FeatureFlag {
    id: string;
    key: string;
    description: string;
    flag_type: string;
    enabled: boolean;
    rollout_percentage?: number;
    allowed_tenant_ids?: string[];
    allowed_user_ids?: string[];
    overrides?: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    expires_at?: string;
}

// ─── Gateway (OpenClaw) ────────────────────────────

export interface GatewayMessage {
    id: string;
    conversation_id?: string;
    sender_agent_name?: string;
    sender_user_name?: string;
    sender_user_id?: string;
    content: string;
    status: 'pending' | 'delivered' | 'completed';
    result?: string;
    created_at: string;
    delivered_at?: string;
    completed_at?: string;
}

export interface GatewayRelationship {
    name: string;
    type: 'human' | 'agent';
    role: string;
    description?: string;
    channels: string[];
}

// ─── Plaza ─────────────────────────────────────────

export interface PlazaComment {
    id: string;
    post_id: string;
    author_id: string;
    author_type: 'agent' | 'human';
    author_name: string;
    content: string;
    created_at: string;
}

export interface PlazaPost {
    id: string;
    author_id: string;
    author_type: 'agent' | 'human';
    author_name: string;
    content: string;
    likes_count: number;
    comments_count: number;
    created_at: string;
    comments?: PlazaComment[];
}

export interface PlazaStats {
    total_posts: number;
    total_comments: number;
    today_posts: number;
    top_contributors: { name: string; type: string; posts: number }[];
}

// ─── Platform Admin ────────────────────────────────

export interface CompanyStats {
    id: string;
    name: string;
    slug: string;
    is_active: boolean;
    created_at: string;
    user_count: number;
    agent_count: number;
    agent_running_count: number;
    total_tokens: number;
}

export interface PlatformSettings {
    allow_self_create_company: boolean;
    invitation_code_enabled: boolean;
}

export interface InvitationCode {
    id: string;
    code: string;
    tenant_id?: string;
    max_uses: number;
    used_count: number;
    is_active: boolean;
    created_by?: string;
    created_at: string;
}

// ─── Activity ──────────────────────────────────────

export type ActivityType = 'chat_reply' | 'tool_call' | 'feishu_msg_sent' | 'agent_msg_sent' | 'web_msg_sent' | 'task_created' | 'task_updated' | 'file_written' | 'error' | 'schedule_run' | 'heartbeat' | 'plaza_post';

export interface ActivityLog {
    id: string;
    agent_id: string;
    action_type: ActivityType;
    summary: string;
    detail_json?: Record<string, unknown>;
    related_id?: string;
    created_at: string;
}

// ─── Skill ─────────────────────────────────────────

export interface Skill {
    id: string;
    name: string;
    description: string;
    category: string;
    icon: string;
    folder_name: string;
    is_builtin: boolean;
    is_default: boolean;
    tenant_id?: string;
    created_at: string;
}

// ─── MCP Server ────────────────────────────────────

export interface McpServer {
    server_id: string;
    name: string;
    mcp_url?: string;
    tools: string[];
}

// ─── Paginated Response ────────────────────────────

export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    page: number;
    page_size: number;
}
