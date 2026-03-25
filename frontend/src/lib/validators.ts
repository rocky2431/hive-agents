/**
 * Zod validation schemas for all forms.
 * Used with react-hook-form via @hookform/resolvers/zod.
 *
 * NOTE: Zod 4 deprecates .email()/.uuid()/.url()/.datetime() on z.string().
 * Use z.email(), z.uuid(), z.url(), z.iso.datetime() instead.
 * For backwards compat we keep z.string().email() etc. — they still work,
 * just emit deprecation warnings in IDE. Migration to Zod 4 native forms
 * can happen in a separate pass.
 */

import { z } from 'zod';

// ─── Auth ──────────────────────────────────────────

export const loginSchema = z.object({
    username: z.string().min(1, 'Username is required'),
    password: z.string().min(1, 'Password is required'),
});
export type LoginForm = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
    username: z.string().min(2, 'Username must be at least 2 characters').max(50),
    email: z.string().check(z.email('Invalid email address')),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    display_name: z.string().min(1, 'Display name is required').max(100),
    invitation_code: z.string().optional(),
});
export type RegisterForm = z.infer<typeof registerSchema>;

export const changePasswordSchema = z.object({
    old_password: z.string().min(1, 'Current password is required'),
    new_password: z.string().min(6, 'New password must be at least 6 characters'),
});
export type ChangePasswordForm = z.infer<typeof changePasswordSchema>;

// ─── Agent ─────────────────────────────────────────

const optionalUrl = z.union([z.string().check(z.url('Invalid URL')), z.literal('')]).optional();
const optionalUuid = z.union([z.string().check(z.uuid()), z.literal('')]).optional();

export const agentCreateSchema = z.object({
    name: z.string().min(1, 'Agent name is required').max(50),
    role_description: z.string().min(1, 'Role description is required').max(2000),
    bio: z.string().max(500).optional(),
    welcome_message: z.string().max(1000).optional(),
    avatar_url: optionalUrl,
    personality: z.string().max(2000).optional(),
    boundaries: z.string().max(2000).optional(),
    primary_model_id: optionalUuid,
    fallback_model_id: optionalUuid,
    permission_scope_type: z.enum(['company', 'user']).default('company'),
    permission_scope_ids: z.array(z.string()).optional(),
    permission_access_level: z.enum(['use', 'manage']).default('use'),
    max_tokens_per_day: z.coerce.number().int().positive().optional().or(z.literal(0)),
    max_tokens_per_month: z.coerce.number().int().positive().optional().or(z.literal(0)),
    agent_class: z.enum(['internal_system', 'internal_tenant', 'external_gateway', 'external_api']).default('internal_tenant'),
    security_zone: z.enum(['public', 'standard', 'restricted']).default('standard'),
    skill_ids: z.array(z.string()).optional(),
});
export type AgentCreateForm = z.infer<typeof agentCreateSchema>;

const optionalDatetime = z.union([z.string().check(z.iso.datetime()), z.literal('')]).optional();

export const agentUpdateSchema = agentCreateSchema.partial().extend({
    max_tool_rounds: z.coerce.number().int().min(1).max(200).optional(),
    max_triggers: z.coerce.number().int().min(0).max(100).optional(),
    min_poll_interval_min: z.coerce.number().int().min(1).optional(),
    webhook_rate_limit: z.coerce.number().int().min(1).optional(),
    heartbeat_enabled: z.boolean().optional(),
    heartbeat_interval_minutes: z.coerce.number().int().min(30).optional(),
    heartbeat_active_hours: z.string().check(
        z.regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, 'Format: HH:MM-HH:MM'),
    ).optional(),
    timezone: z.string().optional(),
    expires_at: optionalDatetime,
});
export type AgentUpdateForm = z.infer<typeof agentUpdateSchema>;

// ─── Task ──────────────────────────────────────────

