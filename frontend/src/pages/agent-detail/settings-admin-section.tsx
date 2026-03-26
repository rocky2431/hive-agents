import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { agentApi } from '@/services/api';
import type { Agent } from '@/types';

interface AdminSettingsSectionProps {
    agentId: string;
    agent: Agent;
}

export function AdminSettingsSection({ agentId, agent }: AdminSettingsSectionProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['agent', agentId] });

    return (
        <>
            {/* Admin Settings */}
            <div className="card mb-3 border-warning">
                <h4 className="mb-1">{t('agent.settings.admin.title', 'Admin Settings')}</h4>
                <p className="text-xs text-content-tertiary mb-4">
                    {t('agent.settings.admin.description', 'These settings are only visible to platform and organization admins.')}
                </p>
                <div className="flex flex-col gap-3.5">
                    {/* Security Zone */}
                    <div className="flex items-center justify-between p-2.5 bg-surface-elevated rounded-lg border border-edge-subtle">
                        <div>
                            <div className="font-medium text-[13px]">{t('agent.settings.securityZone', 'Security Zone')}</div>
                            <div className="text-[11px] text-content-tertiary">{t('agent.settings.securityZoneDesc', 'Controls the security sandbox level for this agent')}</div>
                        </div>
                        <select
                            className="input w-[160px] text-xs"
                            value={agent?.security_zone || 'standard'}
                            onChange={async (e) => {
                                try {
                                    await agentApi.update(agentId, { security_zone: e.target.value } as any);
                                    refresh();
                                } catch (err) { toast.error((err as Error).message); }
                            }}
                        >
                            <option value="public">{t('agent.zone.public', 'Public')}</option>
                            <option value="standard">{t('agent.zone.standard', 'Standard')}</option>
                            <option value="restricted">{t('agent.zone.restricted', 'Restricted')}</option>
                        </select>
                    </div>

                    {/* Agent Class */}
                    <div className="flex items-center justify-between p-2.5 bg-surface-elevated rounded-lg border border-edge-subtle">
                        <div>
                            <div className="font-medium text-[13px]">{t('agent.settings.agentClass', 'Agent Class')}</div>
                            <div className="text-[11px] text-content-tertiary">{t('agent.settings.agentClassDesc', 'Classification that determines the agent\'s operational scope')}</div>
                        </div>
                        <select
                            className="input w-[180px] text-xs"
                            value={agent?.agent_class || 'internal_tenant'}
                            onChange={async (e) => {
                                try {
                                    await agentApi.update(agentId, { agent_class: e.target.value } as any);
                                    refresh();
                                } catch (err) { toast.error((err as Error).message); }
                            }}
                        >
                            <option value="internal_system">{t('agent.class.internal_system', 'System Agent')}</option>
                            <option value="internal_tenant">{t('agent.class.internal_tenant', 'Internal Agent')}</option>
                            <option value="external_gateway">{t('agent.class.external_gateway', 'Gateway Agent')}</option>
                            <option value="external_api">{t('agent.class.external_api', 'API Agent')}</option>
                        </select>
                    </div>

                    {/* Expires At */}
                    <div className="flex items-center justify-between p-2.5 bg-surface-elevated rounded-lg border border-edge-subtle">
                        <div>
                            <div className="font-medium text-[13px]">{t('agent.settings.expiresAt', 'Service Expiry Date')}</div>
                            <div className="text-[11px] text-content-tertiary">
                                {agent?.expires_at
                                    ? t('agent.settings.expiresAtCurrent', 'Expires: ') + new Date(agent.expires_at).toLocaleString()
                                    : t('agent.settings.expiresAtNone', 'No expiry set (never expires)')}
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <input
                                type="datetime-local"
                                className="input w-[200px] text-xs"
                                defaultValue={agent?.expires_at ? new Date(agent.expires_at).toISOString().slice(0, 16) : ''}
                                key={agent?.expires_at}
                                onBlur={async (e) => {
                                    try {
                                        const val = e.target.value ? new Date(e.target.value).toISOString() : null;
                                        await agentApi.update(agentId, { expires_at: val } as any);
                                        refresh();
                                    } catch (err) { toast.error((err as Error).message); }
                                }}
                            />
                            {agent?.expires_at && (
                                <button
                                    onClick={async () => {
                                        try {
                                            await agentApi.update(agentId, { expires_at: null } as any);
                                            refresh();
                                        } catch (err) { toast.error((err as Error).message); }
                                    }}
                                    className="px-2 py-1 rounded-md border border-edge-subtle bg-transparent cursor-pointer text-[11px] text-content-tertiary"
                                    title={t('agent.settings.clearExpiry', 'Clear expiry')}
                                >
                                    {t('agent.settings.clearExpiry', 'Clear')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Danger Zone */}
            <div className="card border-error">
                <h4 className="mb-3 text-error">{t('agent.settings.danger.title')}</h4>
                <p className="text-[13px] text-content-secondary mb-3">
                    {t('agent.settings.danger.deleteWarning')}
                </p>
                {!showDeleteConfirm ? (
                    <button className="btn btn-danger" onClick={() => setShowDeleteConfirm(true)}>
                        {t('agent.settings.danger.deleteAgent')}
                    </button>
                ) : (
                    <div className="flex gap-2 items-center">
                        <span className="text-[13px] font-semibold text-error">{t('agent.settings.danger.deleteWarning')}</span>
                        <button className="btn btn-danger" onClick={async () => {
                            try {
                                await agentApi.delete(agentId);
                                queryClient.invalidateQueries({ queryKey: ['agents'] });
                                navigate('/');
                            } catch (err) {
                                toast.error((err as Error).message || 'Failed to delete agent');
                            }
                        }}>{t('agent.settings.danger.confirmDelete')}</button>
                        <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)}>{t('common.cancel')}</button>
                    </div>
                )}
            </div>
        </>
    );
}
