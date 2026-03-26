/**
 * Tools domain adapter — agent tool configuration.
 *
 * Wraps the /api/tools/* endpoints used by AgentDetail.
 */

import { get, put, post } from '../core';

export interface AgentTool {
  id: string;
  tool_id: string;
  name: string;
  display_name: string;
  description: string;
  type: string;
  category: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface ToolDetail {
  id: string;
  name: string;
  display_name: string;
  description: string;
  parameters_schema: Record<string, unknown>;
  config: Record<string, unknown>;
  config_schema: Record<string, unknown>;
}

export interface CategoryConfig {
  [key: string]: unknown;
}

export const toolsApi = {
  /** List tools with per-agent config (preferred), falls back to basic list */
  listWithConfig: (agentId: string) => get<AgentTool[]>(`/tools/agents/${agentId}/with-config`),
  list: (agentId: string) => get<AgentTool[]>(`/tools/agents/${agentId}`),

  /** Toggle tool enabled/disabled */
  updateTools: (agentId: string, data: { tools: Array<{ tool_id: string; enabled: boolean }> }) =>
    put<void>(`/tools/agents/${agentId}`, data),

  /** Category-level config (e.g., email, feishu) */
  getCategoryConfig: (agentId: string, category: string) =>
    get<CategoryConfig>(`/tools/agents/${agentId}/category-config/${category}`),
  updateCategoryConfig: (agentId: string, category: string, config: Record<string, unknown>) =>
    put<void>(`/tools/agents/${agentId}/category-config/${category}`, config),
  testCategory: (agentId: string, category: string) =>
    post<{ success: boolean }>(`/tools/agents/${agentId}/category-config/${category}/test`),

  /** Per-tool config */
  updateToolConfig: (agentId: string, toolId: string, config: Record<string, unknown>) =>
    put<void>(`/tools/agents/${agentId}/tool-config/${toolId}`, { config }),

  /** Single tool detail */
  getDetail: (toolId: string) => get<ToolDetail>(`/tools/agent-tool/${toolId}`),

  /** Test email */
  testEmail: (data: Record<string, unknown>) => post<{ success: boolean }>('/tools/test-email', data),
};
