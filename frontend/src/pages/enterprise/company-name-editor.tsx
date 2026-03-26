import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores';
import { canEditCompanyProfile } from '@/lib/companyPermissions';
import { fetchJson } from './shared';

export function CompanyNameEditor() {
    const { t } = useTranslation();
    const user = useAuthStore((s) => s.user);
    const qc = useQueryClient();
    const tenantId = localStorage.getItem('current_tenant_id') || '';
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    if (!canEditCompanyProfile(user?.role)) return null;

    useEffect(() => {
        if (!tenantId) return;
        fetchJson<any>(`/tenants/${tenantId}`)
            .then(d => { if (d?.name) setName(d.name); })
            .catch(() => { /* non-critical: company name field stays empty if tenant fetch fails */ });
    }, [tenantId]);

    const handleSave = async () => {
        if (!tenantId || !name.trim()) return;
        setSaving(true);
        try {
            await fetchJson(`/tenants/${tenantId}`, {
                method: 'PUT', body: JSON.stringify({ name: name.trim() }),
            });
            qc.invalidateQueries({ queryKey: ['tenant-detail', tenantId] });
            qc.invalidateQueries({ queryKey: ['tenants'] });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e: any) { if (import.meta.env.DEV) console.error('[EnterpriseSettings] save failed:', e?.message || e); }
        setSaving(false);
    };

    return (
        <div className="card p-4 mb-6">
            <div className="flex gap-3 items-center">
                <input
                    className="form-input flex-1 text-sm"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={t('enterprise.companyName.placeholder', 'Enter company name')}
                    onKeyDown={e => e.key === 'Enter' && handleSave()}
                />
                <button className="btn btn-primary" onClick={handleSave} disabled={saving || !name.trim()}>
                    {saving ? t('common.loading') : t('common.save', 'Save')}
                </button>
                {saved && <span className="text-success text-xs">✅</span>}
            </div>
        </div>
    );
}


