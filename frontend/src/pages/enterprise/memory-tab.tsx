import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { enterpriseApi } from '@/services/api';
import { fetchJson } from './shared';
import type { LLMModel } from './shared';

export function MemoryTab({ models, tenantId }: { models: LLMModel[]; tenantId?: string }) {
    const { t } = useTranslation();
    const defaultConfig = {
        summary_model_id: '' as string,
        compress_threshold: 70,
        keep_recent: 10,
        extract_to_viking: false,
    };
    const [config, setConfig] = useState(defaultConfig);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        setLoaded(false);
        setConfig(defaultConfig);
        fetchJson<any>(`/enterprise/memory/config${tenantId ? `?tenant_id=${tenantId}` : ''}`).then(d => {
            if (d && Object.keys(d).length) {
                setConfig(c => ({
                    ...c,
                    ...d,
                    summary_model_id: d.summary_model_id || '',
                }));
            }
            setLoaded(true);
        }).catch(() => { setLoaded(true); /* non-critical: memory config uses defaults if fetch fails */ });
    }, [tenantId]);

    const saveConfig = async () => {
        setSaving(true);
        try {
            await fetchJson(`/enterprise/memory/config${tenantId ? `?tenant_id=${tenantId}` : ''}`, {
                method: 'PUT',
                body: JSON.stringify({
                    ...config,
                    summary_model_id: config.summary_model_id || null,
                }),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e: any) {
            alert(e.message || 'Failed to save');
        }
        setSaving(false);
    };

    if (!loaded) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading...</div>;

    return (
        <div className="card">
            <h3 style={{ marginBottom: '20px' }}>{t('enterprise.memory.title')}</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Summary Model */}
                <div className="form-group">
                    <label className="form-label">{t('enterprise.memory.summaryModel')}</label>
                    <select
                        className="form-input"
                        value={config.summary_model_id}
                        onChange={e => setConfig(c => ({ ...c, summary_model_id: e.target.value }))}
                    >
                        <option value="">— {t('enterprise.memory.noModelSelected')} —</option>
                        {models.filter(m => m.enabled).map(m => (
                            <option key={m.id} value={m.id}>{m.label} ({m.provider}/{m.model})</option>
                        ))}
                    </select>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                        {t('enterprise.memory.summaryModelDesc')}
                    </div>
                </div>

                {/* Compress Threshold */}
                <div className="form-group">
                    <label className="form-label">{t('enterprise.memory.compressThreshold')}</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                            className="form-input"
                            type="number"
                            min={30}
                            max={95}
                            value={config.compress_threshold}
                            onChange={e => setConfig(c => ({ ...c, compress_threshold: Number(e.target.value) }))}
                            style={{ width: '100px' }}
                        />
                        <span style={{ color: 'var(--text-secondary)' }}>%</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                        {t('enterprise.memory.compressThresholdDesc')}
                    </div>
                </div>

                {/* Keep Recent */}
                <div className="form-group">
                    <label className="form-label">{t('enterprise.memory.keepRecent')}</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                            className="form-input"
                            type="number"
                            min={2}
                            max={50}
                            value={config.keep_recent}
                            onChange={e => setConfig(c => ({ ...c, keep_recent: Number(e.target.value) }))}
                            style={{ width: '100px' }}
                        />
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                        {t('enterprise.memory.keepRecentDesc')}
                    </div>
                </div>

                {/* Extract to Viking */}
                <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                        <input
                            type="checkbox"
                            checked={config.extract_to_viking}
                            onChange={e => setConfig(c => ({ ...c, extract_to_viking: e.target.checked }))}
                        />
                        {t('enterprise.memory.extractToViking')}
                    </label>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                        {t('enterprise.memory.extractToVikingDesc')}
                    </div>
                </div>

                {/* Save */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center' }}>
                    {saved && <span style={{ color: 'var(--success)', fontSize: '13px' }}>{t('enterprise.memory.saved')}</span>}
                    <button className="btn btn-primary" onClick={saveConfig} disabled={saving}>
                        {saving ? '...' : t('common.save')}
                    </button>
                </div>
            </div>
        </div>
    );
}


