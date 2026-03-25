import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { capabilityApi } from '@/services/api';

export function CapabilitiesTab() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const [capSaving, setCapSaving] = useState<string | null>(null);

    const { data: capDefinitions = [] } = useQuery({
        queryKey: ['cap-definitions'],
        queryFn: () => capabilityApi.definitions(),
    });

    const { data: capPolicies = [] } = useQuery({
        queryKey: ['cap-policies'],
        queryFn: () => capabilityApi.list(),
    });

    const handleCapUpsert = async (capability: string, allowed: boolean, requiresApproval: boolean) => {
        setCapSaving(capability);
        try {
            await capabilityApi.upsert({ capability, allowed, requires_approval: requiresApproval });
            qc.invalidateQueries({ queryKey: ['cap-policies'] });
        } catch {
            // error handling
        }
        setCapSaving(null);
    };

    const handleCapDelete = async (policyId: string) => {
        try {
            await capabilityApi.delete(policyId);
            qc.invalidateQueries({ queryKey: ['cap-policies'] });
        } catch {
            // error handling
        }
    };

    return (
        <div>
            <h3 className="mb-1">{t('enterprise.capabilities.title')}</h3>
            <p className="text-xs text-content-tertiary mb-4">{t('enterprise.capabilities.description')}</p>
            <div className="overflow-x-auto">
                <table className="table w-full text-[13px]">
                    <thead>
                        <tr>
                            <th>{t('enterprise.capabilities.capability')}</th>
                            <th>{t('enterprise.capabilities.tools')}</th>
                            <th className="w-[120px]">{t('enterprise.audit.severity')}</th>
                            <th className="w-[140px]">{t('enterprise.capabilities.requiresApproval')}</th>
                            <th className="w-[100px]"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {capDefinitions.map((def: any) => {
                            const policy = capPolicies.find((p: any) => p.capability === def.capability);
                            const isAllowed = policy ? policy.allowed : true;
                            const requiresApproval = policy?.requires_approval ?? false;
                            const isSaving = capSaving === def.capability;
                            return (
                                <tr key={def.capability}>
                                    <td className="font-medium">{def.capability}</td>
                                    <td className="text-[11px] text-content-tertiary">{def.tools?.join(', ') || '-'}</td>
                                    <td>
                                        <button
                                            className="btn btn-ghost text-[11px] px-2.5 py-0.5 rounded border-none cursor-pointer"
                                            disabled={isSaving}
                                            onClick={() => handleCapUpsert(def.capability, !isAllowed, requiresApproval)}
                                            style={{
                                                background: isAllowed ? 'rgba(34,197,94,0.12)' : 'rgba(255,59,48,0.12)',
                                                color: isAllowed ? 'var(--success, #34c759)' : 'var(--error, #ff3b30)',
                                            }}
                                        >
                                            {isAllowed ? t('enterprise.capabilities.allowed') : t('enterprise.capabilities.denied')}
                                        </button>
                                    </td>
                                    <td>
                                        <input
                                            type="checkbox"
                                            checked={requiresApproval}
                                            disabled={isSaving}
                                            onChange={e => handleCapUpsert(def.capability, isAllowed, e.target.checked)}
                                        />
                                    </td>
                                    <td>
                                        {policy ? (
                                            <button className="btn btn-ghost text-[11px] text-content-tertiary px-1.5 py-0.5" onClick={() => handleCapDelete(policy.id)}>
                                                {t('enterprise.capabilities.delete')}
                                            </button>
                                        ) : (
                                            <span className="text-[11px] text-content-tertiary">{t('enterprise.capabilities.noPolicy')}</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {capDefinitions.length === 0 && <div className="text-center py-10 text-content-tertiary">{t('common.noData')}</div>}
        </div>
    );
}
