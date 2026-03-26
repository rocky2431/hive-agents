import { get } from '../core';

export const activityApi = {
  list: (agentId: string, limit = 50) => get<any[]>(`/agents/${agentId}/activity?limit=${limit}`),
};
