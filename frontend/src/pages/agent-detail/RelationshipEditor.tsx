import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { agentApi } from '../../api/domains/agents';
import { put } from '../../api/core';
import { usersApi } from '../../api/domains/users';
import { useAuthStore } from '../../stores';

type RelationshipEditorProps = {
  agentId: string;
  agent?: any;
  readOnly?: boolean;
};

export default function RelationshipEditor({ agentId, agent }: RelationshipEditorProps) {
  const { i18n } = useTranslation();
  const isChinese = i18n.language?.startsWith('zh');
  const qc = useQueryClient();

  const tenantId = localStorage.getItem('current_tenant_id') || '';
  const { data: allAgents = [] } = useQuery({
    queryKey: ['agents', tenantId],
    queryFn: () => agentApi.list(tenantId),
  });

  const currentUser = useAuthStore((s) => s.user);
  const { data: fetchedUsers = [] } = useQuery({
    queryKey: ['users', tenantId],
    queryFn: () => usersApi.list(tenantId) as Promise<any[]>,
    enabled: !!tenantId,
  });
  // If user list is empty (member 403), at least include the current user
  const users = fetchedUsers.length > 0 ? fetchedUsers
    : currentUser ? [{ id: currentUser.id, display_name: currentUser.display_name || currentUser.username, username: currentUser.username, email: currentUser.email || '' }]
    : [];

  const peerAgents = allAgents.filter((a: any) => a.id !== agentId);

  const [binding, setBinding] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const ownerUser = agent?.owner_user_id
    ? users.find((u: any) => u.id === agent.owner_user_id)
      || (agent.owner_username ? { display_name: agent.owner_username, username: agent.owner_username, email: '' } : null)
    : null;

  const handleBind = async (userId: string) => {
    setBinding(true);
    try {
      await put(`/agents/${agentId}/owner`, { owner_user_id: userId });
      qc.invalidateQueries({ queryKey: ['agent', agentId] });
      setShowPicker(false);
    } catch (e: any) {
      alert(e.message || 'Failed');
    }
    setBinding(false);
  };

  const handleUnbind = async () => {
    if (!confirm(isChinese ? '确定解绑该员工？' : 'Unbind this employee?')) return;
    setBinding(true);
    try {
      await put(`/agents/${agentId}/owner`, { owner_user_id: null });
      qc.invalidateQueries({ queryKey: ['agent', agentId] });
    } catch (e: any) {
      alert(e.message || 'Failed');
    }
    setBinding(false);
  };

  return (
    <div>
      {/* Owner Info + Bind */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <h4 style={{ marginBottom: '8px' }}>{isChinese ? '所属员工' : 'Owner'}</h4>
        {agent?.owner_user_id && ownerUser ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600, fontSize: '14px' }}>
              {ownerUser.display_name?.charAt(0) || ownerUser.username?.charAt(0) || 'U'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 500 }}>
                {ownerUser.display_name || ownerUser.username}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                {ownerUser.email} &middot; {isChinese ? 'Token 消耗计入此员工配额' : 'Token usage counted towards this employee'}
              </div>
            </div>
            <button className="btn btn-ghost" style={{ fontSize: '12px', color: 'var(--error)' }} onClick={handleUnbind} disabled={binding}>
              {isChinese ? '解绑' : 'Unbind'}
            </button>
          </div>
        ) : agent?.owner_user_id ? (
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '8px 0' }}>
            {isChinese ? '已绑定员工' : 'Bound to employee'} (ID: {agent.owner_user_id})
            <button className="btn btn-ghost" style={{ fontSize: '12px', color: 'var(--error)', marginLeft: '8px' }} onClick={handleUnbind} disabled={binding}>
              {isChinese ? '解绑' : 'Unbind'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', flex: 1 }}>
              {isChinese ? '未绑定员工。Token 消耗计入创建者。' : 'No owner bound. Token usage counted towards creator.'}
            </div>
            <button className="btn btn-primary" style={{ fontSize: '12px', padding: '4px 12px' }} onClick={() => setShowPicker(true)} disabled={binding}>
              {isChinese ? '绑定员工' : 'Bind Employee'}
            </button>
          </div>
        )}

        {/* User picker */}
        {showPicker && (
          <div style={{ marginTop: '12px', padding: '12px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '8px' }}>
              {isChinese ? '选择员工' : 'Select Employee'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflow: 'auto' }}>
              {users.map((u: any) => (
                <button
                  key={u.id}
                  onClick={() => handleBind(u.id)}
                  disabled={binding}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px',
                    borderRadius: '4px', border: 'none', background: 'transparent', cursor: 'pointer',
                    textAlign: 'left', width: '100%', fontSize: '12px',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '10px', fontWeight: 600 }}>
                    {u.display_name?.charAt(0) || u.username?.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 500 }}>{u.display_name || u.username}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{u.email}</div>
                  </div>
                </button>
              ))}
              {users.length === 0 && (
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', padding: '8px' }}>
                  {isChinese ? '暂无员工' : 'No employees'}
                </div>
              )}
            </div>
            <button className="btn btn-ghost" style={{ fontSize: '11px', marginTop: '8px' }} onClick={() => setShowPicker(false)}>
              {isChinese ? '取消' : 'Cancel'}
            </button>
          </div>
        )}
      </div>

      {/* Peer Agents */}
      <div className="card">
        <h4 style={{ marginBottom: '4px' }}>{isChinese ? '同事（同公司数字员工）' : 'Peers (same company)'}</h4>
        <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
          {isChinese ? '关系信息会自动同步到工作区文件，数字员工可在对话中读取。' : 'Relationship data auto-syncs to workspace files.'}
        </p>
        {peerAgents.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {peerAgents.map((peer: any) => (
              <div key={peer.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px', borderRadius: '6px', background: 'var(--bg-secondary)' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {peer.name?.charAt(0) || 'A'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{peer.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{peer.role_description || (isChinese ? '无描述' : 'No description')}</div>
                </div>
                <div style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'var(--accent-muted)', color: 'var(--accent)' }}>
                  {isChinese ? '同事' : 'Peer'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', padding: '8px 0' }}>
            {isChinese ? '该公司暂无其他数字员工。' : 'No other agents in this company.'}
          </div>
        )}
      </div>
    </div>
  );
}
