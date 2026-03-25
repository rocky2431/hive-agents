import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { agentApi } from '@/services/api';
import { useAuthStore } from '@/stores';

export interface CollaborationPanelProps {
    agentId: string;
    agent: any;
}

export function CollaborationPanel({ agentId, agent }: CollaborationPanelProps) {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const currentUser = useAuthStore((s) => s.user);
    const isCreator = currentUser?.id === agent.creator_id;
    const [delegateTargetId, setDelegateTargetId] = useState('');
    const [delegateTitle, setDelegateTitle] = useState('');
    const [delegateDescription, setDelegateDescription] = useState('');
    const [messageTargetId, setMessageTargetId] = useState('');
    const [messageBody, setMessageBody] = useState('');
    const [messageType, setMessageType] = useState('notify');
    const [handoverUserId, setHandoverUserId] = useState('');
    const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const showNotice = (message: string, type: 'success' | 'error' = 'success') => {
        setNotice({ message, type });
        setTimeout(() => setNotice(null), 2500);
    };

    const { data: collaborators = [], isLoading: collaboratorsLoading } = useQuery({
        queryKey: ['collaborators', agentId],
        queryFn: () => agentApi.collaborators(agentId),
        enabled: !!agentId,
    });
    const { data: tenantUsers = [] } = useQuery({
        queryKey: ['agent-handover-users', agentId],
        queryFn: () => agentApi.handoverCandidates(agentId),
        enabled: isCreator,
    });

    useEffect(() => {
        if (!delegateTargetId && collaborators[0]?.id) setDelegateTargetId(collaborators[0].id);
        if (!messageTargetId && collaborators[0]?.id) setMessageTargetId(collaborators[0].id);
    }, [collaborators, delegateTargetId, messageTargetId]);

    const eligibleUsers = tenantUsers.filter((user: any) => user.id !== agent.creator_id && user.is_active);

    const delegateMutation = useMutation({
        mutationFn: () => agentApi.delegateTask(agentId, {
            to_agent_id: delegateTargetId,
            task_title: delegateTitle.trim(),
            task_description: delegateDescription.trim(),
        }),
        onSuccess: (result: any) => {
            setDelegateTitle('');
            setDelegateDescription('');
            showNotice(
                t('agentDetail.delegateSuccess', {
                    agent: result?.to_agent || collaborators.find((item: any) => item.id === delegateTargetId)?.name || '',
                }),
            );
        },
        onError: (error: any) => showNotice(error?.message || 'Delegate failed', 'error'),
    });
    const messageMutation = useMutation({
        mutationFn: () => agentApi.sendCollaborationMessage(agentId, {
            to_agent_id: messageTargetId,
            message: messageBody.trim(),
            msg_type: messageType,
        }),
        onSuccess: () => {
            setMessageBody('');
            showNotice(t('agentDetail.messageSent', 'Message sent'));
        },
        onError: (error: any) => showNotice(error?.message || 'Send failed', 'error'),
    });
    const handoverMutation = useMutation({
        mutationFn: () => agentApi.handover(agentId, handoverUserId),
        onSuccess: async (result: any) => {
            setHandoverUserId('');
            await qc.invalidateQueries({ queryKey: ['agent', agentId] });
            showNotice(
                t('agentDetail.handoverSuccess', {
                    user: result?.new_creator || eligibleUsers.find((item: any) => item.id === handoverUserId)?.display_name || '',
                }),
            );
        },
        onError: (error: any) => showNotice(error?.message || 'Handover failed', 'error'),
    });

    return (
        <div className="card" style={{ padding: '16px', marginBottom: '24px' }}>
            <div style={{ marginBottom: '12px' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                    {t('agentDetail.collaborationTitle', 'Agent Collaboration')}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    {t('agentDetail.collaborationDesc', 'Coordinate work with other digital employees in the same company.')}
                </div>
            </div>

            {notice && (
                <div
                    style={{
                        marginBottom: '12px',
                        padding: '10px 12px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        background: notice.type === 'success' ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)',
                        border: `1px solid ${notice.type === 'success' ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
                        color: notice.type === 'success' ? 'var(--success, #10b981)' : 'var(--status-error, #ef4444)',
                    }}
                >
                    {notice.message}
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 0.9fr) minmax(320px, 1.1fr)', gap: '16px' }}>
                <div>
                    <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>
                        {t('agentDetail.availableCollaborators', 'Available Collaborators')}
                    </div>
                    {collaboratorsLoading ? (
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('common.loading')}</div>
                    ) : collaborators.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {collaborators.map((collaborator: any) => (
                                <div
                                    key={collaborator.id}
                                    style={{
                                        padding: '10px 12px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--border-subtle)',
                                        background: 'var(--bg-secondary)',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                                        <div style={{ fontSize: '13px', fontWeight: 600 }}>{collaborator.name}</div>
                                        <span style={{ fontSize: '11px', color: collaborator.status === 'running' ? 'var(--success, #10b981)' : 'var(--text-tertiary)' }}>
                                            {String(t(`agent.status.${collaborator.status}`, collaborator.status))}
                                        </span>
                                    </div>
                                    {collaborator.role && (
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                            {collaborator.role}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            {t('agentDetail.noCollaborators', 'No other digital employees are available yet.')}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="card" style={{ padding: '12px', margin: 0, background: 'var(--bg-secondary)' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>
                            {t('agentDetail.delegateTask', 'Delegate Task')}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <select className="form-input" value={delegateTargetId} onChange={e => setDelegateTargetId(e.target.value)}>
                                <option value="">{t('agentDetail.targetAgent', 'Select target agent')}</option>
                                {collaborators.map((collaborator: any) => (
                                    <option key={collaborator.id} value={collaborator.id}>
                                        {collaborator.name}
                                    </option>
                                ))}
                            </select>
                            <input
                                className="form-input"
                                value={delegateTitle}
                                onChange={e => setDelegateTitle(e.target.value)}
                                placeholder={t('agentDetail.taskTitle', 'Task title')}
                            />
                            <textarea
                                className="form-input"
                                value={delegateDescription}
                                onChange={e => setDelegateDescription(e.target.value)}
                                placeholder={t('agentDetail.taskDescription', 'Task description')}
                                style={{ minHeight: '84px', resize: 'vertical' }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button
                                    className="btn btn-primary"
                                    onClick={() => delegateMutation.mutate()}
                                    disabled={!delegateTargetId || !delegateTitle.trim() || delegateMutation.isPending}
                                >
                                    {delegateMutation.isPending ? t('common.loading') : t('agentDetail.delegateTask', 'Delegate Task')}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="card" style={{ padding: '12px', margin: 0, background: 'var(--bg-secondary)' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>
                            {t('agentDetail.sendMessage', 'Send Message')}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <select className="form-input" value={messageTargetId} onChange={e => setMessageTargetId(e.target.value)}>
                                <option value="">{t('agentDetail.targetAgent', 'Select target agent')}</option>
                                {collaborators.map((collaborator: any) => (
                                    <option key={collaborator.id} value={collaborator.id}>
                                        {collaborator.name}
                                    </option>
                                ))}
                            </select>
                            <select className="form-input" value={messageType} onChange={e => setMessageType(e.target.value)}>
                                <option value="notify">{t('agentDetail.messageTypeNotify', 'Notify')}</option>
                                <option value="consult">{t('agentDetail.messageTypeConsult', 'Consult')}</option>
                            </select>
                            <textarea
                                className="form-input"
                                value={messageBody}
                                onChange={e => setMessageBody(e.target.value)}
                                placeholder={t('agentDetail.messagePlaceholder', 'Write a message to another digital employee')}
                                style={{ minHeight: '84px', resize: 'vertical' }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button
                                    className="btn btn-primary"
                                    onClick={() => messageMutation.mutate()}
                                    disabled={!messageTargetId || !messageBody.trim() || messageMutation.isPending}
                                >
                                    {messageMutation.isPending ? t('common.loading') : t('agentDetail.sendMessage', 'Send Message')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {isCreator && (
                <div className="card" style={{ padding: '12px', margin: '16px 0 0', background: 'var(--bg-secondary)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>
                        {t('agentDetail.handoverAgent', 'Transfer Ownership')}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <select className="form-input" value={handoverUserId} onChange={e => setHandoverUserId(e.target.value)}>
                            <option value="">{t('agentDetail.targetUser', 'Select target user')}</option>
                            {eligibleUsers.map((user: any) => (
                                <option key={user.id} value={user.id}>
                                    {user.display_name || user.username}
                                </option>
                            ))}
                        </select>
                        {eligibleUsers.length === 0 && (
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                {t('agentDetail.noEligibleUsers', 'No eligible users are available for transfer.')}
                            </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                className="btn"
                                onClick={() => {
                                    if (!handoverUserId) return;
                                    if (!confirm(t('agentDetail.handoverConfirm', 'Transfer this digital employee to the selected user?'))) return;
                                    handoverMutation.mutate();
                                }}
                                disabled={!handoverUserId || handoverMutation.isPending}
                            >
                                {handoverMutation.isPending ? t('common.loading') : t('agentDetail.handoverAgent', 'Transfer Ownership')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
