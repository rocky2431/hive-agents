import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores';
import { canEditCompanyProfile } from '@/lib/companyPermissions';
import { fetchJson } from './shared';

const COMMON_TIMEZONES = [
    'UTC',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Asia/Singapore',
    'Asia/Kolkata',
    'Asia/Dubai',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Moscow',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'Australia/Sydney',
    'Pacific/Auckland',
];

export function CompanyTimezoneEditor() {
    const { t } = useTranslation();
    const user = useAuthStore((s) => s.user);
    const qc = useQueryClient();
    const tenantId = localStorage.getItem('current_tenant_id') || '';
    const [timezone, setTimezone] = useState('UTC');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    if (!canEditCompanyProfile(user?.role)) return null;

    useEffect(() => {
        if (!tenantId) return;
        fetchJson<any>(`/tenants/${tenantId}`)
            .then(d => { if (d?.timezone) setTimezone(d.timezone); })
            .catch(() => { /* non-critical: timezone picker defaults to UTC if tenant fetch fails */ });
    }, [tenantId]);

    const handleSave = async (tz: string) => {
        if (!tenantId) return;
        setTimezone(tz);
        setSaving(true);
        try {
            await fetchJson(`/tenants/${tenantId}`, {
                method: 'PUT', body: JSON.stringify({ timezone: tz }),
            });
            qc.invalidateQueries({ queryKey: ['tenant-detail', tenantId] });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e: any) { console.error('[EnterpriseSettings] save failed:', e?.message || e); }
        setSaving(false);
    };

    return (
        <div className="card" style={{ padding: '16px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: '13px', marginBottom: '4px' }}>🌐 {t('enterprise.timezone.title', 'Company Timezone')}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        {t('enterprise.timezone.description', 'Default timezone for all agents. Agents can override individually.')}
                    </div>
                </div>
                <select
                    className="form-input"
                    value={timezone}
                    onChange={e => handleSave(e.target.value)}
                    style={{ width: '220px', fontSize: '13px' }}
                    disabled={saving}
                >
                    {COMMON_TIMEZONES.map(tz => (
                        <option key={tz} value={tz}>{tz}</option>
                    ))}
                </select>
                {saved && <span style={{ color: 'var(--success)', fontSize: '12px' }}>✅</span>}
            </div>
        </div>
    );
}
