import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { capabilityApi } from '@/services/api';

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
            <div className="card" style={{ marginBottom: '12px' }}>
                <h4 style={{ marginBottom: '4px' }}>{t('agent.settings.capabilityPolicy.title')}</h4>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '13px', padding: '12px 0' }}>{t('common.loading')}</div>
            </div>
        );
    }

    return (
        <div className="card" style={{ marginBottom: '12px' }}>
            <h4 style={{ marginBottom: '4px' }}>{t('agent.settings.capabilityPolicy.title')}</h4>
            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                {t('agent.settings.capabilityPolicy.description')}
            </p>

            {capDefs.length === 0 ? (
                <div style={{ color: 'var(--text-tertiary)', fontSize: '13px', padding: '12px 0' }}>
                    {t('agent.settings.capabilityPolicy.noDefinitions')}
                </div>
            ) : (
                <>
                    {agentPolicies.length === 0 && (
                        <div style={{
                            fontSize: '12px', color: 'var(--text-tertiary)',
                            padding: '12px 14px', background: 'var(--bg-elevated)',
                            borderRadius: '8px', border: '1px solid var(--border-subtle)',
                            marginBottom: '10px',
                        }}>
                            {t('agent.settings.capabilityPolicy.noPolicies')}
                        </div>
                    )}

                    {agentPolicies.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr 100px 120px 60px',
                                gap: '8px',
                                padding: '6px 14px',
                                fontSize: '11px',
                                fontWeight: 600,
                                color: 'var(--text-tertiary)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                            }}>
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
                                    <div key={policy.id} style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr 100px 120px 60px',
                                        gap: '8px',
                                        alignItems: 'center',
                                        padding: '10px 14px',
                                        background: 'var(--bg-elevated)',
                                        borderRadius: '8px',
                                        border: '1px solid var(--border-subtle)',
                                        opacity: isSaving ? 0.6 : 1,
                                        transition: 'opacity 0.15s',
                                    }}>
                                        <div style={{
                                            fontWeight: 500, fontSize: '13px',
                                            fontFamily: 'var(--font-mono)',
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}>
                                            {policy.capability}
                                        </div>

                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                            {tools.slice(0, 3).map((tool: string) => (
                                                <span key={tool} style={{
                                                    fontSize: '10px', padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    background: 'var(--bg-secondary)',
                                                    color: 'var(--text-tertiary)',
                                                    fontFamily: 'var(--font-mono)',
                                                    border: '1px solid var(--border-subtle)',
                                                }}>
                                                    {tool}
                                                </span>
                                            ))}
                                            {tools.length > 3 && (
                                                <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                                                    +{tools.length - 3}
                                                </span>
                                            )}
                                        </div>

                                        <button
                                            disabled={isSaving}
                                            onClick={() => handleUpsert(policy.capability, !policy.allowed, policy.requires_approval)}
                                            style={{
                                                padding: '4px 10px', borderRadius: '6px',
                                                fontSize: '11px', fontWeight: 600,
                                                border: '1px solid',
                                                cursor: isSaving ? 'default' : 'pointer',
                                                background: policy.allowed ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                                                color: policy.allowed ? 'var(--success)' : 'var(--error)',
                                                borderColor: policy.allowed ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
                                            }}
                                        >
                                            {policy.allowed
                                                ? t('agent.settings.capabilityPolicy.allowed')
                                                : t('agent.settings.capabilityPolicy.denied')}
                                        </button>

                                        <label style={{
                                            display: 'flex', alignItems: 'center', gap: '6px',
                                            fontSize: '11px', color: 'var(--text-secondary)',
                                            cursor: isSaving ? 'default' : 'pointer',
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={policy.requires_approval}
                                                disabled={isSaving}
                                                onChange={(e) => handleUpsert(policy.capability, policy.allowed, e.target.checked)}
                                                style={{ accentColor: 'var(--accent-primary)' }}
                                            />
                                            {t('agent.settings.capabilityPolicy.requiresApproval')}
                                        </label>

                                        <button
                                            disabled={isSaving}
                                            onClick={() => handleDelete(policy)}
                                            title={t('agent.settings.capabilityPolicy.delete')}
                                            style={{
                                                padding: '4px 8px', borderRadius: '6px',
                                                fontSize: '11px', cursor: isSaving ? 'default' : 'pointer',
                                                background: 'none', border: '1px solid var(--border-subtle)',
                                                color: 'var(--text-tertiary)',
                                            }}
                                        >
                                            {t('agent.settings.capabilityPolicy.delete')}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {addingCapability ? (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '10px 14px', background: 'var(--bg-elevated)',
                            borderRadius: '8px', border: '1px solid var(--accent-primary)',
                        }}>
                            <select
                                className="input"
                                value={selectedNewCap}
                                onChange={(e) => setSelectedNewCap(e.target.value)}
                                style={{ flex: 1, fontSize: '12px' }}
                            >
                                <option value="">{t('agent.settings.capabilityPolicy.selectCapability')}</option>
                                {unconfiguredDefs.map((def: any) => (
                                    <option key={def.capability} value={def.capability}>
                                        {def.capability}
                                    </option>
                                ))}
                            </select>
                            <button
                                className="btn btn-primary"
                                disabled={!selectedNewCap || capSaving !== null}
                                onClick={handleAddNew}
                                style={{ padding: '5px 14px', fontSize: '12px' }}
                            >
                                {t('agent.settings.capabilityPolicy.addPolicy')}
                            </button>
                            <button
                                style={{
                                    background: 'none', border: 'none',
                                    cursor: 'pointer', color: 'var(--text-tertiary)',
                                    fontSize: '16px', lineHeight: 1,
                                }}
                                onClick={() => { setAddingCapability(false); setSelectedNewCap(''); }}
                            >
                                x
                            </button>
                        </div>
                    ) : unconfiguredDefs.length > 0 && (
                        <button
                            onClick={() => setAddingCapability(true)}
                            style={{
                                padding: '8px 14px', borderRadius: '8px',
                                border: '1px dashed var(--border-subtle)',
                                background: 'none', cursor: 'pointer',
                                color: 'var(--accent-primary)', fontSize: '12px',
                                fontWeight: 500, width: '100%',
                                transition: 'border-color 0.15s',
                            }}
                        >
                            + {t('agent.settings.capabilityPolicy.addPolicy')}
                        </button>
                    )}
                </>
            )}
        </div>
    );
}
