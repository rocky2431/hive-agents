/**
 * Enterprise domain adapter — LLM, org, audit, settings, invitations.
 */

import { get, post, put, patch, del } from '../core';

export interface LLMModel {
  id: string;
  provider: string;
  model: string;
  label: string;
  enabled: boolean;
  supports_vision: boolean;
  tenant_id?: string;
}

export interface EnterpriseInfo {
  id: string;
  info_type: string;
  content: Record<string, unknown>;
  version: number;
}

export interface AuditLog {
  id: string;
  user_id?: string;
  agent_id?: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface InvitationCode {
  id: string;
  code: string;
  max_uses: number;
  used_count: number;
  is_active: boolean;
  created_at: string;
}

export interface SystemSetting {
  key: string;
  value: Record<string, unknown>;
}

export const enterpriseApi = {
  /** LLM models */
  listLLMModels: () => get<LLMModel[]>('/enterprise/llm-models'),
  createLLMModel: (data: Partial<LLMModel> & { api_key?: string }) => post<LLMModel>('/enterprise/llm-models', data),
  updateLLMModel: (id: string, data: Partial<LLMModel> & { api_key?: string }) =>
    put<LLMModel>(`/enterprise/llm-models/${id}`, data),
  deleteLLMModel: (id: string) => del(`/enterprise/llm-models/${id}`),
  testLLM: (data: Record<string, unknown>) => post<{ success: boolean }>('/enterprise/llm-test', data),
  getLLMProviders: () => get<Record<string, unknown>>('/enterprise/llm-providers'),

  /** Enterprise info */
  getInfo: () => get<EnterpriseInfo[]>('/enterprise/info'),
  updateInfo: (infoType: string, data: Record<string, unknown>) =>
    put<EnterpriseInfo>(`/enterprise/info/${infoType}`, data),

  /** Audit */
  getAuditLogs: (params?: string) => get<AuditLog[]>(`/enterprise/audit${params ? `?${params}` : ''}`),

  /** Stats & quotas */
  getStats: () => get<Record<string, unknown>>('/enterprise/stats'),
  getTenantQuotas: () => get<Record<string, unknown>>('/enterprise/tenant-quotas'),
  updateTenantQuotas: (data: Record<string, unknown>) => patch<void>('/enterprise/tenant-quotas', data),

  /** Invitation codes */
  listInvitationCodes: (params?: string) =>
    get<InvitationCode[]>(`/enterprise/invitation-codes${params ? `?${params}` : ''}`),
  createInvitationCode: (data: { max_uses?: number; count?: number }) =>
    post<InvitationCode>('/enterprise/invitation-codes', data),
  deleteInvitationCode: (id: string) => del(`/enterprise/invitation-codes/${id}`),

  /** System settings */
  getSetting: (key: string) => get<SystemSetting>(`/enterprise/system-settings/${key}`),
  updateSetting: (key: string, value: Record<string, unknown>) =>
    put<SystemSetting>(`/enterprise/system-settings/${key}`, { value }),

  /** OIDC */
  getOIDCConfig: () => get<Record<string, unknown>>('/enterprise/oidc-config'),
  updateOIDCConfig: (data: Record<string, unknown>) => put<void>('/enterprise/oidc-config', data),

  /** Org */
  getDepartments: () => get<unknown[]>('/enterprise/org/departments'),
  getOrgMembers: () => get<unknown[]>('/enterprise/org/members'),
  syncOrg: () => post<void>('/enterprise/org/sync'),

  /** Approvals */
  listApprovals: () => get<unknown[]>('/enterprise/approvals'),
  resolveApproval: (id: string, data: { action: string }) =>
    post<unknown>(`/enterprise/approvals/${id}/resolve`, data),
};

