import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { enterpriseApi, orgApi } from '../../services/api';
import { fetchJson } from './shared';

// ─── Department Tree ───────────────────────────────
function DeptTree({ departments, selectedDept, onSelect, level }: {
    departments: any[];
    selectedDept: string | null;
    onSelect: (id: string | null) => void;
    level: number;
}) {
    if (departments.length === 0) return null;
    return (
        <>
            {departments.map((d: any) => (
                <div key={d.id}>
                    <div
                        style={{
                            padding: '5px 8px', paddingLeft: `${8 + level * 16}px`, borderRadius: '4px',
                            cursor: 'pointer', fontSize: '13px', marginBottom: '1px',
                            background: selectedDept === d.id ? 'rgba(224,238,238,0.12)' : 'transparent',
                        }}
                        onClick={() => onSelect(d.id)}
                    >
                        <span style={{ color: 'var(--text-tertiary)', marginRight: '4px', fontSize: '11px' }}>
                            {d.children?.length ? '▸' : '·'}
                        </span>
                        {d.name}
                        {d.member_count > 0 && <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginLeft: '4px' }}>({d.member_count})</span>}
                    </div>
                    {d.children?.length > 0 && (
                        <DeptTree departments={d.children} selectedDept={selectedDept} onSelect={onSelect} level={level + 1} />
                    )}
                </div>
            ))}
        </>
    );
}

