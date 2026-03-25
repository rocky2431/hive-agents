import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { capabilityApi } from '@/services/api';
import { cn } from '@/lib/cn';

export function CapabilityPolicyManager({ agentId }: { agentId: string }) {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const [capSaving, setCapSaving] = useState<string | null>(null);
    const [addingCapability, setAddingCapability] = useState(false);
    const [selectedNewCap, setSelectedNewCap] = useState('');

    const { data: capDefs = [], isLoading: defsLoading } = useQuery({
        queryKey: ['agent-capability-definitions'],
        queryFn: () => capabilityApi.definitions(),
        enabled: !!agentId,
    });
    const { data: agentPolicies = [], isLoading: policiesLoading } = useQuery({
        queryKey: ['agent-capability-policies', agentId],
        queryFn: () => capabilityApi.list(agentId),
        enabled: !!agentId,
    });

    const configuredCaps = new Set(agentPolicies.map((p: any) => p.capability));
    const unconfiguredDefs = capDefs.filter((d: any) => !configuredCaps.has(d.capability));

    const getToolsForCapability = (cap: string) => {
        const def = capDefs.find((d: any) => d.capability === cap);
        return def?.tools || [];
    };

    const handleUpsert = async (capability: string, allowed: boolean, requiresApproval: boolean) => {
        setCapSaving(capability);
        try {
            await capabilityApi.upsert({
                capability,
                agent_id: agentId,
                allowed,
                requires_approval: requiresApproval,
            });
            await qc.invalidateQueries({ queryKey: ['agent-capability-policies', agentId] });
            await qc.invalidateQueries({ queryKey: ['capability-summary', agentId] });
        } finally {
            setCapSaving(null);
        }
    };

    const handleDelete = async (policy: any) => {
        setCapSaving(policy.capability);
        try {
            await capabilityApi.delete(policy.id);
            await qc.invalidateQueries({ queryKey: ['agent-capability-policies', agentId] });
            await qc.invalidateQueries({ queryKey: ['capability-summary', agentId] });
        } finally {
            setCapSaving(null);
        }
    };

    const handleAddNew = async () => {
        if (!selectedNewCap) return;
        await handleUpsert(selectedNewCap, true, false);
        setSelectedNewCap('');
        setAddingCapability(false);
    };

    if (defsLoading || policiesLoading) {
        return (
            <div className="card mb-3">
                <h4 className="mb-1">{t('agent.settings.capabilityPolicy.title')}</h4>
                <div className="text-content-tertiary text-[13px] py-3">{t('common.loading')}</div>
            </div>
        );
    }

    return (
        <div className="card mb-3">
            <h4 className="mb-1">{t('agent.settings.capabilityPolicy.title')}</h4>
            <p className="text-xs text-content-tertiary mb-4">
                {t('agent.settings.capabilityPolicy.description')}
            </p>

            {capDefs.length === 0 ? (
                <div className="text-content-tertiary text-[13px] py-3">
                    {t('agent.settings.capabilityPolicy.noDefinitions')}
                </div>
            ) : (
                <>
                    {agentPolicies.length === 0 && (
                        <div className="text-xs text-content-tertiary px-3.5 py-3 bg-surface-elevated rounded-lg border border-edge-subtle mb-2.5">
                            {t('agent.settings.capabilityPolicy.noPolicies')}
                        </div>
                    )}

                    {agentPolicies.length > 0 && (
                        <div className="flex flex-col gap-1.5 mb-3">
                            <div className="grid grid-cols-[1fr_1fr_100px_120px_60px] gap-2 px-3.5 py-1.5 text-[11px] font-semibold text-content-tertiary uppercase tracking-wide">
                                <span>{t('agent.settings.capabilityPolicy.capability')}</span>
                                <span>{t('agent.settings.capabilityPolicy.tools')}</span>
                                <span>{t('agent.settings.capabilityPolicy.status')}</span>
                                <span>{t('agent.settings.capabilityPolicy.approval')}</span>
                                <span>{t('agent.settings.capabilityPolicy.actions')}</span>
                            </div>

                            {agentPolicies.map((policy: any) => {
                                const tools = getToolsForCapability(policy.capability);
                                const isSaving = capSaving === policy.capability;
                                return (
                                    <div key={policy.id} className={cn(
                                        'grid grid-cols-[1fr_1fr_100px_120px_60px] gap-2 items-center px-3.5 py-2.5',
                                        'bg-surface-elevated rounded-lg border border-edge-subtle transition-opacity duration-150',
                                        isSaving && 'opacity-60',
                                    )}>
                                        <div className="font-medium text-[13px] font-mono overflow-hidden text-ellipsis whitespace-nowrap">
                                            {policy.capability}
                                        </div>

                                        <div className="flex flex-wrap gap-1">
                                            {tools.slice(0, 3).map((tool: string) => (
                                                <span key={tool} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary text-content-tertiary font-mono border border-edge-subtle">
                                                    {tool}
                                                </span>
                                            ))}
                                            {tools.length > 3 && (
                                                <span className="text-[10px] text-content-tertiary">
                                                    +{tools.length - 3}
                                                </span>
                                            )}
                                        </div>

                                        <button
                                            disabled={isSaving}
                                            onClick={() => handleUpsert(policy.capability, !policy.allowed, policy.requires_approval)}
                                            className={cn(
                                                'px-2.5 py-1 rounded-md text-[11px] font-semibold border cursor-pointer',
                                                isSaving && 'cursor-default',
                                                policy.allowed
                                                    ? 'bg-green-500/10 text-success border-green-500/30'
                                                    : 'bg-red-500/10 text-error border-red-500/30',
                                            )}
                                        >
                                            {policy.allowed
                                                ? t('agent.settings.capabilityPolicy.allowed')
                                                : t('agent.settings.capabilityPolicy.denied')}
                                        </button>

                                        <label className={cn(
                                            'flex items-center gap-1.5 text-[11px] text-content-secondary',
                                            isSaving ? 'cursor-default' : 'cursor-pointer',
                                        )}>
                                            <input
                                                type="checkbox"
                                                checked={policy.requires_approval}
                                                disabled={isSaving}
                                                onChange={(e) => handleUpsert(policy.capability, policy.allowed, e.target.checked)}
                                                className="accent-accent-primary"
                                            />
                                            {t('agent.settings.capabilityPolicy.requiresApproval')}
                                        </label>

                                        <button
                                            disabled={isSaving}
                                            onClick={() => handleDelete(policy)}
                                            title={t('agent.settings.capabilityPolicy.delete')}
                                            className={cn(
                                                'px-2 py-1 rounded-md text-[11px] bg-transparent border border-edge-subtle text-content-tertiary',
                                                isSaving ? 'cursor-default' : 'cursor-pointer',
                                            )}
                                        >
                                            {t('agent.settings.capabilityPolicy.delete')}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {addingCapability ? (
                        <div className="flex items-center gap-2 px-3.5 py-2.5 bg-surface-elevated rounded-lg border border-accent-primary">
                            <select
                                className="input flex-1 text-xs"
                                value={selectedNewCap}
                                onChange={(e) => setSelectedNewCap(e.target.value)}
                            >
                                <option value="">{t('agent.settings.capabilityPolicy.selectCapability')}</option>
                                {unconfiguredDefs.map((def: any) => (
                                    <option key={def.capability} value={def.capability}>
                                        {def.capability}
                                    </option>
                                ))}
                            </select>
                            <button
                                className="btn btn-primary px-3.5 py-[5px] text-xs"
                                disabled={!selectedNewCap || capSaving !== null}
                                onClick={handleAddNew}
                            >
                                {t('agent.settings.capabilityPolicy.addPolicy')}
                            </button>
                            <button
                                className="bg-transparent border-none cursor-pointer text-content-tertiary text-base leading-none"
                                onClick={() => { setAddingCapability(false); setSelectedNewCap(''); }}
                            >
                                x
                            </button>
                        </div>
                    ) : unconfiguredDefs.length > 0 && (
                        <button
                            onClick={() => setAddingCapability(true)}
                            className="w-full px-3.5 py-2 rounded-lg border border-dashed border-edge-subtle bg-transparent cursor-pointer text-accent-primary text-xs font-medium transition-colors duration-150 hover:border-accent-primary"
                        >
                            + {t('agent.settings.capabilityPolicy.addPolicy')}
                        </button>
                    )}
                </>
            )}
        </div>
    );
}
