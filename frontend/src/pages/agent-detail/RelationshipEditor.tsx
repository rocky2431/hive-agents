import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { agentApi } from '../../api/domains/agents';

type RelationshipEditorProps = {
  agentId: string;
  agent?: any;
  readOnly?: boolean;
};

export default function RelationshipEditor({ agentId, agent, readOnly = false }: RelationshipEditorProps) {
  const { t, i18n } = useTranslation();
  const isChinese = i18n.language?.startsWith('zh');

  // Get all agents in the same tenant to show peer list
  const tenantId = localStorage.getItem('current_tenant_id') || '';
  const { data: allAgents = [] } = useQuery({
    queryKey: ['agents', tenantId],
    queryFn: () => agentApi.list(tenantId),
  });

  const peerAgents = allAgents.filter((a: any) => a.id !== agentId);

  return (
    <div>
      {/* Owner Info */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <h4 style={{ marginBottom: '8px' }}>{isChinese ? '所属员工' : 'Owner'}</h4>
        {agent?.owner_user_id ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600, fontSize: '14px' }}>
              U
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 500 }}>
                {agent.creator_username || isChinese ? '已绑定员工' : 'Bound to employee'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                {isChinese ? '该数字员工的 Token 消耗计入此员工的配额' : 'Token usage counted towards this employee\'s quota'}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', padding: '8px 0' }}>
            {isChinese ? '未绑定员工。Token 消耗计入创建者。' : 'No owner bound. Token usage counted towards creator.'}
          </div>
        )}
      </div>

      {/* Peer Agents (read-only, auto-synced) */}
      <div className="card">
        <h4 style={{ marginBottom: '4px' }}>{isChinese ? '同事（同公司数字员工）' : 'Peers (same company)'}</h4>
        <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
          {isChinese ? '关系信息会自动同步到工作区文件 relationships.md，数字员工可在对话中读取。' : 'Relationship data auto-syncs to relationships.md in the workspace.'}
        </p>

        {peerAgents.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {peerAgents.map((peer: any) => (
              <div key={peer.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px', borderRadius: '6px', background: 'var(--bg-secondary)' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {peer.name?.charAt(0) || 'A'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {peer.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {peer.role_description || (isChinese ? '无描述' : 'No description')}
                  </div>
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
