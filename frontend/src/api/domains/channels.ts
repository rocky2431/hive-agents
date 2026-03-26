import { get, post, put, del } from '../core';

export const channelApi = {
  get: (agentId: string) => get<unknown>(`/agents/${agentId}/channel`).catch(() => null),
  create: (agentId: string, data: unknown) => post<unknown>(`/agents/${agentId}/channel`, data),
  update: (agentId: string, data: unknown) => put<unknown>(`/agents/${agentId}/channel`, data),
  delete: (agentId: string) => del(`/agents/${agentId}/channel`),
  webhookUrl: (agentId: string) => get<{ webhook_url: string }>(`/agents/${agentId}/channel/webhook-url`).catch(() => null),
};
