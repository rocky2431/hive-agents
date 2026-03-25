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
                        className="py-[5px] px-2 rounded cursor-pointer text-[13px] mb-px"
                        style={{ paddingLeft: `${8 + level * 16}px`, background: selectedDept === d.id ? 'rgba(224,238,238,0.12)' : 'transparent' }}
                        onClick={() => onSelect(d.id)}
                    >
                        <span className="text-content-tertiary mr-1 text-[11px]">
                            {d.children?.length ? '\u25B8' : '\u00B7'}
                        </span>
                        {d.name}
                        {d.member_count > 0 && <span className="text-[10px] text-content-tertiary ml-1">({d.member_count})</span>}
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
            <div className="card mb-4">
                <h4 className="mb-3">{t('enterprise.org.feishuSync')}</h4>
                <p className="text-xs text-content-tertiary mb-3">
                    {t('enterprise.org.feishuSync')}
                </p>
                <div className="flex gap-3 mb-3">
                    <div className="flex-1">
                        <label className="text-xs font-medium block mb-1">App ID</label>
                        <input className="input" value={syncForm.app_id} onChange={e => setSyncForm({ ...syncForm, app_id: e.target.value })} placeholder="cli_xxxxxxxx" />
                    </div>
                    <div className="flex-1">
                        <label className="text-xs font-medium block mb-1">App Secret</label>
                        <input className="input" type="password" value={syncForm.app_secret} onChange={e => setSyncForm({ ...syncForm, app_secret: e.target.value })} placeholder={config?.value?.app_id ? '' : ''} />
                    </div>
                </div>
                <div className="flex gap-2 items-center">
                    <button className="btn btn-primary" onClick={triggerSync} disabled={syncing || !syncForm.app_id}>
                        {syncing ? t('enterprise.org.syncing') : t('enterprise.org.syncNow')}
                    </button>
                    {config?.value?.last_synced_at && (
                        <span className="text-xs text-content-tertiary">
                            Last sync: {new Date(config.value.last_synced_at).toLocaleString()}
                        </span>
                    )}
                </div>
                {syncResult && (
                    <div className={`mt-3 px-3 py-2 rounded-md text-xs ${syncResult.error ? 'bg-[rgba(255,0,0,0.1)]' : 'bg-[rgba(0,200,0,0.1)]'}`}>
                        {syncResult.error ? `${syncResult.error}` : t('enterprise.org.syncComplete', { departments: syncResult.departments, members: syncResult.members })}
                    </div>
                )}
            </div>

            <div className="card mb-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                        <h4 className="mb-1">{t('enterprise.org.createDepartment', 'Department management')}</h4>
                        <p className="text-xs text-content-tertiary">
                            {t('enterprise.org.editDepartment', 'Create, edit, and delete tenant departments that can be assigned to users.')}
                        </p>
                    </div>
                    <button className="btn btn-secondary" onClick={resetDeptForm}>
                        {t('enterprise.org.newDepartment', 'New department')}
                    </button>
                </div>

                <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-3 mb-3">
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
                                        {'\u2014 '.repeat(dept.level)}
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
                    <div className="mb-3 text-xs text-error">
                        {deptError}
                    </div>
                )}

                <div className="flex gap-2 justify-end">
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
                <h4 className="mb-3">{t('enterprise.org.orgBrowser')}</h4>
                <div className="flex gap-4">
                    <div className="w-[260px] border-r border-edge-subtle pr-4 max-h-[500px] overflow-y-auto">
                        <div className="text-xs font-semibold mb-2 text-content-secondary">{t('enterprise.org.allDepartments')}</div>
                        <div
                            className="px-2 py-1.5 rounded cursor-pointer text-[13px] mb-0.5"
                            style={{ background: !selectedDept ? 'rgba(224,238,238,0.1)' : 'transparent' }}
                            onClick={() => setSelectedDept(null)}
                        >
                            {t('common.all')}
                        </div>
                        <DeptTree departments={departments as any[]} selectedDept={selectedDept} onSelect={setSelectedDept} level={0} />
                        {departments.length === 0 && <div className="text-xs text-content-tertiary p-2">{t('common.noData')}</div>}
                    </div>

                    <div className="flex-1">
                        <input className="input mb-3 text-[13px]" placeholder={t("enterprise.org.searchMembers")} value={memberSearch} onChange={e => setMemberSearch(e.target.value)} />
                        <div className="flex flex-col gap-1 max-h-[400px] overflow-y-auto">
                            {members.map((m: any) => (
                                <div key={m.id} className="flex items-center gap-2.5 p-2 rounded-md border border-edge-subtle">
                                    <div className="w-8 h-8 rounded-full bg-[rgba(224,238,238,0.15)] flex items-center justify-center text-sm font-semibold">
                                        {m.name?.[0] || '?'}
                                    </div>
                                    <div>
                                        <div className="font-medium text-[13px]">{m.display_name || m.username}</div>
                                        <div className="text-[11px] text-content-tertiary">
                                            {m.title || '-'}
                                            {m.email && ` \u00B7 ${m.email}`}
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {members.length === 0 && <div className="text-center py-6 text-content-tertiary text-[13px]">{t('enterprise.org.noMembers')}</div>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
