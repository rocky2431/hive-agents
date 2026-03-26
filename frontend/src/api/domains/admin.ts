/**
 * Admin domain adapter — platform-level company management + settings.
 */

import { get, post, put } from '../core';

export interface Company {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  user_count?: number;
  agent_count?: number;
  created_at: string;
}

export interface PlatformSettings {
  allow_self_registration: boolean;
  default_user_quota: Record<string, unknown>;
}

export const adminApi = {
  listCompanies: () => get<Company[]>('/admin/companies'),
  createCompany: (data: { name: string; slug: string }) => post<Company>('/admin/companies', data),
  toggleCompany: (id: string) => put<void>(`/admin/companies/${id}/toggle`),
  getPlatformSettings: () => get<PlatformSettings>('/admin/platform-settings'),
  updatePlatformSettings: (data: Partial<PlatformSettings>) => put<PlatformSettings>('/admin/platform-settings', data),
};
