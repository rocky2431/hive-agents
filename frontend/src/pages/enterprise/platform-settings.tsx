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
        <div className="card p-4">
            <div className="form-group">
                <label className="form-label">{t('enterprise.config.publicUrl')}</label>
                <input className="form-input" value={publicBaseUrl} onChange={e => setPublicBaseUrl(e.target.value)}
                    placeholder={t("enterprise.config.publicUrlPlaceholder")} />
                <div className="text-[11px] text-content-tertiary mt-1">
                    {t('enterprise.config.publicUrl')}
                </div>
            </div>
            <div className="mt-3 flex gap-2 items-center">
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? t('common.loading') : t('enterprise.config.save')}
                </button>
                {saved && <span className="text-success text-xs">{t('enterprise.config.saved')}</span>}
            </div>
        </div>
    );
}
