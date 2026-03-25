import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi } from '@/services/api';
import { useAuthStore } from '@/stores';
import { canManageCompanyLifecycle } from '@/lib/companyPermissions';
import { NotificationBarConfig } from './notification-bar-config';
import PlatformSettings from './platform-settings';
import ThemeColorPicker from './theme-color-picker';
import { fetchJson } from './shared';
import { useState } from 'react';

export function ConfigTab({ selectedTenantId }: { selectedTenantId?: string }) {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const user = useAuthStore((s) => s.user);
    const [companyLifecycleSaving, setCompanyLifecycleSaving] = useState(false);

    const { data: selectedTenant } = useQuery({
        queryKey: ['tenant-detail', selectedTenantId],
        queryFn: () => fetchJson<any>(`/tenants/${selectedTenantId}`),
        enabled: !!selectedTenantId,
    });

    const handleToggleCompanyLifecycle = async () => {
        if (!selectedTenantId || !selectedTenant || !canManageCompanyLifecycle(user?.role)) return;
        const isDisabling = selectedTenant.is_active !== false;
        const confirmMessage = isDisabling
            ? t('enterprise.companyLifecycle.disableConfirm', 'Disable this company? Its users will lose access and running digital employees will be paused.')
            : t('enterprise.companyLifecycle.enableConfirm', 'Enable this company again? Users will be able to access it again.');
        if (!confirm(confirmMessage)) return;
        setCompanyLifecycleSaving(true);
        try {
            await adminApi.toggleCompany(selectedTenantId);
            qc.invalidateQueries({ queryKey: ['tenant-detail', selectedTenantId] });
            qc.invalidateQueries({ queryKey: ['tenants'] });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : t('enterprise.companyLifecycle.toggleFailed', 'Failed to update company status');
            alert(msg);
        }
        setCompanyLifecycleSaving(false);
    };

    return (
        <div>
            <NotificationBarConfig />
            <h3 className="mb-2">{t('enterprise.config.title')}</h3>
            <PlatformSettings />
            <ThemeColorPicker />

            {/* Company Lifecycle */}
            <div className="mt-8 p-4 border border-[var(--status-warning,#d97706)] rounded-lg">
                <h3 className="mb-1" style={{ color: 'var(--status-warning, #d97706)' }}>
                    {t('enterprise.companyLifecycle.title', 'Company Lifecycle')}
                </h3>
                <p className="text-xs text-content-tertiary mb-3">
                    {t('enterprise.companyLifecycle.description', 'Disabling a company blocks user access and pauses running digital employees. Re-enable it when the company should become active again.')}
                </p>
                {canManageCompanyLifecycle(user?.role) ? (
                    <button
                        className="btn bg-transparent rounded-md px-4 py-1.5 text-[13px] cursor-pointer"
                        onClick={handleToggleCompanyLifecycle}
                        disabled={!selectedTenant || companyLifecycleSaving || selectedTenant?.slug === 'default'}
                        title={selectedTenant?.slug === 'default' ? t('admin.cannotDisableDefault', 'Cannot disable the default company \u2014 platform admin would be locked out') : undefined}
                        style={{
                            color: selectedTenant?.is_active === false ? 'var(--success, #34c759)' : 'var(--status-warning, #d97706)',
                            border: `1px solid ${selectedTenant?.is_active === false ? 'var(--success, #34c759)' : 'var(--status-warning, #d97706)'}`,
                        }}
                    >
                        {companyLifecycleSaving
                            ? t('common.loading')
                            : selectedTenant?.is_active === false
                                ? t('admin.enable', 'Enable')
                                : t('admin.disable', 'Disable')}
                    </button>
                ) : (
                    <div className="text-xs text-content-tertiary">
                        {t('enterprise.companyLifecycle.platformOnly', 'Company lifecycle actions are managed by platform admins.')}
                    </div>
                )}
            </div>
        </div>
    );
}
