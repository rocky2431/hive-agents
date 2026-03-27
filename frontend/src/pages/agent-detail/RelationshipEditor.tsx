import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { agentApi } from '../../api/domains/agents';
import { enterpriseApi } from '../../api/domains/enterprise';
import { relationshipsApi } from '../../api/domains/relationships';

type RelationshipEditorProps = {
  agentId: string;
  readOnly?: boolean;
};

const getRelationOptions = (t: any) => [
  { value: 'supervisor', label: t('agent.detail.supervisor') },
  { value: 'subordinate', label: t('agent.detail.subordinate') },
  { value: 'collaborator', label: t('agent.detail.collaborator') },
  { value: 'peer', label: t('agent.detail.peer') },
  { value: 'mentor', label: t('agent.detail.mentor') },
  { value: 'stakeholder', label: t('agent.detail.stakeholder') },
  { value: 'other', label: t('agent.detail.other') },
];

const getAgentRelationOptions = getRelationOptions;

export default function RelationshipEditor({ agentId, readOnly = false }: RelationshipEditorProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [adding, setAdding] = useState<any>(null);
  const [relation, setRelation] = useState('collaborator');
  const [description, setDescription] = useState('');
  const [addingAgent, setAddingAgent] = useState(false);
  const [agentRelation, setAgentRelation] = useState('collaborator');
  const [agentDescription, setAgentDescription] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRelation, setEditRelation] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [editAgentRelation, setEditAgentRelation] = useState('');
  const [editAgentDescription, setEditAgentDescription] = useState('');

  const { data: relationships = [], refetch } = useQuery({
    queryKey: ['relationships', agentId],
    queryFn: () => relationshipsApi.listHuman(agentId),
  });
  const { data: agentRelationships = [], refetch: refetchAgentRels } = useQuery({
    queryKey: ['agent-relationships', agentId],
    queryFn: () => relationshipsApi.listAgents(agentId),
  });
  const { data: allAgents = [] } = useQuery({
    queryKey: ['agents-for-rel'],
    queryFn: () => agentApi.list(),
  });
  const availableAgents = allAgents.filter((agent: any) => agent.id !== agentId);

  useEffect(() => {
    if (!search || search.length < 1) {
      setSearchResults([]);
      return;
    }
    const timeoutId = setTimeout(() => {
      enterpriseApi.getOrgMembers({ search }).then(setSearchResults);
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [search]);

  const addRelationship = async () => {
    if (!adding) return;
    const existing = relationships.map((item: any) => ({
      member_id: item.member_id,
      relation: item.relation,
      description: item.description,
    }));
    existing.push({ member_id: adding.id, relation, description });
    await relationshipsApi.saveHuman(agentId, existing);
    setAdding(null);
    setSearch('');
    setRelation('collaborator');
    setDescription('');
    refetch();
  };

  const removeRelationship = async (relationshipId: string) => {
    await relationshipsApi.removeHuman(agentId, relationshipId);
    refetch();
  };

  const startEditRelationship = (relationship: any) => {
    setEditingId(relationship.id);
    setEditRelation(relationship.relation || 'collaborator');
    setEditDescription(relationship.description || '');
  };

  const saveEditRelationship = async (targetId: string) => {
    const updated = relationships.map((item: any) => ({
      member_id: item.member_id,
      relation: item.id === targetId ? editRelation : item.relation,
      description: item.id === targetId ? editDescription : item.description,
    }));
    await relationshipsApi.saveHuman(agentId, updated);
    setEditingId(null);
    refetch();
  };

  const addAgentRelationship = async () => {
    if (!selectedAgentId) return;
    const existing = agentRelationships.map((item: any) => ({
      target_agent_id: item.target_agent_id,
      relation: item.relation,
      description: item.description,
    }));
    existing.push({ target_agent_id: selectedAgentId, relation: agentRelation, description: agentDescription });
    await relationshipsApi.saveAgents(agentId, existing);
    setAddingAgent(false);
    setSelectedAgentId('');
    setAgentRelation('collaborator');
    setAgentDescription('');
    refetchAgentRels();
  };

  const removeAgentRelationship = async (relationshipId: string) => {
    await relationshipsApi.removeAgent(agentId, relationshipId);
    refetchAgentRels();
  };

  const startEditAgentRelationship = (relationship: any) => {
    setEditingAgentId(relationship.id);
    setEditAgentRelation(relationship.relation || 'collaborator');
    setEditAgentDescription(relationship.description || '');
  };

  const saveEditAgentRelationship = async (targetId: string) => {
    const updated = agentRelationships.map((item: any) => ({
      target_agent_id: item.target_agent_id,
      relation: item.id === targetId ? editAgentRelation : item.relation,
      description: item.id === targetId ? editAgentDescription : item.description,
    }));
    await relationshipsApi.saveAgents(agentId, updated);
    setEditingAgentId(null);
    refetchAgentRels();
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: '12px' }}>
        <h4 style={{ marginBottom: '12px' }}>{t('agent.detail.humanRelationships')}</h4>
        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>{t('agent.detail.humanRelationships')}</p>
        {relationships.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
            {relationships.map((relationship: any) => (
              <div key={relationship.id} style={{ borderRadius: '8px', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(224,238,238,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 600, flexShrink: 0 }}>
                    {relationship.member?.name?.[0] || '?'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '13px' }}>
                      {relationship.member?.name || '?'} <span className="badge" style={{ fontSize: '10px', marginLeft: '4px' }}>{relationship.relation_label}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                      {relationship.member?.title || ''} · {relationship.member?.department_path || ''}
                    </div>
                    {relationship.description && editingId !== relationship.id && (
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{relationship.description}</div>
                    )}
                  </div>
                  {!readOnly && editingId !== relationship.id && (
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => startEditRelationship(relationship)}>
                        {t('common.edit', 'Edit')}
                      </button>
                      <button className="btn btn-ghost" style={{ color: 'var(--error)', fontSize: '12px' }} onClick={() => void removeRelationship(relationship.id)}>
                        {t('common.delete')}
                      </button>
                    </div>
                  )}
                </div>
                {editingId === relationship.id && (
                  <div style={{ padding: '0 10px 10px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px', marginBottom: '8px' }}>
                      <select className="input" value={editRelation} onChange={(event) => setEditRelation(event.target.value)} style={{ width: '140px', fontSize: '12px' }}>
                        {getRelationOptions(t).map((option: any) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <textarea className="input" value={editDescription} onChange={(event) => setEditDescription(event.target.value)} rows={2} style={{ fontSize: '12px', resize: 'vertical', marginBottom: '8px', width: '100%' }} placeholder={t('agent.detail.descriptionPlaceholder', 'Description...')} />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => void saveEditRelationship(relationship.id)}>
                        {t('common.save', 'Save')}
                      </button>
                      <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => setEditingId(null)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {!readOnly && !adding && (
          <div style={{ position: 'relative' }}>
            <input className="input" placeholder={t('agent.detail.searchMembers')} value={search} onChange={(event) => setSearch(event.target.value)} style={{ fontSize: '13px' }} />
            {searchResults.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '6px', marginTop: '4px', maxHeight: '200px', overflowY: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                {searchResults.map((member: any) => (
                  <div
                    key={member.id}
                    style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid var(--border-subtle)' }}
                    onClick={() => {
                      setAdding(member);
                      setSearch('');
                      setSearchResults([]);
                    }}
                    onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--bg-elevated)')}
                    onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ fontWeight: 500 }}>{member.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                      {member.title} · {member.department_path}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {!readOnly && adding && (
          <div style={{ border: '1px solid var(--accent-primary)', borderRadius: '8px', padding: '12px', background: 'var(--bg-elevated)' }}>
            <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px' }}>
              {t('agent.detail.addRelationship')}: {adding.name}{' '}
              <span style={{ fontSize: '12px', fontWeight: 400, color: 'var(--text-tertiary)' }}>
                ({adding.title} · {adding.department_path})
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <select className="input" value={relation} onChange={(event) => setRelation(event.target.value)} style={{ width: '140px', fontSize: '12px' }}>
                {getRelationOptions(t).map((option: any) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <textarea className="input" placeholder="" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} style={{ fontSize: '12px', resize: 'vertical', marginBottom: '8px' }} />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => void addRelationship()}>
                {t('common.confirm')}
              </button>
              <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => { setAdding(null); setDescription(''); }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: '12px' }}>
        <h4 style={{ marginBottom: '12px' }}>{t('agent.detail.agentRelationships')}</h4>
        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>{t('agent.detail.agentRelationships')}</p>
        {agentRelationships.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
            {agentRelationships.map((relationship: any) => (
              <div key={relationship.id} style={{ borderRadius: '8px', border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.05)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>A</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '13px' }}>
                      {relationship.target_agent?.name || '?'}{' '}
                      <span className="badge" style={{ fontSize: '10px', marginLeft: '4px', background: 'rgba(16,185,129,0.15)', color: 'rgb(16,185,129)' }}>
                        {relationship.relation_label}
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{relationship.target_agent?.role_description || 'Agent'}</div>
                    {relationship.description && editingAgentId !== relationship.id && (
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{relationship.description}</div>
                    )}
                  </div>
                  {!readOnly && editingAgentId !== relationship.id && (
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => startEditAgentRelationship(relationship)}>
                        {t('common.edit', 'Edit')}
                      </button>
                      <button className="btn btn-ghost" style={{ color: 'var(--error)', fontSize: '12px' }} onClick={() => void removeAgentRelationship(relationship.id)}>
                        {t('common.delete')}
                      </button>
                    </div>
                  )}
                </div>
                {editingAgentId === relationship.id && (
                  <div style={{ padding: '0 10px 10px', borderTop: '1px solid rgba(16,185,129,0.2)', background: 'var(--bg-elevated)' }}>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px', marginBottom: '8px' }}>
                      <select className="input" value={editAgentRelation} onChange={(event) => setEditAgentRelation(event.target.value)} style={{ width: '140px', fontSize: '12px' }}>
                        {getAgentRelationOptions(t).map((option: any) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <textarea className="input" value={editAgentDescription} onChange={(event) => setEditAgentDescription(event.target.value)} rows={2} style={{ fontSize: '12px', resize: 'vertical', marginBottom: '8px', width: '100%' }} placeholder={t('agent.detail.descriptionPlaceholder', 'Description...')} />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => void saveEditAgentRelationship(relationship.id)}>
                        {t('common.save', 'Save')}
                      </button>
                      <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => setEditingAgentId(null)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {!readOnly && !addingAgent && (
          <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => setAddingAgent(true)}>
            + {t('agent.detail.addRelationship')}
          </button>
        )}
        {!readOnly && addingAgent && (
          <div style={{ border: '1px solid rgba(16,185,129,0.5)', borderRadius: '8px', padding: '12px', background: 'var(--bg-elevated)' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <select className="input" value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)} style={{ flex: 1, minWidth: 0, fontSize: '12px' }}>
                <option value="">— Select Agent —</option>
                {availableAgents.map((agent: any) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} — {agent.role_description || 'Agent'}
                  </option>
                ))}
              </select>
              <select className="input" value={agentRelation} onChange={(event) => setAgentRelation(event.target.value)} style={{ width: '150px', flexShrink: 0, fontSize: '12px' }}>
                {getAgentRelationOptions(t).map((option: any) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <textarea className="input" placeholder="" value={agentDescription} onChange={(event) => setAgentDescription(event.target.value)} rows={2} style={{ fontSize: '12px', resize: 'vertical', marginBottom: '8px' }} />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => void addAgentRelationship()} disabled={!selectedAgentId}>
                {t('common.confirm')}
              </button>
              <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => { setAddingAgent(false); setAgentDescription(''); setSelectedAgentId(''); }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
