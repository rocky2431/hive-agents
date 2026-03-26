import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores';
import { tenantApi, authApi } from '../services/api';
import { Button } from '@/components/ui/button';

export default function CompanySetup() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const { user, setAuth } = useAuthStore();
    const [allowCreate, setAllowCreate] = useState(true);
    const [invitationCodeRequired, setInvitationCodeRequired] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [inviteCode, setInviteCode] = useState('');
    const [companyName, setCompanyName] = useState('');

    useEffect(() => {
        Promise.all([
            tenantApi.registrationConfig().catch(() => ({ allow_self_create_company: true })),
            authApi.registrationConfig().catch(() => ({ invitation_code_required: false })),
        ]).then(([tenantConfig, authConfig]) => {
            setAllowCreate(tenantConfig.allow_self_create_company);
            setInvitationCodeRequired(!!authConfig.invitation_code_required);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        if (user?.tenant_id) navigate('/');
    }, [user, navigate]);

    const refreshUser = async () => {
        try {
            const me = await authApi.me();
            const token = useAuthStore.getState().token;
            if (token) setAuth(me, token);
        } catch {}
    };

    const handleJoin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await tenantApi.join(inviteCode);
            await refreshUser();
            navigate('/');
        } catch (err: any) {
            setError(err.message || t('companySetup.joinFailed'));
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await tenantApi.selfCreate({ name: companyName });
            await refreshUser();
            navigate('/workspace');
        } catch (err: any) {
            setError(err.message || t('companySetup.createFailed'));
        } finally {
            setLoading(false);
        }
    };

    const toggleLang = () => {
        i18n.changeLanguage(i18n.language === 'zh' ? 'en' : 'zh');
    };

    const canCreateCompany = allowCreate && !invitationCodeRequired;

    return (
        <div className="company-setup-page">
            <button
                onClick={toggleLang}
                className="absolute top-4 right-4 z-50 flex items-center gap-1 rounded-lg border border-edge-subtle bg-surface-secondary px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-hover cursor-pointer"
                aria-label="Switch language"
            >
                🌐 {i18n.language === 'zh' ? 'EN' : '中文'}
            </button>

            <div className="company-setup-container">
                <div className="company-setup-header">
                    <img src="/logo-black.png" alt="" width={32} height={32} />
                    <h1>{t('companySetup.title', 'Set Up Your Workspace')}</h1>
                    <p className="company-setup-subtitle">
                        {t('companySetup.subtitle', 'Join an existing company or create your own to get started.')}
                    </p>
                </div>

                {error && (
                    <div className="login-error mb-4" role="alert">
                        <span aria-hidden="true">⚠</span> {error}
                    </div>
                )}

                {invitationCodeRequired && (
                    <div className="login-error mb-4" role="alert">
                        <span aria-hidden="true">⚠</span> {t('companySetup.invitationRequired')}
                    </div>
                )}

                <div className={`company-setup-panels ${!canCreateCompany ? 'single' : ''}`}>
                    <form className="company-setup-panel" onSubmit={handleJoin}>
                        <div className="company-setup-panel-header">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                                <polyline points="10 17 15 12 10 7" />
                                <line x1="15" y1="12" x2="3" y2="12" />
                            </svg>
                            <h3>{t('companySetup.joinTitle', 'Join a Company')}</h3>
                        </div>
                        <p className="company-setup-panel-desc">
                            {t(
                                invitationCodeRequired ? 'companySetup.joinDescRequired' : 'companySetup.joinDesc',
                                invitationCodeRequired
                                    ? 'Workspace access is invitation-only. Enter the invitation code from your administrator.'
                                    : 'Enter the invitation code provided by your company administrator.',
                            )}
                        </p>
                        <div className="login-field">
                            <label htmlFor="invite-code">{t('companySetup.inviteCode', 'Invitation Code')}</label>
                            <input
                                id="invite-code"
                                value={inviteCode}
                                onChange={(e) => setInviteCode(e.target.value)}
                                required
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={t('companySetup.inviteCodePlaceholder', 'e.g. ABC12345') + '\u2026'}
                                className="uppercase tracking-[2px] font-mono"
                            />
                        </div>
                        <Button type="submit" disabled={loading || !inviteCode} loading={loading} className="login-submit w-full">
                            {t('companySetup.joinBtn', 'Join Company')}
                        </Button>
                    </form>

                    {canCreateCompany && (
                        <>
                            <div className="company-setup-divider">
                                <span>{t('companySetup.or', 'OR')}</span>
                            </div>
                            <form className="company-setup-panel" onSubmit={handleCreate}>
                                <div className="company-setup-panel-header">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                                        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                                    </svg>
                                    <h3>{t('companySetup.createTitle', 'Create a Company')}</h3>
                                </div>
                                <p className="company-setup-panel-desc">
                                    {t('companySetup.createDesc', 'Start a new workspace. You can invite team members later.')}
                                </p>
                                <div className="login-field">
                                    <label htmlFor="company-name">{t('companySetup.companyName', 'Company Name')}</label>
                                    <input
                                        id="company-name"
                                        value={companyName}
                                        onChange={(e) => setCompanyName(e.target.value)}
                                        required
                                        autoComplete="organization"
                                        placeholder={t('companySetup.companyNamePlaceholder', 'e.g. Acme Inc.') + '\u2026'}
                                    />
                                </div>
                                <Button type="submit" disabled={loading || !companyName} loading={loading} className="login-submit w-full">
                                    {t('companySetup.createBtn', 'Create Company')}
                                </Button>
                            </form>
                        </>
                    )}
                </div>

                {!canCreateCompany && (
                    <p className="company-setup-hint">
                        {t(
                            invitationCodeRequired ? 'companySetup.contactAdminInviteOnly' : 'companySetup.contactAdmin',
                            invitationCodeRequired
                                ? 'Self-service workspace creation is disabled while invitation-only access is enabled. Contact your administrator for an invitation code.'
                                : 'Contact your platform administrator for an invitation code.',
                        )}
                    </p>
                )}
            </div>
        </div>
    );
}
