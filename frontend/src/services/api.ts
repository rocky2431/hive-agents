/** API service layer */

import type { Agent, AgentCreateInput, TokenResponse, User, Task, ChatMessage } from '../types';

const API_BASE = '/api/v1';

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const res = await fetch(`${API_BASE}${url}`, { ...options, headers });

    if (!res.ok) {
        // Auto-logout on expired/invalid token (but not on auth endpoints — let them show errors)
        const isAuthEndpoint = url.startsWith('/auth/login') || url.startsWith('/auth/register');
        if (res.status === 401 && !isAuthEndpoint) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/login';
            throw new Error('Session expired');
        }
        const error = await res.json().catch(() => ({ detail: 'Request failed' }));
        // Pydantic validation errors return detail as an array of objects
        const fieldLabels: Record<string, string> = {
            name: '名称',
            role_description: '角色描述',
            primary_model_id: '主模型',
            max_tokens_per_day: '每日 Token 上限',
            max_tokens_per_month: '每月 Token 上限',
        };
        let message = '';
        if (Array.isArray(error.detail)) {
            message = error.detail
                .map((e: any) => {
                    const field = e.loc?.slice(-1)[0] || '';
                    const label = fieldLabels[field] || field;
                    return label ? `${label}: ${e.msg}` : e.msg;
                })
                .join('; ');
        } else {
            message = error.detail || `HTTP ${res.status}`;
        }
        throw new Error(message);
    }

    if (res.status === 204) return undefined as T;
    return res.json();
}