// ─── Org Structure Tab ─────────────────────────────
export default function OrgTab({ tenantId }: { tenantId?: string }) {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const currentTenantId = tenantId || localStorage.getItem('current_tenant_id') || '';
    const [syncForm, setSyncForm] = useState({ app_id: '', app_secret: '' });
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<any>(null);
    const [memberSearch, setMemberSearch] = useState('');
    const [selectedDept, setSelectedDept] = useState<string | null>(null);
    const [deptForm, setDeptForm] = useState({ name: '', parent_id: '', manager_id: '' });
    const [deptSaving, setDeptSaving] = useState(false);
    const [deptDeleting, setDeptDeleting] = useState(false);
    const [deptError, setDeptError] = useState('');

    const { data: config } = useQuery({
        queryKey: ['system-settings', 'feishu_org_sync', currentTenantId],
        queryFn: () => enterpriseApi.getSystemSetting('feishu_org_sync', currentTenantId || undefined),
    });

    useEffect(() => {
        if (config?.value?.app_id) {
            setSyncForm({ app_id: config.value.app_id, app_secret: '' });
        }
    }, [config]);

    const { data: departments = [] } = useQuery({
        queryKey: ['org-departments', currentTenantId],
        queryFn: () => orgApi.listDepartments(currentTenantId || undefined),
    });
    const { data: allUsers = [] } = useQuery({
        queryKey: ['org-users', currentTenantId],
        queryFn: () => {
            const params: Record<string, string> = {};
            if (currentTenantId) params.tenant_id = currentTenantId;
            return orgApi.listUsers(params);
        },
        enabled: !!currentTenantId,
    });

    const flatDepartments = useMemo(() => {
        const flattened: any[] = [];
        const walk = (items: any[], level = 0) => {
            items.forEach((item) => {
                flattened.push({ ...item, level });
                if (item.children?.length) walk(item.children, level + 1);
            });
        };
        walk(departments as any[]);
        return flattened;
    }, [departments]);

    const tenantUsers = useMemo(() => {
        if (!selectedDept) return allUsers;
        return (allUsers as any[]).filter((member: any) => member.department_id === selectedDept);
    }, [allUsers, selectedDept]);

    const members = useMemo(() => {
        if (!memberSearch.trim()) return tenantUsers;
        const query = memberSearch.trim().toLowerCase();
        return (tenantUsers as any[]).filter((member: any) =>
            [member.display_name, member.username, member.email, member.title]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(query)),
        );
    }, [memberSearch, tenantUsers]);

    useEffect(() => {
        if (!selectedDept) {
            setDeptForm({ name: '', parent_id: '', manager_id: '' });
            return;
        }
        const dept = flatDepartments.find((item) => item.id === selectedDept);
        if (!dept) return;
        setDeptForm({
            name: dept.name || '',
            parent_id: dept.parent_id || '',
            manager_id: dept.manager_id || '',
        });
    }, [flatDepartments, selectedDept]);

    const saveConfig = async () => {
        await fetchJson(`/enterprise/system-settings/feishu_org_sync${currentTenantId ? `?tenant_id=${currentTenantId}` : ''}`, {
            method: 'PUT',
            body: JSON.stringify({ value: { app_id: syncForm.app_id, app_secret: syncForm.app_secret } }),
        });
        qc.invalidateQueries({ queryKey: ['system-settings', 'feishu_org_sync', currentTenantId] });
    };

    const triggerSync = async () => {
        setSyncing(true);
        setSyncResult(null);
        try {
            if (syncForm.app_secret) await saveConfig();
            const result = await fetchJson<any>(`/enterprise/org/sync${currentTenantId ? `?tenant_id=${currentTenantId}` : ''}`, { method: 'POST' });
            setSyncResult(result);
            qc.invalidateQueries({ queryKey: ['org-departments'] });
            qc.invalidateQueries({ queryKey: ['org-members'] });
        } catch (e: any) {
            setSyncResult({ error: e.message });
        }
        setSyncing(false);
    };

    const resetDeptForm = () => {
        setSelectedDept(null);
        setDeptForm({ name: '', parent_id: '', manager_id: '' });
        setDeptError('');
    };

    const saveDepartment = async () => {
        if (!deptForm.name.trim()) {
            setDeptError(t('enterprise.org.departmentNameRequired', 'Department name is required.'));
            return;
        }
        setDeptSaving(true);
        setDeptError('');
        const payload = {
            name: deptForm.name.trim(),
            parent_id: deptForm.parent_id || null,
            manager_id: deptForm.manager_id || null,
        };
        try {
            if (selectedDept) {
                await orgApi.updateDepartment(selectedDept, payload, currentTenantId || undefined);
            } else {
                await orgApi.createDepartment(payload, currentTenantId || undefined);
            }
            await qc.invalidateQueries({ queryKey: ['org-departments', currentTenantId] });
            await qc.invalidateQueries({ queryKey: ['org-users'] });
            resetDeptForm();
        } catch (e: any) {
            setDeptError(e.message || 'Failed to save department');
        } finally {
            setDeptSaving(false);
        }
    };

    const deleteDepartment = async () => {
        if (!selectedDept) return;
        if (!confirm(t('enterprise.org.deleteDepartmentConfirm', 'Delete this department?'))) return;
        setDeptDeleting(true);
        setDeptError('');
        try {
            await orgApi.deleteDepartment(selectedDept, currentTenantId || undefined);
            await qc.invalidateQueries({ queryKey: ['org-departments', currentTenantId] });
            await qc.invalidateQueries({ queryKey: ['org-users'] });
            resetDeptForm();
        } catch (e: any) {
            setDeptError(e.message || 'Failed to delete department');
        } finally {
            setDeptDeleting(false);
        }
    };

    return (
        <div>
            {/* Sync Config */}
            <div className="card" style={{ marginBottom: '16px' }}>
                <h4 style={{ marginBottom: '12px' }}>{t('enterprise.org.feishuSync')}</h4>
                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                    {t('enterprise.org.feishuSync')}
                </p>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>App ID</label>
                        <input className="input" value={syncForm.app_id} onChange={e => setSyncForm({ ...syncForm, app_id: e.target.value })} placeholder="cli_xxxxxxxx" />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>App Secret</label>
                        <input className="input" type="password" value={syncForm.app_secret} onChange={e => setSyncForm({ ...syncForm, app_secret: e.target.value })} placeholder={config?.value?.app_id ? '' : ''} />
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button className="btn btn-primary" onClick={triggerSync} disabled={syncing || !syncForm.app_id}>
                        {syncing ? t('enterprise.org.syncing') : t('enterprise.org.syncNow')}
                    </button>
                    {config?.value?.last_synced_at && (
                        <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            Last sync: {new Date(config.value.last_synced_at).toLocaleString()}
                        </span>
                    )}
                </div>
                {syncResult && (
                    <div style={{ marginTop: '12px', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', background: syncResult.error ? 'rgba(255,0,0,0.1)' : 'rgba(0,200,0,0.1)' }}>
                        {syncResult.error ? `${syncResult.error}` : t('enterprise.org.syncComplete', { departments: syncResult.departments, members: syncResult.members })}
                    </div>
                )}
            </div>

            <div className="card" style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
                    <div>
                        <h4 style={{ marginBottom: '4px' }}>{t('enterprise.org.createDepartment', 'Department management')}</h4>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            {t('enterprise.org.editDepartment', 'Create, edit, and delete tenant departments that can be assigned to users.')}
                        </p>
                    </div>
                    <button className="btn btn-secondary" onClick={resetDeptForm}>
                        {t('enterprise.org.newDepartment', 'New department')}
                    </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <div>
                        <label className="form-label">{t('enterprise.org.departmentName', 'Department name')}</label>
                        <input
                            className="form-input"
                            value={deptForm.name}
                            onChange={(e) => setDeptForm((prev) => ({ ...prev, name: e.target.value }))}
                            placeholder={t('enterprise.org.departmentNamePlaceholder', 'e.g. Operations')}
                        />
                    </div>
                    <div>
                        <label className="form-label">{t('enterprise.org.parentDepartment', 'Parent department')}</label>
                        <select
                            className="form-input"
                            value={deptForm.parent_id}
                            onChange={(e) => setDeptForm((prev) => ({ ...prev, parent_id: e.target.value }))}
                        >
                            <option value="">{t('enterprise.org.noParent', 'No parent')}</option>
                            {flatDepartments
                                .filter((dept) => dept.id !== selectedDept)
                                .map((dept) => (
                                    <option key={dept.id} value={dept.id}>
                                        {'— '.repeat(dept.level)}
                                        {dept.name}
                                    </option>
                                ))}
                        </select>
                    </div>
                    <div>
                        <label className="form-label">{t('enterprise.org.manager', 'Manager')}</label>
                        <select
                            className="form-input"
                            value={deptForm.manager_id}
                            onChange={(e) => setDeptForm((prev) => ({ ...prev, manager_id: e.target.value }))}
                        >
                            <option value="">{t('enterprise.org.noManager', 'Unassigned')}</option>
                            {(allUsers as any[]).map((user: any) => (
                                <option key={user.id} value={user.id}>
                                    {user.display_name || user.username}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {deptError && (
                    <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--error)' }}>
                        {deptError}
                    </div>
                )}

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    {selectedDept && (
                        <button className="btn btn-danger" onClick={deleteDepartment} disabled={deptDeleting}>
                            {deptDeleting ? t('common.loading') : t('common.delete', 'Delete')}
                        </button>
                    )}
                    <button className="btn btn-primary" onClick={saveDepartment} disabled={deptSaving}>
                        {deptSaving ? t('common.loading') : t(selectedDept ? 'common.save' : 'enterprise.org.createDepartment', selectedDept ? 'Save' : 'Create department')}
                    </button>
                </div>
            </div>

            {/* Department & Members Browser */}
            <div className="card">
                <h4 style={{ marginBottom: '12px' }}>{t('enterprise.org.orgBrowser')}</h4>
                <div style={{ display: 'flex', gap: '16px' }}>
                    <div style={{ width: '260px', borderRight: '1px solid var(--border-subtle)', paddingRight: '16px', maxHeight: '500px', overflowY: 'auto' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>{t('enterprise.org.allDepartments')}</div>
                        <div
                            style={{ padding: '6px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', marginBottom: '2px', background: !selectedDept ? 'rgba(224,238,238,0.1)' : 'transparent' }}
                            onClick={() => setSelectedDept(null)}
                        >
                            {t('common.all')}
                        </div>
                        <DeptTree departments={departments as any[]} selectedDept={selectedDept} onSelect={setSelectedDept} level={0} />
                        {departments.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', padding: '8px' }}>{t('common.noData')}</div>}
                    </div>

                    <div style={{ flex: 1 }}>
                        <input className="input" placeholder={t("enterprise.org.searchMembers")} value={memberSearch} onChange={e => setMemberSearch(e.target.value)} style={{ marginBottom: '12px', fontSize: '13px' }} />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '400px', overflowY: 'auto' }}>
                            {members.map((m: any) => (
                                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(224,238,238,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 600 }}>
                                        {m.name?.[0] || '?'}
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 500, fontSize: '13px' }}>{m.display_name || m.username}</div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                            {m.title || '-'}
                                            {m.email && ` · ${m.email}`}
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {members.length === 0 && <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-tertiary)', fontSize: '13px' }}>{t('enterprise.org.noMembers')}</div>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
