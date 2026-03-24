import type { User } from '../types';

type Role = User['role'] | undefined;

export function canEditCompanyProfile(role: Role): boolean {
    return role === 'platform_admin' || role === 'org_admin';
}

export function canManageCompanyLifecycle(role: Role): boolean {
    return role === 'platform_admin';
}
