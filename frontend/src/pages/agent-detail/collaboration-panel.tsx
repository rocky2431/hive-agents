import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { agentApi } from '@/services/api';
import { useAuthStore } from '@/stores';
import { cn } from '@/lib/cn';

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
        <div className="card p-4 mb-6">
            <div className="mb-3">
                <div className="font-semibold text-sm mb-1">
                    {t('agentDetail.collaborationTitle', 'Agent Collaboration')}
                </div>
                <div className="text-xs text-content-tertiary">
                    {t('agentDetail.collaborationDesc', 'Coordinate work with other digital employees in the same company.')}
                </div>
            </div>

            {notice && (
                <div
                    role="alert"
                    aria-live="assertive"
                    className={cn(
                        'mb-3 px-3 py-2.5 rounded-lg text-xs',
                        notice.type === 'success'
                            ? 'bg-emerald-500/10 border border-emerald-500/25 text-success'
                            : 'bg-red-500/10 border border-red-500/25 text-error',
                    )}
                >
                    {notice.message}
                </div>
            )}

            <div className="grid grid-cols-[minmax(220px,0.9fr)_minmax(320px,1.1fr)] gap-4">
                <div>
                    <div className="text-xs font-semibold mb-2">
                        {t('agentDetail.availableCollaborators', 'Available Collaborators')}
                    </div>
                    {collaboratorsLoading ? (
                        <div className="text-xs text-content-tertiary">{t('common.loading')}</div>
                    ) : collaborators.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            {collaborators.map((collaborator: any) => (
                                <div
                                    key={collaborator.id}
                                    className="px-3 py-2.5 rounded-lg border border-edge-subtle bg-surface-secondary"
                                >
                                    <div className="flex justify-between gap-2 items-center">
                                        <div className="text-[13px] font-semibold">{collaborator.name}</div>
                                        <span className={cn(
                                            'text-[11px]',
                                            collaborator.status === 'running' ? 'text-success' : 'text-content-tertiary',
                                        )}>
                                            {String(t(`agent.status.${collaborator.status}`, collaborator.status))}
                                        </span>
                                    </div>
                                    {collaborator.role && (
                                        <div className="text-[11px] text-content-tertiary mt-1">
                                            {collaborator.role}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-xs text-content-tertiary">
                            {t('agentDetail.noCollaborators', 'No other digital employees are available yet.')}
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-3">
                    <div className="card p-3 !m-0 bg-surface-secondary">
                        <div className="text-xs font-semibold mb-2" id="delegate-task-heading">
                            {t('agentDetail.delegateTask', 'Delegate Task')}
                        </div>
                        <div className="flex flex-col gap-2" role="group" aria-labelledby="delegate-task-heading">
                            <select className="form-input" value={delegateTargetId} onChange={e => setDelegateTargetId(e.target.value)} aria-label={t('agentDetail.targetAgent', 'Select target agent')}>
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
                                className="form-input min-h-[84px] resize-y"
                                value={delegateDescription}
                                onChange={e => setDelegateDescription(e.target.value)}
                                placeholder={t('agentDetail.taskDescription', 'Task description')}
                            />
                            <div className="flex justify-end">
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

                    <div className="card p-3 !m-0 bg-surface-secondary">
                        <div className="text-xs font-semibold mb-2" id="send-message-heading">
                            {t('agentDetail.sendMessage', 'Send Message')}
                        </div>
                        <div className="flex flex-col gap-2" role="group" aria-labelledby="send-message-heading">
                            <select className="form-input" value={messageTargetId} onChange={e => setMessageTargetId(e.target.value)} aria-label={t('agentDetail.targetAgent', 'Select target agent')}>
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
                                className="form-input min-h-[84px] resize-y"
                                value={messageBody}
                                onChange={e => setMessageBody(e.target.value)}
                                placeholder={t('agentDetail.messagePlaceholder', 'Write a message to another digital employee')}
                            />
                            <div className="flex justify-end">
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
                <div className="card p-3 !m-0 mt-4 bg-surface-secondary">
                    <div className="text-xs font-semibold mb-2" id="handover-heading">
                        {t('agentDetail.handoverAgent', 'Transfer Ownership')}
                    </div>
                    <div className="flex flex-col gap-2" role="group" aria-labelledby="handover-heading">
                        <select className="form-input" value={handoverUserId} onChange={e => setHandoverUserId(e.target.value)} aria-label={t('agentDetail.targetUser', 'Select target user')}>
                            <option value="">{t('agentDetail.targetUser', 'Select target user')}</option>
                            {eligibleUsers.map((user: any) => (
                                <option key={user.id} value={user.id}>
                                    {user.display_name || user.username}
                                </option>
                            ))}
                        </select>
                        {eligibleUsers.length === 0 && (
                            <div className="text-xs text-content-tertiary">
                                {t('agentDetail.noEligibleUsers', 'No eligible users are available for transfer.')}
                            </div>
                        )}
                        <div className="flex justify-end">
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
