/** Shared TypeScript types */

export interface User {
    id: string;
    username: string;
    email: string;
    display_name: string;
    avatar_url?: string;
    role: 'platform_admin' | 'org_admin' | 'agent_admin' | 'member';
    tenant_id?: string;
    department_id?: string;
    title?: string;
    feishu_open_id?: string;
    is_active: boolean;
    created_at: string;
}

export interface Agent {
    id: string;
    name: string;
    avatar_url?: string;
    role_description: string;
    bio?: string;
    status: 'creating' | 'running' | 'idle' | 'stopped' | 'error';
    creator_id: string;
    tenant_id?: string;
    primary_model_id?: string;
    fallback_model_id?: string;
    tokens_used_today: number;
    tokens_used_month: number;
    max_tokens_per_day?: number;
    max_tokens_per_month?: number;
    heartbeat_enabled: boolean;
    heartbeat_interval_minutes: number;
    heartbeat_active_hours: string;
    last_heartbeat_at?: string;
    timezone?: string;
    context_window_size?: number;
    agent_type?: 'native' | 'openclaw';
    agent_class?: 'internal_system' | 'internal_tenant' | 'external_gateway' | 'external_api';
    security_zone?: 'standard' | 'restricted' | 'public';
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
    agent_class?: 'internal_system' | 'internal_tenant' | 'external_gateway' | 'external_api';
    security_zone?: 'standard' | 'restricted' | 'public';
    skill_ids?: string[];
}

export interface Task {
    id: string;
    agent_id: string;
    title: string;
    description?: string;
    type: 'todo' | 'supervision';
    status: 'pending' | 'doing' | 'done' | 'paused';
    priority: 'low' | 'medium' | 'high' | 'urgent';
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

export interface ChatMessage {
    id: string;
    agent_id: string;
    user_id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    created_at: string;
}

export interface ChatAttachment {
    name: string;
    text: string;
    path?: string;
    imageUrl?: string;
}

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

export interface TokenResponse {
    access_token: string;
    token_type: string;
    user: User;
    needs_company_setup?: boolean;
}
