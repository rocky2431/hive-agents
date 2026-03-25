/**
 * Centralized TanStack Query key factory.
 * All query keys defined here for consistent invalidation.
 */

export const queryKeys = {
    agents: {
        all: ['agents'] as const,
        lists: () => [...queryKeys.agents.all, 'list'] as const,
        list: (filters?: Record<string, unknown>) => [...queryKeys.agents.lists(), filters] as const,
        details: () => [...queryKeys.agents.all, 'detail'] as const,
        detail: (id: string) => [...queryKeys.agents.details(), id] as const,
        sessions: (id: string, scope?: string) => [...queryKeys.agents.detail(id), 'sessions', scope] as const,
        tasks: (id: string, filters?: Record<string, unknown>) => [...queryKeys.agents.detail(id), 'tasks', filters] as const,
        schedules: (id: string) => [...queryKeys.agents.detail(id), 'schedules'] as const,
        triggers: (id: string) => [...queryKeys.agents.detail(id), 'triggers'] as const,
        approvals: (id: string) => [...queryKeys.agents.detail(id), 'approvals'] as const,
        permissions: (id: string) => [...queryKeys.agents.detail(id), 'permissions'] as const,
        capabilitySummary: (id: string) => [...queryKeys.agents.detail(id), 'capability-summary'] as const,
        relationships: (id: string) => [...queryKeys.agents.detail(id), 'relationships'] as const,
        agentRelationships: (id: string) => [...queryKeys.agents.detail(id), 'agent-relationships'] as const,
        gatewayMessages: (id: string) => [...queryKeys.agents.detail(id), 'gateway-messages'] as const,
        configHistory: (id: string) => [...queryKeys.agents.detail(id), 'config-history'] as const,
    },
    enterprise: {
        llmModels: (tenantId?: string) => ['enterprise', 'llm-models', tenantId] as const,
        llmProviders: () => ['enterprise', 'llm-providers'] as const,
        auditLogs: (filters?: Record<string, unknown>) => ['enterprise', 'audit-logs', filters] as const,
        memoryConfig: (tenantId?: string) => ['enterprise', 'memory-config', tenantId] as const,
        info: (type?: string) => ['enterprise', 'info', type] as const,
        approvals: (status?: string) => ['enterprise', 'approvals', status] as const,
        systemSettings: (key?: string) => ['enterprise', 'system-settings', key] as const,
    },
    packs: {
        catalog: () => ['packs', 'catalog'] as const,
        policies: () => ['packs', 'policies'] as const,
        mcpServers: () => ['packs', 'mcp-servers'] as const,
        agentPacks: (agentId: string) => ['packs', 'agent', agentId] as const,
    },
    capabilities: {
        definitions: () => ['capabilities', 'definitions'] as const,
        policies: (agentId?: string) => ['capabilities', 'policies', agentId] as const,
    },
    org: {
        departments: () => ['org', 'departments'] as const,
        users: (deptId?: string) => ['org', 'users', deptId] as const,
    },
    admin: {
        companies: () => ['admin', 'companies'] as const,
        settings: () => ['admin', 'settings'] as const,
        invitationCodes: (tenantId?: string) => ['admin', 'invitation-codes', tenantId] as const,
    },
    notifications: {
        all: ['notifications'] as const,
        list: () => [...queryKeys.notifications.all, 'list'] as const,
        unread: () => ['notifications', 'unread'] as const,
    },
    plaza: {
        posts: (limit?: number) => ['plaza', 'posts', limit] as const,
        stats: () => ['plaza', 'stats'] as const,
    },
    messages: {
        inbox: () => ['messages', 'inbox'] as const,
        unread: () => ['messages', 'unread'] as const,
    },
    skills: {
        list: (agentId?: string) => ['skills', 'list', agentId] as const,
        hub: () => ['skills', 'hub'] as const,
    },
    activity: {
        list: (agentId: string) => ['activity', agentId] as const,
    },
} as const;
