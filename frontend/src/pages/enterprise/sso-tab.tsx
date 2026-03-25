import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { oidcApi } from '@/services/api';

export function SsoTab({ selectedTenantId }: { selectedTenantId?: string }) {
    const { t } = useTranslation();

    const [ssoForm, setSsoForm] = useState({
        issuer_url: '', client_id: '', client_secret: '',
        scopes: 'openid profile email', auto_provision: false, display_name: '',
    });
    const [ssoSaving, setSsoSaving] = useState(false);
    const [ssoSaved, setSsoSaved] = useState(false);
    const [ssoLoaded, setSsoLoaded] = useState(false);

    useEffect(() => {
        setSsoLoaded(false);
        oidcApi.getConfig(selectedTenantId || undefined).then((cfg: any) => {
            if (cfg) {
                setSsoForm(f => ({
                    ...f,
                    issuer_url: cfg.issuer_url || '',
                    client_id: cfg.client_id || '',
                    client_secret: '',
                    scopes: cfg.scopes || 'openid profile email',
                    auto_provision: cfg.auto_provision ?? false,
                    display_name: cfg.display_name || '',
                }));
            }
            setSsoLoaded(true);
        }).catch(() => { setSsoLoaded(true); });
    }, [selectedTenantId]);

    const saveSsoConfig = async () => {
        setSsoSaving(true);
        try {
            await oidcApi.updateConfig(ssoForm, selectedTenantId || undefined);
            setSsoSaved(true);
            setTimeout(() => setSsoSaved(false), 2000);
        } catch {
            // error handling
        }
        setSsoSaving(false);
    };

    return (
        <div>
            <h3 className="mb-1">{t('enterprise.sso.title')}</h3>
            <p className="text-xs text-content-tertiary mb-4">{t('enterprise.sso.description')}</p>
            <div className="card p-4">
                {/* Status indicator */}
                <div className="flex items-center gap-2 mb-4">
                    <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: ssoLoaded && ssoForm.issuer_url ? 'var(--success, #34c759)' : 'var(--text-tertiary)' }}
                    />
                    <span className="text-xs text-content-secondary">
                        {ssoLoaded && ssoForm.issuer_url ? t('enterprise.sso.configured') : t('enterprise.sso.notConfigured')}
                    </span>
                </div>

                <div className="flex flex-col gap-3">
                    <div className="form-group">
                        <label className="form-label">{t('enterprise.sso.issuerUrl')}</label>
                        <input className="form-input" value={ssoForm.issuer_url} onChange={e => setSsoForm(f => ({ ...f, issuer_url: e.target.value }))} placeholder={t('enterprise.sso.issuerUrlPlaceholder')} />
                    </div>
                    <div className="flex gap-3">
                        <div className="form-group flex-1">
                            <label className="form-label">{t('enterprise.sso.clientId')}</label>
                            <input className="form-input" value={ssoForm.client_id} onChange={e => setSsoForm(f => ({ ...f, client_id: e.target.value }))} placeholder={t('enterprise.sso.clientIdPlaceholder')} />
                        </div>
                        <div className="form-group flex-1">
                            <label className="form-label">{t('enterprise.sso.clientSecret')}</label>
                            <input className="form-input" type="password" value={ssoForm.client_secret} onChange={e => setSsoForm(f => ({ ...f, client_secret: e.target.value }))} placeholder={t('enterprise.sso.clientSecretPlaceholder')} />
                        </div>
                    </div>
                    <div className="form-group">
                        <label className="form-label">{t('enterprise.sso.scopes')}</label>
                        <input className="form-input" value={ssoForm.scopes} onChange={e => setSsoForm(f => ({ ...f, scopes: e.target.value }))} placeholder={t('enterprise.sso.scopesPlaceholder')} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">{t('enterprise.sso.displayName')}</label>
                        <input className="form-input" value={ssoForm.display_name} onChange={e => setSsoForm(f => ({ ...f, display_name: e.target.value }))} placeholder={t('enterprise.sso.displayNamePlaceholder')} />
                    </div>
                    <div className="flex items-center gap-2">
                        <input type="checkbox" id="sso-auto-provision" checked={ssoForm.auto_provision} onChange={e => setSsoForm(f => ({ ...f, auto_provision: e.target.checked }))} />
                        <label htmlFor="sso-auto-provision" className="text-[13px] cursor-pointer">{t('enterprise.sso.autoProvision')}</label>
                        <span className="text-[11px] text-content-tertiary">{t('enterprise.sso.autoProvisionDesc')}</span>
                    </div>
                </div>
                <div className="mt-4 flex gap-2 items-center">
                    <button className="btn btn-primary" onClick={saveSsoConfig} disabled={ssoSaving || !ssoForm.issuer_url || !ssoForm.client_id}>
                        {ssoSaving ? t('common.loading') : t('enterprise.sso.save')}
                    </button>
                    {ssoSaved && <span className="text-[var(--success)] text-xs">{t('enterprise.sso.saved')}</span>}
                </div>
            </div>
        </div>
    );
}
