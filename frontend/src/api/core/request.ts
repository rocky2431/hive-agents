/**
 * Unified HTTP request layer for the Clawith frontend.
 *
 * All API calls go through this module. Pages must NOT use raw fetch().
 * Token is read from localStorage (same source as zustand AuthStore).
 */

import { ApiError } from './errors';

const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('token');
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function handleUnauthorized(url: string): never {
  const isAuthEndpoint = url.startsWith('/auth/login') || url.startsWith('/auth/register');
  if (!isAuthEndpoint) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
  }
  throw new ApiError(401, 'Session expired');
}

async function parseErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (Array.isArray(body.detail)) {
      return body.detail.map((e: { loc?: string[]; msg: string }) => {
        const field = e.loc?.slice(-1)[0] || '';
        return field ? `${field}: ${e.msg}` : e.msg;
      }).join('; ');
    }
    return body.detail || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * Core JSON request. All domain adapters delegate to this.
 */
export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders(),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
    const detail = await parseErrorDetail(res);
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Convenience shortcuts */
export const get = <T>(path: string) => request<T>('GET', path);
export const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body);
export const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, body);
export const patch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, body);
export const del = <T = void>(path: string) => request<T>('DELETE', path);

/**
 * Multipart file upload — the one case where we skip JSON content-type.
 */
export async function upload<T = unknown>(
  path: string,
  file: File,
  extraFields?: Record<string, string>,
): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);
  if (extraFields) {
    for (const [k, v] of Object.entries(extraFields)) {
      formData.append(k, v);
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
    const detail = await parseErrorDetail(res);
    throw new ApiError(res.status, detail);
  }

  return res.json();
}
