/**
 * Files domain adapter — agent workspace file management.
 */

import { get, post, put, del, upload } from '../core';

export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
}

export interface FileContent {
  path: string;
  content: string;
}

export const fileApi = {
  list: (agentId: string, path?: string) => {
    const qs = path ? `?path=${encodeURIComponent(path)}` : '';
    return get<FileInfo[]>(`/agents/${agentId}/files/${qs}`);
  },
  read: (agentId: string, path: string) =>
    get<FileContent>(`/agents/${agentId}/files/content?path=${encodeURIComponent(path)}`),
  write: (agentId: string, path: string, content: string) =>
    put<void>(`/agents/${agentId}/files/content`, { path, content }),
  remove: (agentId: string, path: string) =>
    del(`/agents/${agentId}/files/content?path=${encodeURIComponent(path)}`),
  upload: (agentId: string, file: File, path?: string) =>
    upload<void>(`/agents/${agentId}/files/upload`, file, path ? { path } : undefined),
  download: (agentId: string, path: string) =>
    get<Blob>(`/agents/${agentId}/files/download?path=${encodeURIComponent(path)}`),
  importSkill: (agentId: string, skillId: string) =>
    post<void>(`/agents/${agentId}/files/import-skill`, { skill_id: skillId }),
  importFromClawHub: (agentId: string, slug: string) =>
    post<void>(`/agents/${agentId}/files/import-from-clawhub`, { slug }),
  importFromUrl: (agentId: string, url: string) =>
    post<void>(`/agents/${agentId}/files/import-from-url`, { url }),
};
