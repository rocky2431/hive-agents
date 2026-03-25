import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores';
import { authApi, oidcApi } from '../services/api';

export default function Login() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const setAuth = useAuthStore((s) => s.setAuth);
    const [isRegister, setIsRegister] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const [ssoConfig, setSsoConfig] = useState<any>(null);

    const [form, setForm] = useState({
        username: '',
        password: '',
        email: '',
    });

    // Login page always uses dark theme (hero panel is dark)
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
    }, []);

    // Fetch SSO config on mount
    useEffect(() => {
        oidcApi.config().then(cfg => {
            if (cfg.configured) setSsoConfig(cfg);
        }).catch(() => { /* non-critical: SSO button hidden if config unavailable */ });
    }, []);

    // Handle OIDC callback — check URL for ?code= parameter with CSRF state verification
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        if (code && ssoConfig) {
            // Verify OIDC state parameter to prevent CSRF
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
            // Redirect to company setup if user has no company assigned
            if (res.needs_company_setup) {
                navigate('/setup-company');
            } else {
                navigate('/');
            }
        } catch (err: any) {
            const msg = err.message || '';
            // Server-returned error messages (e.g. disabled company, invalid credentials)
            if (msg && msg !== 'Failed to fetch' && !msg.includes('NetworkError') && !msg.includes('ERR_CONNECTION')) {
                // Translate known error messages
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
            {/* ── Left: Branding Panel ── */}
            <div className="login-hero">
                <div className="login-hero-bg" />
                <div className="login-hero-content">
                    <div className="login-hero-badge">
                        <span className="login-hero-badge-dot" />
                        {t('login.heroBadge')}
                    </div>
                    <h1 className="login-hero-title">
                        Clawith<br />
                        <span style={{ fontSize: '0.65em', fontWeight: 600, opacity: 0.85 }}>{t('login.heroSubtitle')}</span>
                    </h1>
                    <p className="login-hero-desc">
                        {t('login.heroDesc1')}<br />
                        {t('login.heroDesc2')}
                    </p>
                    <div className="login-hero-features">
                        <div className="login-hero-feature">
                            <span className="login-hero-feature-icon">🤖</span>
                            <div>
                                <div className="login-hero-feature-title">{t('login.featureCrewTitle')}</div>
                                <div className="login-hero-feature-desc">{t('login.featureCrewDesc')}</div>
                            </div>
                        </div>
                        <div className="login-hero-feature">
                            <span className="login-hero-feature-icon">🧠</span>
                            <div>
                                <div className="login-hero-feature-title">{t('login.featureMemoryTitle')}</div>
                                <div className="login-hero-feature-desc">{t('login.featureMemoryDesc')}</div>
                            </div>
                        </div>
                        <div className="login-hero-feature">
                            <span className="login-hero-feature-icon">🏛️</span>
                            <div>
                                <div className="login-hero-feature-title">{t('login.featurePlazaTitle')}</div>
                                <div className="login-hero-feature-desc">{t('login.featurePlazaDesc')}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Right: Form Panel ── */}
            <div className="login-form-panel">
                {/* Language Switcher */}
                <div style={{
                    position: 'absolute', top: '16px', right: '16px',
                    cursor: 'pointer', fontSize: '13px', color: 'var(--text-secondary)',
                    display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '6px 12px', borderRadius: '8px',
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                    zIndex: 101,
                }} onClick={toggleLang}>
                    🌐 {i18n.language === 'zh' ? 'EN' : '中文'}
                </div>

                <div className="login-form-wrapper">
                    <div className="login-form-header">
                        <div className="login-form-logo"><img src="/logo-black.png" className="login-logo-img" alt="" style={{ width: 28, height: 28, marginRight: 8, verticalAlign: 'middle' }} />Clawith</div>
                        <h2 className="login-form-title">
                            {isRegister ? t('auth.register') : t('auth.login')}
                        </h2>
                        <p className="login-form-subtitle">
                            {isRegister ? t('auth.subtitleRegister') : t('auth.subtitleLogin')}
                        </p>
                    </div>

                    {error && (
                        <div className="login-error">
                            <span>⚠</span> {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="login-form">
                        <div className="login-field">
                            <label>{t('auth.username')}</label>
                            <input
                                value={form.username}
                                onChange={(e) => setForm({ ...form, username: e.target.value })}
                                required
                                autoFocus
                                placeholder={t('auth.usernamePlaceholder')}
                            />
                        </div>

                        {isRegister && (
                            <div className="login-field">
                                <label>{t('auth.email')}</label>
                                <input
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                                    required
                                    placeholder={t('auth.emailPlaceholder')}
                                />
                            </div>
                        )}

                        <div className="login-field">
                            <label>{t('auth.password')}</label>
                            <input
                                type="password"
                                value={form.password}
                                onChange={(e) => setForm({ ...form, password: e.target.value })}
                                required
                                placeholder={t('auth.passwordPlaceholder')}
                            />
                        </div>

                        <button className="login-submit" type="submit" disabled={loading}>
                            {loading ? (
                                <span className="login-spinner" />
                            ) : (
                                <>
                                    {isRegister ? t('auth.register') : t('auth.login')}
                                    <span style={{ marginLeft: '6px' }}>→</span>
                                </>
                            )}
                        </button>
                    </form>

                    {ssoConfig && (
                        <div style={{ marginTop: '16px' }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: '12px',
                                margin: '16px 0', color: 'var(--text-tertiary)', fontSize: '13px',
                            }}>
                                <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
                                {t('auth.or')}
                                <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
                            </div>
                            <button
                                type="button"
                                className="login-submit"
                                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
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
                            </button>
                        </div>
                    )}

                    <div className="login-switch">
                        {isRegister ? t('auth.hasAccount') : t('auth.noAccount')}{' '}
                        <a href="#" onClick={(e) => { e.preventDefault(); setIsRegister(!isRegister); setError(''); }}>
                            {isRegister ? t('auth.goLogin') : t('auth.goRegister')}
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}
