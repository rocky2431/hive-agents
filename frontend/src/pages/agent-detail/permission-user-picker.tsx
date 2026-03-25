import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { orgApi } from '@/services/api';
import { cn } from '@/lib/cn';

export interface PermissionUserPickerProps {
    tenantId?: string;
    selectedPermissionUserIds: string[];
    onToggle: (userId: string) => void;
    disabled: boolean;
}

export function PermissionUserPicker({
    tenantId,
    selectedPermissionUserIds,
    onToggle,
    disabled,
}: PermissionUserPickerProps) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const { data: tenantUsers = [] } = useQuery({
        queryKey: ['agent-permission-users', tenantId],
        queryFn: () => orgApi.listUsers(tenantId ? { tenant_id: tenantId } : {}),
        enabled: !!tenantId,
    });

    const filteredUsers = useMemo(() => {
        if (!search.trim()) return tenantUsers;
        const query = search.trim().toLowerCase();
        return (tenantUsers as any[]).filter((user: any) =>
            [user.display_name, user.username, user.email]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(query)),
        );
    }, [search, tenantUsers]);

    return (
        <div className="border-t border-edge-subtle pt-3">
            <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                    <div className="text-[13px] font-medium">
                        {t('agent.settings.perm.specificUsers', 'Specific users')}
                    </div>
                    <div className="text-[11px] text-content-tertiary mt-0.5">
                        {t('agent.settings.perm.specificUsersDesc', 'Choose the exact users who should be able to use or manage this agent. Leave empty to keep it creator-only.')}
                    </div>
                </div>
                <input
                    className="input max-w-[220px]"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('agent.settings.perm.searchUsers', 'Search users')}
                    disabled={disabled}
                />
            </div>
            <div className="grid grid-cols-2 gap-2 max-h-[220px] overflow-y-auto">
                {filteredUsers.map((user: any) => (
                    <label
                        key={user.id}
                        className={cn(
                            'flex gap-2 items-start p-2.5 rounded-lg border border-edge-subtle',
                            selectedPermissionUserIds.includes(user.id) ? 'bg-indigo-500/[0.06]' : 'bg-surface-elevated',
                            disabled && 'opacity-70',
                        )}
                    >
                        <input
                            type="checkbox"
                            checked={selectedPermissionUserIds.includes(user.id)}
                            onChange={() => onToggle(user.id)}
                            disabled={disabled}
                        />
                        <div className="min-w-0">
                            <div className="text-[13px] font-medium">{user.display_name || user.username}</div>
                            <div className="text-[11px] text-content-tertiary overflow-hidden text-ellipsis">
                                {user.email}
                            </div>
                        </div>
                    </label>
                ))}
                {filteredUsers.length === 0 && (
                    <div className="col-span-full text-center p-3 text-xs text-content-tertiary">
                        {t('agent.settings.perm.noUsersFound', 'No users found in this workspace.')}
                    </div>
                )}
            </div>
        </div>
    );
}
