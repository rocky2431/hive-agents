/**
 * Agents domain adapter — CRUD, lifecycle, metrics, permissions.
 */

import { get, post, put, patch, del } from '../core';
import type { Agent } from '../../types';

export interface AgentCreateParams {
  name: string;
  role_description?: string;
  bio?: string;
  agent_class?: string;
  primary_model_id?: string;
  security_zone?: string;
}

export interface AgentUpdateParams {
  name?: string;
  role_description?: string;
  bio?: string;
  primary_model_id?: string;
  fallback_model_id?: string;
  max_tokens_per_day?: number;
  max_tokens_per_month?: number;
  context_window_size?: number;
  heartbeat_enabled?: boolean;
  heartbeat_interval_minutes?: number;
  heartbeat_active_hours?: string;
  timezone?: string;
}

export interface AgentPermissions {
  scope_type: string;
  scope_id?: string;
  access_level: string;
}

export interface AgentMetrics {
  total_messages: number;
  total_tool_calls: number;
  avg_response_time?: number;
}

export const agentApi = {
  list: (tenantId?: string) => get<Agent[]>(`/agents/${tenantId ? `?tenant_id=${tenantId}` : ''}`),
  getById: (id: string) => get<Agent>(`/agents/${id}`),
  create: (data: AgentCreateParams) => post<Agent>('/agents/', data),
  update: (id: string, data: AgentUpdateParams) => patch<Agent>(`/agents/${id}`, data),
  remove: (id: string) => del(`/agents/${id}`),
  start: (id: string) => post<Agent>(`/agents/${id}/start`),
  stop: (id: string) => post<Agent>(`/agents/${id}/stop`),
  getMetrics: (id: string) => get<AgentMetrics>(`/agents/${id}/metrics`),
  getPermissions: (id: string) => get<AgentPermissions[]>(`/agents/${id}/permissions`),
  updatePermissions: (id: string, data: AgentPermissions[]) => put<void>(`/agents/${id}/permissions`, data),
  getApprovals: (id: string) => get<unknown[]>(`/agents/${id}/approvals`),
  resolveApproval: (agentId: string, approvalId: string, data: { action: string }) =>
    post<unknown>(`/agents/${agentId}/approvals/${approvalId}/resolve`, data),
  generateApiKey: (id: string) => post<{ api_key: string }>(`/agents/${id}/api-key`),
  getGatewayMessages: (id: string) => get<unknown[]>(`/agents/${id}/gateway-messages`),
};
