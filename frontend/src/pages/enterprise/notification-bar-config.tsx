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
        } catch (e: any) { if (import.meta.env.DEV) console.error('[EnterpriseSettings] save failed:', e?.message || e); }
        setSaving(false);
    };

    return (
        <div className="mb-6">
            <h3 className="mb-2">{t('enterprise.notificationBar.title', 'Notification Bar')}</h3>
            <p className="text-xs text-content-tertiary mb-3">
                {t('enterprise.notificationBar.description', 'Display a notification bar at the top of the page, visible to all users.')}
            </p>
            <div className="card p-4">
                <div className="flex items-center gap-3 mb-3">
                    <label className="flex items-center gap-2 cursor-pointer text-[13px] font-medium">
                        <input
                            type="checkbox"
                            checked={enabled}
                            onChange={e => setEnabled(e.target.checked)}
                            className="w-4 h-4 cursor-pointer"
                        />
                        {t('enterprise.notificationBar.enabled', 'Enable notification bar')}
                    </label>
                </div>
                <div className="mb-3">
                    <label className="form-label">{t('enterprise.notificationBar.text', 'Notification text')}</label>
                    <input
                        className="form-input text-[13px]"
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder={t('enterprise.notificationBar.textPlaceholder', 'e.g. 🎉 v2.1 released with new features!')}
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
                    const barStyle = (bg: string, fg: string): React.CSSProperties => ({
                        background: bg, color: fg,
                    });
                    return (
                        <div className="mb-3">
                            <div className="text-[11px] text-content-tertiary mb-1.5">
                                {t('enterprise.notificationBar.preview', 'Preview')}:
                            </div>
                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <div className="text-[10px] text-content-tertiary mb-[3px]">🌙 Dark</div>
                                    <div className="h-8 rounded-md flex items-center justify-center text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap" style={barStyle(darkAccent, darkText)}>
                                        <span className="max-w-[calc(100%-20px)] overflow-hidden text-ellipsis whitespace-nowrap">{text}</span>
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <div className="text-[10px] text-content-tertiary mb-[3px]">☀️ Light</div>
                                    <div className="h-8 rounded-md flex items-center justify-center text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap" style={barStyle(lightAccent, lightText)}>
                                        <span className="max-w-[calc(100%-20px)] overflow-hidden text-ellipsis whitespace-nowrap">{text}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })()}
                <div className="flex gap-2 items-center">
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? t('common.loading') : t('common.save', 'Save')}
                    </button>
                    {saved && <span className="text-success text-xs">✅ {t('enterprise.config.saved', 'Saved')}</span>}
                </div>
            </div>
        </div>
    );
}


