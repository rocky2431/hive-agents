/**
 * Chat domain adapter — history, sessions, file upload.
 */

import { get, post, del, upload } from '../core';
import type { RequestOptions } from '../core/request';
import type { ChatMessage } from '../../types';

export interface ChatSession {
  id: string;
  agent_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface UploadedChatFile {
  filename: string;
  saved_filename: string;
  size: number;
  extracted_text: string;
  workspace_path: string;
  is_image: boolean;
  image_data_url?: string;
}

export const chatApi = {
  getHistory: (agentId: string, conversationId?: string) => {
    const qs = conversationId ? `?conversation_id=${conversationId}` : '';
    return get<ChatMessage[]>(`/chat/${agentId}/history${qs}`);
  },
  uploadFile: (file: File, agentId?: string) =>
    upload<UploadedChatFile>('/chat/upload', file, agentId ? { agent_id: agentId } : undefined),

  /** Session management */
  listSessions: (agentId: string, scope?: 'mine' | 'all') =>
    get<ChatSession[]>(`/agents/${agentId}/sessions${scope ? `?scope=${scope}` : ''}`),
  createSession: (agentId: string, title?: string) => post<ChatSession>(`/agents/${agentId}/sessions`, { title }),
  deleteSession: (agentId: string, sessionId: string) => del(`/agents/${agentId}/sessions/${sessionId}`),
  getSessionMessages: (agentId: string, sessionId: string, options?: RequestOptions) =>
    get<ChatMessage[]>(`/agents/${agentId}/sessions/${sessionId}/messages`, options),
};