async function uploadFile(url: string, file: File, extraFields?: Record<string, string>): Promise<any> {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', file);
    if (extraFields) {
        for (const [k, v] of Object.entries(extraFields)) {
            formData.append(k, v);
        }
    }
    const res = await fetch(`${API_BASE}${url}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
    });
    if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: 'Upload failed' }));
        throw new Error(error.detail || `HTTP ${res.status}`);
    }
    return res.json();
}

// Upload with progress tracking via XMLHttpRequest.
// Returns { promise, abort } — call abort() to cancel the upload.
// Progress callback: 0-100 = upload phase, 101 = processing phase (server is parsing the file).
export function uploadFileWithProgress(
    url: string,
    file: File,
    onProgress?: (percent: number) => void,
    extraFields?: Record<string, string>,
    timeoutMs: number = 120_000,
): { promise: Promise<any>; abort: () => void } {
    const xhr = new XMLHttpRequest();
    const promise = new Promise<any>((resolve, reject) => {
        const token = localStorage.getItem('token');
        const formData = new FormData();
        formData.append('file', file);
        if (extraFields) {
            for (const [k, v] of Object.entries(extraFields)) {
                formData.append(k, v);
            }
        }
        xhr.open('POST', `${API_BASE}${url}`);
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        // Upload phase: 0-100%
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
                onProgress(Math.round((e.loaded / e.total) * 100));
            }
        };
        // Upload bytes finished → enter processing phase
        xhr.upload.onload = () => {
            if (onProgress) onProgress(101); // 101 = "processing" sentinel
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)); } catch { resolve(undefined); }
            } else {
                try {
                    const err = JSON.parse(xhr.responseText);
                    reject(new Error(err.detail || `HTTP ${xhr.status}`));
                } catch { reject(new Error(`HTTP ${xhr.status}`)); }
            }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.ontimeout = () => reject(new Error('Upload timed out'));
        xhr.onabort = () => reject(new Error('Upload cancelled'));
        xhr.timeout = timeoutMs;
        xhr.send(formData);
    });
    return { promise, abort: () => xhr.abort() };
}

// ─── Auth ─────────────────────────────────────────────
export const authApi = {
    register: (data: { username: string; email: string; password: string; display_name: string }) =>
        request<TokenResponse>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),

    login: (data: { username: string; password: string }) =>
        request<TokenResponse>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),

    me: () => request<User>('/auth/me'),

    updateMe: (data: Partial<User>) =>
        request<User>('/auth/me', { method: 'PATCH', body: JSON.stringify(data) }),
};

// ─── OIDC SSO ────────────────────────────────────────
export const oidcApi = {
    config: (tenantSlug?: string) =>
        request<any>(`/auth/oidc/config${tenantSlug ? `?tenant_slug=${tenantSlug}` : ''}`),

    callback: (data: { code: string; redirect_uri: string; tenant_id?: string }) =>
        request<TokenResponse>('/auth/oidc/callback', { method: 'POST', body: JSON.stringify(data) }),

    bind: (data: { code: string; redirect_uri: string }) =>
        request<any>('/auth/oidc/bind', { method: 'POST', body: JSON.stringify(data) }),

    getConfig: (tenantId?: string) => request<any>(`/enterprise/oidc-config${tenantId ? `?tenant_id=${tenantId}` : ''}`),

    updateConfig: (data: { issuer_url: string; client_id: string; client_secret: string; scopes?: string; auto_provision?: boolean; display_name?: string }, tenantId?: string) =>
        request<any>(`/enterprise/oidc-config${tenantId ? `?tenant_id=${tenantId}` : ''}`, { method: 'PUT', body: JSON.stringify(data) }),
};

// ─── Tenants ──────────────────────────────────────────
export const tenantApi = {
    selfCreate: (data: { name: string }) =>
        request<any>('/tenants/self-create', { method: 'POST', body: JSON.stringify(data) }),

    join: (invitationCode: string) =>
        request<any>('/tenants/join', { method: 'POST', body: JSON.stringify({ invitation_code: invitationCode }) }),

    registrationConfig: () =>
        request<{ allow_self_create_company: boolean }>('/tenants/registration-config'),
};

export const adminApi = {
    listCompanies: () =>
        request<any[]>('/admin/companies'),

    createCompany: (data: { name: string }) =>
        request<any>('/admin/companies', { method: 'POST', body: JSON.stringify(data) }),

    toggleCompany: (id: string) =>
        request<any>(`/admin/companies/${id}/toggle`, { method: 'PUT' }),

    getPlatformSettings: () =>
        request<any>('/admin/platform-settings'),

    updatePlatformSettings: (data: any) =>
        request<any>('/admin/platform-settings', { method: 'PUT', body: JSON.stringify(data) }),
};

// ─── Agents ───────────────────────────────────────────
export const agentApi = {
    list: (tenantId?: string) => request<Agent[]>(`/agents/${tenantId ? `?tenant_id=${tenantId}` : ''}`),

    sessions: (id: string, scope: 'mine' | 'all' = 'mine') =>
        request<any[]>(`/agents/${id}/sessions?scope=${scope}`),

    get: (id: string) => request<Agent>(`/agents/${id}`),

    create: (data: AgentCreateInput) =>
        request<Agent>('/agents/', { method: 'POST', body: JSON.stringify(data) }),

    update: (id: string, data: Partial<Agent>) =>
        request<Agent>(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

    delete: (id: string) =>
        request<void>(`/agents/${id}`, { method: 'DELETE' }),

    start: (id: string) =>
        request<Agent>(`/agents/${id}/start`, { method: 'POST' }),

    stop: (id: string) =>
        request<Agent>(`/agents/${id}/stop`, { method: 'POST' }),

    metrics: (id: string) =>
        request<any>(`/agents/${id}/metrics`),

    collaborators: (id: string) =>
        request<any[]>(`/agents/${id}/collaborators`),

    delegateTask: (id: string, data: { to_agent_id: string; task_title: string; task_description?: string }) =>
        request<any>(`/agents/${id}/collaborate/delegate`, { method: 'POST', body: JSON.stringify(data) }),

    sendCollaborationMessage: (id: string, data: { to_agent_id: string; message: string; msg_type?: string }) =>
        request<any>(`/agents/${id}/collaborate/message`, { method: 'POST', body: JSON.stringify(data) }),

    handoverCandidates: (id: string) =>
        request<any[]>(`/agents/${id}/handover-candidates`),

    handover: (id: string, newCreatorId: string) =>
        request<any>(`/agents/${id}/handover`, { method: 'POST', body: JSON.stringify({ new_creator_id: newCreatorId }) }),

    // OpenClaw gateway
    generateApiKey: (id: string) =>
        request<{ api_key: string; message: string }>(`/agents/${id}/api-key`, { method: 'POST' }),

    gatewayMessages: (id: string) =>
        request<any[]>(`/agents/${id}/gateway-messages`),
};

// ─── Tasks ────────────────────────────────────────────
export const taskApi = {
    list: (agentId: string, status?: string, type?: string) => {
        const params = new URLSearchParams();
        if (status) params.set('status_filter', status);
        if (type) params.set('type_filter', type);
        return request<Task[]>(`/agents/${agentId}/tasks/?${params}`);
    },

    create: (agentId: string, data: any) =>
        request<Task>(`/agents/${agentId}/tasks/`, { method: 'POST', body: JSON.stringify(data) }),

    update: (agentId: string, taskId: string, data: Partial<Task>) =>
        request<Task>(`/agents/${agentId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(data) }),

    getLogs: (agentId: string, taskId: string) =>
        request<{ id: string; task_id: string; content: string; created_at: string }[]>(`/agents/${agentId}/tasks/${taskId}/logs`),

    trigger: (agentId: string, taskId: string) =>
        request<any>(`/agents/${agentId}/tasks/${taskId}/trigger`, { method: 'POST' }),
};

