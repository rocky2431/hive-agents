/**
 * Business constants and display mappings.
 * Replaces scattered inline string checks across pages.
 */

import type { AgentStatus, AgentClass, SecurityZone, TaskStatus, TaskPriority, TriggerType, ChannelType } from '@/types';

// ─── Agent Status ──────────────────────────────────

export const AGENT_STATUS_CONFIG: Record<AgentStatus, { label: string; color: string; dotColor: string }> = {
    draft: { label: 'Draft', color: 'var(--text-tertiary)', dotColor: 'var(--status-idle)' },
    creating: { label: 'Creating', color: 'var(--info)', dotColor: 'var(--info)' },
    running: { label: 'Running', color: 'var(--success)', dotColor: 'var(--status-running)' },
    idle: { label: 'Idle', color: 'var(--text-secondary)', dotColor: 'var(--status-idle)' },
    stopped: { label: 'Stopped', color: 'var(--text-tertiary)', dotColor: 'var(--status-stopped)' },
    error: { label: 'Error', color: 'var(--error)', dotColor: 'var(--status-error)' },
};

// ─── Agent Class ───────────────────────────────────

export const AGENT_CLASS_CONFIG: Record<AgentClass, { label: string; description: string }> = {
    internal_system: { label: 'Internal System', description: 'Platform-level system agent' },
    internal_tenant: { label: 'Internal Tenant', description: 'Tenant-scoped digital employee' },
    external_gateway: { label: 'External Gateway', description: 'Remote OpenClaw agent' },
    external_api: { label: 'External API', description: 'External API-connected agent' },
};

// ─── Security Zone ─────────────────────────────────

export const SECURITY_ZONE_CONFIG: Record<SecurityZone, { label: string; description: string; color: string }> = {
    public: { label: 'Public', description: 'Minimal restrictions', color: 'var(--success)' },
    standard: { label: 'Standard', description: 'Default security level', color: 'var(--info)' },
    restricted: { label: 'Restricted', description: 'Elevated security controls', color: 'var(--warning)' },
};

// ─── Task Status ───────────────────────────────────

export const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
    pending: { label: 'Pending', color: 'var(--text-tertiary)' },
    doing: { label: 'In Progress', color: 'var(--info)' },
    done: { label: 'Done', color: 'var(--success)' },
    paused: { label: 'Paused', color: 'var(--warning)' },
};

// ─── Task Priority ─────────────────────────────────

export const TASK_PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> = {
    low: { label: 'Low', color: 'var(--text-tertiary)' },
    medium: { label: 'Medium', color: 'var(--info)' },
    high: { label: 'High', color: 'var(--warning)' },
    urgent: { label: 'Urgent', color: 'var(--error)' },
};

// ─── Trigger Type ──────────────────────────────────

export const TRIGGER_TYPE_CONFIG: Record<TriggerType, { label: string; icon: string }> = {
    cron: { label: 'Cron Schedule', icon: '🕐' },
    once: { label: 'One-Time', icon: '1️⃣' },
    interval: { label: 'Interval', icon: '🔄' },
    poll: { label: 'URL Poll', icon: '🌐' },
    on_message: { label: 'On Message', icon: '💬' },
};

// ─── Channel Type ──────────────────────────────────

export const CHANNEL_TYPE_CONFIG: Record<ChannelType, { label: string; icon: string }> = {
    feishu: { label: 'Feishu / Lark', icon: '🪶' },
    slack: { label: 'Slack', icon: '💬' },
    discord: { label: 'Discord', icon: '🎮' },
    wecom: { label: 'WeCom', icon: '💼' },
    dingtalk: { label: 'DingTalk', icon: '🔔' },
    microsoft_teams: { label: 'Microsoft Teams', icon: '🟦' },
    atlassian: { label: 'Atlassian', icon: '🔷' },
};

// ─── Permission ────────────────────────────────────

export const PERMISSION_SCOPES = [
    { value: 'company' as const, label: 'Entire Company' },
    { value: 'department' as const, label: 'Department' },
    { value: 'user' as const, label: 'Specific Users' },
];

export const ACCESS_LEVELS = [
    { value: 'use' as const, label: 'Use', description: 'Chat, tasks, tools, skills only' },
    { value: 'manage' as const, label: 'Manage', description: 'Full access including settings' },
];

// ─── LLM Providers ─────────────────────────────────

export const LLM_PROVIDER_CONFIG: Record<string, { label: string; icon: string }> = {
    openai: { label: 'OpenAI', icon: '🟢' },
    anthropic: { label: 'Anthropic', icon: '🟠' },
    deepseek: { label: 'DeepSeek', icon: '🔵' },
    google: { label: 'Google', icon: '🔴' },
    openai_compatible: { label: 'OpenAI Compatible', icon: '⚙️' },
};
