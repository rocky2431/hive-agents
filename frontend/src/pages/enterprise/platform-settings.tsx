import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchJson } from './shared';

export default function PlatformSettings() {
    const { t } = useTranslation();
    const [publicBaseUrl, setPublicBaseUrl] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        fetchJson<any>('/enterprise/system-settings/platform')
            .then(d => {
                if (d.value?.public_base_url) setPublicBaseUrl(d.value.public_base_url);
            }).catch(() => { /* non-critical: platform settings use defaults if unavailable */ });
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await fetchJson('/enterprise/system-settings/platform', {
                method: 'PUT', body: JSON.stringify({ value: { public_base_url: publicBaseUrl } }),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e) {
            alert(t('agent.upload.failed'));
        } finally { setSaving(false); }
    };

    return (
        <div className="card" style={{ padding: '16px' }}>
            <div className="form-group">
                <label className="form-label">{t('enterprise.config.publicUrl')}</label>
                <input className="form-input" value={publicBaseUrl} onChange={e => setPublicBaseUrl(e.target.value)}
                    placeholder={t("enterprise.config.publicUrlPlaceholder")} />
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                    {t('enterprise.config.publicUrl')}
                </div>
            </div>
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? t('common.loading') : t('enterprise.config.save')}
                </button>
                {saved && <span style={{ color: 'var(--success)', fontSize: '12px' }}>{t('enterprise.config.saved')}</span>}
            </div>
        </div>
    );
}