export const taskCreateSchema = z.object({
    title: z.string().min(1, 'Title is required').max(200),
    description: z.string().max(2000).optional(),
    type: z.enum(['todo', 'supervision']).default('todo'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
    due_date: optionalDatetime,
    supervision_target_name: z.string().optional(),
    supervision_channel: z.string().optional(),
    remind_schedule: z.string().optional(),
});
export type TaskCreateForm = z.infer<typeof taskCreateSchema>;

// ─── Schedule ──────────────────────────────────────

export const scheduleCreateSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100),
    instruction: z.string().min(1, 'Instruction is required').max(2000),
    cron_expr: z.string().min(1, 'Cron expression is required'),
    is_enabled: z.boolean().default(true),
});
export type ScheduleCreateForm = z.infer<typeof scheduleCreateSchema>;

// ─── LLM Model ─────────────────────────────────────

export const llmModelCreateSchema = z.object({
    provider: z.string().min(1, 'Provider is required'),
    model: z.string().min(1, 'Model name is required'),
    api_key: z.string().min(1, 'API key is required'),
    base_url: optionalUrl,
    label: z.string().min(1, 'Label is required').max(100),
    max_tokens_per_day: z.coerce.number().int().positive().optional(),
    enabled: z.boolean().default(true),
    supports_vision: z.boolean().default(false),
    max_output_tokens: z.coerce.number().int().positive().optional(),
    max_input_tokens: z.coerce.number().int().positive().optional(),
});
export type LLMModelCreateForm = z.infer<typeof llmModelCreateSchema>;

// ─── Department ────────────────────────────────────

export const departmentCreateSchema = z.object({
    name: z.string().min(1, 'Department name is required').max(100),
    parent_id: optionalUuid,
    manager_id: optionalUuid,
});
export type DepartmentCreateForm = z.infer<typeof departmentCreateSchema>;

// ─── Capability Policy ─────────────────────────────

export const capabilityPolicySchema = z.object({
    capability: z.string().min(1, 'Capability is required'),
    agent_id: optionalUuid,
    allowed: z.boolean().default(true),
    requires_approval: z.boolean().default(false),
});
export type CapabilityPolicyForm = z.infer<typeof capabilityPolicySchema>;

// ─── Invitation Code ───────────────────────────────

export const invitationCodeCreateSchema = z.object({
    count: z.coerce.number().int().min(1).max(100).default(5),
    max_uses: z.coerce.number().int().min(1).default(5),
});
export type InvitationCodeCreateForm = z.infer<typeof invitationCodeCreateSchema>;

// ─── Memory Config ─────────────────────────────────

export const memoryConfigSchema = z.object({
    summary_model_id: optionalUuid,
    compress_threshold: z.coerce.number().int().min(10).max(200).default(70),
    keep_recent: z.coerce.number().int().min(1).max(50).default(10),
    extract_to_viking: z.boolean().default(false),
});
export type MemoryConfigForm = z.infer<typeof memoryConfigSchema>;

// ─── Channel Config ────────────────────────────────

export const channelConfigSchema = z.object({
    channel_type: z.enum(['feishu', 'wecom', 'dingtalk', 'slack', 'discord', 'atlassian', 'microsoft_teams']).default('feishu'),
    app_id: z.string().optional(),
    app_secret: z.string().optional(),
    encrypt_key: z.string().optional(),
    verification_token: z.string().optional(),
    extra_config: z.record(z.string(), z.unknown()).optional(),
});
export type ChannelConfigForm = z.infer<typeof channelConfigSchema>;

// ─── User Quota ────────────────────────────────────

export const userQuotaSchema = z.object({
    quota_message_limit: z.coerce.number().int().min(0).optional(),
    quota_message_period: z.enum(['permanent', 'daily', 'weekly', 'monthly']).optional(),
    quota_max_agents: z.coerce.number().int().min(0).optional(),
    quota_agent_ttl_hours: z.coerce.number().int().min(0).optional(),
});
export type UserQuotaForm = z.infer<typeof userQuotaSchema>;

// ─── Platform Settings ─────────────────────────────

export const platformSettingsSchema = z.object({
    allow_self_create_company: z.boolean(),
    invitation_code_enabled: z.boolean(),
});
export type PlatformSettingsForm = z.infer<typeof platformSettingsSchema>;
