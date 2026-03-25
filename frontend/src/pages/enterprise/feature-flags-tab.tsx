import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { featureFlagApi } from '@/services/api';

export function FeatureFlagsTab() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({ key: '', description: '', flag_type: 'boolean', enabled: false });

    const { data: flags = [], isLoading } = useQuery({
        queryKey: ['feature-flags'],
        queryFn: featureFlagApi.list,
    });

    const toggleMutation = useMutation({
        mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
            featureFlagApi.update(id, { enabled }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['feature-flags'] }),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => featureFlagApi.delete(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['feature-flags'] }),
    });

    const createMutation = useMutation({
        mutationFn: () => featureFlagApi.create(form),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['feature-flags'] });
            setShowCreate(false);
            setForm({ key: '', description: '', flag_type: 'boolean', enabled: false });
        },
    });

    if (isLoading) return <div style={{ padding: '20px', opacity: 0.5 }}>Loading...</div>;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ {t('enterprise.flags.create')}</button>
            </div>

            {showCreate && (
                <div className="card" style={{ marginBottom: '16px', padding: '16px' }}>
                    <h3 style={{ marginBottom: '12px' }}>{t('enterprise.flags.create')}</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                        <input className="input" placeholder="Flag key (e.g. unified_agent_runtime)" value={form.key}
                            onChange={e => setForm({ ...form, key: e.target.value })} />
                        <select className="input" value={form.flag_type}
                            onChange={e => setForm({ ...form, flag_type: e.target.value })}>
                            <option value="boolean">Boolean</option>
                            <option value="percentage">Percentage</option>
                            <option value="tenant_gate">Tenant Gate</option>
                            <option value="allowlist">Allowlist</option>
                        </select>
                    </div>
                    <input className="input" placeholder={t('enterprise.flags.description')} value={form.description}
                        onChange={e => setForm({ ...form, description: e.target.value })} style={{ marginBottom: '12px', width: '100%' }} />
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-primary" onClick={() => createMutation.mutate()} disabled={!form.key}>
                            {t('enterprise.flags.create')}
                        </button>
                        <button className="btn" onClick={() => setShowCreate(false)}>{t('common.cancel', 'Cancel')}</button>
                    </div>
                </div>
            )}

            {flags.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', opacity: 0.5 }}>{t('enterprise.flags.noFlags')}</div>
            ) : (
                <table className="table" style={{ width: '100%' }}>
                    <thead>
                        <tr>
                            <th>{t('enterprise.flags.key')}</th>
                            <th>{t('enterprise.flags.description')}</th>
                            <th>{t('enterprise.flags.type')}</th>
                            <th>{t('enterprise.flags.enabled')}</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {flags.map((f: any) => (
                            <tr key={f.id}>
                                <td><code style={{ fontSize: '12px', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '4px' }}>{f.key}</code></td>
                                <td style={{ fontSize: '13px', opacity: 0.7 }}>{f.description || '—'}</td>
                                <td><span className="badge">{f.flag_type}</span></td>
                                <td>
                                    <label style={{ cursor: 'pointer' }}>
                                        <input type="checkbox" checked={f.enabled}
                                            onChange={() => toggleMutation.mutate({ id: f.id, enabled: !f.enabled })} />
                                    </label>
                                </td>
                                <td>
                                    <button className="btn btn-sm" style={{ color: 'var(--danger, #ef4444)', fontSize: '12px' }}
                                        onClick={() => { if (confirm(t('enterprise.flags.confirmDelete'))) deleteMutation.mutate(f.id); }}>
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

