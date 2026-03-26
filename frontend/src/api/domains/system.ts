/**
 * System domain adapter — version, health, tenants, onboarding.
 *
 * Fixes breakpoint: /api/version → mapped to /api/health
 */

import { get, post } from '../core';

export interface HealthInfo {
  status: string;
  version: string;
}

export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

export interface JoinResult {
  success: boolean;
  tenant?: TenantInfo;
}

export const systemApi = {
  /** Maps the old /api/version call to /api/health which actually exists */
  getVersion: () => get<HealthInfo>('/health'),

  /** Tenant self-service */
  createTenant: (data: { name: string; slug?: string }) => post<TenantInfo>('/tenants/self-create', data),
  joinTenant: (data: { invitation_code: string }) => post<JoinResult>('/tenants/join', data),
  getRegistrationConfig: () => get<{ invitation_code_required: boolean }>('/tenants/registration-config'),

  /** Onboarding */
  getOnboardingStatus: () => get<Record<string, unknown>>('/onboarding-status'),
};