// ─── Files ────────────────────────────────────────────
export const fileApi = {
    list: (agentId: string, path: string = '') =>
        request<any[]>(`/agents/${agentId}/files/?path=${encodeURIComponent(path)}`),

    read: (agentId: string, path: string) =>
        request<{ path: string; content: string }>(`/agents/${agentId}/files/content?path=${encodeURIComponent(path)}`),

    write: (agentId: string, path: string, content: string) =>
        request(`/agents/${agentId}/files/content?path=${encodeURIComponent(path)}`, {
            method: 'PUT',
            body: JSON.stringify({ content }),
        }),

    delete: (agentId: string, path: string) =>
        request(`/agents/${agentId}/files/content?path=${encodeURIComponent(path)}`, {
            method: 'DELETE',
        }),

    upload: (agentId: string, file: File, path: string = 'workspace/knowledge_base', onProgress?: (pct: number) => void) =>
        onProgress
            ? uploadFileWithProgress(`/agents/${agentId}/files/upload?path=${encodeURIComponent(path)}`, file, onProgress).promise
            : uploadFile(`/agents/${agentId}/files/upload?path=${encodeURIComponent(path)}`, file),

    importSkill: (agentId: string, skillId: string) =>
        request<any>(`/agents/${agentId}/files/import-skill`, {
            method: 'POST',
            body: JSON.stringify({ skill_id: skillId }),
        }),

    downloadUrl: (agentId: string, path: string) => {
        const token = localStorage.getItem('token');
        return `${API_BASE}/agents/${agentId}/files/download?path=${encodeURIComponent(path)}&token=${token}`;
    },
};

// ─── Channel Config ───────────────────────────────────
export const channelApi = {
    get: (agentId: string) =>
        request<any>(`/agents/${agentId}/channel`).catch(() => null),

    create: (agentId: string, data: any) =>
        request<any>(`/agents/${agentId}/channel`, { method: 'POST', body: JSON.stringify(data) }),

    update: (agentId: string, data: any) =>
        request<any>(`/agents/${agentId}/channel`, { method: 'PUT', body: JSON.stringify(data) }),

    delete: (agentId: string) =>
        request<void>(`/agents/${agentId}/channel`, { method: 'DELETE' }),

    webhookUrl: (agentId: string) =>
        request<{ webhook_url: string }>(`/agents/${agentId}/channel/webhook-url`).catch(() => null),
};

// ─── Enterprise ───────────────────────────────────────
export const enterpriseApi = {
    llmModels: () => {
        const tid = localStorage.getItem('current_tenant_id');
        return request<any[]>(`/enterprise/llm-models${tid ? `?tenant_id=${tid}` : ''}`);
    },

    // Enterprise Knowledge Base
    kbFiles: (path: string = '') =>
        request<any[]>(`/enterprise/knowledge-base/files?path=${encodeURIComponent(path)}`),

    kbUpload: (file: File, subPath: string = '') =>
        uploadFile(`/enterprise/knowledge-base/upload?sub_path=${encodeURIComponent(subPath)}`, file),

    kbRead: (path: string) =>
        request<{ path: string; content: string }>(`/enterprise/knowledge-base/content?path=${encodeURIComponent(path)}`),

    kbWrite: (path: string, content: string) =>
        request(`/enterprise/knowledge-base/content?path=${encodeURIComponent(path)}`, {
            method: 'PUT',
            body: JSON.stringify({ content }),
        }),

    kbDelete: (path: string) =>
        request(`/enterprise/knowledge-base/content?path=${encodeURIComponent(path)}`, {
            method: 'DELETE',
        }),

    openvikingStatus: () =>
        request<{ connected: boolean; version?: string; reason?: string }>('/enterprise/knowledge-base/openviking-status'),

    // Memory configuration
    memoryConfig: (tenantId?: string) =>
        request<any>(`/enterprise/memory/config${tenantId ? `?tenant_id=${tenantId}` : ''}`),
    updateMemoryConfig: (data: any, tenantId?: string) =>
        request<any>(`/enterprise/memory/config${tenantId ? `?tenant_id=${tenantId}` : ''}`, { method: 'PUT', body: JSON.stringify(data) }),
    agentMemory: (agentId: string) =>
        request<{ facts: any[] }>(`/enterprise/memory/agents/${agentId}/memory`),
    sessionSummary: (sessionId: string) =>
        request<{ session_id: string; summary: string | null; title: string | null }>(`/enterprise/memory/sessions/${sessionId}/summary`),
};

