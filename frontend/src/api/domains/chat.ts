/**
 * Chat domain adapter — history, sessions, file upload.
 */

import { get, post, del, upload } from '../core';
import type { ChatMessage } from '../../types';

export interface ChatSession {
  id: string;
  agent_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export const chatApi = {
  getHistory: (agentId: string, conversationId?: string) => {
    const qs = conversationId ? `?conversation_id=${conversationId}` : '';
    return get<ChatMessage[]>(`/chat/${agentId}/history${qs}`);
  },
  uploadFile: (file: File) => upload<{ url: string }>('/chat/upload', file),

  /** Session management */
  listSessions: (agentId: string) => get<ChatSession[]>(`/agents/${agentId}/sessions`),
  createSession: (agentId: string, title?: string) => post<ChatSession>(`/agents/${agentId}/sessions`, { title }),
  deleteSession: (agentId: string, sessionId: string) => del(`/agents/${agentId}/sessions/${sessionId}`),
  getSessionMessages: (agentId: string, sessionId: string) =>
    get<ChatMessage[]>(`/agents/${agentId}/sessions/${sessionId}/messages`),
};
