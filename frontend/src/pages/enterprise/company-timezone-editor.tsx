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
        } catch (e: any) { if (import.meta.env.DEV) console.error('[EnterpriseSettings] save failed:', e?.message || e); }
        setSaving(false);
    };

    return (
        <div className="card p-4 mb-6">
            <div className="flex gap-3 items-center">
                <div className="flex-1">
                    <div className="font-medium text-[13px] mb-1">🌐 {t('enterprise.timezone.title', 'Company Timezone')}</div>
                    <div className="text-[11px] text-content-tertiary">
                        {t('enterprise.timezone.description', 'Default timezone for all agents. Agents can override individually.')}
                    </div>
                </div>
                <select
                    className="form-input w-[220px] text-[13px]"
                    value={timezone}
                    onChange={e => handleSave(e.target.value)}
                    disabled={saving}
                >
                    {COMMON_TIMEZONES.map(tz => (
                        <option key={tz} value={tz}>{tz}</option>
                    ))}
                </select>
                {saved && <span className="text-success text-xs">✅</span>}
            </div>
        </div>
    );
}
