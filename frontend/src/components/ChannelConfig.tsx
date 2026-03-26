import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { channelApi } from '../services/api';
import { sanitizeChannelPayload } from '../lib/channelSecrets';
import { cn } from '../lib/cn';

// ─── Shared fetchAuth (same as AgentDetail) ─────────────
function fetchAuth<T>(url: string, options?: RequestInit): Promise<T> {
    const token = localStorage.getItem('token');
    return fetch(`/api/v1${url}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }).then(r => r.json());
}

// ─── Types ──────────────────────────────────────────────
interface ChannelConfigProps {
    mode: 'create' | 'edit';
    agentId?: string;          // required for edit mode
    canManage?: boolean;       // edit mode: whether current user can manage
    values?: Record<string, string>;
    onChange?: (values: Record<string, string>) => void;
}

interface ChannelField {
    key: string;
    label: string;
    placeholder?: string;
    type?: 'text' | 'password';
    required?: boolean;
}

interface GuideConfig {
    prefix: string;           // i18n key prefix e.g. 'channelGuide.slack'
    steps: number;
    noteKey?: string;         // override note key
}

interface ChannelDef {
    id: string;
    icon: ReactNode;
    nameKey: string;
    nameFallback: string;
    descKey: string;
    descFallback: string;
    // API endpoint slug: e.g. 'slack-channel', 'discord-channel'
    apiSlug?: string;
    // Feishu uses channelApi instead of fetchAuth
    useChannelApi?: boolean;
    // Fields for configuration form
    fields: ChannelField[];
    // Setup guide
    guide: GuideConfig;
    // Whether this channel supports connection_mode toggle (feishu, wecom)
    connectionMode?: boolean;
    // WebSocket guide config (when connection_mode === 'websocket')
    wsGuide?: GuideConfig;
    // Whether this channel shows feishu permission JSON block
    showPermJson?: boolean;
    // Webhook URL label key
    webhookLabelKey?: string;
    // Webhook URL label fallback
    webhookLabelFallback?: string;
    // Channels only shown in edit mode (not in create wizard)
    editOnly?: boolean;
    // Custom fields for websocket mode (wecom)
    wsFields?: ChannelField[];
    // Atlassian-specific test connection feature
    hasTestConnection?: boolean;
}

// ─── SVG Icons ──────────────────────────────────────────
const SlackIcon = <img src="/slack.png" alt="Slack" width="20" height="20" className="rounded" />;

const DiscordIcon = <img src="/discord.png" alt="Discord" width="20" height="20" className="rounded" />;

const FeishuIcon = <img src="/feishu.png" alt="Feishu" width="20" height="20" className="rounded" />;

const TeamsIcon = <img src="/teams.png" alt="Teams" width="20" height="20" className="rounded" />;

const WeComIcon = <img src="/wecom.png" alt="WeCom" width="20" height="20" className="rounded" />;

const DingTalkIcon = <img src="/dingtalk.png" alt="DingTalk" width="20" height="20" className="rounded" />;

const AtlassianIcon = <img src="/atlassian.png" alt="Atlassian" width="20" height="20" className="rounded" />;

// Eye icons for password toggle
const EyeOpen = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>;
const EyeClosed = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>;

// ─── Channel Registry ───────────────────────────────────
const CHANNEL_REGISTRY: ChannelDef[] = [
    {
        id: 'slack',
        icon: SlackIcon,
        nameKey: 'common.channels.slack',
        nameFallback: 'Slack',
        descKey: 'channel.slackDesc',
        descFallback: 'Slack Bot',
        apiSlug: 'slack-channel',
        fields: [
            { key: 'bot_token', label: 'channel.botToken', placeholder: 'xoxb-...', type: 'password', required: true },
            { key: 'signing_secret', label: 'channel.signingSecret', type: 'password', required: true },
        ],
        guide: { prefix: 'channelGuide.slack', steps: 8 },
        webhookLabelKey: 'channel.webhookUrlEventSub',
        webhookLabelFallback: 'Webhook URL (Event Subscriptions URL)',
    },
    {
        id: 'discord',
        icon: DiscordIcon,
        nameKey: 'common.channels.discord',
        nameFallback: 'Discord',
        descKey: 'channel.discordDesc',
        descFallback: 'Slash Commands (/ask)',
        apiSlug: 'discord-channel',
        fields: [
            { key: 'application_id', label: 'channel.applicationId', placeholder: '1234567890', required: true },
            { key: 'bot_token', label: 'channel.botToken', type: 'password', required: true },
            { key: 'public_key', label: 'channel.publicKey', required: true },
        ],
        guide: { prefix: 'channelGuide.discord', steps: 7 },
        webhookLabelKey: 'channel.interactionsEndpointUrl',
        webhookLabelFallback: 'Interactions Endpoint URL',
    },
    {
        id: 'teams',
        icon: TeamsIcon,
        nameKey: 'common.channels.teams',
        nameFallback: 'Microsoft Teams',
        descKey: 'channel.teamsDesc',
        descFallback: 'Teams Bot',
        apiSlug: 'teams-channel',
        fields: [
            { key: 'app_id', label: 'channel.appIdClientId', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true },
            { key: 'app_secret', label: 'channel.appSecretClientSecret', type: 'password', required: true },
            { key: 'tenant_id', label: 'channelGuide.teams.tenantId', placeholder: 'channelGuide.teams.tenantIdPlaceholder' },
        ],
        guide: { prefix: 'channelGuide.teams', steps: 5 },
        webhookLabelKey: 'channel.messagingEndpointUrl',
        webhookLabelFallback: 'Messaging Endpoint URL',
    },
    {
        id: 'feishu',
        icon: FeishuIcon,
        nameKey: 'agent.settings.channel.feishu',
        nameFallback: 'Feishu / Lark',
        descKey: 'channel.feishuDesc',
        descFallback: 'Feishu / Lark',
        useChannelApi: true,
        connectionMode: true,
        fields: [
            { key: 'app_id', label: 'channel.appId', placeholder: 'cli_xxxxxxxxxxxxxxxx', required: true },
            { key: 'app_secret', label: 'channel.appSecret', type: 'password', required: true },
            { key: 'encrypt_key', label: 'channel.encryptKey', type: 'password' },
        ],
        guide: { prefix: 'channelGuide.feishu', steps: 8 },
        wsGuide: { prefix: 'channelGuide.feishu', steps: 8 },
        showPermJson: true,
        webhookLabelKey: 'channel.webhookUrl',
        webhookLabelFallback: 'Webhook URL',
    },
    {
        id: 'wecom',
        icon: WeComIcon,
        nameKey: 'common.channels.wecom',
        nameFallback: 'WeCom',
        descKey: 'channel.wecomDesc',
        descFallback: 'WebSocket / Webhook',
        apiSlug: 'wecom-channel',
        connectionMode: true,
        fields: [
            { key: 'corp_id', label: 'channel.corpId', required: true },
            { key: 'wecom_agent_id', label: 'channel.agentId', required: true },
            { key: 'secret', label: 'channel.secret', type: 'password', required: true },
            { key: 'token', label: 'channel.token', required: true },
            { key: 'encoding_aes_key', label: 'channel.encodingAesKey', required: true },
        ],
        wsFields: [
            { key: 'bot_id', label: 'channel.botId', placeholder: 'aibXXXXXXXXXXXX', required: true },
            { key: 'bot_secret', label: 'channel.botSecret', type: 'password', required: true },
        ],
        guide: { prefix: 'channelGuide.wecom', steps: 6 },
        wsGuide: { prefix: 'channelGuide.wecom', steps: 6 },
        webhookLabelKey: 'channel.webhookUrl',
        webhookLabelFallback: 'Webhook URL',
    },
    {
        id: 'dingtalk',
        icon: DingTalkIcon,
        nameKey: 'common.channels.dingtalk',
        nameFallback: 'DingTalk',
        descKey: 'channel.dingtalkDesc',
        descFallback: 'Stream Mode',
        apiSlug: 'dingtalk-channel',
        fields: [
            { key: 'app_key', label: 'channel.appKey', type: 'password', required: true },
            { key: 'app_secret', label: 'channel.appSecretLabel', type: 'password', required: true },
        ],
        guide: { prefix: 'channelGuide.dingtalk', steps: 6 },
    },
    {
        id: 'atlassian',
        icon: AtlassianIcon,
        nameKey: 'common.channels.atlassian',
        nameFallback: 'Atlassian',
        descKey: 'channel.atlassianDesc',
        descFallback: 'Jira / Confluence / Compass (Rovo MCP)',
        apiSlug: 'atlassian-channel',
        hasTestConnection: true,
        fields: [
            { key: 'api_key', label: 'channel.apiKey', type: 'password', required: true },
            { key: 'cloud_id', label: 'channel.cloudId', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
        ],
        guide: { prefix: 'channelGuide.atlassian', steps: 5 },
    },
];

// ─── Feishu Permission JSON ─────────────────────────────
const FEISHU_PERM_JSON = '{"scopes":{"tenant":["contact:contact.base:readonly","contact:user.base:readonly","contact:user.id:readonly","im:chat","im:message","im:message.group_at_msg:readonly","im:message.p2p_msg:readonly","im:message:send_as_bot","im:resource"],"user":[]}}';

const FEISHU_PERM_DISPLAY = `{
  "scopes": {
    "tenant": [
      "contact:contact.base:readonly",
      "contact:user.base:readonly",
      "contact:user.id:readonly",
      "im:chat",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.p2p_msg:readonly",
      "im:message:send_as_bot",
      "im:resource"
    ],
    "user": []
  }
}`;

// ─── Copy Button helper ─────────────────────────────────
function CopyBtn({ url, title }: { url: string; title?: string }) {
    return (
        <button title={title} className="inline-flex items-center justify-center ml-1.5 px-1 py-px cursor-pointer rounded-sm border border-edge-default bg-surface-primary text-content-secondary align-middle leading-none"
            onClick={() => navigator.clipboard.writeText(url)}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="9" height="11" rx="1.5" /><path d="M3 11H2a1 1 0 01-1-1V2a1 1 0 011-1h8a1 1 0 011 1v1" />
            </svg>
        </button>
    );
}

// ─── Main Component ─────────────────────────────────────
export default function ChannelConfig({ mode, agentId, canManage = true, values, onChange }: ChannelConfigProps) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();

    // Collapsible state per channel
    const [openChannels, setOpenChannels] = useState<Record<string, boolean>>({});
    const toggleChannel = (id: string) => setOpenChannels(prev => ({ ...prev, [id]: !prev[id] }));

    // Editing state per channel (edit mode only)
    const [editingChannels, setEditingChannels] = useState<Record<string, boolean>>({});
    const setEditing = (id: string, val: boolean) => setEditingChannels(prev => ({ ...prev, [id]: val }));

    // Form state per channel (edit mode only)
    const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
    const setFormField = (channelId: string, key: string, val: string) =>
        setForms(prev => ({ ...prev, [channelId]: { ...prev[channelId], [key]: val } }));
    const getForm = (channelId: string) => forms[channelId] || {};

    // Connection mode state for feishu/wecom (edit mode)
    const [connectionModes, setConnectionModes] = useState<Record<string, string>>({
        feishu: 'websocket',
        wecom: 'websocket',
    });

    // Password visibility
    const [showPwds, setShowPwds] = useState<Record<string, boolean>>({});
    const togglePwd = (fieldId: string) => setShowPwds(p => ({ ...p, [fieldId]: !p[fieldId] }));

    // Atlassian test connection state
    const [atlassianTesting, setAtlassianTesting] = useState(false);
    const [atlassianTestResult, setAtlassianTestResult] = useState<{ ok: boolean; message?: string; tool_count?: number; error?: string } | null>(null);

    // ─── Edit mode: queries for each channel ────────────
    const enabled = mode === 'edit' && !!agentId;

    const { data: feishuConfig } = useQuery({
        queryKey: ['channel', agentId],
        queryFn: () => channelApi.get(agentId!),
        enabled: enabled,
    });
    const { data: feishuWebhook } = useQuery({
        queryKey: ['webhook-url', agentId],
        queryFn: () => channelApi.webhookUrl(agentId!),
        enabled: enabled,
    });
    const { data: slackConfig } = useQuery({
        queryKey: ['slack-channel', agentId],
        queryFn: () => fetchAuth<any>(`/agents/${agentId}/slack-channel`).catch(() => null),
        enabled: enabled,
    });
    const { data: slackWebhook } = useQuery({
        queryKey: ['slack-webhook-url', agentId],
        queryFn: () => fetchAuth<any>(`/agents/${agentId}/slack-channel/webhook-url`),
        enabled: enabled,
    });
    const { data: discordConfig } = useQuery({
        queryKey: ['discord-channel', agentId],
        queryFn: () => fetchAuth<any>(`/agents/${agentId}/discord-channel`).catch(() => null),
        enabled: enabled,
    });
    const { data: discordWebhook } = useQuery({
        queryKey: ['discord-webhook-url', agentId],
        queryFn: () => fetchAuth<any>(`/agents/${agentId}/discord-channel/webhook-url`),
        enabled: enabled,
    });
    const { data: teamsConfig } = useQuery({
        queryKey: ['teams-channel', agentId],
        queryFn: () => fetchAuth<any>(`/agents/${agentId}/teams-channel`).catch(() => null),
        enabled: enabled,
    });
    const { data: teamsWebhook } = useQuery({
        queryKey: ['teams-webhook-url', agentId],
        queryFn: () => fetchAuth<any>(`/agents/${agentId}/teams-channel/webhook-url`).catch(() => null),
        enabled: enabled,
    });
    const { data: dingtalkConfig } = useQuery({
        queryKey: ['dingtalk-channel', agentId],
        queryFn: () => fetchAuth<any>(`/agents/${agentId}/dingtalk-channel`).catch(() => null),
        enabled: enabled,
    });
    const { data: wecomConfig } = useQuery({
        queryKey: ['wecom-channel', agentId],
        queryFn: () => fetchAuth<any>(`/agents/${agentId}/wecom-channel`).catch(() => null),
        enabled: enabled,
    });
    const { data: wecomWebhook } = useQuery({
        queryKey: ['wecom-webhook-url', agentId],
        queryFn: () => fetchAuth<any>(`/agents/${agentId}/wecom-channel/webhook-url`),
        enabled: enabled,
    });
    const { data: atlassianConfig } = useQuery({
        queryKey: ['atlassian-channel', agentId],
        queryFn: () => fetchAuth<any>(`/agents/${agentId}/atlassian-channel`).catch(() => null),
        enabled: enabled,
    });

    // Helper: get config data for a channel
    const getConfig = (id: string): any => {
        switch (id) {
            case 'feishu': return feishuConfig;
            case 'slack': return slackConfig;
            case 'discord': return discordConfig;
            case 'teams': return teamsConfig;
            case 'dingtalk': return dingtalkConfig;
            case 'wecom': return wecomConfig;
            case 'atlassian': return atlassianConfig;
            default: return null;
        }
    };

    // Helper: get webhook data for a channel
    const getWebhook = (id: string): any => {
        switch (id) {
            case 'feishu': return feishuWebhook;
            case 'slack': return slackWebhook;
            case 'discord': return discordWebhook;
            case 'teams': return teamsWebhook;
            case 'wecom': return wecomWebhook;
            default: return null;
        }
    };

    // ─── Edit mode: mutations ───────────────────────────
    const saveMutation = useMutation({
        mutationFn: ({ ch, data }: { ch: ChannelDef; data: any }) => {
            if (ch.useChannelApi) {
                return channelApi.create(agentId!, data);
            }
            return fetchAuth(`/agents/${agentId}/${ch.apiSlug}`, { method: 'POST', body: JSON.stringify(data) });
        },
        onSuccess: (_d, { ch }) => {
            const keys = ch.useChannelApi
                ? [['channel', agentId]]
                : [[`${ch.apiSlug}`, agentId], [`${ch.id}-webhook-url`, agentId]];
            keys.forEach(k => queryClient.invalidateQueries({ queryKey: k }));
            // Reset form
            setForms(prev => ({ ...prev, [ch.id]: {} }));
            setEditing(ch.id, false);
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to save channel config'),
    });

    const deleteMutation = useMutation({
        mutationFn: ({ ch }: { ch: ChannelDef }) => {
            if (ch.useChannelApi) {
                return channelApi.delete(agentId!);
            }
            return fetchAuth(`/agents/${agentId}/${ch.apiSlug}`, { method: 'DELETE' });
        },
        onSuccess: (_d, { ch }) => {
            const keys = ch.useChannelApi
                ? [['channel', agentId]]
                : [[`${ch.apiSlug}`, agentId]];
            keys.forEach(k => queryClient.invalidateQueries({ queryKey: k }));
            if (ch.id === 'atlassian') setAtlassianTestResult(null);
        },
        onError: (err: Error) => toast.error(err.message || 'Failed to delete channel config'),
    });

    const testAtlassian = async () => {
        setAtlassianTesting(true);
        setAtlassianTestResult(null);
        try {
            const res = await fetchAuth<any>(`/agents/${agentId}/atlassian-channel/test`, { method: 'POST' });
            setAtlassianTestResult(res);
        } catch (e: any) {
            setAtlassianTestResult({ ok: false, error: String(e) });
        }
        setAtlassianTesting(false);
    };

    // ─── Build save payload for a channel ───────────────
    const buildPayload = (ch: ChannelDef, form: Record<string, string>) => {
        if (ch.id === 'feishu') {
            return sanitizeChannelPayload(ch.id, {
                channel_type: 'feishu',
                app_id: form.app_id,
                app_secret: form.app_secret,
                encrypt_key: form.encrypt_key || undefined,
                extra_config: { connection_mode: connectionModes.feishu || 'websocket' },
            });
        }
        if (ch.id === 'wecom') {
            const connMode = connectionModes.wecom || 'websocket';
            if (connMode === 'websocket') {
                return sanitizeChannelPayload(ch.id, {
                    connection_mode: 'websocket',
                    bot_id: form.bot_id,
                    bot_secret: form.bot_secret,
                });
            }
            return sanitizeChannelPayload(ch.id, { ...form, connection_mode: 'webhook' });
        }
        // Generic channels
        return sanitizeChannelPayload(ch.id, form);
    };

    // ─── Render guide steps ─────────────────────────────
    const renderGuide = (guide: GuideConfig, isWs: boolean, ch: ChannelDef) => {
        const prefix = isWs && ch.wsGuide ? `${ch.wsGuide.prefix}.ws_step` : `${guide.prefix}.step`;
        const stepCount = isWs && ch.wsGuide ? ch.wsGuide.steps : guide.steps;
        const noteKey = isWs && ch.wsGuide ? `${ch.wsGuide.prefix}.ws_note` : (guide.noteKey || `${guide.prefix}.note`);

        return (
            <details className="mb-2 text-xs text-content-secondary">
                <summary className="cursor-pointer font-medium text-content-primary select-none list-none flex items-center gap-1.5">
                    <span className="text-[10px]">&#9654;</span> {t('channelGuide.setupGuide')}
                </summary>
                <ol className="pl-4 my-2 leading-[1.9]">
                    {Array.from({ length: stepCount }, (_, i) => (
                        <li key={i}>{t(`${prefix}${i + 1}`)}</li>
                    ))}
                </ol>
                {ch.showPermJson && (
                    <div className="my-2 rounded-md border border-edge-default overflow-hidden">
                        <div className="flex items-center justify-between px-2.5 py-1 bg-surface-secondary border-b border-edge-default">
                            <span className="text-[10px] text-content-secondary font-medium">{t('channelGuide.feishuPermJson')}</span>
                            <button type="button" className="text-[10px] px-[7px] py-px cursor-pointer rounded-sm border border-edge-default bg-surface-primary text-content-secondary"
                                onClick={(e) => {
                                    const btn = e.currentTarget;
                                    navigator.clipboard.writeText(FEISHU_PERM_JSON).then(() => {
                                        const o = btn.textContent;
                                        btn.textContent = t('channelGuide.feishuPermCopied');
                                        btn.style.color = 'rgb(16,185,129)';
                                        setTimeout(() => { btn.textContent = o; btn.style.color = ''; }, 1500);
                                    });
                                }}>{t('channelGuide.feishuPermCopy')}</button>
                        </div>
                        <pre className="m-0 px-2.5 py-1.5 text-[10px] font-mono leading-normal bg-surface-primary text-content-secondary overflow-x-auto select-all">{FEISHU_PERM_DISPLAY}</pre>
                    </div>
                )}
                <div className="text-[11px] text-content-tertiary bg-surface-secondary px-2.5 py-1.5 rounded-md">
                    {t(noteKey)}
                </div>
            </details>
        );
    };

    // ─── Render a password field with toggle ─────────────
    const renderField = (field: ChannelField, channelId: string, fieldValue: string, onFieldChange: (val: string) => void) => {
        const fieldId = `${channelId}_${field.key}`;
        const isSecret = field.type === 'password';
        const labelText = t(field.label);
        const placeholderText = field.placeholder?.startsWith('channelGuide.') ? t(field.placeholder) : field.placeholder;

        return (
            <div key={field.key}>
                <label className="text-xs font-medium block mb-1">
                    {labelText} {field.required && '*'}
                    {!field.required && <span className="font-normal text-content-tertiary"> ({t('channel.optional')})</span>}
                </label>
                <div className="relative">
                    <input
                        className={cn(mode === 'edit' ? 'input' : 'form-input', mode === 'edit' && 'text-xs w-full', isSecret && mode === 'edit' && 'pr-9')}
                        type={isSecret && !showPwds[fieldId] ? 'password' : 'text'}
                        value={fieldValue}
                        onChange={e => onFieldChange(e.target.value)}
                        placeholder={placeholderText || ''}
                    />
                    {isSecret && (
                        <button type="button" onClick={() => togglePwd(fieldId)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-content-tertiary p-0.5 flex items-center">
                            {showPwds[fieldId] ? EyeClosed : EyeOpen}
                        </button>
                    )}
                </div>
                {/* Tenant ID hint for Teams */}
                {channelId === 'teams' && field.key === 'tenant_id' && (
                    <div className="text-[11px] text-content-tertiary mt-1">{t('channelGuide.teams.tenantIdHint')}</div>
                )}
            </div>
        );
    };

    // ─── Render create mode channel card ─────────────────
    const renderCreateChannel = (ch: ChannelDef) => {
        const isOpen = openChannels[ch.id] || false;

        // Ensure we default to 'websocket' for connectionMode in create view if enabled
        const connMode = ch.connectionMode ? (connectionModes[ch.id] || 'websocket') : null;
        const isWs = connMode === 'websocket';

        // Active fields for current mode
        const activeFields = (ch.connectionMode && isWs && ch.wsFields) ? ch.wsFields : ch.fields;

        // Special Feishu field filtering (hide encrypt_key if websocket mode)
        const formFields = ch.id === 'feishu' && isWs
            ? ch.fields.filter(f => f.key !== 'encrypt_key')
            : activeFields;

        // Determine if configured (any required field has value)
        const hasValues = formFields.some(f => f.required && values?.[`${ch.id}_${f.key}`]);

        let subtitle = t(ch.descKey, ch.descFallback);
        if (ch.connectionMode && hasValues) {
            subtitle = isWs ? t('channel.websocketMode') : t('channel.webhookMode');
        }

        return (
            <div key={ch.id} className="border border-edge-default rounded-lg overflow-hidden mb-2">
                <div
                    onClick={() => toggleChannel(ch.id)}
                    className={cn(
                        'flex items-center gap-3 p-3.5 cursor-pointer',
                        isOpen ? 'bg-[var(--accent-subtle)] border-b border-edge-default' : 'bg-surface-elevated',
                    )}
                >
                    {ch.icon}
                    <div className="flex-1">
                        <div className="font-medium text-[13px]">{t(ch.nameKey, ch.nameFallback)}</div>
                        <div className="text-[11px] text-content-tertiary">{subtitle}</div>
                    </div>
                    {hasValues && <span className="text-[10px] px-2 py-0.5 rounded-[10px] bg-[rgba(16,185,129,0.15)] text-[rgb(16,185,129)] font-medium">{t('channel.configured')}</span>}
                    <span className={cn('text-xs text-content-tertiary transition-transform duration-200', isOpen && 'rotate-180')}>&#9660;</span>
                </div>
                {isOpen && (
                    <div className="p-4">
                        {/* Connection Mode Toggle */}
                        {ch.connectionMode && (
                            <div className="mb-4 flex items-center gap-2">
                                <label className="text-xs font-medium w-[120px]">{t('channel.connectionMode')}</label>
                                <label className="flex items-center gap-1 text-[13px] cursor-pointer">
                                    <input type="radio" checked={isWs} onChange={() => setConnectionModes(p => ({ ...p, [ch.id]: 'websocket' }))} />
                                    {t('channel.websocketRecommended')}
                                </label>
                                <label className="flex items-center gap-1 text-[13px] cursor-pointer ml-3">
                                    <input type="radio" checked={!isWs} onChange={() => setConnectionModes(p => ({ ...p, [ch.id]: 'webhook' }))} />
                                    {t('channel.webhook')}
                                </label>
                            </div>
                        )}

                        {renderGuide(ch.guide, !!isWs, ch)}

                        {formFields.map(field => (
                            <div className="form-group" key={field.key}>
                                {renderField(
                                    field, ch.id,
                                    values?.[`${ch.id}_${field.key}`] || '',
                                    (val) => {
                                        const newValues = { ...values, [`${ch.id}_${field.key}`]: val };
                                        // Save connection mode if this channel supports it
                                        if (ch.connectionMode) {
                                            newValues[`${ch.id}_connection_mode`] = connMode || 'websocket';
                                        }
                                        onChange?.(newValues);
                                    },
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    // ─── Render edit mode channel card ───────────────────
    const renderEditChannel = (ch: ChannelDef) => {
        const config = getConfig(ch.id);
        const webhook = getWebhook(ch.id);
        const isOpen = openChannels[ch.id] || false;
        const isEditing = editingChannels[ch.id] || false;
        const form = getForm(ch.id);
        const isConfigured = ch.id === 'feishu' ? config?.is_configured : config?.is_configured;
        const connMode = connectionModes[ch.id] || 'websocket';
        const isWs = ch.connectionMode && connMode === 'websocket';
        const configConnMode = config?.extra_config?.connection_mode;

        // Determine desc subtitle based on current mode
        let subtitle = t(ch.descKey, ch.descFallback);
        if (ch.connectionMode && config) {
            subtitle = configConnMode === 'websocket' ? t('channel.websocketMode') : subtitle;
        }

        // Webhook URL for this channel
        const webhookUrl = webhook?.webhook_url || `${window.location.origin}/api/v1/channel/${ch.id === 'feishu' ? 'feishu' : ch.apiSlug?.replace('-channel', '')}/${agentId}/webhook`;

        // Determine which fields to use (wecom websocket mode has different fields)
        const activeFields = (ch.connectionMode && isWs && ch.wsFields) ? ch.wsFields : ch.fields;
        // For feishu, hide encrypt_key in websocket mode (non-editing form)
        const formFields = ch.id === 'feishu' && connMode === 'webhook'
            ? ch.fields
            : ch.id === 'feishu'
                ? ch.fields.filter(f => f.key !== 'encrypt_key')
                : activeFields;

        // Check if all required fields are filled
        const allRequired = formFields.filter(f => f.required).every(f => form[f.key]);

        return (
            <div key={ch.id} className="border border-edge-subtle rounded-lg overflow-hidden mb-3">
                {/* Header */}
                <button
                    type="button"
                    onClick={() => toggleChannel(ch.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleChannel(ch.id); } }}
                    aria-expanded={isOpen}
                    aria-label={t(ch.nameKey, ch.nameFallback)}
                    className="flex w-full items-center justify-between px-4 py-3.5 cursor-pointer transition-colors duration-150 hover:bg-[var(--bg-hover)] bg-transparent border-none text-left">
                    <div className="flex items-center gap-2">
                        {ch.icon}
                        <div>
                            <div className="font-semibold text-sm">{t(ch.nameKey, ch.nameFallback)}</div>
                            <div className="text-[11px] text-content-tertiary">{subtitle}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {config && <span className={`badge ${isConfigured ? 'badge-success' : 'badge-warning'}`}>{isConfigured ? t('channel.configured') : t('channel.notConfigured')}</span>}
                        <span className={cn('text-xs text-content-tertiary transition-transform duration-200', isOpen && 'rotate-180')}>&#9660;</span>
                    </div>
                </button>

                {/* Body */}
                {isOpen && (
                    <div className="px-4 pb-4 border-t border-edge-subtle">
                        {!canManage ? (
                            <div className="text-xs text-content-tertiary italic p-3 bg-surface-secondary rounded-md">
                                {t('channel.noPermission')}
                            </div>
                        ) : isConfigured && !isEditing ? (
                            /* ── Configured view ── */
                            <div>
                                {/* Feishu websocket status */}
                                {ch.id === 'feishu' && configConnMode === 'websocket' && (
                                    <div className="bg-surface-secondary rounded-md p-2.5 text-xs mb-3">
                                        <div className="flex items-center gap-1.5 mb-1.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-[#00D6B9] inline-block"></span>
                                            <span className="text-content-secondary">{t('channel.connectedWebsocket')}</span>
                                        </div>
                                        <div className="text-[11px] text-content-tertiary">App ID: <code>{config.app_id}</code></div>
                                    </div>
                                )}
                                {ch.id === 'feishu' && configConnMode !== 'websocket' && (
                                    <div className="text-xs text-content-tertiary mb-2">
                                        <div className="mb-1">{t('channel.modeLabel')}: <strong>{t('channel.webhook')}</strong></div>
                                        <div>App ID: <code>{config.app_id}</code></div>
                                    </div>
                                )}

                                {/* WeCom websocket status */}
                                {ch.id === 'wecom' && configConnMode === 'websocket' && (
                                    <div className="bg-surface-secondary rounded-md p-2.5 text-xs mb-3">
                                        <div className="flex items-center gap-1.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-[#07C160] inline-block"></span>
                                            <span className="text-content-secondary">{t('channel.connectedWebsocket')}</span>
                                        </div>
                                    </div>
                                )}

                                {/* Webhook URL (non-websocket channels) */}
                                {ch.webhookLabelKey && !(ch.connectionMode && configConnMode === 'websocket') && ch.id !== 'dingtalk' && ch.id !== 'atlassian' && (
                                    <div className="bg-surface-secondary rounded-md p-2.5 text-xs font-mono mb-3">
                                        <div className="text-content-tertiary mb-1.5">{t(ch.webhookLabelKey!, ch.webhookLabelFallback || '')}</div>
                                        <div className="leading-relaxed break-all">
                                            <span className="text-accent-primary">{webhookUrl}</span>
                                            <CopyBtn url={webhookUrl} title={t('channel.copy')} />
                                        </div>
                                    </div>
                                )}

                                {/* Discord extra hint */}
                                {ch.id === 'discord' && (
                                    <div className="text-[11px] text-content-tertiary mb-2">{t('channel.discordHint')}</div>
                                )}

                                {/* DingTalk stream mode hint */}
                                {ch.id === 'dingtalk' && (
                                    <div className="text-[11px] text-content-tertiary mb-2 p-2 px-2.5 bg-surface-secondary rounded-md">
                                        {t('channel.streamModeActive')}
                                    </div>
                                )}

                                {/* Atlassian status */}
                                {ch.id === 'atlassian' && (
                                    <div className="bg-surface-secondary rounded-md p-2.5 text-xs mb-3">
                                        <div className="text-content-tertiary mb-1">{t('channel.status')}</div>
                                        <div className="text-content-primary font-medium">{t('channel.atlassianConfigured')}</div>
                                        {config.cloud_id && <div className="text-content-tertiary mt-1 text-[11px]">Cloud ID: <code>{config.cloud_id}</code></div>}
                                    </div>
                                )}
                                {ch.id === 'atlassian' && atlassianTestResult && (
                                    <div className={cn(
                                        'px-3 py-2 rounded-md text-xs mb-2.5 border',
                                        atlassianTestResult.ok
                                            ? 'bg-[rgba(16,185,129,0.08)] border-[rgba(16,185,129,0.25)] text-[rgb(5,150,105)]'
                                            : 'bg-[rgba(239,68,68,0.08)] border-[rgba(239,68,68,0.25)] text-[rgb(220,38,38)]',
                                    )}>
                                        {atlassianTestResult.ok
                                            ? (atlassianTestResult.message || t('channel.atlassianConnected', { count: atlassianTestResult.tool_count }))
                                            : atlassianTestResult.error}
                                    </div>
                                )}

                                {/* Setup guide in configured view */}
                                {renderGuide(ch.guide, !!(ch.connectionMode && configConnMode === 'websocket'), ch)}

                                {/* Action buttons */}
                                <div className="flex gap-2 flex-wrap">
                                    {ch.hasTestConnection && (
                                        <button className="btn btn-secondary text-xs px-3 py-1" onClick={testAtlassian} disabled={atlassianTesting}>
                                            {atlassianTesting ? t('channel.testing') : t('channel.testConnection')}
                                        </button>
                                    )}
                                    <button className="btn btn-secondary text-xs px-3 py-1"
                                        onClick={() => {
                                            // Populate form with existing config data
                                            const prefill: Record<string, string> = {};
                                            if (ch.id === 'feishu') {
                                                prefill.app_id = config.app_id || '';
                                                prefill.app_secret = config.app_secret || '';
                                                prefill.encrypt_key = config.encrypt_key || '';
                                                setConnectionModes(prev => ({ ...prev, feishu: config.extra_config?.connection_mode || 'websocket' }));
                                            } else if (ch.id === 'wecom') {
                                                const cm = config.extra_config?.connection_mode === 'websocket' ? 'websocket' : 'webhook';
                                                setConnectionModes(prev => ({ ...prev, wecom: cm }));
                                                if (cm === 'websocket') {
                                                    prefill.bot_id = config.extra_config?.bot_id || '';
                                                    prefill.bot_secret = config.extra_config?.bot_secret || '';
                                                } else {
                                                    prefill.corp_id = config.app_id || '';
                                                    prefill.wecom_agent_id = config.extra_config?.wecom_agent_id || '';
                                                    prefill.secret = config.app_secret || '';
                                                    prefill.token = config.verification_token || '';
                                                    prefill.encoding_aes_key = config.encrypt_key || '';
                                                }
                                            } else if (ch.id === 'slack') {
                                                prefill.bot_token = config.app_secret || '';
                                                prefill.signing_secret = config.encrypt_key || '';
                                            } else if (ch.id === 'discord') {
                                                prefill.application_id = config.app_id || '';
                                                prefill.bot_token = config.app_secret || '';
                                                prefill.public_key = config.encrypt_key || '';
                                            } else if (ch.id === 'teams') {
                                                prefill.app_id = config.app_id || '';
                                                prefill.app_secret = config.app_secret || '';
                                                prefill.tenant_id = config.extra_config?.tenant_id || '';
                                            } else if (ch.id === 'dingtalk') {
                                                prefill.app_key = config.app_id || '';
                                                prefill.app_secret = config.app_secret || '';
                                            } else if (ch.id === 'atlassian') {
                                                prefill.api_key = '';
                                                prefill.cloud_id = config.cloud_id || '';
                                            }
                                            setForms(prev => ({ ...prev, [ch.id]: prefill }));
                                            setEditing(ch.id, true);
                                        }}>{t('channel.edit')}</button>
                                    <button className="btn btn-danger text-xs px-3 py-1"
                                        onClick={() => deleteMutation.mutate({ ch })}
                                        disabled={deleteMutation.isPending}>{deleteMutation.isPending ? t('common.loading') : t('channel.disconnect')}</button>
                                </div>
                            </div>
                        ) : (
                            /* ── Form view (new or editing) ── */
                            <div className="flex flex-col gap-2">
                                {/* Connection mode toggle (feishu, wecom) */}
                                {ch.connectionMode && (
                                    <div className="mb-2">
                                        <label className="text-xs font-medium block mb-2">{t('channel.connectionMode')}</label>
                                        <div className="flex gap-4 mb-2">
                                            <label className="text-xs flex items-center gap-1.5 cursor-pointer">
                                                <input type="radio" name={`${ch.id}_connection_mode`} value="websocket" checked={connMode === 'websocket'}
                                                    onChange={() => setConnectionModes(prev => ({ ...prev, [ch.id]: 'websocket' }))} />
                                                {t('channel.websocketRecommended')}
                                            </label>
                                            <label className="text-xs flex items-center gap-1.5 cursor-pointer">
                                                <input type="radio" name={`${ch.id}_connection_mode`} value="webhook" checked={connMode === 'webhook'}
                                                    onChange={() => setConnectionModes(prev => ({ ...prev, [ch.id]: 'webhook' }))} />
                                                {t('channel.webhook')}
                                            </label>
                                        </div>
                                    </div>
                                )}

                                {renderGuide(ch.guide, !!isWs, ch)}

                                {/* Form fields */}
                                {formFields.map(field =>
                                    renderField(field, ch.id, form[field.key] || '', (val) => setFormField(ch.id, field.key, val))
                                )}

                                {/* Atlassian extra hints */}
                                {ch.id === 'atlassian' && (
                                    <>
                                        <div className="text-[11px] text-content-tertiary -mt-1">
                                            {t('channel.atlassianApiKeyHint')}
                                        </div>
                                        <div className="text-[11px] text-content-tertiary">{t('channel.atlassianCloudIdHint')}</div>
                                    </>
                                )}

                                {/* Save / Cancel buttons */}
                                <div className="flex gap-2 mt-1">
                                    <button className="btn btn-primary text-xs self-start"
                                        onClick={() => {
                                            const payload = buildPayload(ch, form);
                                            saveMutation.mutate({ ch, data: payload });
                                        }}
                                        disabled={!allRequired || saveMutation.isPending}>
                                        {saveMutation.isPending ? t('common.loading') : (isEditing ? t('channel.saveChanges') : t('channel.saveConfig'))}
                                    </button>
                                    {isEditing && <button className="btn btn-secondary text-xs" onClick={() => setEditing(ch.id, false)}>{t('common.cancel')}</button>}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    // ─── Render ─────────────────────────────────────────
    if (mode === 'create') {
        return (
            <div className="flex flex-col gap-2">
                {/* Configurable channels */}
                {CHANNEL_REGISTRY.filter(ch => !ch.editOnly).map(renderCreateChannel)}

                {/* Disabled channels: configure in settings after creation */}
                {CHANNEL_REGISTRY.filter(ch => ch.editOnly).map(ch => (
                    <div key={ch.id} className="flex items-center gap-3 p-3.5 bg-surface-elevated border border-edge-default rounded-lg opacity-70">
                        {ch.icon}
                        <div className="flex-1">
                            <div className="font-medium text-[13px]">{t(ch.nameKey, ch.nameFallback)}</div>
                            <div className="text-[11px] text-content-tertiary">{t(ch.descKey, ch.descFallback)}</div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-[10px] bg-surface-secondary text-content-tertiary font-medium">{t('channel.configureInSettings')}</span>
                    </div>
                ))}
            </div>
        );
    }

    // Edit mode
    return (
        <div className="card mb-3">
            <h4 className="mb-3">{t('agent.settings.channel.title')}</h4>
            <p className="text-xs text-content-tertiary mb-2">{t('channel.description')}</p>
            <div className="px-3.5 py-2.5 rounded-lg mb-4 bg-[rgba(59,130,246,0.08)] border border-[rgba(59,130,246,0.2)] text-xs text-content-secondary leading-relaxed">
                {t('channel.syncHint')}
            </div>
            {CHANNEL_REGISTRY.map(renderEditChannel)}
        </div>
    );
}
