import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores';
import { authApi, oidcApi } from '../services/api';
import { Button } from '@/components/ui/button';

export default function Login() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const setAuth = useAuthStore((s) => s.setAuth);
    const [isRegister, setIsRegister] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const [ssoConfig, setSsoConfig] = useState<any>(null);
    const [registrationConfig, setRegistrationConfig] = useState<{ invitation_code_required: boolean }>({ invitation_code_required: false });

    const [form, setForm] = useState({
        username: '',
        password: '',
        email: '',
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
    }, []);

    useEffect(() => {
        oidcApi.config().then(cfg => {
            if (cfg.configured) setSsoConfig(cfg);
        }).catch(() => {});
        authApi.registrationConfig()
            .then(setRegistrationConfig)
            .catch(() => {});
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        if (code && ssoConfig) {
            const returnedState = params.get('state');
            const savedState = sessionStorage.getItem('oidc_state');
            if (!savedState || returnedState !== savedState) {
                setError('Invalid SSO state parameter — possible CSRF attack. Please try again.');
                window.history.replaceState({}, '', '/login');
                return;
            }
            sessionStorage.removeItem('oidc_state');

            setLoading(true);
            oidcApi.callback({
                code,
                redirect_uri: window.location.origin + '/login',
                tenant_id: ssoConfig.tenant_id,
            }).then(res => {
                setAuth(res.user, res.access_token);
                navigate(res.needs_company_setup ? '/setup-company' : '/');
            }).catch(err => {
                setError(err.message || t('auth.loginFailed'));
            }).finally(() => {
                setLoading(false);
                window.history.replaceState({}, '', '/login');
            });
        }
    }, [ssoConfig]);

    const toggleLang = () => {
        i18n.changeLanguage(i18n.language === 'zh' ? 'en' : 'zh');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            let res;
            if (isRegister) {
                res = await authApi.register({
                    ...form,
                    display_name: form.username,
                });
            } else {
                res = await authApi.login({ username: form.username, password: form.password });
            }
            setAuth(res.user, res.access_token);
            if (res.needs_company_setup) {
                navigate('/setup-company');
            } else {
                navigate('/');
            }
        } catch (err: any) {
            const msg = err.message || '';
            if (msg && msg !== 'Failed to fetch' && !msg.includes('NetworkError') && !msg.includes('ERR_CONNECTION')) {
                if (msg.includes('company has been disabled')) {
                    setError(t('auth.companyDisabled', 'Your company has been disabled. Please contact the platform administrator.'));
                } else if (msg.includes('Invalid credentials')) {
                    setError(t('auth.invalidCredentials', 'Invalid username or password.'));
                } else if (msg.includes('Account is disabled')) {
                    setError(t('auth.accountDisabled', 'Your account has been disabled.'));
                } else if (msg.includes('500') || msg.includes('Internal Server Error')) {
                    setError(t('auth.serverStarting', 'Service is starting up or experiencing issues. Please try again in a few seconds.'));
                } else {
                    setError(msg);
                }
            } else {
                setError(t('auth.serverUnreachable', 'Unable to reach server. Please check if the service is running and try again.'));
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            {/* Left: Branding Panel */}
            <div className="login-hero">
                <div className="login-hero-bg" />
                <div className="login-hero-content">
                    <div className="login-hero-badge">
                        <span className="login-hero-badge-dot" />
                        {t('login.heroBadge')}
                    </div>
                    <h1 className="login-hero-title">
                        Hive<br />
                        <span className="text-[0.65em] font-semibold opacity-85">{t('login.heroSubtitle')}</span>
                    </h1>
                    <p className="login-hero-desc">
                        {t('login.heroDesc1')}<br />
                        {t('login.heroDesc2')}
                    </p>
                    <div className="login-hero-features">
                        {[
                            { icon: '🤖', title: t('login.featureCrewTitle'), desc: t('login.featureCrewDesc') },
                            { icon: '🧠', title: t('login.featureMemoryTitle'), desc: t('login.featureMemoryDesc') },
                            { icon: '🏛️', title: t('login.featurePlazaTitle'), desc: t('login.featurePlazaDesc') },
                        ].map((f) => (
                            <div key={f.icon} className="login-hero-feature">
                                <span className="login-hero-feature-icon" aria-hidden="true">{f.icon}</span>
                                <div>
                                    <div className="login-hero-feature-title">{f.title}</div>
                                    <div className="login-hero-feature-desc">{f.desc}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Right: Form Panel */}
            <div className="login-form-panel">
                <button
                    onClick={toggleLang}
                    className="absolute top-4 right-4 z-50 flex items-center gap-1 rounded-lg border border-edge-subtle bg-surface-secondary px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-hover cursor-pointer"
                    aria-label="Switch language"
                >
                    🌐 {i18n.language === 'zh' ? 'EN' : '中文'}
                </button>

                <div className="login-form-wrapper">
                    <div className="login-form-header">
                        <div className="login-form-logo">
                            <img src="/logo-black.png" className="login-logo-img mr-2 align-middle" alt="" width={28} height={28} />
                            Hive
                        </div>
                        <h2 className="login-form-title">
                            {isRegister ? t('auth.register') : t('auth.login')}
                        </h2>
                        <p className="login-form-subtitle">
                            {isRegister ? t('auth.subtitleRegister') : t('auth.subtitleLogin')}
                        </p>
                    </div>

                    {error && (
                        <div className="login-error" role="alert">
                            <span aria-hidden="true">⚠</span> {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="login-form">
                        <div className="login-field">
                            <label htmlFor="login-username">{t('auth.username')}</label>
                            <input
                                id="login-username"
                                value={form.username}
                                onChange={(e) => setForm({ ...form, username: e.target.value })}
                                required
                                autoFocus
                                autoComplete={isRegister ? 'username' : 'username'}
                                spellCheck={false}
                                placeholder={t('auth.usernamePlaceholder') + '\u2026'}
                            />
                        </div>

                        {isRegister && (
                            <div className="login-field">
                                <label htmlFor="login-email">{t('auth.email')}</label>
                                <input
                                    id="login-email"
                                    type="email"
                                    inputMode="email"
                                    value={form.email}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                                    required
                                    autoComplete="email"
                                    spellCheck={false}
                                    placeholder={t('auth.emailPlaceholder') + '\u2026'}
                                />
                            </div>
                        )}

                        <div className="login-field">
                            <label htmlFor="login-password">{t('auth.password')}</label>
                            <input
                                id="login-password"
                                type="password"
                                value={form.password}
                                onChange={(e) => setForm({ ...form, password: e.target.value })}
                                required
                                autoComplete={isRegister ? 'new-password' : 'current-password'}
                                placeholder={t('auth.passwordPlaceholder') + '\u2026'}
                            />
                        </div>

                        <Button type="submit" disabled={loading} loading={loading} className="login-submit w-full">
                            {isRegister ? t('auth.register') : t('auth.login')}
                            {!loading && <span className="ml-1.5">→</span>}
                        </Button>
                    </form>

                    {ssoConfig && (
                        <div className="mt-4">
                            <div className="my-4 flex items-center gap-3 text-sm text-content-tertiary">
                                <div className="h-px flex-1 bg-edge-subtle" />
                                {t('auth.or')}
                                <div className="h-px flex-1 bg-edge-subtle" />
                            </div>
                            <Button
                                variant="secondary"
                                className="w-full"
                                onClick={() => {
                                    const state = crypto.randomUUID();
                                    sessionStorage.setItem('oidc_state', state);
                                    const params = new URLSearchParams({
                                        client_id: ssoConfig.client_id,
                                        response_type: 'code',
                                        redirect_uri: window.location.origin + '/login',
                                        scope: ssoConfig.scopes || 'openid profile email',
                                        state,
                                    });
                                    window.location.href = `${ssoConfig.authorization_endpoint}?${params}`;
                                }}
                            >
                                {ssoConfig.display_name || t('enterprise.sso.loginWithSSO')}
                            </Button>
                        </div>
                    )}

                    <div className="login-switch">
                        {isRegister ? t('auth.hasAccount') : t('auth.noAccount')}{' '}
                        <a href="#" onClick={(e) => { e.preventDefault(); setIsRegister(!isRegister); setError(''); }}>
                            {isRegister ? t('auth.goLogin') : t('auth.goRegister')}
                        </a>
                    </div>

                    {isRegister && registrationConfig.invitation_code_required && (
                        <p className="mt-3 text-xs leading-relaxed text-content-tertiary">
                            {t('auth.invitationRequiredHint', 'Registration is open, but joining a workspace currently requires an invitation code from an administrator.')}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
