import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { agentApi, enterpriseApi, orgApi } from '@/services/api';
import { useAuthStore } from '@/stores';
import { getRelationOptions, getAgentRelationOptions } from './helpers';

export function RelationshipEditor({ agentId, readOnly = false }: { agentId: string; readOnly?: boolean }) {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const [search, setSearch] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [adding, setAdding] = useState<any>(null);
    const [relation, setRelation] = useState('collaborator');
    const [description, setDescription] = useState('');
    // Agent relationships state
    const [addingAgent, setAddingAgent] = useState(false);
    const [agentRelation, setAgentRelation] = useState('collaborator');
    const [agentDescription, setAgentDescription] = useState('');
    const [selectedAgentId, setSelectedAgentId] = useState('');
    // Editing state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editRelation, setEditRelation] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
    const [editAgentRelation, setEditAgentRelation] = useState('');
    const [editAgentDescription, setEditAgentDescription] = useState('');

    const { data: relationships = [], refetch } = useQuery({
        queryKey: ['relationships', agentId],
        queryFn: () => agentApi.listRelationships(agentId),
    });
    const { data: agentRelationships = [], refetch: refetchAgentRels } = useQuery({
        queryKey: ['agent-relationships', agentId],
        queryFn: () => agentApi.listAgentRelationships(agentId),
    });
    const relationshipTenantId = localStorage.getItem('current_tenant_id') || '';
    const { data: allAgents = [] } = useQuery({
        queryKey: ['agents-for-rel', relationshipTenantId],
        queryFn: () => agentApi.list(relationshipTenantId || undefined),
    });
    const availableAgents = allAgents.filter((a: any) => a.id !== agentId);

    useEffect(() => {
        if (!search || search.length < 1) { setSearchResults([]); return; }
        const t = setTimeout(() => {
            const params = new URLSearchParams();
            params.set('search', search);
            if (relationshipTenantId) params.set('tenant_id', relationshipTenantId);
            enterpriseApi.searchOrgMembers(Object.fromEntries(params.entries())).then(setSearchResults);
        }, 300);
        return () => clearTimeout(t);
    }, [search, relationshipTenantId]);

    const addRelationship = async () => {
        if (!adding) return;
        const existing = relationships.map((r: any) => ({ member_id: r.member_id, relation: r.relation, description: r.description }));
        existing.push({ member_id: adding.id, relation, description });
        await agentApi.updateRelationships(agentId, { relationships: existing });
        setAdding(null); setSearch(''); setRelation('collaborator'); setDescription('');
        refetch();
    };
    const removeRelationship = async (relId: string) => {
        await agentApi.deleteRelationship(agentId, relId);
        refetch();
    };
    const startEditRelationship = (r: any) => {
        setEditingId(r.id);
        setEditRelation(r.relation || 'collaborator');
        setEditDescription(r.description || '');
    };
    const saveEditRelationship = async (targetId: string) => {
        const updated = relationships.map((r: any) => ({
            member_id: r.member_id,
            relation: r.id === targetId ? editRelation : r.relation,
            description: r.id === targetId ? editDescription : r.description,
        }));
        await agentApi.updateRelationships(agentId, { relationships: updated });
        setEditingId(null);
        refetch();
    };
    const addAgentRelationship = async () => {
        if (!selectedAgentId) return;
        const existing = agentRelationships.map((r: any) => ({ target_agent_id: r.target_agent_id, relation: r.relation, description: r.description }));
        existing.push({ target_agent_id: selectedAgentId, relation: agentRelation, description: agentDescription });
        await agentApi.updateAgentRelationships(agentId, { relationships: existing });
        setAddingAgent(false); setSelectedAgentId(''); setAgentRelation('collaborator'); setAgentDescription('');
        refetchAgentRels();
    };
    const removeAgentRelationship = async (relId: string) => {
        await agentApi.deleteAgentRelationship(agentId, relId);
        refetchAgentRels();
    };
    const startEditAgentRelationship = (r: any) => {
        setEditingAgentId(r.id);
        setEditAgentRelation(r.relation || 'collaborator');
        setEditAgentDescription(r.description || '');
    };
    const saveEditAgentRelationship = async (targetId: string) => {
        const updated = agentRelationships.map((r: any) => ({
            target_agent_id: r.target_agent_id,
            relation: r.id === targetId ? editAgentRelation : r.relation,
            description: r.id === targetId ? editAgentDescription : r.description,
        }));
        await agentApi.updateAgentRelationships(agentId, { relationships: updated });
        setEditingAgentId(null);
        refetchAgentRels();
    };

    return (
        <div>
            {/* -- Human Relationships -- */}
            <div className="card mb-3">
                <h4 className="mb-3">{t('agent.detail.humanRelationships')}</h4>
                <p className="text-xs text-content-tertiary mb-3">{t('agent.detail.humanRelationships')}</p>
                {relationships.length > 0 && (
                    <div className="flex flex-col gap-1.5 mb-4">
                        {relationships.map((r: any) => (
                            <div key={r.id} className="rounded-lg border border-edge-subtle overflow-hidden">
                                <div className="flex items-center gap-2.5 p-2.5">
                                    <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center text-base font-semibold shrink-0">{r.member?.name?.[0] || '?'}</div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-semibold text-[13px]">{r.member?.name || '?'} <span className="badge text-[10px] ml-1">{r.relation_label}</span></div>
                                        <div className="text-[11px] text-content-tertiary">{r.member?.title || ''} · {r.member?.department_path || ''}</div>
                                        {r.description && editingId !== r.id && <div className="text-xs text-content-secondary mt-1">{r.description}</div>}
                                    </div>
                                    {!readOnly && editingId !== r.id && (
                                        <div className="flex gap-1 shrink-0">
                                            <button className="btn btn-ghost text-xs" onClick={() => startEditRelationship(r)}>{t('common.edit', 'Edit')}</button>
                                            <button className="btn btn-ghost text-xs text-error" onClick={() => removeRelationship(r.id)}>{t('common.delete')}</button>
                                        </div>
                                    )}
                                </div>
                                {editingId === r.id && (
                                    <div className="px-2.5 pb-2.5 border-t border-edge-subtle bg-surface-elevated">
                                        <div className="flex gap-2 mt-2 mb-2">
                                            <select className="input w-[140px] text-xs" value={editRelation} onChange={e => setEditRelation(e.target.value)}>
                                                {getRelationOptions(t).map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </div>
                                        <textarea className="input text-xs resize-y mb-2 w-full" value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={2} placeholder={t('agent.detail.descriptionPlaceholder', 'Description...')} />
                                        <div className="flex gap-2">
                                            <button className="btn btn-primary text-xs" onClick={() => saveEditRelationship(r.id)}>{t('common.save', 'Save')}</button>
                                            <button className="btn btn-secondary text-xs" onClick={() => setEditingId(null)}>{t('common.cancel')}</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                {!readOnly && !adding && (
                    <div className="relative">
                        <input className="input text-[13px]" placeholder={t("agent.detail.searchMembers")} value={search} onChange={e => setSearch(e.target.value)} aria-label={t("agent.detail.searchMembers")} />
                        {searchResults.length > 0 && (
                            <div className="absolute top-full left-0 right-0 bg-surface-primary border border-edge-subtle rounded-md mt-1 max-h-[200px] overflow-y-auto z-10 shadow-lg">
                                {searchResults.map((m: any) => (
                                    <button key={m.id} type="button" className="px-3 py-2 cursor-pointer text-[13px] border-b border-edge-subtle hover:bg-surface-elevated w-full text-left bg-transparent border-x-0 border-t-0"
                                        onClick={() => { setAdding(m); setSearch(''); setSearchResults([]); }}>
                                        <div className="font-medium">{m.name}</div>
                                        <div className="text-[11px] text-content-tertiary">{m.title} · {m.department_path}</div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {!readOnly && adding && (
                    <div className="border border-accent-primary rounded-lg p-3 bg-surface-elevated">
                        <div className="font-semibold text-sm mb-2">{t('agent.detail.addRelationship')}: {adding.name} <span className="text-xs font-normal text-content-tertiary">({adding.title} · {adding.department_path})</span></div>
                        <div className="flex gap-2 mb-2">
                            <select className="input w-[140px] text-xs" value={relation} onChange={e => setRelation(e.target.value)}>
                                {getRelationOptions(t).map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </div>
                        <textarea className="input text-xs resize-y mb-2" placeholder="" value={description} onChange={e => setDescription(e.target.value)} rows={2} />
                        <div className="flex gap-2">
                            <button className="btn btn-primary text-xs" onClick={addRelationship}>{t('common.confirm')}</button>
                            <button className="btn btn-secondary text-xs" onClick={() => { setAdding(null); setDescription(''); }}>{t('common.cancel')}</button>
                        </div>
                    </div>
                )}
            </div>
            {/* -- Agent-to-Agent Relationships -- */}
            <div className="card mb-3">
                <h4 className="mb-3">{t('agent.detail.agentRelationships')}</h4>
                <p className="text-xs text-content-tertiary mb-3">{t('agent.detail.agentRelationships')}</p>
                {agentRelationships.length > 0 && (
                    <div className="flex flex-col gap-1.5 mb-4">
                        {agentRelationships.map((r: any) => (
                            <div key={r.id} className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 overflow-hidden">
                                <div className="flex items-center gap-2.5 p-2.5">
                                    <div className="w-9 h-9 rounded-full bg-emerald-500/15 flex items-center justify-center text-base shrink-0">A</div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-semibold text-[13px]">{r.target_agent?.name || '?'} <span className="badge text-[10px] ml-1 bg-emerald-500/15 text-emerald-500">{r.relation_label}</span></div>
                                        <div className="text-[11px] text-content-tertiary">{r.target_agent?.role_description || 'Agent'}</div>
                                        {r.description && editingAgentId !== r.id && <div className="text-xs text-content-secondary mt-1">{r.description}</div>}
                                    </div>
                                    {!readOnly && editingAgentId !== r.id && (
                                        <div className="flex gap-1 shrink-0">
                                            <button className="btn btn-ghost text-xs" onClick={() => startEditAgentRelationship(r)}>{t('common.edit', 'Edit')}</button>
                                            <button className="btn btn-ghost text-xs text-error" onClick={() => removeAgentRelationship(r.id)}>{t('common.delete')}</button>
                                        </div>
                                    )}
                                </div>
                                {editingAgentId === r.id && (
                                    <div className="px-2.5 pb-2.5 border-t border-emerald-500/20 bg-surface-elevated">
                                        <div className="flex gap-2 mt-2 mb-2">
                                            <select className="input w-[140px] text-xs" value={editAgentRelation} onChange={e => setEditAgentRelation(e.target.value)}>
                                                {getAgentRelationOptions(t).map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </div>
                                        <textarea className="input text-xs resize-y mb-2 w-full" value={editAgentDescription} onChange={e => setEditAgentDescription(e.target.value)} rows={2} placeholder={t('agent.detail.descriptionPlaceholder', 'Description...')} />
                                        <div className="flex gap-2">
                                            <button className="btn btn-primary text-xs" onClick={() => saveEditAgentRelationship(r.id)}>{t('common.save', 'Save')}</button>
                                            <button className="btn btn-secondary text-xs" onClick={() => setEditingAgentId(null)}>{t('common.cancel')}</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                {!readOnly && !addingAgent && (
                    <button className="btn btn-secondary text-xs" onClick={() => setAddingAgent(true)}>+ {t('agent.detail.addRelationship')}</button>
                )}
                {!readOnly && addingAgent && (
                    <div className="border border-emerald-500/50 rounded-lg p-3 bg-surface-elevated">
                        <div className="flex gap-2 mb-2">
                            <select className="input flex-1 text-xs" value={selectedAgentId} onChange={e => setSelectedAgentId(e.target.value)}>
                                <option value="">— Select —</option>
                                {availableAgents.map((a: any) => <option key={a.id} value={a.id}>{a.name} — {a.role_description || 'Agent'}</option>)}
                            </select>
                            <select className="input w-[140px] text-xs" value={agentRelation} onChange={e => setAgentRelation(e.target.value)}>
                                {getAgentRelationOptions(t).map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </div>
                        <textarea className="input text-xs resize-y mb-2" placeholder="" value={agentDescription} onChange={e => setAgentDescription(e.target.value)} rows={2} />
                        <div className="flex gap-2">
                            <button className="btn btn-primary text-xs" onClick={addAgentRelationship} disabled={!selectedAgentId}>{t('common.confirm')}</button>
                            <button className="btn btn-secondary text-xs" onClick={() => { setAddingAgent(false); setAgentDescription(''); setSelectedAgentId(''); }}>{t('common.cancel')}</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