// ─── Feature Flags ────────────────────────────────────
export const featureFlagApi = {
    list: () => request<any[]>('/feature-flags/'),
    create: (data: { key: string; description?: string; flag_type?: string; enabled?: boolean }) =>
        request<any>('/feature-flags/', { method: 'POST', body: JSON.stringify(data) }),
    update: (flagId: string, data: Record<string, unknown>) =>
        request<any>(`/feature-flags/${flagId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (flagId: string) =>
        request<void>(`/feature-flags/${flagId}`, { method: 'DELETE' }),
};

// ─── Activity Logs ────────────────────────────────────
export const activityApi = {
    list: (agentId: string, limit = 50) =>
        request<any[]>(`/agents/${agentId}/activity?limit=${limit}`),
};

// ─── Messages ─────────────────────────────────────────
export const messageApi = {
    inbox: (limit = 50) =>
        request<any[]>(`/messages/inbox?limit=${limit}`),

    unreadCount: () =>
        request<{ unread_count: number }>('/messages/unread-count'),
};

// ─── Schedules ────────────────────────────────────────
export const scheduleApi = {
    list: (agentId: string) =>
        request<any[]>(`/agents/${agentId}/schedules/`),

    create: (agentId: string, data: { name: string; instruction: string; cron_expr: string }) =>
        request<any>(`/agents/${agentId}/schedules/`, { method: 'POST', body: JSON.stringify(data) }),

    update: (agentId: string, scheduleId: string, data: any) =>
        request<any>(`/agents/${agentId}/schedules/${scheduleId}`, { method: 'PATCH', body: JSON.stringify(data) }),

    delete: (agentId: string, scheduleId: string) =>
        request<void>(`/agents/${agentId}/schedules/${scheduleId}`, { method: 'DELETE' }),

    trigger: (agentId: string, scheduleId: string) =>
        request<any>(`/agents/${agentId}/schedules/${scheduleId}/run`, { method: 'POST' }),

    history: (agentId: string, scheduleId: string) =>
        request<any[]>(`/agents/${agentId}/schedules/${scheduleId}/history`),
};

// ─── Skills ───────────────────────────────────────────
export const skillApi = {
    list: () => request<any[]>('/skills/'),
    get: (id: string) => request<any>(`/skills/${id}`),
    create: (data: any) =>
        request<any>('/skills/', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) =>
        request<any>(`/skills/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
        request<void>(`/skills/${id}`, { method: 'DELETE' }),
    // Path-based browse for FileBrowser
    browse: {
        list: (path: string) => request<any[]>(`/skills/browse/list?path=${encodeURIComponent(path)}`),
        read: (path: string) => request<{ content: string }>(`/skills/browse/read?path=${encodeURIComponent(path)}`),
        write: (path: string, content: string) =>
            request<any>('/skills/browse/write', { method: 'PUT', body: JSON.stringify({ path, content }) }),
        delete: (path: string) =>
            request<any>(`/skills/browse/delete?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
    },
    // ClawHub marketplace integration
    clawhub: {
        search: (q: string) => request<any[]>(`/skills/clawhub/search?q=${encodeURIComponent(q)}`),
        detail: (slug: string) => request<any>(`/skills/clawhub/detail/${slug}`),
        install: (slug: string) => request<any>('/skills/clawhub/install', { method: 'POST', body: JSON.stringify({ slug }) }),
    },
    importFromUrl: (url: string) =>
        request<any>('/skills/import-from-url', { method: 'POST', body: JSON.stringify({ url }) }),
    previewUrl: (url: string) =>
        request<any>('/skills/import-from-url/preview', { method: 'POST', body: JSON.stringify({ url }) }),
    // Tenant-level settings
    settings: {
        getToken: () => request<{ configured: boolean; source: string; masked: string; clawhub_configured: boolean; clawhub_masked: string }>('/skills/settings/token'),
        setToken: (github_token: string) =>
            request<any>('/skills/settings/token', { method: 'PUT', body: JSON.stringify({ github_token }) }),
        setClawhubKey: (clawhub_key: string) =>
            request<any>('/skills/settings/token', { method: 'PUT', body: JSON.stringify({ clawhub_key }) }),
    },
    // Agent-level import (writes to agent workspace)
    agentImport: {
        fromClawhub: (agentId: string, slug: string) =>
            request<any>(`/agents/${agentId}/files/import-from-clawhub`, { method: 'POST', body: JSON.stringify({ slug }) }),
        fromUrl: (agentId: string, url: string) =>
            request<any>(`/agents/${agentId}/files/import-from-url`, { method: 'POST', body: JSON.stringify({ url }) }),
    },
};

// ─── Triggers (Aware Engine) ──────────────────────────
export const triggerApi = {
    list: (agentId: string) =>
        request<any[]>(`/agents/${agentId}/triggers`),

    update: (agentId: string, triggerId: string, data: any) =>
        request<any>(`/agents/${agentId}/triggers/${triggerId}`, { method: 'PATCH', body: JSON.stringify(data) }),

    delete: (agentId: string, triggerId: string) =>
        request<void>(`/agents/${agentId}/triggers/${triggerId}`, { method: 'DELETE' }),
};

// ─── Audit (SecurityAuditEvent) ──────────────────────
export const auditApi = {
    query: (params: Record<string, string | number | undefined>) => {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== '') qs.set(k, String(v));
        }
        return request<{ items: any[]; total: number; page: number; page_size: number }>(
            `/enterprise/audit?${qs}`,
        );
    },

    exportCsv: (params: Record<string, string | undefined>) => {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== '') qs.set(k, String(v));
        }
        const token = localStorage.getItem('token');
        return fetch(`${API_BASE}/enterprise/audit/export?${qs}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
    },

    verifyChain: (eventId: string) =>
        request<{ valid: boolean; event_hash: string; computed_hash: string; predecessor_id: string | null }>(
            `/enterprise/audit/${eventId}/chain`,
        ),
};

// ─── Capability Policies ─────────────────────────────
export const capabilityApi = {
    definitions: () => request<any[]>('/enterprise/capabilities/definitions'),

    list: (agentId?: string) =>
        request<any[]>(`/enterprise/capabilities${agentId ? `?agent_id=${agentId}` : ''}`),

    upsert: (data: { capability: string; agent_id?: string; allowed: boolean; requires_approval: boolean }) =>
        request<any>('/enterprise/capabilities', { method: 'PUT', body: JSON.stringify(data) }),

    delete: (policyId: string) =>
        request<void>(`/enterprise/capabilities/${policyId}`, { method: 'DELETE' }),
};

// ─── Onboarding ──────────────────────────────────────
export const onboardingApi = {
    status: () => request<{ items: any[]; completed: number; total: number }>('/enterprise/onboarding-status'),
};

// ─── Pack Catalog & Capability Summary ───────────────
export const packApi = {
    catalog: () => request<any[]>('/packs'),

    updatePolicy: (packName: string, enabled: boolean) =>
        request<any>(`/enterprise/packs/policies/${encodeURIComponent(packName)}`, {
            method: 'PUT',
            body: JSON.stringify({ enabled }),
        }),

    mcpRegistry: () =>
        request<any[]>('/enterprise/mcp-servers'),

    importMcp: (data: {
        server_id?: string;
        mcp_url?: string;
        server_name?: string;
        config?: Record<string, unknown>;
    }) =>
        request<any>('/enterprise/mcp-servers/import', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    deleteMcp: (serverKey: string) =>
        request<any>(`/enterprise/mcp-servers/${encodeURIComponent(serverKey)}`, {
            method: 'DELETE',
        }),

    agentPacks: (agentId: string) =>
        request<{ kernel_tools: string[]; available_packs: any[]; channel_backed_packs: any[]; skill_declared_packs: any[] }>(
            `/agents/${agentId}/packs`,
        ),

    capabilitySummary: (agentId: string) =>
        request<{
            kernel_tools: string[];
            available_packs: any[];
            channel_backed_packs: any[];
            skill_declared_packs: any[];
            capability_policies: any[];
            pending_approvals: number;
        }>(`/agents/${agentId}/capability-summary`),

    sessionRuntime: (sessionId: string) =>
        request<{
            activated_packs: string[];
            used_tools: string[];
            blocked_capabilities: any[];
            compaction_count: number;
        }>(`/chat/sessions/${sessionId}/runtime-summary`),
};
