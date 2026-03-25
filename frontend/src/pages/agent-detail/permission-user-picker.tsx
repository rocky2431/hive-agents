import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { orgApi } from '@/services/api';

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
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
                <div>
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>
                        {t('agent.settings.perm.specificUsers', 'Specific users')}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                        {t('agent.settings.perm.specificUsersDesc', 'Choose the exact users who should be able to use or manage this agent. Leave empty to keep it creator-only.')}
                    </div>
                </div>
                <input
                    className="input"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('agent.settings.perm.searchUsers', 'Search users')}
                    style={{ maxWidth: '220px' }}
                    disabled={disabled}
                />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', maxHeight: '220px', overflowY: 'auto' }}>
                {filteredUsers.map((user: any) => (
                    <label
                        key={user.id}
                        style={{
                            display: 'flex',
                            gap: '8px',
                            alignItems: 'flex-start',
                            padding: '10px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-subtle)',
                            background: selectedPermissionUserIds.includes(user.id) ? 'rgba(99,102,241,0.06)' : 'var(--bg-elevated)',
                            opacity: disabled ? 0.7 : 1,
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={selectedPermissionUserIds.includes(user.id)}
                            onChange={() => onToggle(user.id)}
                            disabled={disabled}
                        />
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: 500 }}>{user.display_name || user.username}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {user.email}
                            </div>
                        </div>
                    </label>
                ))}
                {filteredUsers.length === 0 && (
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '12px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                        {t('agent.settings.perm.noUsersFound', 'No users found in this workspace.')}
                    </div>
                )}
            </div>
        </div>
    );
}
