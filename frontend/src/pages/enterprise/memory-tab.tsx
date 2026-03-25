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

    if (!loaded) return <div className="py-10 text-center text-content-tertiary">Loading...</div>;

    return (
        <div className="card">
            <h3 className="mb-5">{t('enterprise.memory.title')}</h3>

            <div className="flex flex-col gap-5">
                {/* Summary Model */}
                <div className="form-group">
                    <label htmlFor="memory-summary-model" className="form-label">{t('enterprise.memory.summaryModel')}</label>
                    <select
                        id="memory-summary-model"
                        className="form-input"
                        value={config.summary_model_id}
                        onChange={e => setConfig(c => ({ ...c, summary_model_id: e.target.value }))}
                    >
                        <option value="">— {t('enterprise.memory.noModelSelected')} —</option>
                        {models.filter(m => m.enabled).map(m => (
                            <option key={m.id} value={m.id}>{m.label} ({m.provider}/{m.model})</option>
                        ))}
                    </select>
                    <div className="text-[11px] text-content-tertiary mt-1">
                        {t('enterprise.memory.summaryModelDesc')}
                    </div>
                </div>

                {/* Compress Threshold */}
                <div className="form-group">
                    <label htmlFor="memory-compress" className="form-label">{t('enterprise.memory.compressThreshold')}</label>
                    <div className="flex items-center gap-2">
                        <input
                            id="memory-compress"
                            className="form-input w-[100px]"
                            type="number"
                            min={30}
                            max={95}
                            value={config.compress_threshold}
                            onChange={e => setConfig(c => ({ ...c, compress_threshold: Number(e.target.value) }))}
                            autoComplete="off"
                        />
                        <span className="text-content-secondary">%</span>
                    </div>
                    <div className="text-[11px] text-content-tertiary mt-1">
                        {t('enterprise.memory.compressThresholdDesc')}
                    </div>
                </div>

                {/* Keep Recent */}
                <div className="form-group">
                    <label htmlFor="memory-keep-recent" className="form-label">{t('enterprise.memory.keepRecent')}</label>
                    <div className="flex items-center gap-2">
                        <input
                            id="memory-keep-recent"
                            className="form-input w-[100px]"
                            type="number"
                            min={2}
                            max={50}
                            value={config.keep_recent}
                            onChange={e => setConfig(c => ({ ...c, keep_recent: Number(e.target.value) }))}
                            autoComplete="off"
                        />
                    </div>
                    <div className="text-[11px] text-content-tertiary mt-1">
                        {t('enterprise.memory.keepRecentDesc')}
                    </div>
                </div>

                {/* Extract to Viking */}
                <div className="form-group">
                    <label className="flex items-center gap-2 cursor-pointer text-[13px]">
                        <input
                            type="checkbox"
                            checked={config.extract_to_viking}
                            onChange={e => setConfig(c => ({ ...c, extract_to_viking: e.target.checked }))}
                        />
                        {t('enterprise.memory.extractToViking')}
                    </label>
                    <div className="text-[11px] text-content-tertiary mt-1">
                        {t('enterprise.memory.extractToVikingDesc')}
                    </div>
                </div>

                {/* Save */}
                <div className="flex justify-end gap-2 items-center">
                    {saved && <span className="text-success text-[13px]">{t('enterprise.memory.saved')}</span>}
                    <button className="btn btn-primary" onClick={saveConfig} disabled={saving}>
                        {saving ? '...' : t('common.save')}
                    </button>
                </div>
            </div>
        </div>
    );
}


