import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { enterpriseApi } from '@/services/api';
import { getSavedAccentColor } from '@/utils/theme';
import { fetchJson } from './shared';

export function NotificationBarConfig() {
    const { t } = useTranslation();
    const [enabled, setEnabled] = useState(false);
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        fetchJson<any>('/enterprise/system-settings/notification_bar')
            .then(d => {
                if (d?.value) {
                    setEnabled(!!d.value.enabled);
                    setText(d.value.text || '');
                }
            })
            .catch(() => { /* non-critical: notification bar settings default to disabled */ });
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await fetchJson('/enterprise/system-settings/notification_bar', {
                method: 'PUT',
                body: JSON.stringify({ value: { enabled, text } }),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e: any) { console.error('[EnterpriseSettings] save failed:', e?.message || e); }
        setSaving(false);
    };

    return (
        <div style={{ marginBottom: '24px' }}>
            <h3 style={{ marginBottom: '8px' }}>{t('enterprise.notificationBar.title', 'Notification Bar')}</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                {t('enterprise.notificationBar.description', 'Display a notification bar at the top of the page, visible to all users.')}
            </p>
            <div className="card" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>
                        <input
                            type="checkbox"
                            checked={enabled}
                            onChange={e => setEnabled(e.target.checked)}
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                        />
                        {t('enterprise.notificationBar.enabled', 'Enable notification bar')}
                    </label>
                </div>
                <div style={{ marginBottom: '12px' }}>
                    <label className="form-label">{t('enterprise.notificationBar.text', 'Notification text')}</label>
                    <input
                        className="form-input"
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder={t('enterprise.notificationBar.textPlaceholder', 'e.g. 🎉 v2.1 released with new features!')}
                        style={{ fontSize: '13px' }}
                    />
                </div>
                {/* Live preview — both themes */}
                {enabled && text && (() => {
                    // Read current accent color or default per theme
                    const savedAccent = getSavedAccentColor();
                    const darkAccent = savedAccent || '#e1e1e8';
                    const lightAccent = savedAccent || '#3a3a42';
                    // Compute text color via luminance
                    const hexLum = (hex: string) => {
                        const h = hex.replace('#', '');
                        const r = parseInt(h.substring(0, 2), 16) / 255;
                        const g = parseInt(h.substring(2, 4), 16) / 255;
                        const b = parseInt(h.substring(4, 6), 16) / 255;
                        return 0.299 * r + 0.587 * g + 0.114 * b;
                    };
                    const darkText = '#ffffff';
                    const lightText = '#ffffff';
                    const barStyle = (bg: string, fg: string) => ({
                        height: '32px', borderRadius: '6px', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: '12px', fontWeight: 500, background: bg, color: fg,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    });
                    return (
                        <div style={{ marginBottom: '12px' }}>
                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>
                                {t('enterprise.notificationBar.preview', 'Preview')}:
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '3px' }}>🌙 Dark</div>
                                    <div style={barStyle(darkAccent, darkText)}>
                                        <span style={{ maxWidth: 'calc(100% - 20px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
                                    </div>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '3px' }}>☀️ Light</div>
                                    <div style={barStyle(lightAccent, lightText)}>
                                        <span style={{ maxWidth: 'calc(100% - 20px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })()}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? t('common.loading') : t('common.save', 'Save')}
                    </button>
                    {saved && <span style={{ color: 'var(--success)', fontSize: '12px' }}>✅ {t('enterprise.config.saved', 'Saved')}</span>}
                </div>
            </div>
        </div>
    );
}


