import React, { useState, useEffect, useRef, Component, ErrorInfo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import ConfirmModal from '../components/ConfirmModal';
import type { FileBrowserApi } from '../components/FileBrowser';
import FileBrowser from '../components/FileBrowser';
import ChannelConfig from '../components/ChannelConfig';
import MarkdownRenderer from '../components/MarkdownRenderer';
import PromptModal from '../components/PromptModal';
import { applyStreamEvent, hydrateTimelineMessage, type TimelineMessage } from '../lib/chatParts.ts';
import { normalizeMemoryFacts } from '../lib/memoryInsights.ts';
import { activityApi, agentApi, capabilityApi, channelApi, chatApi, enterpriseApi, fileApi, packApi, scheduleApi, skillApi, taskApi, triggerApi } from '../services/api';
import { useAuthStore } from '../stores';
import type { ChatAttachment } from '../types';

const TABS = ['chat', 'overview', 'skills', 'activity', 'settings'] as const;

// Format large token numbers with K/M suffixes
const formatTokens = (n: number) => {
    if (!n) return '0';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
};

const getTimelineEventPresentation = (msg: TimelineMessage) => {
    if (msg.eventType === 'permission') {
        return {
            icon: '🔒',
            title: msg.eventTitle || 'Permission Gate',
            background: 'rgba(245,158,11,0.10)',
        };
    }
    if (msg.eventType === 'pack_activation') {
        return {
            icon: '🧰',
            title: msg.eventTitle || 'Capability Packs Activated',
            background: 'rgba(59,130,246,0.10)',
        };
    }
    return {
        icon: '🗜️',
        title: msg.eventTitle || 'Context Compacted',
        background: 'var(--bg-secondary)',
    };
};

type ChatMsg = TimelineMessage;

function ConfigVersionHistory({ agentId }: { agentId: string }) {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const user = useAuthStore((s) => s.user);
    const canRollback = user?.role === 'platform_admin' || user?.role === 'org_admin';
    const tkn = localStorage.getItem('token');
    const { data: configHistory = [] } = useQuery({
        queryKey: ['config-history', agentId],
        queryFn: () => fetch(`/api/v1/config-history/agent/${agentId}`, { headers: { Authorization: `Bearer ${tkn}` } }).then(r => r.ok ? r.json() : []),
        enabled: !!agentId,
    });
    const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
    const { data: expandedRevision } = useQuery({
        queryKey: ['config-history', agentId, expandedVersion],
        queryFn: () => fetch(`/api/v1/config-history/agent/${agentId}/${expandedVersion}`, {
            headers: { Authorization: `Bearer ${tkn}` },
        }).then(r => r.ok ? r.json() : null),
        enabled: !!agentId && expandedVersion !== null,
    });
    const rollbackMutation = useMutation({
        mutationFn: async (targetVersion: number) => {
            const res = await fetch(`/api/v1/config-history/agent/${agentId}/rollback`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(tkn ? { Authorization: `Bearer ${tkn}` } : {}),
                },
                body: JSON.stringify({ target_version: targetVersion }),
            });
            if (!res.ok) {
                const error = await res.json().catch(() => ({ detail: 'Rollback failed' }));
                throw new Error(error.detail || 'Rollback failed');
            }
            return res.json();
        },
        onSuccess: async () => {
            setExpandedVersion(null);
            await qc.invalidateQueries({ queryKey: ['config-history', agentId] });
            await qc.invalidateQueries({ queryKey: ['agent', agentId] });
            alert(t('agentDetail.rolledBack', 'Rolled back successfully'));
        },
        onError: (error: any) => {
            alert(error?.message || 'Rollback failed');
        },
    });
    if (!configHistory.length) return null;
    return (
        <details className="card" style={{ marginBottom: '12px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '14px', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>▸</span> {t('agentDetail.configHistory', 'Config History')}
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 400 }}>({configHistory.length})</span>
            </summary>
            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '8px 0 12px' }}>
                {t('agentDetail.configHistoryDesc', 'Previous configuration snapshots')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {configHistory.map((rev: any) => (
                    <div key={rev.version} style={{
                        padding: '10px 12px', borderRadius: '6px',
                        background: expandedVersion === rev.version ? 'var(--bg-secondary)' : 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)', cursor: 'pointer',
                    }} onClick={() => setExpandedVersion(expandedVersion === rev.version ? null : rev.version)}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontWeight: 600, fontSize: '13px' }}>v{rev.version}</span>
                                {rev.change_summary && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{rev.change_summary}</span>}
                            </div>
                            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                {rev.created_at ? new Date(rev.created_at).toLocaleString() : ''}
                            </span>
                        </div>
                        {expandedVersion === rev.version && (
                            <>
                                <pre style={{
                                    marginTop: '8px', padding: '8px', background: 'var(--bg-primary)',
                                    borderRadius: '4px', fontSize: '11px', overflow: 'auto',
                                    maxHeight: '200px', border: '1px solid var(--border-subtle)',
                                }}>{JSON.stringify(expandedRevision?.snapshot ?? rev.snapshot ?? {}, null, 2)}</pre>
                                {canRollback && (
                                    <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                                        <button
                                            className="btn"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (!confirm(t('agentDetail.rollbackConfirm', { version: rev.version }))) return;
                                                rollbackMutation.mutate(rev.version);
                                            }}
                                            disabled={rollbackMutation.isPending}
                                            style={{ fontSize: '12px' }}
                                        >
                                            {rollbackMutation.isPending
                                                ? t('common.loading')
                                                : t('agentDetail.rollback', 'Rollback')}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                ))}
            </div>
        </details>
    );
}

function CollaborationPanel({ agentId, agent }: { agentId: string; agent: any }) {
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

function OpenClawGatewayPanel({ agentId, agent }: { agentId: string; agent: any }) {
    const { t } = useTranslation();
    const currentUser = useAuthStore((s) => s.user);
    const canManageGateway = currentUser?.id === agent.creator_id || currentUser?.role === 'platform_admin' || currentUser?.role === 'org_admin';
    const [generatedApiKey, setGeneratedApiKey] = useState('');
    const [setupGuide, setSetupGuide] = useState<any | null>(null);
    const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const showNotice = (message: string, type: 'success' | 'error' = 'success') => {
        setNotice({ message, type });
        setTimeout(() => setNotice(null), 2500);
    };

    const { data: gatewayMessages = [], isLoading: gatewayLoading } = useQuery({
        queryKey: ['gateway-messages', agentId],
        queryFn: () => agentApi.gatewayMessages(agentId),
        enabled: !!agentId,
    });

    const apiKeyMutation = useMutation({
        mutationFn: async () => {
            const keyResult = await agentApi.generateApiKey(agentId);
            const guideResponse = await fetch(`/api/v1/gateway/setup-guide/${agentId}`, {
                headers: { 'X-Api-Key': keyResult.api_key },
            });
            if (!guideResponse.ok) {
                const error = await guideResponse.json().catch(() => ({ detail: 'Failed to load setup guide' }));
                throw new Error(error.detail || 'Failed to load setup guide');
            }
            const guide = await guideResponse.json();
            return { ...keyResult, guide };
        },
        onSuccess: (result: any) => {
            setGeneratedApiKey(result.api_key);
            setSetupGuide(result.guide);
            showNotice(result.message || t('agentDetail.apiKeyVisibleOnce', 'This API key is only shown once.'));
        },
        onError: (error: any) => showNotice(error?.message || 'Failed to generate API key', 'error'),
    });

    return (
        <div className="card" style={{ padding: '16px', marginBottom: '24px' }}>
            <div style={{ marginBottom: '12px' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                    {t('agentDetail.openclawConnection', 'OpenClaw Connection')}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    {t('agentDetail.managedByOpenclaw', 'Managed by OpenClaw')}
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

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 1.2fr)', gap: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="card" style={{ padding: '12px', margin: 0, background: 'var(--bg-secondary)' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>
                            {t('agentDetail.gatewayMessages', 'Gateway Messages')}
                        </div>
                        {gatewayLoading ? (
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('common.loading')}</div>
                        ) : gatewayMessages.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto' }}>
                                {gatewayMessages.map((message: any) => (
                                    <div
                                        key={message.id}
                                        style={{
                                            padding: '10px 12px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--border-subtle)',
                                            background: 'var(--bg-primary)',
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                                            <span style={{ fontSize: '12px', fontWeight: 600 }}>
                                                {message.sender_agent_name || t('agentDetail.gatewaySystem', 'Platform')}
                                            </span>
                                            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                                {message.created_at ? new Date(message.created_at).toLocaleString() : ''}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                                            {message.status}
                                        </div>
                                        <div style={{ fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                            {message.content}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                {t('agentDetail.noGatewayMessages', 'No gateway messages yet.')}
                            </div>
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {canManageGateway && (
                        <div className="card" style={{ padding: '12px', margin: 0, background: 'var(--bg-secondary)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                                <div>
                                    <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                                        {t('agentDetail.generateApiKey', 'Generate API Key')}
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                        {t('agentDetail.apiKeyVisibleOnce', 'This API key is only shown once.')}
                                    </div>
                                </div>
                                <button
                                    className="btn"
                                    onClick={() => apiKeyMutation.mutate()}
                                    disabled={apiKeyMutation.isPending}
                                >
                                    {apiKeyMutation.isPending ? t('common.loading') : t('agentDetail.generateApiKey', 'Generate API Key')}
                                </button>
                            </div>

                            {generatedApiKey && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <textarea
                                        className="form-input"
                                        readOnly
                                        value={generatedApiKey}
                                        rows={3}
                                        style={{ fontFamily: 'var(--font-mono)', resize: 'none' }}
                                    />
                                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                        <button className="btn" onClick={() => navigator.clipboard.writeText(generatedApiKey)}>
                                            {t('common.copy', 'Copy')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {setupGuide && (
                        <div className="card" style={{ padding: '12px', margin: 0, background: 'var(--bg-secondary)' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>
                                {t('openclaw.setupInstruction', 'Setup Instruction')}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                                {t('openclaw.keyNote', 'The API key is already embedded in the instruction above. Save it separately if needed for manual configuration.')}
                            </div>
                            <textarea
                                className="form-input"
                                readOnly
                                value={setupGuide.skill_content || ''}
                                rows={12}
                                style={{ fontFamily: 'var(--font-mono)', resize: 'vertical', marginBottom: '8px' }}
                            />
                            <textarea
                                className="form-input"
                                readOnly
                                value={setupGuide.heartbeat_addition || ''}
                                rows={3}
                                style={{ fontFamily: 'var(--font-mono)', resize: 'none' }}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function MemoryInsightsPanel({ agentId }: { agentId: string }) {
    const { t } = useTranslation();
    const { data: memoryResponse, isLoading: memoryLoading } = useQuery({
        queryKey: ['agent-memory-facts', agentId],
        queryFn: () => enterpriseApi.agentMemory(agentId),
        enabled: !!agentId,
    });
    const { data: ownSessions = [], isLoading: sessionsLoading } = useQuery({
        queryKey: ['agent-owned-sessions', agentId],
        queryFn: () => agentApi.sessions(agentId, 'mine'),
        enabled: !!agentId,
    });
    const latestSessionId = ownSessions[0]?.id as string | undefined;
    const { data: latestSessionSummary, isLoading: summaryLoading } = useQuery({
        queryKey: ['agent-session-summary', latestSessionId],
        queryFn: () => enterpriseApi.sessionSummary(latestSessionId!),
        enabled: !!latestSessionId,
    });

    const facts = normalizeMemoryFacts(memoryResponse?.facts);
    const sessionSummary = typeof latestSessionSummary?.summary === 'string' ? latestSessionSummary.summary.trim() : '';
    const sessionTitle = typeof latestSessionSummary?.title === 'string' && latestSessionSummary.title.trim()
        ? latestSessionSummary.title.trim()
        : t('agentDetail.sessionSummaryTitleFallback', 'Untitled session');

    return (
        <div className="card" style={{ padding: '16px', marginBottom: '24px' }}>
            <div style={{ marginBottom: '12px' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                    {t('agentDetail.structuredMemory', 'Structured Memory')}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    {t('agentDetail.structuredMemoryDesc', 'Knowledge extracted into reusable facts and the latest personal session summary.')}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.2fr) minmax(280px, 0.8fr)', gap: '16px' }}>
                <div className="card" style={{ padding: '12px', margin: 0, background: 'var(--bg-secondary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600 }}>
                            {t('agentDetail.structuredMemory', 'Structured Memory')}
                        </div>
                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{facts.length}</span>
                    </div>
                    {memoryLoading ? (
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('common.loading')}</div>
                    ) : facts.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {facts.map((fact) => (
                                <div
                                    key={fact.id}
                                    style={{
                                        padding: '10px 12px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--border-subtle)',
                                        background: 'var(--bg-primary)',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                                        <span
                                            style={{
                                                fontSize: '11px',
                                                padding: '2px 8px',
                                                borderRadius: '999px',
                                                background: 'rgba(59,130,246,0.12)',
                                                color: '#60a5fa',
                                                border: '1px solid rgba(59,130,246,0.20)',
                                            }}
                                        >
                                            {fact.label}
                                        </span>
                                        {fact.timestamp && (
                                            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                                {new Date(fact.timestamp).toLocaleString()}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                                        {fact.content}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            {t('agentDetail.noStructuredMemory', 'No structured memory facts yet.')}
                        </div>
                    )}
                </div>

                <div className="card" style={{ padding: '12px', margin: 0, background: 'var(--bg-secondary)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>
                        {t('agentDetail.sessionSummary', 'Latest Session Summary')}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '10px' }}>
                        {t('agentDetail.sessionSummaryDesc', 'Only your own latest session summary is visible here.')}
                    </div>
                    {sessionsLoading || (latestSessionId && summaryLoading) ? (
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('common.loading')}</div>
                    ) : !latestSessionId ? (
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            {t('agentDetail.noSessionHistory', 'No personal sessions yet.')}
                        </div>
                    ) : sessionSummary ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ fontSize: '13px', fontWeight: 600 }}>{sessionTitle}</div>
                            <div
                                style={{
                                    fontSize: '13px',
                                    color: 'var(--text-secondary)',
                                    lineHeight: 1.6,
                                    whiteSpace: 'pre-wrap',
                                }}
                            >
                                {sessionSummary}
                            </div>
                        </div>
                    ) : (
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            {t('agentDetail.noSessionSummary', 'This session does not have a summary yet.')}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function CapabilitiesView({ agentId, canManage }: { agentId: string; canManage: boolean }) {
    const { t } = useTranslation();
    const [sessionExpanded, setSessionExpanded] = useState(false);
    const sessionScope = canManage ? 'all' : 'mine';

    const { data: capSummary, isLoading } = useQuery({
        queryKey: ['capability-summary', agentId],
        queryFn: () => packApi.capabilitySummary(agentId),
        enabled: !!agentId,
    });
    const { data: sessions = [] } = useQuery({
        queryKey: ['capability-sessions', agentId, sessionScope],
        queryFn: () => fetchAuth<any[]>(`/agents/${agentId}/sessions?scope=${sessionScope}`),
        enabled: !!agentId,
    });
    const latestSessionId = sessions[0]?.id as string | undefined;
    const { data: runtimeSummary, isLoading: runtimeLoading } = useQuery({
        queryKey: ['capability-runtime-summary', latestSessionId],
        queryFn: () => packApi.sessionRuntime(latestSessionId!),
        enabled: sessionExpanded && !!latestSessionId,
    });

    if (isLoading || !capSummary) {
        return <div style={{ color: 'var(--text-tertiary)', padding: '20px' }}>{t('common.loading')}</div>;
    }

    const { kernel_tools, available_packs, channel_backed_packs, skill_declared_packs } = capSummary;
    const allPacks = [...available_packs, ...channel_backed_packs];
    const capabilityNameMap: Record<string, string> = {
        web_pack: t('agent.capability.research'),
        feishu_pack: t('agent.capability.feishu'),
        plaza_pack: t('agent.capability.collaboration'),
        mcp_admin_pack: t('agent.capability.mcpAdmin'),
    };
    const sourceLabel = (source?: string) => {
        switch (source) {
            case 'channel':
                return t('agent.capability.channelSource');
            case 'mcp':
                return t('agent.capability.mcpSource');
            case 'skill':
                return t('agent.capability.skillSource');
            default:
                return t('agent.capability.systemSource');
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="card" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                    <div>
                        <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>{t('agent.capability.foundationTitle')}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('agent.capability.foundationDesc')}</div>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', alignSelf: 'center' }}>
                        {t('agent.capability.foundationCount', { count: kernel_tools.length })}
                    </div>
                </div>
            </div>

            <div>
                <h3 style={{ marginBottom: '4px', fontSize: '14px' }}>{t('agent.capability.sections.skills')}</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '10px' }}>
                    {t('agent.capability.skillsHint')}
                </p>
                {skill_declared_packs && skill_declared_packs.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
                        {skill_declared_packs.map((pack: any) => (
                            <div key={pack.name} className="card" style={{ padding: '14px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start', marginBottom: '8px' }}>
                                    <div style={{ fontWeight: 600, fontSize: '13px' }}>{(pack.skills || []).join(' · ') || capabilityNameMap[pack.name] || pack.name}</div>
                                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{t('agent.capability.skillSource')}</span>
                                </div>
                                {pack.summary ? (
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>{pack.summary}</div>
                                ) : null}
                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                                    {t('agent.capability.connectedActions', { count: (pack.tools || []).length })}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                    {(pack.tools || []).map((tool: string) => (
                                        <span
                                            key={tool}
                                            style={{
                                                fontSize: '11px',
                                                padding: '2px 8px',
                                                borderRadius: '4px',
                                                background: 'var(--bg-secondary)',
                                                border: '1px solid var(--border-subtle)',
                                            }}
                                        >
                                            {tool}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="card" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                        {t('agent.capability.skillsEmpty')}
                    </div>
                )}
            </div>

            <div>
                <h3 style={{ marginBottom: '4px', fontSize: '14px' }}>{t('agent.capability.sections.tools')}</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '10px' }}>
                    {allPacks.length > 0
                        ? t('agent.capability.connectedSummary', { count: allPacks.length })
                        : t('agent.capability.connectedEmpty')}
                </p>
                {allPacks.length > 0 ? (
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                            gap: '10px',
                        }}
                    >
                        {allPacks.map((pack: any) => (
                            <div key={pack.name} className="card" style={{ padding: '14px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start', marginBottom: '8px' }}>
                                    <div style={{ fontWeight: 600, fontSize: '13px' }}>{capabilityNameMap[pack.name] || pack.summary || pack.name}</div>
                                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{sourceLabel(pack.source)}</span>
                                </div>
                                {pack.summary ? (
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>{pack.summary}</div>
                                ) : null}
                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                                    {t('agent.capability.connectedActions', { count: (pack.tools || []).length })}
                                </div>
                                {pack.capabilities && pack.capabilities.length > 0 ? (
                                    <div style={{ fontSize: '11px', color: '#f59e0b', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.20)', borderRadius: '6px', padding: '6px 8px' }}>
                                        {t('enterprise.importedTools.restricted')}: {pack.capabilities.join(', ')}
                                    </div>
                                ) : (
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{t('enterprise.importedTools.unrestricted')}</div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="card" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                        {t('agent.capability.connectedEmpty')}
                    </div>
                )}
            </div>

            <details
                className="card"
                open={sessionExpanded}
                onToggle={(e) => setSessionExpanded((e.target as HTMLDetailsElement).open)}
            >
                <summary
                    style={{
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '14px',
                        listStyle: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        userSelect: 'none',
                    }}
                >
                    <span style={{ transition: 'transform 0.15s', display: 'inline-block', transform: sessionExpanded ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: '12px' }}>&#x25B6;</span>
                    {t('agent.capability.sections.advanced')}
                </summary>
                {!latestSessionId ? (
                    <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '8px 0 0' }}>
                        {t('agent.capability.advancedNone')}
                    </p>
                ) : runtimeLoading || !runtimeSummary ? (
                    <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '8px 0 0' }}>
                        {t('common.loading')}
                    </p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: 0 }}>
                            {t('agent.capability.advancedDesc')}
                        </p>
                        <div>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>{t('enterprise.packs.activatedPacks')}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {runtimeSummary.activated_packs.length > 0 ? runtimeSummary.activated_packs.map((pack: string) => (
                                    <span
                                        key={pack}
                                        style={{
                                            fontSize: '11px',
                                            padding: '3px 10px',
                                            borderRadius: '999px',
                                            background: 'rgba(59,130,246,0.12)',
                                            color: '#60a5fa',
                                            border: '1px solid rgba(59,130,246,0.25)',
                                        }}
                                    >
                                        {pack}
                                    </span>
                                )) : (
                                    <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('enterprise.packs.noActivatedPacks')}</span>
                                )}
                            </div>
                        </div>

                        <div>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>{t('agent.capability.recentTools')}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {runtimeSummary.used_tools.length > 0 ? runtimeSummary.used_tools.map((tool: string) => (
                                    <span
                                        key={tool}
                                        style={{
                                            fontSize: '11px',
                                            padding: '3px 10px',
                                            borderRadius: '4px',
                                            background: 'var(--bg-secondary)',
                                            color: 'var(--text-secondary)',
                                            border: '1px solid var(--border-subtle)',
                                            fontFamily: 'var(--font-mono)',
                                        }}
                                    >
                                        {tool}
                                    </span>
                                )) : (
                                    <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('enterprise.packs.noUsedTools')}</span>
                                )}
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                            <div style={{ minWidth: '180px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>{t('agent.capability.recentBlocks')}</div>
                                {runtimeSummary.blocked_capabilities.length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {runtimeSummary.blocked_capabilities.map((item: any, index: number) => (
                                            <div
                                                key={`${item.tool || 'unknown'}-${index}`}
                                                style={{
                                                    padding: '8px 10px',
                                                    borderRadius: '8px',
                                                    background: 'rgba(245,158,11,0.10)',
                                                    border: '1px solid rgba(245,158,11,0.20)',
                                                    fontSize: '11px',
                                                    color: 'var(--text-secondary)',
                                                }}
                                            >
                                                <div style={{ fontWeight: 600 }}>{item.capability || item.tool || 'blocked'}</div>
                                                <div style={{ color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                                    {item.tool ? `${item.tool} · ` : ''}{item.status}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('enterprise.packs.noBlockedCapabilities')}</span>
                                )}
                            </div>

                            <div style={{ minWidth: '180px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>{t('agent.capability.recentCompactions')}</div>
                                <div
                                    style={{
                                        padding: '10px 12px',
                                        borderRadius: '8px',
                                        background: 'var(--bg-secondary)',
                                        border: '1px solid var(--border-subtle)',
                                        fontSize: '20px',
                                        fontWeight: 700,
                                    }}
                                >
                                    {runtimeSummary.compaction_count}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </details>
        </div>
    );
}

function CapabilityPolicyManager({ agentId }: { agentId: string }) {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const [capSaving, setCapSaving] = useState<string | null>(null);
    const [addingCapability, setAddingCapability] = useState(false);
    const [selectedNewCap, setSelectedNewCap] = useState('');

    const { data: capDefs = [], isLoading: defsLoading } = useQuery({
        queryKey: ['agent-capability-definitions'],
        queryFn: () => capabilityApi.definitions(),
        enabled: !!agentId,
    });
    const { data: agentPolicies = [], isLoading: policiesLoading } = useQuery({
        queryKey: ['agent-capability-policies', agentId],
        queryFn: () => capabilityApi.list(agentId),
        enabled: !!agentId,
    });

    const configuredCaps = new Set(agentPolicies.map((p: any) => p.capability));
    const unconfiguredDefs = capDefs.filter((d: any) => !configuredCaps.has(d.capability));

    const getToolsForCapability = (cap: string) => {
        const def = capDefs.find((d: any) => d.capability === cap);
        return def?.tools || [];
    };

    const handleUpsert = async (capability: string, allowed: boolean, requiresApproval: boolean) => {
        setCapSaving(capability);
        try {
            await capabilityApi.upsert({
                capability,
                agent_id: agentId,
                allowed,
                requires_approval: requiresApproval,
            });
            await qc.invalidateQueries({ queryKey: ['agent-capability-policies', agentId] });
            await qc.invalidateQueries({ queryKey: ['capability-summary', agentId] });
        } finally {
            setCapSaving(null);
        }
    };

    const handleDelete = async (policy: any) => {
        setCapSaving(policy.capability);
        try {
            await capabilityApi.delete(policy.id);
            await qc.invalidateQueries({ queryKey: ['agent-capability-policies', agentId] });
            await qc.invalidateQueries({ queryKey: ['capability-summary', agentId] });
        } finally {
            setCapSaving(null);
        }
    };

    const handleAddNew = async () => {
        if (!selectedNewCap) return;
        await handleUpsert(selectedNewCap, true, false);
        setSelectedNewCap('');
        setAddingCapability(false);
    };

    if (defsLoading || policiesLoading) {
        return (
            <div className="card" style={{ marginBottom: '12px' }}>
                <h4 style={{ marginBottom: '4px' }}>{t('agent.settings.capabilityPolicy.title')}</h4>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '13px', padding: '12px 0' }}>{t('common.loading')}</div>
            </div>
        );
    }

    return (
        <div className="card" style={{ marginBottom: '12px' }}>
            <h4 style={{ marginBottom: '4px' }}>{t('agent.settings.capabilityPolicy.title')}</h4>
            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                {t('agent.settings.capabilityPolicy.description')}
            </p>

            {capDefs.length === 0 ? (
                <div style={{ color: 'var(--text-tertiary)', fontSize: '13px', padding: '12px 0' }}>
                    {t('agent.settings.capabilityPolicy.noDefinitions')}
                </div>
            ) : (
                <>
                    {agentPolicies.length === 0 && (
                        <div style={{
                            fontSize: '12px', color: 'var(--text-tertiary)',
                            padding: '12px 14px', background: 'var(--bg-elevated)',
                            borderRadius: '8px', border: '1px solid var(--border-subtle)',
                            marginBottom: '10px',
                        }}>
                            {t('agent.settings.capabilityPolicy.noPolicies')}
                        </div>
                    )}

                    {agentPolicies.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr 100px 120px 60px',
                                gap: '8px',
                                padding: '6px 14px',
                                fontSize: '11px',
                                fontWeight: 600,
                                color: 'var(--text-tertiary)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                            }}>
                                <span>{t('agent.settings.capabilityPolicy.capability')}</span>
                                <span>{t('agent.settings.capabilityPolicy.tools')}</span>
                                <span>{t('agent.settings.capabilityPolicy.status')}</span>
                                <span>{t('agent.settings.capabilityPolicy.approval')}</span>
                                <span>{t('agent.settings.capabilityPolicy.actions')}</span>
                            </div>

                            {agentPolicies.map((policy: any) => {
                                const tools = getToolsForCapability(policy.capability);
                                const isSaving = capSaving === policy.capability;
                                return (
                                    <div key={policy.id} style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr 100px 120px 60px',
                                        gap: '8px',
                                        alignItems: 'center',
                                        padding: '10px 14px',
                                        background: 'var(--bg-elevated)',
                                        borderRadius: '8px',
                                        border: '1px solid var(--border-subtle)',
                                        opacity: isSaving ? 0.6 : 1,
                                        transition: 'opacity 0.15s',
                                    }}>
                                        <div style={{
                                            fontWeight: 500, fontSize: '13px',
                                            fontFamily: 'var(--font-mono)',
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}>
                                            {policy.capability}
                                        </div>

                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                            {tools.slice(0, 3).map((tool: string) => (
                                                <span key={tool} style={{
                                                    fontSize: '10px', padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    background: 'var(--bg-secondary)',
                                                    color: 'var(--text-tertiary)',
                                                    fontFamily: 'var(--font-mono)',
                                                    border: '1px solid var(--border-subtle)',
                                                }}>
                                                    {tool}
                                                </span>
                                            ))}
                                            {tools.length > 3 && (
                                                <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                                                    +{tools.length - 3}
                                                </span>
                                            )}
                                        </div>

                                        <button
                                            disabled={isSaving}
                                            onClick={() => handleUpsert(policy.capability, !policy.allowed, policy.requires_approval)}
                                            style={{
                                                padding: '4px 10px', borderRadius: '6px',
                                                fontSize: '11px', fontWeight: 600,
                                                border: '1px solid',
                                                cursor: isSaving ? 'default' : 'pointer',
                                                background: policy.allowed ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                                                color: policy.allowed ? 'var(--success)' : 'var(--error)',
                                                borderColor: policy.allowed ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
                                            }}
                                        >
                                            {policy.allowed
                                                ? t('agent.settings.capabilityPolicy.allowed')
                                                : t('agent.settings.capabilityPolicy.denied')}
                                        </button>

                                        <label style={{
                                            display: 'flex', alignItems: 'center', gap: '6px',
                                            fontSize: '11px', color: 'var(--text-secondary)',
                                            cursor: isSaving ? 'default' : 'pointer',
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={policy.requires_approval}
                                                disabled={isSaving}
                                                onChange={(e) => handleUpsert(policy.capability, policy.allowed, e.target.checked)}
                                                style={{ accentColor: 'var(--accent-primary)' }}
                                            />
                                            {t('agent.settings.capabilityPolicy.requiresApproval')}
                                        </label>

                                        <button
                                            disabled={isSaving}
                                            onClick={() => handleDelete(policy)}
                                            title={t('agent.settings.capabilityPolicy.delete')}
                                            style={{
                                                padding: '4px 8px', borderRadius: '6px',
                                                fontSize: '11px', cursor: isSaving ? 'default' : 'pointer',
                                                background: 'none', border: '1px solid var(--border-subtle)',
                                                color: 'var(--text-tertiary)',
                                            }}
                                        >
                                            {t('agent.settings.capabilityPolicy.delete')}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {addingCapability ? (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '10px 14px', background: 'var(--bg-elevated)',
                            borderRadius: '8px', border: '1px solid var(--accent-primary)',
                        }}>
                            <select
                                className="input"
                                value={selectedNewCap}
                                onChange={(e) => setSelectedNewCap(e.target.value)}
                                style={{ flex: 1, fontSize: '12px' }}
                            >
                                <option value="">{t('agent.settings.capabilityPolicy.selectCapability')}</option>
                                {unconfiguredDefs.map((def: any) => (
                                    <option key={def.capability} value={def.capability}>
                                        {def.capability}
                                    </option>
                                ))}
                            </select>
                            <button
                                className="btn btn-primary"
                                disabled={!selectedNewCap || capSaving !== null}
                                onClick={handleAddNew}
                                style={{ padding: '5px 14px', fontSize: '12px' }}
                            >
                                {t('agent.settings.capabilityPolicy.addPolicy')}
                            </button>
                            <button
                                style={{
                                    background: 'none', border: 'none',
                                    cursor: 'pointer', color: 'var(--text-tertiary)',
                                    fontSize: '16px', lineHeight: 1,
                                }}
                                onClick={() => { setAddingCapability(false); setSelectedNewCap(''); }}
                            >
                                x
                            </button>
                        </div>
                    ) : unconfiguredDefs.length > 0 && (
                        <button
                            onClick={() => setAddingCapability(true)}
                            style={{
                                padding: '8px 14px', borderRadius: '8px',
                                border: '1px dashed var(--border-subtle)',
                                background: 'none', cursor: 'pointer',
                                color: 'var(--accent-primary)', fontSize: '12px',
                                fontWeight: 500, width: '100%',
                                transition: 'border-color 0.15s',
                            }}
                        >
                            + {t('agent.settings.capabilityPolicy.addPolicy')}
                        </button>
                    )}
                </>
            )}
        </div>
    );
}

/** Convert rich schedule JSON to cron expression */
function schedToCron(sched: { freq: string; interval: number; time: string; weekdays?: number[] }): string {
    const [h, m] = (sched.time || '09:00').split(':').map(Number);
    if (sched.freq === 'weekly') {
        const days = (sched.weekdays || [1, 2, 3, 4, 5]).join(',');
        return sched.interval > 1 ? `${m} ${h} * * ${days}` : `${m} ${h} * * ${days}`;
    }
    // daily
    if (sched.interval === 1) return `${m} ${h} * * *`;
    return `${m} ${h} */${sched.interval} * *`;
}

const getRelationOptions = (t: any) => [
    { value: 'direct_leader', label: t('agent.detail.supervisor') },
    { value: 'collaborator', label: t('agent.detail.collaborator') },
    { value: 'stakeholder', label: 'Stakeholder' },
    { value: 'team_member', label: 'Team Member' },
    { value: 'subordinate', label: t('agent.detail.subordinate') },
    { value: 'mentor', label: 'Mentor' },
    { value: 'other', label: 'Other' },
];

const getAgentRelationOptions = (t: any) => [
    { value: 'peer', label: t('agent.detail.colleague') },
    { value: 'supervisor', label: t('agent.detail.supervisor') },
    { value: 'assistant', label: 'Assistant' },
    { value: 'collaborator', label: t('agent.detail.collaborator') },
    { value: 'other', label: 'Other' },
];

function fetchAuth<T>(url: string, options?: RequestInit): Promise<T> {
    const token = localStorage.getItem('token');
    return fetch(`/api${url}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }).then(r => r.json());
}

function RelationshipEditor({ agentId, readOnly = false }: { agentId: string; readOnly?: boolean }) {
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
        queryFn: () => fetchAuth<any[]>(`/agents/${agentId}/relationships/`),
    });
    const { data: agentRelationships = [], refetch: refetchAgentRels } = useQuery({
        queryKey: ['agent-relationships', agentId],
        queryFn: () => fetchAuth<any[]>(`/agents/${agentId}/relationships/agents`),
    });
    const relationshipTenantId = localStorage.getItem('current_tenant_id') || '';
    const { data: allAgents = [] } = useQuery({
        queryKey: ['agents-for-rel', relationshipTenantId],
        queryFn: () => fetchAuth<any[]>(`/agents/${relationshipTenantId ? `?tenant_id=${relationshipTenantId}` : ''}`),
    });
    const availableAgents = allAgents.filter((a: any) => a.id !== agentId);

    useEffect(() => {
        if (!search || search.length < 1) { setSearchResults([]); return; }
        const t = setTimeout(() => {
            const params = new URLSearchParams({ search });
            if (relationshipTenantId) params.set('tenant_id', relationshipTenantId);
            fetchAuth<any[]>(`/enterprise/org/members?${params}`).then(setSearchResults);
        }, 300);
        return () => clearTimeout(t);
    }, [search, relationshipTenantId]);

    const addRelationship = async () => {
        if (!adding) return;
        const existing = relationships.map((r: any) => ({ member_id: r.member_id, relation: r.relation, description: r.description }));
        existing.push({ member_id: adding.id, relation, description });
        await fetchAuth(`/agents/${agentId}/relationships/`, { method: 'PUT', body: JSON.stringify({ relationships: existing }) });
        setAdding(null); setSearch(''); setRelation('collaborator'); setDescription('');
        refetch();
    };
    const removeRelationship = async (relId: string) => {
        await fetchAuth(`/agents/${agentId}/relationships/${relId}`, { method: 'DELETE' });
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
        await fetchAuth(`/agents/${agentId}/relationships/`, { method: 'PUT', body: JSON.stringify({ relationships: updated }) });
        setEditingId(null);
        refetch();
    };
    const addAgentRelationship = async () => {
        if (!selectedAgentId) return;
        const existing = agentRelationships.map((r: any) => ({ target_agent_id: r.target_agent_id, relation: r.relation, description: r.description }));
        existing.push({ target_agent_id: selectedAgentId, relation: agentRelation, description: agentDescription });
        await fetchAuth(`/agents/${agentId}/relationships/agents`, { method: 'PUT', body: JSON.stringify({ relationships: existing }) });
        setAddingAgent(false); setSelectedAgentId(''); setAgentRelation('collaborator'); setAgentDescription('');
        refetchAgentRels();
    };
    const removeAgentRelationship = async (relId: string) => {
        await fetchAuth(`/agents/${agentId}/relationships/agents/${relId}`, { method: 'DELETE' });
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
        await fetchAuth(`/agents/${agentId}/relationships/agents`, { method: 'PUT', body: JSON.stringify({ relationships: updated }) });
        setEditingAgentId(null);
        refetchAgentRels();
    };

    return (
        <div>
            {/* ── Human Relationships ── */}
            <div className="card" style={{ marginBottom: '12px' }}>
                <h4 style={{ marginBottom: '12px' }}>{t('agent.detail.humanRelationships')}</h4>
                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>{t('agent.detail.humanRelationships')}</p>
                {relationships.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
                        {relationships.map((r: any) => (
                            <div key={r.id} style={{ borderRadius: '8px', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px' }}>
                                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(224,238,238,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 600, flexShrink: 0 }}>{r.member?.name?.[0] || '?'}</div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: '13px' }}>{r.member?.name || '?'} <span className="badge" style={{ fontSize: '10px', marginLeft: '4px' }}>{r.relation_label}</span></div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{r.member?.title || ''} · {r.member?.department_path || ''}</div>
                                        {r.description && editingId !== r.id && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{r.description}</div>}
                                    </div>
                                    {!readOnly && editingId !== r.id && (
                                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                            <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => startEditRelationship(r)}>{t('common.edit', 'Edit')}</button>
                                            <button className="btn btn-ghost" style={{ color: 'var(--error)', fontSize: '12px' }} onClick={() => removeRelationship(r.id)}>{t('common.delete')}</button>
                                        </div>
                                    )}
                                </div>
                                {editingId === r.id && (
                                    <div style={{ padding: '0 10px 10px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', marginBottom: '8px' }}>
                                            <select className="input" value={editRelation} onChange={e => setEditRelation(e.target.value)} style={{ width: '140px', fontSize: '12px' }}>
                                                {getRelationOptions(t).map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </div>
                                        <textarea className="input" value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={2} style={{ fontSize: '12px', resize: 'vertical', marginBottom: '8px', width: '100%' }} placeholder={t('agent.detail.descriptionPlaceholder', 'Description...')} />
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => saveEditRelationship(r.id)}>{t('common.save', 'Save')}</button>
                                            <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => setEditingId(null)}>{t('common.cancel')}</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                {!readOnly && !adding && (
                    <div style={{ position: 'relative' }}>
                        <input className="input" placeholder={t("agent.detail.searchMembers")} value={search} onChange={e => setSearch(e.target.value)} style={{ fontSize: '13px' }} />
                        {searchResults.length > 0 && (
                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '6px', marginTop: '4px', maxHeight: '200px', overflowY: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                {searchResults.map((m: any) => (
                                    <div key={m.id} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid var(--border-subtle)' }}
                                        onClick={() => { setAdding(m); setSearch(''); setSearchResults([]); }}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                        <div style={{ fontWeight: 500 }}>{m.name}</div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{m.title} · {m.department_path}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {!readOnly && adding && (
                    <div style={{ border: '1px solid var(--accent-primary)', borderRadius: '8px', padding: '12px', background: 'var(--bg-elevated)' }}>
                        <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px' }}>{t('agent.detail.addRelationship')}: {adding.name} <span style={{ fontSize: '12px', fontWeight: 400, color: 'var(--text-tertiary)' }}>({adding.title} · {adding.department_path})</span></div>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                            <select className="input" value={relation} onChange={e => setRelation(e.target.value)} style={{ width: '140px', fontSize: '12px' }}>
                                {getRelationOptions(t).map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </div>
                        <textarea className="input" placeholder="" value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ fontSize: '12px', resize: 'vertical', marginBottom: '8px' }} />
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={addRelationship}>{t('common.confirm')}</button>
                            <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => { setAdding(null); setDescription(''); }}>{t('common.cancel')}</button>
                        </div>
                    </div>
                )}
            </div>
            {/* ── Agent-to-Agent Relationships ── */}
            <div className="card" style={{ marginBottom: '12px' }}>
                <h4 style={{ marginBottom: '12px' }}>{t('agent.detail.agentRelationships')}</h4>
                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>{t('agent.detail.agentRelationships')}</p>
                {agentRelationships.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
                        {agentRelationships.map((r: any) => (
                            <div key={r.id} style={{ borderRadius: '8px', border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.05)', overflow: 'hidden' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px' }}>
                                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>A</div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: '13px' }}>{r.target_agent?.name || '?'} <span className="badge" style={{ fontSize: '10px', marginLeft: '4px', background: 'rgba(16,185,129,0.15)', color: 'rgb(16,185,129)' }}>{r.relation_label}</span></div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{r.target_agent?.role_description || 'Agent'}</div>
                                        {r.description && editingAgentId !== r.id && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{r.description}</div>}
                                    </div>
                                    {!readOnly && editingAgentId !== r.id && (
                                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                            <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => startEditAgentRelationship(r)}>{t('common.edit', 'Edit')}</button>
                                            <button className="btn btn-ghost" style={{ color: 'var(--error)', fontSize: '12px' }} onClick={() => removeAgentRelationship(r.id)}>{t('common.delete')}</button>
                                        </div>
                                    )}
                                </div>
                                {editingAgentId === r.id && (
                                    <div style={{ padding: '0 10px 10px', borderTop: '1px solid rgba(16,185,129,0.2)', background: 'var(--bg-elevated)' }}>
                                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', marginBottom: '8px' }}>
                                            <select className="input" value={editAgentRelation} onChange={e => setEditAgentRelation(e.target.value)} style={{ width: '140px', fontSize: '12px' }}>
                                                {getAgentRelationOptions(t).map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </div>
                                        <textarea className="input" value={editAgentDescription} onChange={e => setEditAgentDescription(e.target.value)} rows={2} style={{ fontSize: '12px', resize: 'vertical', marginBottom: '8px', width: '100%' }} placeholder={t('agent.detail.descriptionPlaceholder', 'Description...')} />
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => saveEditAgentRelationship(r.id)}>{t('common.save', 'Save')}</button>
                                            <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => setEditingAgentId(null)}>{t('common.cancel')}</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                {!readOnly && !addingAgent && (
                    <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => setAddingAgent(true)}>+ {t('agent.detail.addRelationship')}</button>
                )}
                {!readOnly && addingAgent && (
                    <div style={{ border: '1px solid rgba(16,185,129,0.5)', borderRadius: '8px', padding: '12px', background: 'var(--bg-elevated)' }}>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                            <select className="input" value={selectedAgentId} onChange={e => setSelectedAgentId(e.target.value)} style={{ flex: 1, fontSize: '12px' }}>
                                <option value="">— Select —</option>
                                {availableAgents.map((a: any) => <option key={a.id} value={a.id}>{a.name} — {a.role_description || 'Agent'}</option>)}
                            </select>
                            <select className="input" value={agentRelation} onChange={e => setAgentRelation(e.target.value)} style={{ width: '140px', fontSize: '12px' }}>
                                {getAgentRelationOptions(t).map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </div>
                        <textarea className="input" placeholder="" value={agentDescription} onChange={e => setAgentDescription(e.target.value)} rows={2} style={{ fontSize: '12px', resize: 'vertical', marginBottom: '8px' }} />
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={addAgentRelationship} disabled={!selectedAgentId}>{t('common.confirm')}</button>
                            <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => { setAddingAgent(false); setAgentDescription(''); setSelectedAgentId(''); }}>{t('common.cancel')}</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function FileEditorCard({ agentId, path, title, readOnly = false }: { agentId: string; path: string; title: string; readOnly?: boolean }) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const { data, isError, refetch } = useQuery({
        queryKey: ['agent-file', agentId, path],
        queryFn: () => fileApi.read(agentId, path).catch(() => null),
        enabled: !!agentId,
    });
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const fileExists = data !== null && data !== undefined;

    const handleSave = async () => {
        setSaving(true);
        try {
            await fileApi.write(agentId, path, draft);
            queryClient.invalidateQueries({ queryKey: ['agent-file', agentId, path] });
            setEditing(false);
        } finally {
            setSaving(false);
        }
    };

    const handleCreate = async () => {
        setSaving(true);
        try {
            await fileApi.write(agentId, path, '');
            queryClient.invalidateQueries({ queryKey: ['agent-file', agentId, path] });
            refetch();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="card" style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600 }}>{title}</h3>
                {fileExists && !readOnly && !editing && (
                    <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => { setDraft(data?.content || ''); setEditing(true); }}>
                        {t('agent.overview.editFile')}
                    </button>
                )}
                {editing && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => setEditing(false)}>
                            {t('agent.overview.cancelEdit')}
                        </button>
                        <button className="btn btn-primary" style={{ fontSize: '12px', padding: '4px 12px' }} disabled={saving} onClick={handleSave}>
                            {saving ? t('agent.overview.saving') : t('agent.overview.saveFile')}
                        </button>
                    </div>
                )}
            </div>
            {!fileExists && (isError || data === null) ? (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                    <div style={{ marginBottom: '8px' }}>{t('agent.overview.fileNotExists')}</div>
                    {!readOnly && (
                        <button className="btn btn-secondary" style={{ fontSize: '12px' }} disabled={saving} onClick={handleCreate}>
                            {saving ? t('agent.overview.saving') : t('agent.overview.createFile')}
                        </button>
                    )}
                </div>
            ) : editing ? (
                <textarea
                    className="input"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    rows={10}
                    style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box' }}
                />
            ) : (
                <div style={{ fontSize: '13px', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                    {data?.content ? (
                        <MarkdownRenderer content={data.content} />
                    ) : (
                        <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>{path}</span>
                    )}
                </div>
            )}
        </div>
    );
}

function AgentDetailInner() {
    const { t, i18n } = useTranslation();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const location = useLocation();
    const validTabs = ['chat', 'overview', 'skills', 'activity', 'settings'];
    const hashTab = location.hash?.replace('#', '');
    const [activeTab, setActiveTabRaw] = useState<string>(hashTab && validTabs.includes(hashTab) ? hashTab : 'chat');

    // Sync URL hash when tab changes
    const setActiveTab = (tab: string) => {
        setActiveTabRaw(tab);
        window.history.replaceState(null, '', `#${tab}`);
    };

    const { data: agent, isLoading } = useQuery({
        queryKey: ['agent', id],
        queryFn: () => agentApi.get(id!),
        enabled: !!id,
    });

    // ── Aware tab data: triggers ──
    const { data: awareTriggers = [], refetch: refetchTriggers } = useQuery({
        queryKey: ['triggers', id],
        queryFn: () => triggerApi.list(id!),
        enabled: !!id && activeTab === 'overview',
        refetchInterval: activeTab === 'overview' ? 5000 : false,
    });

    // ── Aware tab data: focus.md ──
    const { data: focusFile } = useQuery({
        queryKey: ['file', id, 'focus.md'],
        queryFn: () => fileApi.read(id!, 'focus.md').catch(() => null),
        enabled: !!id && activeTab === 'overview',
    });

    // ── Aware tab data: task_history.md ──
    const { data: taskHistoryFile } = useQuery({
        queryKey: ['file', id, 'task_history.md'],
        queryFn: () => fileApi.read(id!, 'task_history.md').catch(() => null),
        enabled: !!id && activeTab === 'overview',
    });

    // ── Aware tab data: reflection sessions (trigger monologues) ──
    const { data: reflectionSessions = [] } = useQuery({
        queryKey: ['reflection-sessions', id],
        queryFn: async () => {
            const tkn = localStorage.getItem('token');
            const res = await fetch(`/api/v1/agents/${id}/sessions?scope=all`, { headers: { Authorization: `Bearer ${tkn}` } });
            if (!res.ok) return [];
            const all = await res.json();
            return all.filter((s: any) => s.source_channel === 'trigger');
        },
        enabled: !!id && activeTab === 'overview',
        refetchInterval: activeTab === 'overview' ? 10000 : false,
    });

    // ── Aware tab state ──
    const [expandedFocus, setExpandedFocus] = useState<string | null>(null);
    const [expandedReflection, setExpandedReflection] = useState<string | null>(null);
    const [reflectionMessages, setReflectionMessages] = useState<Record<string, any[]>>({});
    const [showAllFocus, setShowAllFocus] = useState(false);
    const [showCompletedFocus, setShowCompletedFocus] = useState(false);
    const [showAllTriggers, setShowAllTriggers] = useState(false);
    const [showAllReflections, setShowAllReflections] = useState(false);
    const [skillSubTab, setSkillSubTab] = useState<'skills' | 'mcp' | 'knowledge'>('skills');
    const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
    const { data: expandedSkillContent } = useQuery({
        queryKey: ['skill-content', id, expandedSkill],
        queryFn: () => fileApi.read(id!, expandedSkill!),
        enabled: !!id && !!expandedSkill,
    });
    const [reflectionPage, setReflectionPage] = useState(0);
    const REFLECTIONS_PAGE_SIZE = 10;
    const SECTION_PAGE_SIZE = 5;

    const { data: soulContent } = useQuery({
        queryKey: ['file', id, 'soul.md'],
        queryFn: () => fileApi.read(id!, 'soul.md'),
        enabled: !!id && (activeTab === 'skills' || activeTab === 'overview'),
    });

    const { data: memoryFiles = [] } = useQuery({
        queryKey: ['files', id, 'memory'],
        queryFn: () => fileApi.list(id!, 'memory'),
        enabled: !!id && activeTab === 'skills',
    });
    const [expandedMemory, setExpandedMemory] = useState<string | null>(null);
    const { data: memoryFileContent } = useQuery({
        queryKey: ['file', id, expandedMemory],
        queryFn: () => fileApi.read(id!, expandedMemory!),
        enabled: !!id && !!expandedMemory,
    });

    const { data: skillFiles = [] } = useQuery({
        queryKey: ['files', id, 'skills'],
        queryFn: () => fileApi.list(id!, 'skills'),
        enabled: !!id && activeTab === 'skills',
    });

    const [workspacePath, setWorkspacePath] = useState('workspace');
    const { data: workspaceFiles = [] } = useQuery({
        queryKey: ['files', id, workspacePath],
        queryFn: () => fileApi.list(id!, workspacePath),
        enabled: !!id && activeTab === 'skills',
    });

    const { data: activityLogs = [] } = useQuery({
        queryKey: ['activity', id],
        queryFn: () => activityApi.list(id!, 100),
        enabled: !!id && (activeTab === 'activity' || activeTab === 'overview'),
        refetchInterval: activeTab === 'activity' ? 10000 : false,
    });

    // Chat history
    // ── Session state (replaces old conversations query) ──────────────────
    const [sessions, setSessions] = useState<any[]>([]);
    const [allSessions, setAllSessions] = useState<any[]>([]);
    const [activeSession, setActiveSession] = useState<any | null>(null);
    const [chatScope, setChatScope] = useState<'mine' | 'all'>('mine');
    const [allUserFilter, setAllUserFilter] = useState<string>('');  // filter by username in All Users
    const [historyMsgs, setHistoryMsgs] = useState<any[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [agentExpired, setAgentExpired] = useState(false);

    const fetchMySessions = async (silent = false) => {
        if (!id) return;
        if (!silent) setSessionsLoading(true);
        try {
            const tkn = localStorage.getItem('token');
            const res = await fetch(`/api/v1/agents/${id}/sessions?scope=mine`, { headers: { Authorization: `Bearer ${tkn}` } });
            if (res.ok) { const data = await res.json(); setSessions(data); return data; }
        } catch { }
        if (!silent) setSessionsLoading(false);
        return [];
    };

    const fetchAllSessions = async () => {
        if (!id) return;
        try {
            const tkn = localStorage.getItem('token');
            const res = await fetch(`/api/v1/agents/${id}/sessions?scope=all`, { headers: { Authorization: `Bearer ${tkn}` } });
            if (res.ok) {
                const all = await res.json();
                setAllSessions(all.filter((s: any) => s.source_channel !== 'trigger'));
            }
        } catch { }
    };

    const createNewSession = async () => {
        try {
            const tkn = localStorage.getItem('token');
            const res = await fetch(`/api/v1/agents/${id}/sessions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tkn}` },
                body: JSON.stringify({}),
            });
            if (res.ok) {
                const newSess = await res.json();
                setSessions(prev => [newSess, ...prev]);
                setChatMessages([]);
                setHistoryMsgs([]);
                setActiveSession(newSess);
            } else {
                const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
                console.error('Failed to create session:', err);
                alert(`Failed to create session: ${err.detail || res.status}`);
            }
        } catch (err: any) {
            console.error('Failed to create session:', err);
            alert(`Failed to create session: ${err.message || err}`);
        }
    };

    const deleteSession = async (sessionId: string) => {
        if (!confirm(t('chat.deleteConfirm', 'Delete this session and all its messages? This cannot be undone.'))) return;
        const tkn = localStorage.getItem('token');
        try {
            await fetch(`/api/v1/agents/${id}/sessions/${sessionId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tkn}` } });
            // If deleted the active session, clear it
            if (activeSession?.id === sessionId) {
                setActiveSession(null);
                setChatMessages([]);
                setHistoryMsgs([]);
            }
            // Refresh session lists
            const r1 = await fetch(`/api/v1/agents/${id}/sessions?scope=mine`, { headers: { Authorization: `Bearer ${tkn}` } });
            if (r1.ok) setSessions(await r1.json());
            const r2 = await fetch(`/api/v1/agents/${id}/sessions?scope=all`, { headers: { Authorization: `Bearer ${tkn}` } });
            if (r2.ok) {
                const all2 = await r2.json();
                setAllSessions(all2.filter((s: any) => s.source_channel !== 'trigger'));
            }
        } catch (e: any) {
            alert(e.message || 'Delete failed');
        }
    };

    const selectSession = async (sess: any) => {
        setChatMessages([]);
        setHistoryMsgs([]);
        setActiveSession(sess);
        // Always load stored messages for the selected session
        const tkn = localStorage.getItem('token');
        const res = await fetch(`/api/v1/agents/${id}/sessions/${sess.id}/messages`, { headers: { Authorization: `Bearer ${tkn}` } });
        if (res.ok) {
            const msgs = await res.json();
            const normalizedMsgs = msgs.map((m: any) => (
                m.role === 'tool_result'
                    ? { ...m, timestamp: m.created_at || undefined }
                    : parseChatMsg(m)
            ));
            // Agent-to-agent sessions are always read-only
            const isAgentSession = sess.source_channel === 'agent' || sess.participant_type === 'agent';
            if (!isAgentSession && sess.user_id === String(currentUser?.id)) {
                // Own session: load into chatMessages so WS can append new replies seamlessly
                setChatMessages(normalizedMsgs.filter((m: any) => m.role !== 'tool_result'));
            } else {
                // Other user's session or agent-to-agent: read-only view
                setHistoryMsgs(normalizedMsgs);
            }
        }
    };

    // Websocket chat state (for 'me' conversation)
    const token = useAuthStore((s) => s.token);
    const currentUser = useAuthStore((s) => s.user);
    const isAdmin = currentUser?.role === 'platform_admin' || currentUser?.role === 'org_admin';
    const resolveHistoryImageUrl = (fileName: string) => {
        if (!id || !token) return undefined;
        return `/api/v1/agents/${id}/files/download?path=workspace/uploads/${encodeURIComponent(fileName)}&token=${token}`;
    };

    // Expiry editor modal state
    const [showExpiryModal, setShowExpiryModal] = useState(false);
    const [expiryValue, setExpiryValue] = useState('');       // datetime-local string or ''
    const [expirySaving, setExpirySaving] = useState(false);

    const openExpiryModal = () => {
        const cur = (agent as any)?.expires_at;
        // Convert ISO to datetime-local format (YYYY-MM-DDTHH:MM)
        setExpiryValue(cur ? new Date(cur).toISOString().slice(0, 16) : '');
        setShowExpiryModal(true);
    };

    const addHours = (h: number) => {
        const base = (agent as any)?.expires_at ? new Date((agent as any).expires_at) : new Date();
        const next = new Date(base.getTime() + h * 3600_000);
        setExpiryValue(next.toISOString().slice(0, 16));
    };

    const saveExpiry = async (permanent = false) => {
        setExpirySaving(true);
        try {
            const token = localStorage.getItem('token');
            const body = permanent ? { expires_at: null } : { expires_at: expiryValue ? new Date(expiryValue).toISOString() : null };
            await fetch(`/api/v1/agents/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(body),
            });
            queryClient.invalidateQueries({ queryKey: ['agent', id] });
            setShowExpiryModal(false);
        } catch (e) { alert('Failed: ' + e); }
        setExpirySaving(false);
    };
    const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [wsConnected, setWsConnected] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [isWaiting, setIsWaiting] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(-1);
    const uploadAbortRef = useRef<(() => void) | null>(null);
    const [attachedFiles, setAttachedFiles] = useState<ChatAttachment[]>([]);
    const wsRef = useRef<WebSocket | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const chatInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Settings form local state
    const [settingsForm, setSettingsForm] = useState({
        primary_model_id: '',
        fallback_model_id: '',
        context_window_size: 100,
        max_tool_rounds: 50,
        max_tokens_per_day: '' as string | number,
        max_tokens_per_month: '' as string | number,
        max_triggers: 20,
        min_poll_interval_min: 5,
        webhook_rate_limit: 5,
    });
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [settingsSaved, setSettingsSaved] = useState(false);
    const [settingsError, setSettingsError] = useState('');
    const settingsInitRef = useRef(false);

    // Sync settings form from server data on load
    useEffect(() => {
        if (agent && !settingsInitRef.current) {
            setSettingsForm({
                primary_model_id: agent.primary_model_id || '',
                fallback_model_id: agent.fallback_model_id || '',
                context_window_size: agent.context_window_size ?? 100,
                max_tool_rounds: (agent as any).max_tool_rounds ?? 50,
                max_tokens_per_day: agent.max_tokens_per_day || '',
                max_tokens_per_month: agent.max_tokens_per_month || '',
                max_triggers: (agent as any).max_triggers ?? 20,
                min_poll_interval_min: (agent as any).min_poll_interval_min ?? 5,
                webhook_rate_limit: (agent as any).webhook_rate_limit ?? 5,
            });
            settingsInitRef.current = true;
        }
    }, [agent]);

    // Welcome message editor state (must be at top level -- not inside IIFE)
    const [wmDraft, setWmDraft] = useState('');
    const [wmSaved, setWmSaved] = useState(false);
    useEffect(() => { setWmDraft((agent as any)?.welcome_message || ''); }, [(agent as any)?.welcome_message]);

    // Reset cached state when switching to a different agent
    const prevIdRef = useRef(id);
    useEffect(() => {
        if (id && id !== prevIdRef.current) {
            prevIdRef.current = id;
            settingsInitRef.current = false;
            setSettingsSaved(false);
            setSettingsError('');
            setWmDraft('');
            setWmSaved(false);
            // Invalidate all queries for the old agent to force fresh data
            queryClient.invalidateQueries({ queryKey: ['agent', id] });
            // Re-apply hash so refresh preserves the current tab
            window.history.replaceState(null, '', `#${activeTab}`);
        }
    }, [id]);

    // Load chat history + connect websocket when chat tab is active
    const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
    const parseChatMsg = (msg: Record<string, unknown>): ChatMsg => {
        return hydrateTimelineMessage(msg, {
            resolveImageUrl: resolveHistoryImageUrl,
        });
    };

    const hasToolArgs = (toolArgs: unknown): toolArgs is Record<string, unknown> => (
        typeof toolArgs === 'object'
        && toolArgs !== null
        && Object.keys(toolArgs).length > 0
    );

    const formatToolArgsSummary = (toolArgs: unknown) => {
        if (!hasToolArgs(toolArgs)) return '';
        return Object.entries(toolArgs)
            .map(([key, value]) => `${key}: ${typeof value === 'string' ? value.slice(0, 30) : JSON.stringify(value)}`)
            .join(', ');
    };

    const formatChatTimestamp = (value?: string) => {
        if (!value) return '';
        const d = new Date(value);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const isToday = d.toDateString() === now.toDateString();
        if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (diffMs < 7 * 86400000) {
            return `${d.toLocaleDateString([], { weekday: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        }
        return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    };


    // Reset state whenever the viewed agent changes
    useEffect(() => {
        setActiveSession(null);
        setChatMessages([]);
        setHistoryMsgs([]);
        setChatScope('mine');
        setAgentExpired(false);
        settingsInitRef.current = false;
    }, [id]);

    useEffect(() => {
        if (!id || !token || activeTab !== 'chat') return;
        // Load sessions when entering chat tab; auto-select first and load its history
        fetchMySessions().then((data: any) => {
            setSessionsLoading(false);
            if (data && data.length > 0) selectSession(data[0]);
        });
    }, [id, activeTab]);

    useEffect(() => {
        if (!id || !token || activeTab !== 'chat') return;
        if (!activeSession) return;  // wait for session to be set
        // Only connect WS for own sessions (not other users' and not agent-to-agent)
        const isAgentSession = activeSession.source_channel === 'agent' || activeSession.participant_type === 'agent';
        if (isAgentSession) return;
        if (activeSession.user_id && currentUser && activeSession.user_id !== String(currentUser.id)) return;
        let cancelled = false;
        const sessionParam = activeSession?.id ? `&session_id=${activeSession.id}` : '';
        const connect = () => {
            if (cancelled) return;
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(`${protocol}//${window.location.host}/ws/chat/${id}?token=${token}${sessionParam}`);
            ws.onopen = () => { if (cancelled) { ws.close(); return; } setWsConnected(true); wsRef.current = ws; };
            ws.onclose = (e) => {
                if (e.code === 4003 || e.code === 4002) {
                    // 4003 = Agent expired, 4002 = Config error (no model, setup failed)
                    if (e.code === 4003) setAgentExpired(true);
                    setWsConnected(false);
                    setIsWaiting(false);
                    setIsStreaming(false);
                    return;
                }
                if (!cancelled) { setWsConnected(false); setIsWaiting(false); setIsStreaming(false); setTimeout(connect, 2000); }
            };
            ws.onerror = () => { if (!cancelled) setWsConnected(false); };
            ws.onmessage = (e) => {
                const d = JSON.parse(e.data);
                if (['thinking', 'chunk', 'tool_call', 'done', 'error', 'quota_exceeded'].includes(d.type)) {
                    setIsWaiting(false);
                    if (['thinking', 'chunk', 'tool_call'].includes(d.type)) setIsStreaming(true);
                    if (['done', 'error', 'quota_exceeded'].includes(d.type)) setIsStreaming(false);
                }

                if (['thinking', 'tool_call', 'chunk', 'done'].includes(d.type)) {
                    setChatMessages((prev) => applyStreamEvent(prev, d, new Date().toISOString()));
                    // Silently refresh session list to update last_message_at (no loading spinner)
                    fetchMySessions(true);
                } else if (d.type === 'error' || d.type === 'quota_exceeded') {
                    const msg = d.content || d.detail || d.message || 'Request denied';
                    // Only add message if not a duplicate of the last one
                    setChatMessages(prev => {
                        const last = prev[prev.length - 1];
                        if (last && last.role === 'assistant' && last.content === `⚠️ ${msg}`) return prev;
                        return [...prev, { role: 'assistant', content: `⚠️ ${msg}` }];
                    });
                    // Permanent errors — stop reconnecting
                    if (msg.includes('expired') || msg.includes('Setup failed') || msg.includes('no LLM model') || msg.includes('No model')) {
                        cancelled = true;
                        if (msg.includes('expired')) setAgentExpired(true);
                    }
                } else if (d.type === 'trigger_notification') {
                    // Trigger fired — show the result as a new assistant message
                    setChatMessages(prev => [...prev, { role: 'assistant', content: d.content }]);
                    fetchMySessions(true);
                } else {
                    setChatMessages(prev => [...prev, parseChatMsg({
                        ...d,
                        created_at: new Date().toISOString(),
                    })]);
                }
            };
        };
        connect();
        return () => { cancelled = true; wsRef.current?.close(); wsRef.current = null; setWsConnected(false); };
    }, [id, token, activeTab, activeSession?.id]);

    // Smart scroll: only auto-scroll if user is at the bottom
    const isNearBottom = useRef(true);
    const isFirstLoad = useRef(true);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    // Read-only history scroll-to-bottom
    const historyContainerRef = useRef<HTMLDivElement>(null);
    const [showHistoryScrollBtn, setShowHistoryScrollBtn] = useState(false);
    const handleHistoryScroll = () => {
        const el = historyContainerRef.current;
        if (!el) return;
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        setShowHistoryScrollBtn(distFromBottom > 200);
    };
    const scrollHistoryToBottom = () => {
        const el = historyContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
        setShowHistoryScrollBtn(false);
    };
    // Auto-show button when history messages overflow the container
    useEffect(() => {
        const el = historyContainerRef.current;
        if (!el) return;
        // Use a small timeout to let the DOM render the messages first
        const timer = setTimeout(() => {
            const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            setShowHistoryScrollBtn(distFromBottom > 200);
        }, 100);
        return () => clearTimeout(timer);
    }, [historyMsgs, activeSession?.id]);
    const handleChatScroll = () => {
        const el = chatContainerRef.current;
        if (!el) return;
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        isNearBottom.current = distFromBottom < 5;
        setShowScrollBtn(distFromBottom > 200);
    };
    const scrollToBottom = () => {
        chatEndRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
        setShowScrollBtn(false);
    };
    useEffect(() => {
        if (!chatEndRef.current) return;
        if (isFirstLoad.current && chatMessages.length > 0) {
            // First load: instant jump to bottom, no animation
            chatEndRef.current.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
            isFirstLoad.current = false;
            // Auto-focus the input
            setTimeout(() => chatInputRef.current?.focus(), 100);
            return;
        }
        if (isNearBottom.current) {
            chatEndRef.current.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
        }
    }, [chatMessages]);

    // Auto-focus input when switching sessions
    useEffect(() => {
        if (activeSession && activeTab === 'chat') {
            setTimeout(() => chatInputRef.current?.focus(), 150);
        }
    }, [activeSession?.id, activeTab]);

    const sendChatMsg = () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (!chatInput.trim() && attachedFiles.length === 0) return;
        
        let userMsg = chatInput.trim();
        let contentForLLM = userMsg;
        let displayFiles = '';

        if (attachedFiles.length > 0) {
            let filesPrompt = '';
            let filesDisplay = '';
            
            attachedFiles.forEach(file => {
                filesDisplay += `[📎 ${file.name}] `;
                if (file.imageUrl && supportsVision) {
                    filesPrompt += `[image_data:${file.imageUrl}]\n`;
                } else if (file.imageUrl) {
                    filesPrompt += `[图片文件已上传: ${file.name}，保存在 ${file.path || ''}]\n`;
                } else {
                    const wsPath = file.path || '';
                    const codePath = wsPath.replace(/^workspace\//, '');
                    const fileLoc = wsPath ? `\nFile location: ${wsPath} (for read_file/read_document tools)\nIn execute_code, use relative path: "${codePath}" (working directory is workspace/)\n` : '';
                    filesPrompt += `[File: ${file.name}]${fileLoc}\n${file.text}\n\n`;
                }
            });

            if (supportsVision && attachedFiles.some(f => f.imageUrl)) {
                contentForLLM = userMsg ? `${filesPrompt}\n${userMsg}` : `${filesPrompt}\n请分析这些文件`;
            } else {
                contentForLLM = userMsg ? `${filesPrompt}\nQuestion: ${userMsg}` : `Please analyze these files:\n\n${filesPrompt}`;
            }
            
            displayFiles = filesDisplay.trim();
            userMsg = userMsg ? `${displayFiles}\n${userMsg}` : displayFiles;
        }

        setIsWaiting(true);
        setIsStreaming(false);
        setChatMessages(prev => [...prev, { 
            role: 'user', 
            content: userMsg, 
            fileName: attachedFiles.map(f => f.name).join(', '), 
            imageUrl: attachedFiles.length === 1 ? attachedFiles[0].imageUrl : undefined, 
            timestamp: new Date().toISOString() 
        }]);
        wsRef.current.send(JSON.stringify({ 
            content: contentForLLM, 
            display_content: userMsg, 
            file_name: attachedFiles.map(f => f.name).join(', ') 
        }));
        
        setChatInput(''); 
        setAttachedFiles([]);
    };

    const uploadChatFiles = async (filesToUpload: File[]) => {
        const progress = filesToUpload.map(() => 0);
        const requests = filesToUpload.map((file, index) =>
            chatApi.uploadAttachment(file, id, (pct) => {
                progress[index] = pct;
                const allUploaded = progress.every((value) => value >= 101);
                if (allUploaded) {
                    setUploadProgress(101);
                    return;
                }
                const bounded = progress.map((value) => Math.min(value, 100));
                const average = bounded.reduce((sum, value) => sum + value, 0) / bounded.length;
                setUploadProgress(Math.round(average));
            }),
        );
        uploadAbortRef.current = () => requests.forEach((request) => request.abort());
        const results = await Promise.all(requests.map((request) => request.promise));
        setAttachedFiles((prev) => [...prev, ...results].slice(0, 10));
    };

    const handleChatFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        const allowedFiles = files.slice(0, 10 - attachedFiles.length);
        if (!allowedFiles.length) {
            alert('Limit of 10 attached files reached.');
            return;
        }
        
        setUploading(true); setUploadProgress(0);
        try {
            await uploadChatFiles(allowedFiles);
        } catch (err: any) {
            if (err?.message !== 'Upload cancelled') alert(t('agent.upload.failed'));
        } finally { 
            setUploading(false); setUploadProgress(-1); uploadAbortRef.current = null; 
            if (fileInputRef.current) fileInputRef.current.value = ''; 
        }
    };

    // Clipboard paste handler — auto-upload pasted images
    const handlePaste = async (e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        
        const filesToUpload: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                const blob = items[i].getAsFile();
                if (blob) {
                    const ext = blob.type.split('/')[1] || 'png';
                    const fileName = `paste-${Date.now()}-${i}.${ext}`;
                    filesToUpload.push(new File([blob], fileName, { type: blob.type }));
                }
            }
        }
        
        if (!filesToUpload.length) return;
        e.preventDefault();
        const allowedFiles = filesToUpload.slice(0, 10 - attachedFiles.length);
        if (!allowedFiles.length) {
            alert('Limit of 10 attached files reached.');
            return;
        }

        setUploading(true); setUploadProgress(0);
        try {
            await uploadChatFiles(allowedFiles);
        } catch (err: any) {
            if (err?.message !== 'Upload cancelled') alert(t('agent.upload.failed'));
        } finally { setUploading(false); setUploadProgress(-1); uploadAbortRef.current = null; }
    };

    // Expandable activity log
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
    const [logFilter, setLogFilter] = useState<string>('user'); // 'user' | 'backend' | 'heartbeat' | 'schedule' | 'messages'

    // Import skill from presets
    const [showImportSkillModal, setShowImportSkillModal] = useState(false);
    const [importingSkillId, setImportingSkillId] = useState<string | null>(null);
    const { data: globalSkillsForImport } = useQuery({
        queryKey: ['global-skills-for-import'],
        queryFn: () => skillApi.list(),
        enabled: showImportSkillModal,
    });
    // Agent-level import from ClawHub / URL
    const [showAgentClawhub, setShowAgentClawhub] = useState(false);
    const [agentClawhubQuery, setAgentClawhubQuery] = useState('');
    const [agentClawhubResults, setAgentClawhubResults] = useState<any[]>([]);
    const [agentClawhubSearching, setAgentClawhubSearching] = useState(false);
    const [agentClawhubInstalling, setAgentClawhubInstalling] = useState<string | null>(null);
    const [showAgentUrlImport, setShowAgentUrlImport] = useState(false);
    const [agentUrlInput, setAgentUrlInput] = useState('');
    const [agentUrlImporting, setAgentUrlImporting] = useState(false);

    const { data: schedules = [] } = useQuery({
        queryKey: ['schedules', id],
        queryFn: () => scheduleApi.list(id!),
        enabled: !!id && activeTab === 'overview',
    });

    // Schedule form state
    const [showScheduleForm, setShowScheduleForm] = useState(false);
    const schedDefaults = { freq: 'daily', interval: 1, time: '09:00', weekdays: [1, 2, 3, 4, 5] };
    const [schedForm, setSchedForm] = useState({ name: '', instruction: '', schedule: JSON.stringify(schedDefaults), due_date: '' });

    const createScheduleMut = useMutation({
        mutationFn: () => {
            let sched: any;
            try { sched = JSON.parse(schedForm.schedule); } catch { sched = schedDefaults; }
            return scheduleApi.create(id!, { name: schedForm.name, instruction: schedForm.instruction, cron_expr: schedToCron(sched) });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schedules', id] });
            setShowScheduleForm(false);
            setSchedForm({ name: '', instruction: '', schedule: JSON.stringify(schedDefaults), due_date: '' });
        },
        onError: (err: any) => {
            const msg = err?.detail || err?.message || String(err);
            alert(`Failed to create schedule: ${msg}`);
        },
    });

    const toggleScheduleMut = useMutation({
        mutationFn: ({ sid, enabled }: { sid: string; enabled: boolean }) =>
            scheduleApi.update(id!, sid, { is_enabled: enabled }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules', id] }),
    });

    const deleteScheduleMut = useMutation({
        mutationFn: (sid: string) => scheduleApi.delete(id!, sid),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules', id] }),
    });

    const triggerScheduleMut = useMutation({
        mutationFn: async (sid: string) => {
            const res = await scheduleApi.trigger(id!, sid);
            return res;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schedules', id] });
            showToast('✅ Schedule triggered — executing in background', 'success');
        },
        onError: (err: any) => {
            const msg = err?.response?.data?.detail || err?.message || 'Failed to trigger schedule';
            showToast(msg, 'error');
        },
    });


    const { data: metrics } = useQuery({
        queryKey: ['metrics', id],
        queryFn: () => agentApi.metrics(id!).catch(() => null),
        enabled: !!id && activeTab === 'overview',
        retry: false,
    });

    const { data: channelConfig } = useQuery({
        queryKey: ['channel', id],
        queryFn: () => channelApi.get(id!),
        enabled: !!id && activeTab === 'settings',
    });

    const { data: webhookData } = useQuery({
        queryKey: ['webhook-url', id],
        queryFn: () => channelApi.webhookUrl(id!),
        enabled: !!id && activeTab === 'settings',
    });

    const { data: llmModels = [] } = useQuery({
        queryKey: ['llm-models'],
        queryFn: () => enterpriseApi.llmModels(),
        enabled: activeTab === 'settings' || activeTab === 'overview' || activeTab === 'chat',
    });

    const supportsVision = !!agent?.primary_model_id && llmModels.some(
        (m: any) => m.id === agent.primary_model_id && m.supports_vision
    );

    const { data: permData } = useQuery({
        queryKey: ['agent-permissions', id],
        queryFn: () => fetchAuth<any>(`/agents/${id}/permissions`),
        enabled: !!id && activeTab === 'settings',
    });

    // ─── Soul editor ─────────────────────────────────────
    const [soulEditing, setSoulEditing] = useState(false);
    const [soulDraft, setSoulDraft] = useState('');

    const saveSoul = useMutation({
        mutationFn: () => fileApi.write(id!, 'soul.md', soulDraft),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['file', id, 'soul.md'] });
            setSoulEditing(false);
        },
    });

    // ─── Focus editor (overview tab) ─────────────────────
    const [focusEditing, setFocusEditing] = useState(false);
    const [focusDraft, setFocusDraft] = useState('');

    const saveFocus = useMutation({
        mutationFn: () => fileApi.write(id!, 'focus.md', focusDraft),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['file', id, 'focus.md'] });
            setFocusEditing(false);
        },
    });

    // Memory sub-tab removed — memory.md is now edited via FileEditorCard in overview


    const CopyBtn = ({ url }: { url: string }) => (
        <button title="Copy" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginLeft: '6px', padding: '1px 4px', cursor: 'pointer', borderRadius: '3px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-secondary)', verticalAlign: 'middle', lineHeight: 1 }}
            onClick={() => navigator.clipboard.writeText(url).then(() => { })}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="9" height="11" rx="1.5" /><path d="M3 11H2a1 1 0 01-1-1V2a1 1 0 011-1h8a1 1 0 011 1v1" />
            </svg>
        </button>
    );

    // ─── File viewer ─────────────────────────────────────
    const [viewingFile, setViewingFile] = useState<string | null>(null);
    const [fileEditing, setFileEditing] = useState(false);
    const [fileDraft, setFileDraft] = useState('');
    const [promptModal, setPromptModal] = useState<{ title: string; placeholder: string; action: string } | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; name: string; isDir: boolean } | null>(null);
    const [uploadToast, setUploadToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [editingRole, setEditingRole] = useState(false);
    const [roleInput, setRoleInput] = useState('');
    const [editingName, setEditingName] = useState(false);
    const [nameInput, setNameInput] = useState('');
    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setUploadToast({ message, type });
        setTimeout(() => setUploadToast(null), 3000);
    };
    const { data: fileContent } = useQuery({
        queryKey: ['file-content', id, viewingFile],
        queryFn: () => fileApi.read(id!, viewingFile!),
        enabled: !!viewingFile,
    });

    // ─── Task creation & detail ───────────────────────────────────
    const [showTaskForm, setShowTaskForm] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [taskForm, setTaskForm] = useState({ title: '', description: '', priority: 'medium', type: 'todo' as 'todo' | 'supervision', supervision_target_name: '', remind_schedule: '', due_date: '' });
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const { data: taskLogs = [] } = useQuery({
        queryKey: ['task-logs', id, selectedTaskId],
        queryFn: () => taskApi.getLogs(id!, selectedTaskId!),
        enabled: !!id && !!selectedTaskId,
        refetchInterval: selectedTaskId ? 3000 : false,
    });

    // Schedule execution history (selectedTaskId format: 'sched-{uuid}')
    const expandedScheduleId = selectedTaskId?.startsWith('sched-') ? selectedTaskId.slice(6) : null;
    const { data: scheduleHistoryData } = useQuery({
        queryKey: ['schedule-history', id, expandedScheduleId],
        queryFn: () => scheduleApi.history(id!, expandedScheduleId!),
        enabled: !!id && !!expandedScheduleId,
    });
    const createTask = useMutation({
        mutationFn: (data: any) => {
            const cleaned = { ...data };
            if (!cleaned.due_date) delete cleaned.due_date;
            return taskApi.create(id!, cleaned);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tasks', id] });
            setShowTaskForm(false);
            setTaskForm({ title: '', description: '', priority: 'medium', type: 'todo', supervision_target_name: '', remind_schedule: '', due_date: '' });
        },
    });

    if (isLoading || !agent) {
        return <div style={{ padding: '40px', color: 'var(--text-tertiary)' }}>{t('common.loading')}</div>;
    }

    // Compute display status (including OpenClaw disconnected detection)
    const computeStatusKey = () => {
        if (agent.status === 'error') return 'error';
        if (agent.status === 'creating') return 'creating';
        if (agent.status === 'stopped') return 'stopped';
        if ((agent as any).agent_type === 'openclaw' && agent.status === 'running' && (agent as any).openclaw_last_seen) {
            const elapsed = Date.now() - new Date((agent as any).openclaw_last_seen).getTime();
            if (elapsed > 60 * 60 * 1000) return 'disconnected';
        }
        return agent.status === 'running' ? 'running' : 'idle';
    };
    const statusKey = computeStatusKey();
    const canManage = (agent as any).access_level === 'manage' || isAdmin;

    return (
        <>
            <div>
                {/* Header */}
                <div className="page-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--accent-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>{(Array.from(agent.name || 'A')[0] as string || 'A').toUpperCase()}</div>
                        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                            {canManage && editingName ? (
                                <input
                                    className="page-title"
                                    autoFocus
                                    value={nameInput}
                                    onChange={e => setNameInput(e.target.value)}
                                    onBlur={async () => {
                                        setEditingName(false);
                                        if (nameInput.trim() && nameInput !== agent.name) {
                                            await agentApi.update(id!, { name: nameInput.trim() } as any);
                                            queryClient.invalidateQueries({ queryKey: ['agent', id] });
                                        } else {
                                            setNameInput(agent.name);
                                        }
                                    }}
                                    onKeyDown={async e => {
                                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                        if (e.key === 'Escape') { setEditingName(false); setNameInput(agent.name); }
                                    }}
                                    style={{
                                        background: 'var(--bg-elevated)', border: '1px solid var(--accent-primary)',
                                        borderRadius: '6px', color: 'var(--text-primary)',
                                        padding: '4px 10px', minWidth: '320px', width: 'auto', outline: 'none',
                                        marginBottom: '0', display: 'block',
                                    }}
                                />
                            ) : (
                                <h1 className="page-title"
                                    title={canManage ? "Click to edit name" : undefined}
                                    onClick={() => { if (canManage) { setNameInput(agent.name); setEditingName(true); } }}
                                    style={{ cursor: canManage ? 'text' : 'default', borderBottom: canManage ? '1px dashed transparent' : 'none', display: 'inline-block', marginBottom: '0' }}
                                    onMouseEnter={e => { if (canManage) e.currentTarget.style.borderBottomColor = 'var(--text-tertiary)'; }}
                                    onMouseLeave={e => { if (canManage) e.currentTarget.style.borderBottomColor = 'transparent'; }}
                                >
                                    {agent.name}
                                </h1>
                            )}
                            <p className="page-subtitle" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                                <span className={`status-dot ${statusKey}`} />
                                {t(`agent.status.${statusKey}`)}
                                {canManage && editingRole ? (
                                    <textarea
                                        autoFocus
                                        value={roleInput}
                                        onChange={e => setRoleInput(e.target.value)}
                                        onBlur={async () => {
                                            setEditingRole(false);
                                            if (roleInput !== agent.role_description) {
                                                await agentApi.update(id!, { role_description: roleInput } as any);
                                                queryClient.invalidateQueries({ queryKey: ['agent', id] });
                                            }
                                        }}
                                        onKeyDown={async e => {
                                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
                                            if (e.key === 'Escape') { setEditingRole(false); setRoleInput(agent.role_description || ''); }
                                        }}
                                        rows={2}
                                        style={{
                                            background: 'var(--bg-elevated)', border: '1px solid var(--accent-primary)',
                                            borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px',
                                            padding: '6px 10px', width: 'min(500px, 50vw)', outline: 'none',
                                            resize: 'vertical', lineHeight: '1.5', fontFamily: 'inherit',
                                        }}
                                    />
                                ) : (
                                    <span
                                        title={canManage ? (agent.role_description || 'Click to edit') : (agent.role_description || '')}
                                        onClick={() => { if (canManage) { setRoleInput(agent.role_description || ''); setEditingRole(true); } }}
                                        style={{ cursor: canManage ? 'text' : 'default', borderBottom: canManage ? '1px dashed transparent' : 'none', maxWidth: '38vw', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'middle' }}
                                        onMouseEnter={e => { if (canManage) e.currentTarget.style.borderBottomColor = 'var(--text-tertiary)'; }}
                                        onMouseLeave={e => { if (canManage) e.currentTarget.style.borderBottomColor = 'transparent'; }}
                                    >
                                        {agent.role_description ? `· ${agent.role_description}` : (canManage ? <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>· {t('agent.fields.role', 'Click to add a description...')}</span> : null)}
                                    </span>
                                )}
                                {(agent as any).is_expired && (
                                    <span style={{ background: 'var(--error)', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>Expired</span>
                                )}
                                {(agent as any).agent_type === 'openclaw' && (
                                    <span style={{
                                        fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
                                        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', fontWeight: 600,
                                        letterSpacing: '0.5px',
                                    }}>OpenClaw · Lab</span>
                                )}
                                {!(agent as any).is_expired && (agent as any).expires_at && (
                                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                        Expires: {new Date((agent as any).expires_at).toLocaleString()}
                                    </span>
                                )}
                                {isAdmin && (
                                    <button
                                        onClick={openExpiryModal}
                                        title="Edit expiry time"
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--text-tertiary)', padding: '1px 4px', borderRadius: '4px', lineHeight: 1 }}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                    >✏️ {t((agent as any).expires_at || (agent as any).is_expired ? 'agent.settings.expiry.renew' : 'agent.settings.expiry.setExpiry')}</button>
                                )}
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-primary" onClick={() => setActiveTab('chat')}>{t('agent.actions.chat')}</button>
                        {(agent as any)?.agent_type !== 'openclaw' && (
                            <>
                                {agent.status === 'stopped' ? (
                                    <button className="btn btn-secondary" onClick={async () => { await agentApi.start(id!); queryClient.invalidateQueries({ queryKey: ['agent', id] }); }}>{t('agent.actions.start')}</button>
                                ) : agent.status === 'running' ? (
                                    <button className="btn btn-secondary" onClick={async () => { await agentApi.stop(id!); queryClient.invalidateQueries({ queryKey: ['agent', id] }); }}>{t('agent.actions.stop')}</button>
                                ) : null}
                            </>
                        )}
                    </div>
                </div>

                {/* Tabs */}
                <div className="tabs">
                    {TABS.filter(tab => {
                        // 'use' access: hide settings tab
                        if ((agent as any)?.access_level === 'use') {
                            if (tab === 'settings') return false;
                        }
                        // OpenClaw agents: only show chat, overview, activity, settings
                        if ((agent as any)?.agent_type === 'openclaw') {
                            return ['chat', 'overview', 'activity', 'settings'].includes(tab);
                        }
                        return true;
                    }).map((tab) => (
                        <div key={tab} className={`tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
                            {t(`agent.tabs.${tab}`)}
                        </div>
                    ))}
                </div>

                {/* ── Overview Tab (identity card + tokens + 5 MD file editors) ── */}
                {activeTab === 'overview' && (() => {
                    const formatDate = (d: string) => {
                        try { return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return d; }
                    };

                    return (
                        <div>
                            {/* Identity card — compact one-row */}
                            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 18px', marginBottom: '16px' }}>
                                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--accent-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>
                                    {(Array.from(agent.name || 'A')[0] as string || 'A').toUpperCase()}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <span style={{ fontWeight: 600, fontSize: '15px' }}>{agent.name}</span>
                                        {agent.role_description && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{agent.role_description}</span>}
                                        <span className={`status-dot ${statusKey}`} />
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                        <span>{agent.created_at ? formatDate(agent.created_at) : ''}</span>
                                        {(agent as any).creator_username && <span>@{(agent as any).creator_username}</span>}
                                    </div>
                                </div>
                            </div>

                            {/* Token usage — 3 small cards */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '24px' }}>
                                <div className="card">
                                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>{t('agent.settings.today')} Token</div>
                                    <div style={{ fontSize: '22px', fontWeight: 600 }}>{formatTokens(agent.tokens_used_today)}</div>
                                    {agent.max_tokens_per_day && <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>/ {formatTokens(agent.max_tokens_per_day)}</div>}
                                </div>
                                <div className="card">
                                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>{t('agent.settings.month')} Token</div>
                                    <div style={{ fontSize: '22px', fontWeight: 600 }}>{formatTokens(agent.tokens_used_month)}</div>
                                    {agent.max_tokens_per_month && <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>/ {formatTokens(agent.max_tokens_per_month)}</div>}
                                </div>
                                <div className="card">
                                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>Total Token</div>
                                    <div style={{ fontSize: '22px', fontWeight: 600 }}>{formatTokens((agent as any).tokens_used_total || 0)}</div>
                                </div>
                            </div>

                            {(agent as any)?.agent_type === 'openclaw' && <OpenClawGatewayPanel agentId={id!} agent={agent} />}
                            <MemoryInsightsPanel agentId={id!} />
                            <CollaborationPanel agentId={id!} agent={agent} />

                            {/* 5 MD file editor cards */}
                            <FileEditorCard agentId={id!} path="soul.md" title={t('agent.overview.personality')} />
                            <FileEditorCard agentId={id!} path="memory/memory.md" title={t('agent.overview.memory')} />
                            <FileEditorCard agentId={id!} path="HEARTBEAT.md" title={t('agent.overview.heartbeat')} />
                            <FileEditorCard agentId={id!} path="relationships.md" title={t('agent.overview.relationships')} />
                            <FileEditorCard agentId={id!} path="memory/reflections.md" title={t('agent.overview.reflections')} readOnly />
                        </div>
                    );
                })()}

                {/* ── Skills Tab (3 sub-tabs: skills / mcp / knowledge) ── */}
                {
                    activeTab === 'skills' && (() => {
                        const adapter: FileBrowserApi = {
                            list: (p) => fileApi.list(id!, p),
                            read: (p) => fileApi.read(id!, p),
                            write: (p, c) => fileApi.write(id!, p, c),
                            delete: (p) => fileApi.delete(id!, p),
                            upload: (file, path, onProgress) => fileApi.upload(id!, file, path, onProgress),
                            downloadUrl: (p) => fileApi.downloadUrl(id!, p),
                        };
                        const allSkillItems = [...skillFiles];
                        // expandedSkill state and query are hoisted to main component level
                        // to avoid React hook ordering violation

                        return (
                            <div>
                                {/* Sub-tab pill navigation */}
                                <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: '8px' }}>
                                    {(['skills', 'mcp', 'knowledge'] as const).map(sub => (
                                        <button key={sub} onClick={() => setSkillSubTab(sub)}
                                            style={{
                                                padding: '6px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 500,
                                                background: skillSubTab === sub ? 'var(--bg-primary)' : 'transparent',
                                                color: skillSubTab === sub ? 'var(--text-primary)' : 'var(--text-tertiary)',
                                                border: 'none', cursor: 'pointer',
                                                transition: 'background 0.15s, color 0.15s',
                                            }}>
                                            {t(`agent.skillTabs.${sub}`)}
                                        </button>
                                    ))}
                                </div>

                                {/* ── Sub-tab 1: Skills ── */}
                                {skillSubTab === 'skills' && (
                                    <div>
                                        {/* Import buttons */}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                                            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: 0 }}>{t('agent.foundation.builtInHint')}</p>
                                            <div style={{ display: 'flex', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
                                                <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => { setShowAgentUrlImport(true); setAgentUrlInput(''); }}>
                                                    {t('agent.capability.skillsUrl')}
                                                </button>
                                                <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => { setShowAgentClawhub(true); setAgentClawhubQuery(''); setAgentClawhubResults([]); }}>
                                                    {t('agent.capability.skillsLibrary')}
                                                </button>
                                                <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => setShowImportSkillModal(true)}>
                                                    {t('agent.capability.skillsPreset')}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Expandable skill list */}
                                        {allSkillItems.length > 0 ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {allSkillItems.map((item: any) => {
                                                    const isExpanded = expandedSkill === item.path;
                                                    return (
                                                        <div key={item.path} className="card" style={{ padding: '14px' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
                                                                 onClick={() => setExpandedSkill(isExpanded ? null : item.path)}>
                                                                <span>{item.is_dir ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}</span>
                                                                <div style={{ flex: 1 }}>
                                                                    <div style={{ fontWeight: 500, fontSize: '13px' }}>{item.name}</div>
                                                                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                                                        {item.is_dir ? t('agent.skills.folderFormat') : t('agent.skills.flatFormat')}
                                                                    </div>
                                                                </div>
                                                                <span style={{ fontSize: '12px', color: 'var(--success)' }}>{'\u2713'}</span>
                                                                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{isExpanded ? '\u25BC' : '\u25B6'}</span>
                                                            </div>
                                                            {isExpanded && (
                                                                <div style={{ marginTop: '12px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                                                                    {item.is_dir ? (
                                                                        <FileBrowser api={adapter} rootPath={item.path} features={{ newFile: true, edit: true, delete: true, upload: true, directoryNavigation: true }} />
                                                                    ) : (
                                                                        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '12px', margin: 0, color: 'var(--text-secondary)', maxHeight: '400px', overflow: 'auto' }}>
                                                                            {expandedSkillContent?.content ?? t('common.loading')}
                                                                        </pre>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="card" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                                                {t('agent.capability.skillsEmpty')}
                                            </div>
                                        )}

                                        {/* Modals (ClawHub / URL / Presets) */}
                                        {showAgentClawhub && (
                                            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowAgentClawhub(false)}>
                                                <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-primary)', borderRadius: '12px', padding: '24px', maxWidth: '600px', width: '90%', maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                        <h3>{t('agent.capability.skillsLibrary')}</h3>
                                                        <button onClick={() => setShowAgentClawhub(false)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px 8px' }}>x</button>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                                                        <input className="input" placeholder={t('common.search')} value={agentClawhubQuery} onChange={e => setAgentClawhubQuery(e.target.value)}
                                                            onKeyDown={e => { if (e.key === 'Enter' && agentClawhubQuery.trim()) { setAgentClawhubSearching(true); skillApi.clawhub.search(agentClawhubQuery).then(r => { setAgentClawhubResults(r); setAgentClawhubSearching(false); }).catch(() => setAgentClawhubSearching(false)); } }}
                                                            style={{ flex: 1, fontSize: '13px' }} />
                                                        <button className="btn btn-primary" style={{ fontSize: '13px' }} disabled={!agentClawhubQuery.trim() || agentClawhubSearching}
                                                            onClick={() => { setAgentClawhubSearching(true); skillApi.clawhub.search(agentClawhubQuery).then(r => { setAgentClawhubResults(r); setAgentClawhubSearching(false); }).catch(() => setAgentClawhubSearching(false)); }}>
                                                            {agentClawhubSearching ? 'Searching...' : 'Search'}
                                                        </button>
                                                    </div>
                                                    <div style={{ flex: 1, overflowY: 'auto' }}>
                                                        {agentClawhubResults.length === 0 && !agentClawhubSearching && (
                                                            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-tertiary)', fontSize: '13px' }}>{t('agent.capability.skillsHint')}</div>
                                                        )}
                                                        {agentClawhubResults.map((r: any) => (
                                                            <div key={r.slug} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: '8px', marginBottom: '6px', border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
                                                                <div style={{ flex: 1 }}>
                                                                    <div style={{ fontWeight: 600, fontSize: '13px' }}>{r.displayName || r.slug}</div>
                                                                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{r.summary?.substring(0, 100)}</div>
                                                                </div>
                                                                <button className="btn btn-secondary" style={{ fontSize: '12px', padding: '5px 12px', marginLeft: '12px' }} disabled={agentClawhubInstalling === r.slug}
                                                                    onClick={async () => { setAgentClawhubInstalling(r.slug); try { const res = await skillApi.agentImport.fromClawhub(id!, r.slug); alert(`Installed "${r.displayName || r.slug}" (${res.files_written} files)`); queryClient.invalidateQueries({ queryKey: ['files', id, 'skills'] }); } catch (err: any) { alert(`Import failed: ${err?.message || err}`); } finally { setAgentClawhubInstalling(null); } }}>
                                                                    {agentClawhubInstalling === r.slug ? t('common.loading') : t('common.confirm')}
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        {showAgentUrlImport && (
                                            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowAgentUrlImport(false)}>
                                                <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-primary)', borderRadius: '12px', padding: '24px', maxWidth: '500px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                        <h3>{t('agent.capability.skillsUrl')}</h3>
                                                        <button onClick={() => setShowAgentUrlImport(false)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px 8px' }}>x</button>
                                                    </div>
                                                    <input className="input" placeholder="https://github.com/owner/repo/tree/main/path/to/skill" value={agentUrlInput} onChange={e => setAgentUrlInput(e.target.value)}
                                                        style={{ width: '100%', fontSize: '13px', marginBottom: '12px', boxSizing: 'border-box' }} />
                                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                                        <button className="btn btn-secondary" onClick={() => setShowAgentUrlImport(false)}>Cancel</button>
                                                        <button className="btn btn-primary" disabled={!agentUrlInput.trim() || agentUrlImporting}
                                                            onClick={async () => { setAgentUrlImporting(true); try { const res = await skillApi.agentImport.fromUrl(id!, agentUrlInput.trim()); alert(`Imported ${res.files_written} files`); queryClient.invalidateQueries({ queryKey: ['files', id, 'skills'] }); setShowAgentUrlImport(false); } catch (err: any) { alert(`Import failed: ${err?.message || err}`); } finally { setAgentUrlImporting(false); } }}>
                                                            {agentUrlImporting ? t('common.loading') : t('common.confirm')}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        {showImportSkillModal && (
                                            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowImportSkillModal(false)}>
                                                <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-primary)', borderRadius: '12px', padding: '24px', maxWidth: '600px', width: '90%', maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                        <h3>{t('agent.capability.skillsPreset')}</h3>
                                                        <button onClick={() => setShowImportSkillModal(false)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px 8px' }}>x</button>
                                                    </div>
                                                    <div style={{ flex: 1, overflowY: 'auto' }}>
                                                        {!globalSkillsForImport ? (
                                                            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-tertiary)' }}>{t('common.loading')}</div>
                                                        ) : globalSkillsForImport.length === 0 ? (
                                                            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-tertiary)' }}>{t('agent.capability.skillsEmpty')}</div>
                                                        ) : (
                                                            globalSkillsForImport.map((skill: any) => (
                                                                <div key={skill.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: '8px', marginBottom: '8px', border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', transition: 'border-color 0.15s' }}
                                                                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                                                                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                                                                        <span style={{ fontSize: '20px' }}>{skill.icon || '\uD83D\uDCCB'}</span>
                                                                        <div>
                                                                            <div style={{ fontWeight: 600, fontSize: '14px' }}>{skill.name}</div>
                                                                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{skill.description?.substring(0, 100)}{skill.description?.length > 100 ? '...' : ''}</div>
                                                                        </div>
                                                                    </div>
                                                                    <button className="btn btn-secondary" style={{ whiteSpace: 'nowrap', fontSize: '12px', padding: '6px 14px' }} disabled={importingSkillId === skill.id}
                                                                        onClick={async () => { setImportingSkillId(skill.id); try { const res = await fileApi.importSkill(id!, skill.id); alert(`Imported "${skill.name}" (${res.files_written} files)`); queryClient.invalidateQueries({ queryKey: ['files', id, 'skills'] }); setShowImportSkillModal(false); } catch (err: any) { alert(`Import failed: ${err?.message || err}`); } finally { setImportingSkillId(null); } }}>
                                                                        {importingSkillId === skill.id ? t('common.loading') : t('common.confirm')}
                                                                    </button>
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* ── Sub-tab 2: MCP / Imported Tools ── */}
                                {skillSubTab === 'mcp' && (
                                    <div>
                                        {/* Existing CapabilitiesView — pack cards + runtime records */}
                                        <CapabilitiesView agentId={id!} canManage={canManage} />

                                        {/* MCP management link */}
                                        <div className="card" style={{ marginTop: '20px', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                                                    🔌 {t('agent.mcp.manageTitle', 'MCP 服务器')}
                                                </div>
                                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                    {t('agent.mcp.manageDesc', '在公司设置中添加、配置和管理 MCP 外部工具服务器。所有 Agent 共享。')}
                                                </div>
                                            </div>
                                            <button
                                                className="btn btn-secondary"
                                                style={{ fontSize: '12px', whiteSpace: 'nowrap' }}
                                                onClick={() => window.location.href = '/enterprise?tab=mcp'}
                                            >
                                                {t('agent.mcp.goToSettings', '前往公司设置 →')}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* ── Sub-tab 3: Knowledge Base ── */}
                                {skillSubTab === 'knowledge' && (() => {
                                    // Knowledge Base sub-tab
                                    const kbAdapter: FileBrowserApi = {
                                        list: (p) => fileApi.list(id!, p),
                                        read: (p) => fileApi.read(id!, p),
                                        write: (p, c) => fileApi.write(id!, p, c),
                                        delete: (p) => fileApi.delete(id!, p),
                                        upload: (file, path, onProgress) => fileApi.upload(id!, file, path + '/', onProgress),
                                        downloadUrl: (p) => fileApi.downloadUrl(id!, p),
                                    };
                                    const eiAdapter: FileBrowserApi = {
                                        list: (p) => fileApi.list(id!, p),
                                        read: (p) => fileApi.read(id!, p),
                                        write: (p, c) => fileApi.write(id!, p, c),
                                        delete: (p) => fileApi.delete(id!, p),
                                        downloadUrl: (p) => fileApi.downloadUrl(id!, p),
                                    };
                                    return (
                                        <div>
                                            <div style={{ marginBottom: '24px' }}>
                                                <FileBrowser api={kbAdapter} rootPath="workspace/knowledge_base" features={{ upload: true, newFile: true, newFolder: true, edit: true, delete: true, directoryNavigation: true }} />
                                            </div>
                                            <details className="card">
                                                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '14px', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ transition: 'transform 0.15s', display: 'inline-block', fontSize: '12px' }}>{'\u25B6'}</span>
                                                    enterprise_info/
                                                </summary>
                                                <div style={{ marginTop: '12px' }}>
                                                    <FileBrowser api={eiAdapter} rootPath="enterprise_info" readOnly features={{}} />
                                                </div>
                                            </details>
                                        </div>
                                    );
                                })()}
                            </div>
                        );
                    })()
                }

                {
                    activeTab === 'chat' && (
                        <div style={{ display: 'flex', gap: '0', flex: 1, minHeight: 0, height: 'calc(100vh - 206px)' }}>
                            {/* ── Left: session sidebar ── */}
                            <div style={{ width: '220px', flexShrink: 0, borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                {/* Tab row */}
                                <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px 0', gap: '4px', borderBottom: '1px solid var(--border-subtle)' }}>
                                    <button onClick={() => setChatScope('mine')}
                                        style={{ flex: 1, padding: '5px 0', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: chatScope === 'mine' ? 600 : 400, color: chatScope === 'mine' ? 'var(--text-primary)' : 'var(--text-tertiary)', borderBottom: chatScope === 'mine' ? '2px solid var(--accent-primary)' : '2px solid transparent', paddingBottom: '8px' }}>
                                        My Sessions
                                    </button>
                                    {isAdmin && (
                                        <button onClick={() => { setChatScope('all'); fetchAllSessions(); }}
                                            style={{ flex: 1, padding: '5px 0', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: chatScope === 'all' ? 600 : 400, color: chatScope === 'all' ? 'var(--text-primary)' : 'var(--text-tertiary)', borderBottom: chatScope === 'all' ? '2px solid var(--accent-primary)' : '2px solid transparent', paddingBottom: '8px' }}>
                                            All Users
                                        </button>
                                    )}
                                </div>

                                {/* Actions row */}
                                {chatScope === 'mine' && (
                                    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                                        <button onClick={createNewSession}
                                            style={{ width: '100%', padding: '5px 8px', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '6px' }}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-secondary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
                                            + New Session
                                        </button>
                                    </div>
                                )}

                                {/* Session list */}
                                <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                                    {chatScope === 'mine' ? (
                                        sessionsLoading ? (
                                            <div style={{ padding: '20px 12px', fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('common.loading')}</div>
                                        ) : sessions.length === 0 ? (
                                            <div style={{ padding: '20px 12px', fontSize: '12px', color: 'var(--text-tertiary)' }}>No sessions yet.<br />Click "+ New Session" to start.</div>
                                        ) : sessions.map((s: any) => {
                                            const isActive = activeSession?.id === s.id;
                                            const isOwn = s.user_id === String(currentUser?.id);
                                            const channelLabel: Record<string, string> = {
                                                feishu: t('common.channels.feishu'),
                                                discord: t('common.channels.discord'),
                                                slack: t('common.channels.slack'),
                                                dingtalk: t('common.channels.dingtalk'),
                                                wecom: t('common.channels.wecom'),
                                            };
                                            const chLabel = channelLabel[s.source_channel];
                                            return (
                                                <div key={s.id} onClick={() => selectSession(s)}
                                                    className="session-item"
                                                    style={{ padding: '8px 12px', cursor: 'pointer', borderLeft: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent', background: isActive ? 'var(--bg-secondary)' : 'transparent', marginBottom: '1px', position: 'relative' }}
                                                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-secondary)'; const btn = e.currentTarget.querySelector('.del-btn') as HTMLElement; if (btn) btn.style.opacity = '0.5'; }}
                                                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; const btn = e.currentTarget.querySelector('.del-btn') as HTMLElement; if (btn) btn.style.opacity = '0'; }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                                                        <div style={{ fontSize: '12px', fontWeight: isActive ? 600 : 400, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{s.title}</div>
                                                        {chLabel && <span style={{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px', background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', flexShrink: 0 }}>{chLabel}</span>}
                                                    </div>
                                                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        {isOwn && isActive && wsConnected && <span className="status-dot running" style={{ width: '5px', height: '5px', flexShrink: 0 }} />}
                                                        {s.last_message_at
                                                            ? new Date(s.last_message_at).toLocaleString(i18n.language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                                            : new Date(s.created_at).toLocaleString(i18n.language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })}
                                                        {s.message_count > 0 && <span style={{ marginLeft: 'auto' }}>{s.message_count}</span>}
                                                    </div>
                                                    <button className="del-btn" onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                                                        style={{ position: 'absolute', top: '4px', right: '4px', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', opacity: 0, fontSize: '14px', color: 'var(--text-tertiary)', lineHeight: 1, transition: 'opacity 0.15s' }}
                                                        onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--status-error)'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
                                                        title={t('chat.deleteSession', 'Delete session')}>×</button>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        /* All Users tab — user filter dropdown + flat list */
                                        <>
                                            {/* User filter dropdown */}
                                            <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
                                                <select
                                                    value={allUserFilter}
                                                    onChange={e => setAllUserFilter(e.target.value)}
                                                    style={{ width: '100%', padding: '4px 6px', fontSize: '11px', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '5px', color: 'var(--text-primary)', cursor: 'pointer' }}
                                                >
                                                    <option value="">All Users</option>
                                                    {Array.from(new Set(allSessions.map((s: any) => s.username || s.user_id))).filter(Boolean).map((u: any) => (
                                                        <option key={u} value={u}>{u}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            {/* Filtered session list */}
                                            {allSessions
                                                .filter((s: any) => !allUserFilter || (s.username || s.user_id) === allUserFilter)
                                                .map((s: any) => {
                                                    const isActive = activeSession?.id === s.id;
                                                    return (
                                                        <div key={s.id} onClick={() => selectSession(s)}
                                                            className="session-item"
                                                            style={{ padding: '6px 12px', cursor: 'pointer', borderLeft: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent', background: isActive ? 'var(--bg-secondary)' : 'transparent', position: 'relative' }}
                                                            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-secondary)'; const btn = e.currentTarget.querySelector('.del-btn') as HTMLElement; if (btn) btn.style.opacity = '0.5'; }}
                                                            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; const btn = e.currentTarget.querySelector('.del-btn') as HTMLElement; if (btn) btn.style.opacity = '0'; }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '1px' }}>
                                                                <div style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', flex: 1 }}>{s.title}</div>
                                                                {({
                                                                    feishu: t('common.channels.feishu'),
                                                                    discord: t('common.channels.discord'),
                                                                    slack: t('common.channels.slack'),
                                                                    dingtalk: t('common.channels.dingtalk'),
                                                                    wecom: t('common.channels.wecom'),
                                                                } as Record<string, string>)[s.source_channel] && (
                                                                        <span style={{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px', background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', flexShrink: 0 }}>
                                                                            {({
                                                                                feishu: t('common.channels.feishu'),
                                                                                discord: t('common.channels.discord'),
                                                                                slack: t('common.channels.slack'),
                                                                                dingtalk: t('common.channels.dingtalk'),
                                                                                wecom: t('common.channels.wecom'),
                                                                            } as Record<string, string>)[s.source_channel]}
                                                                        </span>
                                                                    )}
                                                            </div>
                                                            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', display: 'flex', gap: '4px' }}>
                                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{s.username || ''}</span>
                                                                <span style={{ flexShrink: 0 }}>{s.last_message_at ? new Date(s.last_message_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}{s.message_count > 0 ? ` · ${s.message_count}` : ''}</span>
                                                            </div>
                                                            <button className="del-btn" onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                                                                style={{ position: 'absolute', top: '4px', right: '4px', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', opacity: 0, fontSize: '14px', color: 'var(--text-tertiary)', lineHeight: 1, transition: 'opacity 0.15s' }}
                                                                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--status-error)'; }}
                                                                onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
                                                                title={t('chat.deleteSession', 'Delete session')}>×</button>
                                                        </div>
                                                    );
                                                })}
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* ── Right: chat/message area ── */}
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', minWidth: 0, overflow: 'hidden' }}>
                                {!activeSession ? (
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: '13px', flexDirection: 'column', gap: '8px' }}>
                                        <div>No session selected</div>
                                        <button className="btn btn-secondary" onClick={createNewSession} style={{ fontSize: '12px' }}>Start a new session</button>
                                    </div>
                                ) : (activeSession.user_id && currentUser && activeSession.user_id !== String(currentUser.id)) || activeSession.source_channel === 'agent' || activeSession.participant_type === 'agent' ? (
                                    /* ── Read-only history view (other user's session or agent-to-agent) ── */
                                    <>
                                        <div ref={historyContainerRef} onScroll={handleHistoryScroll} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '12px', padding: '4px 8px', background: 'var(--bg-secondary)', borderRadius: '4px', display: 'inline-block' }}>
                                                {activeSession.source_channel === 'agent' ? `🤖 Agent Conversation · ${activeSession.username || 'Agents'}` : `Read-only · ${activeSession.username || 'User'}`}
                                            </div>
                                            {historyMsgs.map((m: any, i: number) => {
                                                if (m.role === 'event') {
                                                    const eventUi = getTimelineEventPresentation(m);
                                                    return (
                                                        <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', paddingLeft: '36px', minWidth: 0 }}>
                                                            <div style={{
                                                                flex: 1,
                                                                minWidth: 0,
                                                                borderRadius: '8px',
                                                                background: eventUi.background,
                                                                border: '1px solid var(--border-subtle)',
                                                                padding: '10px 12px',
                                                            }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                                                    <span style={{ fontSize: '13px' }}>{eventUi.icon}</span>
                                                                    <span style={{ fontSize: '12px', fontWeight: 600 }}>{eventUi.title}</span>
                                                                    {m.eventStatus && <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{String(m.eventStatus).replace(/_/g, ' ')}</span>}
                                                                </div>
                                                                {m.eventToolName && <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px', fontFamily: 'var(--font-mono)' }}>{m.eventToolName}</div>}
                                                                <div style={{ fontSize: '12px', lineHeight: '1.6', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</div>
                                                                {m.eventPacks && m.eventPacks.length > 0 && (
                                                                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                                        {m.eventPacks.map((pack: any, packIndex: number) => (
                                                                            <div key={packIndex} style={{ fontSize: '11px', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px' }}>
                                                                                <div style={{ fontWeight: 600 }}>{String(pack.name || 'unknown_pack')}</div>
                                                                                {pack.summary && <div style={{ marginTop: '2px' }}>{String(pack.summary)}</div>}
                                                                                {Array.isArray(pack.tools) && pack.tools.length > 0 && (
                                                                                    <div style={{ marginTop: '4px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                                                                                        {pack.tools.join(', ')}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                {m.eventApprovalId && <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>Approval ID: {m.eventApprovalId}</div>}
                                                                {(m.timestamp || m.created_at) && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '6px', opacity: 0.6 }}>{formatChatTimestamp(m.timestamp || m.created_at)}</div>}
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                if (m.role === 'tool_call') {
                                                    const tName = m.toolName || 'tool';
                                                    const tArgs = m.toolArgs || {};
                                                    const tResult = m.toolResult || '';
                                                    return (
                                                        <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', paddingLeft: '36px', minWidth: 0 }}>
                                                            <details style={{ flex: 1, minWidth: 0, borderRadius: '8px', background: 'var(--accent-subtle)', border: '1px solid var(--accent-subtle)', fontSize: '12px', overflow: 'hidden' }}>
                                                                <summary style={{ padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', userSelect: 'none', listStyle: 'none', overflow: 'hidden' }}>
                                                                    <span style={{ fontSize: '13px' }}>⚡</span>
                                                                    <span style={{ fontWeight: 600, color: 'var(--accent-text)' }}>{tName}</span>
                                                                    {hasToolArgs(tArgs) && <span style={{ color: 'var(--text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{`(${formatToolArgsSummary(tArgs)})`}</span>}
                                                                </summary>
                                                                {tResult && <div style={{ padding: '4px 10px 8px' }}><div style={{ color: 'var(--text-secondary)', fontSize: '11px', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '240px', overflow: 'auto', background: 'rgba(0,0,0,0.15)', borderRadius: '4px', padding: '4px 6px' }}>{tResult}</div></div>}
                                                            </details>
                                                        </div>
                                                    );
                                                }

                                                {/* Assistant message with no content: show inline thinking or skip */}
                                                if (m.role === 'assistant' && !m.content?.trim()) {
                                                    if (m.thinking) {
                                                        return (
                                                            <div key={i} style={{ paddingLeft: '36px', marginBottom: '6px' }}>
                                                                <details style={{
                                                                    fontSize: '12px',
                                                                    background: 'rgba(147, 130, 220, 0.08)', borderRadius: '6px',
                                                                    border: '1px solid rgba(147, 130, 220, 0.15)',
                                                                }}>
                                                                    <summary style={{
                                                                        padding: '6px 10px', cursor: 'pointer',
                                                                        color: 'rgba(147, 130, 220, 0.9)', fontWeight: 500,
                                                                        userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px',
                                                                    }}>Thinking</summary>
                                                                    <div style={{
                                                                        padding: '4px 10px 8px',
                                                                        fontSize: '12px', lineHeight: '1.6',
                                                                        color: 'var(--text-secondary)',
                                                                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                                                        maxHeight: '300px', overflow: 'auto',
                                                                    }}>{m.thinking}</div>
                                                                </details>
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                }
                                                return (
                                                    <div key={i} style={{ display: 'flex', flexDirection: m.role === 'assistant' ? 'row' : 'row-reverse', gap: '8px', marginBottom: '8px' }}>
                                                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: m.role === 'assistant' ? 'var(--bg-elevated)' : 'rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', flexShrink: 0, color: 'var(--text-secondary)', fontWeight: 600 }}>{m.sender_name ? m.sender_name[0] : (m.role === 'assistant' ? 'A' : 'U')}</div>
                                                        <div style={{ maxWidth: '70%', padding: '8px 12px', borderRadius: '12px', background: m.role === 'assistant' ? 'var(--bg-secondary)' : 'rgba(16,185,129,0.1)', fontSize: '13px', lineHeight: '1.5', wordBreak: 'break-word' }}>
                                                            {m.sender_name && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '2px', fontWeight: 600 }}>🤖 {m.sender_name}</div>}
                                                            {(() => {
                                                                const pm = m as ChatMsg;
                                                                const fe = pm.fileName?.split('.').pop()?.toLowerCase() ?? '';
                                                                const fi = fe === 'pdf' ? '📄' : (fe === 'csv' || fe === 'xlsx' || fe === 'xls') ? '📊' : (fe === 'docx' || fe === 'doc') ? '📝' : '📎';
                                                                return (
                                                                    <>
                                                                        {m.thinking && (
                                                                            <details style={{
                                                                                marginBottom: '8px', fontSize: '12px',
                                                                                background: 'rgba(147, 130, 220, 0.08)', borderRadius: '6px',
                                                                                border: '1px solid rgba(147, 130, 220, 0.15)',
                                                                            }}>
                                                                                <summary style={{
                                                                                    padding: '6px 10px', cursor: 'pointer',
                                                                                    color: 'rgba(147, 130, 220, 0.9)', fontWeight: 500,
                                                                                    userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px',
                                                                                }}>
                                                                                    💭 Thinking
                                                                                </summary>
                                                                                <div style={{
                                                                                    padding: '4px 10px 8px',
                                                                                    fontSize: '12px', lineHeight: '1.6',
                                                                                    color: 'var(--text-secondary)',
                                                                                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                                                                    maxHeight: '300px', overflow: 'auto',
                                                                                }}>
                                                                                    {m.thinking}
                                                                                </div>
                                                                            </details>
                                                                        )}
                                                                        {pm.fileName && (
                                                                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'var(--bg-elevated)', borderRadius: '6px', padding: '4px 8px', marginBottom: pm.content ? '4px' : '0', fontSize: '11px', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                                                                                <span>{fi}</span>
                                                                                <span style={{ fontWeight: 500, color: 'var(--text-primary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pm.fileName}</span>
                                                                            </div>
                                                                        )}
                                                                        {pm.content ? (m.role === 'assistant' ? <MarkdownRenderer content={pm.content} /> : <div style={{ whiteSpace: 'pre-wrap' }}>{pm.content}</div>) : null}
                                                                    </>
                                                                );
                                                            })()}
                                                            {(m.timestamp || m.created_at) && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px', opacity: 0.6 }}>{formatChatTimestamp(m.timestamp || m.created_at)}</div>}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {showHistoryScrollBtn && (
                                            <button onClick={scrollHistoryToBottom} style={{ position: 'absolute', bottom: '20px', right: '20px', width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', zIndex: 10 }} title="Scroll to bottom">↓</button>
                                        )}
                                    </>
                                ) : (
                                    /* ── Live WebSocket chat (own session) ── */
                                    <>
                                        <div ref={chatContainerRef} onScroll={handleChatScroll} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                                            {chatMessages.length === 0 && (
                                                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-tertiary)' }}>
                                                    <div style={{ fontSize: '13px', marginBottom: '4px' }}>{activeSession?.title || t('agent.chat.startChat')}</div>
                                                    <div style={{ fontSize: '12px' }}>{t('agent.chat.startConversation', { name: agent.name })}</div>
                                                    <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.7 }}>{t('agent.chat.fileSupport')}</div>
                                                </div>
                                            )}
                                            {chatMessages.map((msg, i) => {
                                                if (msg.role === 'event') {
                                                    const eventUi = getTimelineEventPresentation(msg);
                                                    return (
                                                        <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', paddingLeft: '36px', minWidth: 0 }}>
                                                            <div style={{
                                                                flex: 1,
                                                                minWidth: 0,
                                                                borderRadius: '8px',
                                                                background: eventUi.background,
                                                                border: '1px solid var(--border-subtle)',
                                                                padding: '10px 12px',
                                                            }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                                                    <span style={{ fontSize: '13px' }}>{eventUi.icon}</span>
                                                                    <span style={{ fontSize: '12px', fontWeight: 600 }}>{eventUi.title}</span>
                                                                    {msg.eventStatus && <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{String(msg.eventStatus).replace(/_/g, ' ')}</span>}
                                                                </div>
                                                                {msg.eventToolName && <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px', fontFamily: 'var(--font-mono)' }}>{msg.eventToolName}</div>}
                                                                <div style={{ fontSize: '12px', lineHeight: '1.6', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</div>
                                                                {msg.eventPacks && msg.eventPacks.length > 0 && (
                                                                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                                        {msg.eventPacks.map((pack: any, packIndex: number) => (
                                                                            <div key={packIndex} style={{ fontSize: '11px', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px' }}>
                                                                                <div style={{ fontWeight: 600 }}>{String(pack.name || 'unknown_pack')}</div>
                                                                                {pack.summary && <div style={{ marginTop: '2px' }}>{String(pack.summary)}</div>}
                                                                                {Array.isArray(pack.tools) && pack.tools.length > 0 && (
                                                                                    <div style={{ marginTop: '4px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                                                                                        {pack.tools.join(', ')}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                {msg.eventApprovalId && <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>Approval ID: {msg.eventApprovalId}</div>}
                                                                {msg.timestamp && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '6px', opacity: 0.6 }}>{formatChatTimestamp(msg.timestamp)}</div>}
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                if (msg.role === 'tool_call') {
                                                    return (
                                                        <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', paddingLeft: '36px', minWidth: 0 }}>
                                                            <details style={{ flex: 1, minWidth: 0, borderRadius: '8px', background: 'var(--accent-subtle)', border: '1px solid var(--accent-subtle)', fontSize: '12px', overflow: 'hidden' }}>
                                                                <summary style={{ padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', userSelect: 'none', listStyle: 'none', overflow: 'hidden' }}>
                                                                    <span style={{ fontSize: '13px' }}>{msg.toolStatus === 'running' ? '⏳' : '⚡'}</span>
                                                                    <span style={{ fontWeight: 600, color: 'var(--accent-text)' }}>{msg.toolName}</span>
                                                                    {hasToolArgs(msg.toolArgs) && <span style={{ color: 'var(--text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{`(${formatToolArgsSummary(msg.toolArgs)})`}</span>}
                                                                    {msg.toolStatus === 'running' && <span style={{ color: 'var(--text-tertiary)', fontSize: '11px', marginLeft: 'auto' }}>{t('common.loading')}</span>}
                                                                </summary>
                                                                {msg.toolResult && <div style={{ padding: '4px 10px 8px' }}><div style={{ color: 'var(--text-secondary)', fontSize: '11px', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '240px', overflow: 'auto', background: 'rgba(0,0,0,0.15)', borderRadius: '4px', padding: '4px 6px' }}>{msg.toolResult}</div></div>}
                                                            </details>
                                                        </div>
                                                    );
                                                }
                                                {/* Assistant message with no text content: show inline thinking or skip */}
                                                if (msg.role === 'assistant' && !msg.content?.trim()) {
                                                    if (msg.thinking) {
                                                        return (
                                                            <div key={i} style={{ paddingLeft: '36px', marginBottom: '6px' }}>
                                                                <details style={{
                                                                    fontSize: '12px',
                                                                    background: 'rgba(147, 130, 220, 0.08)', borderRadius: '6px',
                                                                    border: '1px solid rgba(147, 130, 220, 0.15)',
                                                                }}>
                                                                    <summary style={{
                                                                        padding: '6px 10px', cursor: 'pointer',
                                                                        color: 'rgba(147, 130, 220, 0.9)', fontWeight: 500,
                                                                        userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px',
                                                                    }}>Thinking</summary>
                                                                    <div style={{
                                                                        padding: '4px 10px 8px',
                                                                        fontSize: '12px', lineHeight: '1.6',
                                                                        color: 'var(--text-secondary)',
                                                                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                                                        maxHeight: '300px', overflow: 'auto',
                                                                    }}>{msg.thinking}</div>
                                                                </details>
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                }
                                                return (
                                                    <div key={i} style={{ display: 'flex', flexDirection: msg.role === 'assistant' ? 'row' : 'row-reverse', gap: '8px', marginBottom: '8px' }}>
                                                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: msg.role === 'assistant' ? 'var(--bg-elevated)' : 'rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', flexShrink: 0, color: 'var(--text-secondary)', fontWeight: 600 }}>{msg.role === 'user' ? 'U' : 'A'}</div>
                                                        <div style={{ maxWidth: '70%', padding: '8px 12px', borderRadius: '12px', background: msg.role === 'assistant' ? 'var(--bg-secondary)' : 'rgba(16,185,129,0.1)', fontSize: '13px', lineHeight: '1.5', wordBreak: 'break-word' }}>
                                                            {msg.fileName && (() => {
                                                                const fe = msg.fileName!.split('.').pop()?.toLowerCase() ?? '';
                                                                const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(fe);
                                                                if (isImage && msg.imageUrl) {
                                                                    return (<div style={{ marginBottom: '4px' }}>
                                                                        <img src={msg.imageUrl} alt={msg.fileName} style={{ maxWidth: '200px', maxHeight: '150px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }} />
                                                                    </div>);
                                                                }
                                                                const fi = fe === 'pdf' ? '📄' : (fe === 'csv' || fe === 'xlsx' || fe === 'xls') ? '📊' : (fe === 'docx' || fe === 'doc') ? '📝' : '📎';
                                                                return (<div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'rgba(0,0,0,0.08)', borderRadius: '6px', padding: '4px 8px', marginBottom: msg.content ? '4px' : '0', fontSize: '11px', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}><span>{fi}</span><span style={{ fontWeight: 500, color: 'var(--text-primary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.fileName}</span></div>);
                                                            })()}
                                                            {msg.thinking && (
                                                                <details style={{
                                                                    marginBottom: '8px', fontSize: '12px',
                                                                    background: 'rgba(147, 130, 220, 0.08)', borderRadius: '6px',
                                                                    border: '1px solid rgba(147, 130, 220, 0.15)',
                                                                }}>
                                                                    <summary style={{
                                                                        padding: '6px 10px', cursor: 'pointer',
                                                                        color: 'rgba(147, 130, 220, 0.9)', fontWeight: 500,
                                                                        userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px',
                                                                    }}>
                                                                        💭 Thinking
                                                                    </summary>
                                                                    <div style={{
                                                                        padding: '4px 10px 8px',
                                                                        fontSize: '12px', lineHeight: '1.6',
                                                                        color: 'var(--text-secondary)',
                                                                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                                                        maxHeight: '300px', overflow: 'auto',
                                                                    }}>
                                                                        {msg.thinking}
                                                                    </div>
                                                                </details>
                                                            )}
                                                            {msg.role === 'assistant' ? (
                                                                (msg as any)._streaming && !msg.content ? (
                                                                    <div className="thinking-indicator">
                                                                        <div className="thinking-dots">
                                                                            <span /><span /><span />
                                                                        </div>
                                                                        <span style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>{t('agent.chat.thinking', 'Thinking...')}</span>
                                                                    </div>
                                                                ) : <MarkdownRenderer content={msg.content} />
                                                            ) : msg.content ? <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div> : null}
                                                            {msg.timestamp && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px', opacity: 0.6, textAlign: msg.role === 'user' ? 'right' : 'left' }}>{formatChatTimestamp(msg.timestamp)}</div>}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            {isWaiting && (
                                                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', animation: 'fadeIn .2s ease' }}>
                                                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', flexShrink: 0, color: 'var(--text-secondary)', fontWeight: 600 }}>A</div>
                                                    <div style={{ padding: '8px 12px', borderRadius: '12px', background: 'var(--bg-secondary)', fontSize: '13px' }}>
                                                        <div className="thinking-indicator">
                                                            <div className="thinking-dots">
                                                                <span /><span /><span />
                                                            </div>
                                                            <span style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>{t('agent.chat.thinking', 'Thinking...')}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                            <div ref={chatEndRef} />
                                        </div>
                                        {showScrollBtn && (
                                            <button onClick={scrollToBottom} style={{ position: 'absolute', bottom: '70px', right: '20px', width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', zIndex: 10 }} title="Scroll to bottom">↓</button>
                                        )}
                                        {agentExpired ? (
                                            <div style={{ padding: '7px 16px', borderTop: '1px solid rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.08)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'rgb(180,100,0)' }}>
                                                <span>u23f8</span>
                                                <span>This Agent has <strong>expired</strong> and is off duty. Contact your admin to extend its service.</span>
                                            </div>
                                        ) : !wsConnected && (!activeSession?.user_id || !currentUser || activeSession.user_id === String(currentUser?.id)) ? (
                                            <div style={{ padding: '3px 16px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                                <span style={{ display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%', background: 'var(--accent-primary)', opacity: 0.8, animation: 'pulse 1.2s ease-in-out infinite' }} />
                                                Connecting...
                                            </div>
                                        ) : null}
                                        {attachedFiles.length > 0 && (
                                            <div style={{ padding: '6px 16px', background: 'var(--bg-elevated)', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                {attachedFiles.map((file, idx) => (
                                                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', background: 'var(--bg-secondary)', padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--border-subtle)', maxWidth: '200px' }}>
                                                        {file.imageUrl ? (
                                                            <img src={file.imageUrl} alt={file.name} style={{ width: '20px', height: '20px', borderRadius: '4px', objectFit: 'cover' }} />
                                                        ) : (
                                                            <span>📎</span>
                                                        )}
                                                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                                                        <button onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: '14px', padding: '0 2px' }} title="Remove file">✕</button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', gap: '8px', padding: '6px 12px', borderTop: '1px solid var(--border-subtle)' }}>
                                            <input type="file" multiple ref={fileInputRef} onChange={handleChatFile} style={{ display: 'none' }} />
                                            <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={!wsConnected || uploading || isWaiting || isStreaming || attachedFiles.length >= 10} style={{ padding: '6px 10px', fontSize: '14px', minWidth: 'auto', ...( (!wsConnected || uploading || isWaiting || isStreaming) ? { cursor: 'not-allowed', opacity: 0.4 } : {}) }}>{uploading ? '⏳' : '⦹'}</button>
                                            {uploading && uploadProgress >= 0 && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 140px' }}>
                                                    {uploadProgress <= 100 ? (
                                                        /* Upload phase: show progress bar */
                                                        <>
                                                            <div style={{ flex: 1, height: '4px', borderRadius: '2px', background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                                                                <div style={{ height: '100%', borderRadius: '2px', background: 'var(--accent-primary)', width: `${uploadProgress}%`, transition: 'width 0.15s ease' }} />
                                                            </div>
                                                            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{uploadProgress}%</span>
                                                        </>
                                                    ) : (
                                                        /* Processing phase (progress = 101): server is parsing the file */
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <span style={{ display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%', background: 'var(--accent-primary)', animation: 'pulse 1.2s ease-in-out infinite' }} />
                                                            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>Processing...</span>
                                                        </div>
                                                    )}
                                                    <button onClick={() => { uploadAbortRef.current?.(); }} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: '12px', padding: '0 2px', lineHeight: 1 }} title="Cancel upload">✕</button>
                                                </div>
                                            )}
                                            <input ref={chatInputRef} className="chat-input" value={chatInput} onChange={e => setChatInput(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendChatMsg(); } }}
                                                onPaste={handlePaste}
                                                placeholder={!wsConnected && (!activeSession?.user_id || !currentUser || activeSession.user_id === String(currentUser?.id)) ? 'Connecting...' : attachedFiles.length > 0 ? t('agent.chat.askAboutFile', { name: attachedFiles.length === 1 ? attachedFiles[0].name : `${attachedFiles.length} files` }) : t('chat.placeholder')}
                                                disabled={!wsConnected || isWaiting || isStreaming} style={{ flex: 1 }} autoFocus />
                                            {(isStreaming || isWaiting) ? (
                                                <button className="btn btn-stop-generation" onClick={() => { if (wsRef.current?.readyState === WebSocket.OPEN) { wsRef.current.send(JSON.stringify({ type: 'abort' })); setIsStreaming(false); setIsWaiting(false); } }} style={{ padding: '6px 16px' }} title={t('chat.stop', 'Stop')}>
                                                    <span className="stop-icon" />
                                                </button>
                                            ) : (
                                                <button className="btn btn-primary" onClick={sendChatMsg} disabled={!wsConnected || (!chatInput.trim() && attachedFiles.length === 0)} style={{ padding: '6px 16px' }}>{t('chat.send')}</button>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )
                }

                {
                    activeTab === 'activity' && (() => {
                        // Category definitions
                        const userActionTypes = ['chat_reply', 'tool_call', 'task_created', 'task_updated', 'file_written', 'error'];
                        const heartbeatTypes = ['heartbeat', 'plaza_post'];
                        const scheduleTypes = ['schedule_run'];
                        const messageTypes = ['feishu_msg_sent', 'agent_msg_sent', 'web_msg_sent'];

                        let filteredLogs = activityLogs;
                        if (logFilter === 'user') {
                            filteredLogs = activityLogs.filter((l: any) => userActionTypes.includes(l.action_type));
                        } else if (logFilter === 'backend') {
                            filteredLogs = activityLogs.filter((l: any) => !userActionTypes.includes(l.action_type));
                        } else if (logFilter === 'heartbeat') {
                            filteredLogs = activityLogs.filter((l: any) => heartbeatTypes.includes(l.action_type));
                        } else if (logFilter === 'schedule') {
                            filteredLogs = activityLogs.filter((l: any) => scheduleTypes.includes(l.action_type));
                        } else if (logFilter === 'messages') {
                            filteredLogs = activityLogs.filter((l: any) => messageTypes.includes(l.action_type));
                        }

                        const filterBtn = (key: string, label: string, indent = false) => (
                            <button
                                key={key}
                                onClick={() => setLogFilter(key)}
                                style={{
                                    padding: indent ? '4px 10px 4px 20px' : '6px 14px',
                                    fontSize: indent ? '11px' : '12px',
                                    fontWeight: logFilter === key ? 600 : 400,
                                    color: logFilter === key ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                    background: logFilter === key ? 'rgba(99,102,241,0.1)' : 'transparent',
                                    border: logFilter === key ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s',
                                    whiteSpace: 'nowrap' as const,
                                }}
                            >
                                {label}
                            </button>
                        );

                        const ApprovalsSection = () => {
                            const { data: approvals = [], refetch: refetchApprovals } = useQuery({
                                queryKey: ['agent-approvals', id],
                                queryFn: () => fetchAuth<any[]>(`/agents/${id}/approvals`),
                                enabled: !!id,
                                refetchInterval: 15000,
                            });
                            const resolveMut = useMutation({
                                mutationFn: async ({ approvalId, action }: { approvalId: string; action: string }) => {
                                    const token = localStorage.getItem('token');
                                    return fetch(`/api/v1/agents/${id}/approvals/${approvalId}/resolve`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                                        body: JSON.stringify({ action }),
                                    });
                                },
                                onSuccess: () => {
                                    refetchApprovals();
                                    queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
                                },
                            });
                            const pending = (approvals as any[]).filter((a: any) => a.status === 'pending');
                            const resolved = (approvals as any[]).filter((a: any) => a.status !== 'pending');
                            const statusStyle = (s: string) => ({
                                padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                                background: s === 'approved' ? 'rgba(0,180,120,0.12)' : s === 'rejected' ? 'rgba(255,80,80,0.12)' : 'rgba(255,180,0,0.12)',
                                color: s === 'approved' ? 'var(--success)' : s === 'rejected' ? 'var(--error)' : 'var(--warning)',
                            });
                            if (pending.length === 0 && resolved.length === 0) return null;
                            return (
                                <div style={{ marginBottom: '24px' }}>
                                    {/* Pending approvals at top */}
                                    {pending.length > 0 && (
                                        <>
                                            <h4 style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--warning)' }}>
                                                {t('agentDetail.pendingApprovals', { count: pending.length })}
                                            </h4>
                                            {pending.map((a: any) => (
                                                <div key={a.id} style={{
                                                    padding: '14px 16px', marginBottom: '8px', borderRadius: '8px',
                                                    background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                                        <span style={statusStyle(a.status)}>{a.status}</span>
                                                        <span style={{ fontSize: '13px', fontWeight: 500 }}>{a.action_type}</span>
                                                        <span style={{ flex: 1 }} />
                                                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                                            {a.created_at ? new Date(a.created_at).toLocaleString() : ''}
                                                        </span>
                                                    </div>
                                                    {a.details && (
                                                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px', lineHeight: '1.5', maxHeight: '80px', overflow: 'hidden' }}>
                                                            {typeof a.details === 'string' ? a.details : JSON.stringify(a.details, null, 2)}
                                                        </div>
                                                    )}
                                                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                        <button
                                                            className="btn btn-primary"
                                                            style={{ padding: '6px 16px', fontSize: '12px' }}
                                                            onClick={() => resolveMut.mutate({ approvalId: a.id, action: 'approve' })}
                                                            disabled={resolveMut.isPending}
                                                        >
                                                            {t('agentDetail.approve')}
                                                        </button>
                                                        <button
                                                            className="btn btn-danger"
                                                            style={{ padding: '6px 16px', fontSize: '12px' }}
                                                            onClick={() => resolveMut.mutate({ approvalId: a.id, action: 'reject' })}
                                                            disabled={resolveMut.isPending}
                                                        >
                                                            {t('agentDetail.reject')}
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                            <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '16px 0' }} />
                                        </>
                                    )}
                                    {/* Approval history (collapsible) */}
                                    {resolved.length > 0 && (
                                        <details>
                                            <summary style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                                {t('agentDetail.approvalHistory')} ({resolved.length})
                                            </summary>
                                            {resolved.map((a: any) => (
                                                <div key={a.id} style={{
                                                    padding: '12px 16px', marginBottom: '6px', borderRadius: '8px',
                                                    background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                                                    opacity: 0.7,
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span style={statusStyle(a.status)}>{a.status}</span>
                                                        <span style={{ fontSize: '12px' }}>{a.action_type}</span>
                                                        <span style={{ flex: 1 }} />
                                                        <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                                                            {a.resolved_at ? new Date(a.resolved_at).toLocaleString() : ''}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </details>
                                    )}
                                </div>
                            );
                        };

                        return (
                            <div>
                                {/* Section 1: Pending approvals */}
                                {(agent as any)?.access_level !== 'use' && <ApprovalsSection />}

                                {/* Section 2: Activity stream */}
                                <h3 style={{ marginBottom: '12px' }}>{t('agent.activityLog.title')}</h3>

                                {/* Filter tabs */}
                                <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                                    {filterBtn('user', '👤 ' + t('agent.activityLog.userActions', 'User Actions'))}
                                    {(agent as any)?.agent_type !== 'openclaw' && (<>
                                    {filterBtn('backend', '⚙️ ' + t('agent.activityLog.backendServices', 'Backend Services'))}
                                    {(logFilter === 'backend' || logFilter === 'heartbeat' || logFilter === 'schedule' || logFilter === 'messages') && (
                                        <>
                                            <span style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>│</span>
                                            {filterBtn('heartbeat', '💓 Heartbeat', true)}
                                            {filterBtn('schedule', '⏰ Schedule/Cron', true)}
                                            {filterBtn('messages', '📨 Messages', true)}
                                        </>
                                    )}
                                    </>)}
                                </div>

                                {filteredLogs.length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        {filteredLogs.map((log: any) => {
                                            const icons: Record<string, string> = {
                                                chat_reply: '💬', tool_call: '⚡', feishu_msg_sent: '📤',
                                                agent_msg_sent: '🤖', web_msg_sent: '🌐', task_created: '📋',
                                                task_updated: '✅', file_written: '📝', error: '❌',
                                                schedule_run: '⏰', heartbeat: '💓', plaza_post: '🏛️',
                                            };
                                            const time = log.created_at ? new Date(log.created_at).toLocaleString('zh-CN', {
                                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
                                            }) : '';
                                            const isExpanded = expandedLogId === log.id;
                                            return (
                                                <div key={log.id}
                                                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                                                    style={{
                                                        padding: '10px 14px', borderRadius: '8px', cursor: 'pointer',
                                                        background: isExpanded ? 'var(--bg-elevated)' : 'var(--bg-secondary)', fontSize: '13px',
                                                        border: isExpanded ? '1px solid var(--accent-primary)' : '1px solid transparent',
                                                        transition: 'all 0.15s ease',
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                                                        <span style={{ fontSize: '16px', flexShrink: 0, marginTop: '1px' }}>
                                                            {icons[log.action_type] || '·'}
                                                        </span>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <div style={{ fontWeight: 500, marginBottom: '2px' }}>{log.summary}</div>
                                                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                                                {time} · {log.action_type}
                                                                {log.detail && !isExpanded && <span style={{ marginLeft: '8px', color: 'var(--accent-primary)' }}>▸ Details</span>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {isExpanded && log.detail && (
                                                        <div style={{ marginTop: '8px', padding: '10px', borderRadius: '6px', background: 'var(--bg-primary)', fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: '1.6', color: 'var(--text-secondary)', maxHeight: '300px', overflowY: 'auto' }}>
                                                            {Object.entries(log.detail).map(([k, v]: [string, any]) => (
                                                                <div key={k} style={{ marginBottom: '6px' }}>
                                                                    <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{k}:</span>{' '}
                                                                    <span>{typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
                                        {t('agent.activityLog.noRecords')}
                                    </div>
                                )}
                            </div>
                        );
                    })()
                }

                {/* ── Settings Tab ── */}
                {
                    activeTab === 'settings' && (() => {
                        // Check if form has unsaved changes
                        const hasChanges = (
                            settingsForm.primary_model_id !== (agent?.primary_model_id || '') ||
                            settingsForm.fallback_model_id !== (agent?.fallback_model_id || '') ||
                            settingsForm.context_window_size !== (agent?.context_window_size ?? 100) ||
                            settingsForm.max_tool_rounds !== ((agent as any)?.max_tool_rounds ?? 50) ||
                            String(settingsForm.max_tokens_per_day) !== String(agent?.max_tokens_per_day || '') ||
                            String(settingsForm.max_tokens_per_month) !== String(agent?.max_tokens_per_month || '') ||
                            settingsForm.max_triggers !== ((agent as any)?.max_triggers ?? 20) ||
                            settingsForm.min_poll_interval_min !== ((agent as any)?.min_poll_interval_min ?? 5) ||
                            settingsForm.webhook_rate_limit !== ((agent as any)?.webhook_rate_limit ?? 5)
                        );

                        const handleSaveSettings = async () => {
                            setSettingsSaving(true);
                            setSettingsError('');
                            try {
                                const result: any = await agentApi.update(id!, {
                                    primary_model_id: settingsForm.primary_model_id || null,
                                    fallback_model_id: settingsForm.fallback_model_id || null,
                                    context_window_size: settingsForm.context_window_size,
                                    max_tool_rounds: settingsForm.max_tool_rounds,
                                    max_tokens_per_day: settingsForm.max_tokens_per_day ? Number(settingsForm.max_tokens_per_day) : null,
                                    max_tokens_per_month: settingsForm.max_tokens_per_month ? Number(settingsForm.max_tokens_per_month) : null,
                                    max_triggers: settingsForm.max_triggers,
                                    min_poll_interval_min: settingsForm.min_poll_interval_min,
                                    webhook_rate_limit: settingsForm.webhook_rate_limit,
                                } as any);
                                queryClient.invalidateQueries({ queryKey: ['agent', id] });
                                settingsInitRef.current = false;

                                // Check if any values were clamped by company policy
                                const clamped = result?._clamped_fields;
                                if (clamped && clamped.length > 0) {
                                    const isCh = i18n.language?.startsWith('zh');
                                    const fieldNames: Record<string, string> = isCh
                                        ? { min_poll_interval_min: 'Poll 最短间隔', webhook_rate_limit: 'Webhook 频率限制', heartbeat_interval_minutes: '心跳间隔' }
                                        : { min_poll_interval_min: 'Min Poll Interval', webhook_rate_limit: 'Webhook Rate Limit', heartbeat_interval_minutes: 'Heartbeat Interval' };
                                    const msgs = clamped.map((c: any) => {
                                        const name = fieldNames[c.field] || c.field;
                                        return isCh
                                            ? `${name}: ${c.requested} -> ${c.applied} (公司策略限制)`
                                            : `${name}: ${c.requested} -> ${c.applied} (company policy)`;
                                    });
                                    setSettingsError((isCh ? 'Some values were adjusted:\n' : 'Some values were adjusted:\n') + msgs.join('\n'));
                                    setTimeout(() => setSettingsError(''), 5000);
                                }

                                setSettingsSaved(true);
                                setTimeout(() => setSettingsSaved(false), 2000);
                            } catch (e: any) {
                                setSettingsError(e?.message || 'Failed to save');
                            } finally {
                                setSettingsSaving(false);
                            }
                        };

                        return (
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-primary)', paddingTop: '4px', paddingBottom: '12px', borderBottom: '1px solid var(--border-subtle)' }}>
                                    <h3 style={{ margin: 0 }}>{t('agent.settings.title')}</h3>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        {settingsSaved && <span style={{ fontSize: '12px', color: 'var(--success)' }}>{t('agent.settings.saved', 'Saved')}</span>}
                                        {settingsError && <span style={{ fontSize: '12px', color: settingsError.includes('adjusted') ? 'var(--warning)' : 'var(--error)', whiteSpace: 'pre-line' }}>{settingsError}</span>}
                                        <button
                                            className="btn btn-primary"
                                            disabled={!hasChanges || settingsSaving}
                                            onClick={handleSaveSettings}
                                            style={{
                                                opacity: hasChanges ? 1 : 0.5,
                                                cursor: hasChanges ? 'pointer' : 'default',
                                                padding: '6px 20px',
                                                fontSize: '13px',
                                            }}
                                        >
                                            {settingsSaving ? t('agent.settings.saving', 'Saving...') : t('agent.settings.save', 'Save')}
                                        </button>
                                    </div>
                                </div>

                                {/* Model Selection — native agents only */}
                                {(agent as any)?.agent_type !== 'openclaw' && (
                                <div className="card" style={{ marginBottom: '12px' }}>
                                    <h4 style={{ marginBottom: '12px' }}>{t('agent.settings.modelConfig')}</h4>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>{t('agent.settings.primaryModel')}</label>
                                            <select
                                                className="input"
                                                value={settingsForm.primary_model_id}
                                                onChange={(e) => setSettingsForm(f => ({ ...f, primary_model_id: e.target.value }))}
                                            >
                                                <option value="">--</option>
                                                {llmModels.map((m: any) => (
                                                    <option key={m.id} value={m.id}>{m.label} ({m.provider}/{m.model})</option>
                                                ))}
                                            </select>
                                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{t('agent.settings.primaryModel')}</div>
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>{t('agent.settings.fallbackModel')}</label>
                                            <select
                                                className="input"
                                                value={settingsForm.fallback_model_id}
                                                onChange={(e) => setSettingsForm(f => ({ ...f, fallback_model_id: e.target.value }))}
                                            >
                                                <option value="">--</option>
                                                {llmModels.map((m: any) => (
                                                    <option key={m.id} value={m.id}>{m.label} ({m.provider}/{m.model})</option>
                                                ))}
                                            </select>
                                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{t('agent.settings.fallbackModel')}</div>
                                        </div>
                                    </div>
                                </div>
                                )}

                                {/* Context Window — native agents only */}
                                {(agent as any)?.agent_type !== 'openclaw' && (<>
                                <div className="card" style={{ marginBottom: '12px' }}>
                                    <h4 style={{ marginBottom: '12px' }}>{t('agent.settings.conversationContext')}</h4>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>{t('agent.settings.maxRounds')}</label>
                                        <input
                                            className="input"
                                            type="number"
                                            min={10}
                                            max={500}
                                            value={settingsForm.context_window_size}
                                            onChange={(e) => setSettingsForm(f => ({ ...f, context_window_size: Math.max(10, Math.min(500, parseInt(e.target.value) || 100)) }))}
                                            style={{ width: '120px' }}
                                        />
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{t('agent.settings.roundsDesc')}</div>
                                    </div>
                                </div>

                                {/* Max Tool Call Rounds */}
                                <div className="card" style={{ marginBottom: '12px' }}>
                                    <h4 style={{ marginBottom: '12px' }}>🔧 {t('agent.settings.maxToolRounds', 'Max Tool Call Rounds')}</h4>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>{t('agent.settings.maxToolRoundsLabel', 'Maximum rounds per message')}</label>
                                        <input
                                            className="input"
                                            type="number"
                                            min={5}
                                            max={200}
                                            value={settingsForm.max_tool_rounds}
                                            onChange={(e) => setSettingsForm(f => ({ ...f, max_tool_rounds: Math.max(5, Math.min(200, parseInt(e.target.value) || 50)) }))}
                                            style={{ width: '120px' }}
                                        />
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{t('agent.settings.maxToolRoundsDesc', 'How many tool-calling rounds the agent can perform per message (search, write, etc). Default: 50')}</div>
                                    </div>
                                </div>
                                </>)}

                                {/* Token Limits */}
                                <div className="card" style={{ marginBottom: '12px' }}>
                                    <h4 style={{ marginBottom: '12px' }}>{t('agent.settings.tokenLimits')}</h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>{t('agent.settings.dailyLimit')}</label>
                                            <input
                                                className="input"
                                                type="number"
                                                value={settingsForm.max_tokens_per_day}
                                                onChange={(e) => setSettingsForm(f => ({ ...f, max_tokens_per_day: e.target.value }))}
                                                placeholder={t("agent.settings.noLimit")}
                                            />
                                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                                {t('agent.settings.today')}: {formatTokens(agent?.tokens_used_today || 0)}
                                            </div>
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>{t('agent.settings.monthlyLimit')}</label>
                                            <input
                                                className="input"
                                                type="number"
                                                value={settingsForm.max_tokens_per_month}
                                                onChange={(e) => setSettingsForm(f => ({ ...f, max_tokens_per_month: e.target.value }))}
                                                placeholder={t("agent.settings.noLimit")}
                                            />
                                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                                {t('agent.settings.month')}: {formatTokens(agent?.tokens_used_month || 0)}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Trigger Limits — native agents only */}
                                {(agent as any)?.agent_type !== 'openclaw' && (() => {
                                    return (
                                        <div className="card" style={{ marginBottom: '12px' }}>
                                            <h4 style={{ marginBottom: '4px' }}>{t('agentDetail.triggerLimits')}</h4>
                                            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                                                {t('agentDetail.triggerLimitsDesc')}
                                            </p>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                                                        {t('agentDetail.maxTriggers')}
                                                    </label>
                                                    <input
                                                        className="input"
                                                        type="number"
                                                        min={1}
                                                        max={100}
                                                        value={settingsForm.max_triggers}
                                                        onChange={(e) => setSettingsForm(f => ({ ...f, max_triggers: Math.max(1, Math.min(100, parseInt(e.target.value) || 20)) }))}
                                                        style={{ width: '100%' }}
                                                    />
                                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                                        {t('agentDetail.maxTriggersHelp')}
                                                    </div>
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                                                        {t('agentDetail.minPollInterval')}
                                                    </label>
                                                    <input
                                                        className="input"
                                                        type="number"
                                                        min={1}
                                                        max={60}
                                                        value={settingsForm.min_poll_interval_min}
                                                        onChange={(e) => setSettingsForm(f => ({ ...f, min_poll_interval_min: Math.max(1, Math.min(60, parseInt(e.target.value) || 5)) }))}
                                                        style={{ width: '100%' }}
                                                    />
                                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                                        {t('agentDetail.minPollIntervalHelp')}
                                                    </div>
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                                                        {t('agentDetail.webhookRateLimit')}
                                                    </label>
                                                    <input
                                                        className="input"
                                                        type="number"
                                                        min={1}
                                                        max={60}
                                                        value={settingsForm.webhook_rate_limit}
                                                        onChange={(e) => setSettingsForm(f => ({ ...f, webhook_rate_limit: Math.max(1, Math.min(60, parseInt(e.target.value) || 5)) }))}
                                                        style={{ width: '100%' }}
                                                    />
                                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                                        {t('agentDetail.webhookRateLimitHelp')}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Welcome Message */}
                                {(() => {
                                    const saveWm = async () => {
                                        try {
                                            await agentApi.update(id!, { welcome_message: wmDraft } as any);
                                            queryClient.invalidateQueries({ queryKey: ['agent', id] });
                                            setWmSaved(true);
                                            setTimeout(() => setWmSaved(false), 2000);
                                        } catch { }
                                    };
                                    return (
                                        <div className="card" style={{ marginBottom: '12px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                <h4 style={{ margin: 0 }}>{t('agentDetail.welcomeMessage')}</h4>
                                                {wmSaved && <span style={{ fontSize: '12px', color: 'var(--success)' }}>✓ {t('agentDetail.saved')}</span>}
                                            </div>
                                            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                                                {t('agentDetail.welcomeMessageDesc', 'Greeting message sent automatically when a user starts a new web conversation. Supports Markdown. Leave empty to disable.')}
                                            </p>
                                            <textarea
                                                className="input"
                                                rows={4}
                                                value={wmDraft}
                                                onChange={e => setWmDraft(e.target.value)}
                                                onBlur={saveWm}
                                                placeholder={t('agentDetail.welcomePlaceholder')}
                                                style={{
                                                    width: '100%', minHeight: '80px', resize: 'vertical',
                                                    fontFamily: 'inherit', fontSize: '13px',
                                                }}
                                            />
                                        </div>
                                    );
                                })()}

                                {/* Capability Policy — native agents only */}
                                {(agent as any)?.agent_type !== 'openclaw' && (
                                    <CapabilityPolicyManager agentId={id!} />
                                )}

                                {/* Permission Management */}
                                {(() => {
                                    const scopeLabels: Record<string, string> = {
                                        company: '🏢 ' + t('agent.settings.perm.company', 'Company-wide'),
                                        user: '👤 ' + t('agent.settings.perm.selfOnly', 'Only Me'),
                                    };

                                    const handleScopeChange = async (newScope: string) => {
                                        try {
                                            await fetchAuth(`/agents/${id}/permissions`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ scope_type: newScope, scope_ids: [], access_level: permData?.access_level || 'use' }),
                                            });
                                            queryClient.invalidateQueries({ queryKey: ['agent-permissions', id] });
                                            queryClient.invalidateQueries({ queryKey: ['agent', id] });
                                        } catch (e) {
                                            console.error('Failed to update permissions', e);
                                        }
                                    };

                                    const handleAccessLevelChange = async (newLevel: string) => {
                                        try {
                                            await fetchAuth(`/agents/${id}/permissions`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ scope_type: permData?.scope_type || 'company', scope_ids: permData?.scope_ids || [], access_level: newLevel }),
                                            });
                                            queryClient.invalidateQueries({ queryKey: ['agent-permissions', id] });
                                            queryClient.invalidateQueries({ queryKey: ['agent', id] });
                                        } catch (e) {
                                            console.error('Failed to update access level', e);
                                        }
                                    };

                                    const isOwner = permData?.is_owner ?? false;
                                    const currentScope = permData?.scope_type || 'company';
                                    const currentAccessLevel = permData?.access_level || 'use';

                                    return (
                                        <div className="card" style={{ marginBottom: '12px' }}>
                                            <h4 style={{ marginBottom: '12px' }}>🔒 {t('agent.settings.perm.title', 'Access Permissions')}</h4>
                                            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                                                {t('agent.settings.perm.description', 'Control who can see and interact with this agent. Only the creator or admin can change this.')}
                                            </p>

                                            {/* Scope Selection */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                                                {(['company', 'user'] as const).map((scope) => (
                                                    <label
                                                        key={scope}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '10px',
                                                            padding: '12px 14px',
                                                            borderRadius: '8px',
                                                            cursor: isOwner ? 'pointer' : 'default',
                                                            border: currentScope === scope
                                                                ? '1px solid var(--accent-primary)'
                                                                : '1px solid var(--border-subtle)',
                                                            background: currentScope === scope
                                                                ? 'rgba(99,102,241,0.06)'
                                                                : 'transparent',
                                                            opacity: isOwner ? 1 : 0.7,
                                                            transition: 'all 0.15s',
                                                        }}
                                                    >
                                                        <input
                                                            type="radio"
                                                            name="perm_scope"
                                                            checked={currentScope === scope}
                                                            disabled={!isOwner}
                                                            onChange={() => handleScopeChange(scope)}
                                                            style={{ accentColor: 'var(--accent-primary)' }}
                                                        />
                                                        <div>
                                                            <div style={{ fontWeight: 500, fontSize: '13px' }}>{scopeLabels[scope]}</div>
                                                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                                                {scope === 'company' && t('agent.settings.perm.companyDesc', 'All users in the organization can use this agent')}
                                                                {scope === 'user' && t('agent.settings.perm.selfDesc', 'Only the creator can use this agent')}
                                                            </div>
                                                        </div>
                                                    </label>
                                                ))}
                                            </div>

                                            {/* Access Level for company scope */}
                                            {currentScope === 'company' && isOwner && (
                                                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
                                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>
                                                        {t('agent.settings.perm.accessLevel', 'Default Access Level')}
                                                    </label>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        {[{ val: 'use', label: '👁️ ' + t('agent.settings.perm.useLevel', 'Use'), desc: t('agent.settings.perm.useDesc', 'Task, Chat, Tools, Skills, Workspace') },
                                                        { val: 'manage', label: '⚙️ ' + t('agent.settings.perm.manageLevel', 'Manage'), desc: t('agent.settings.perm.manageDesc', 'Full access including Settings, Mind, Relationships') }].map(opt => (
                                                            <label key={opt.val}
                                                                style={{
                                                                    flex: 1,
                                                                    padding: '10px 12px',
                                                                    borderRadius: '8px',
                                                                    cursor: 'pointer',
                                                                    border: currentAccessLevel === opt.val
                                                                        ? '1px solid var(--accent-primary)'
                                                                        : '1px solid var(--border-subtle)',
                                                                    background: currentAccessLevel === opt.val
                                                                        ? 'rgba(99,102,241,0.06)'
                                                                        : 'transparent',
                                                                    transition: 'all 0.15s',
                                                                }}
                                                            >
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                    <input type="radio" name="access_level" checked={currentAccessLevel === opt.val}
                                                                        onChange={() => handleAccessLevelChange(opt.val)}
                                                                        style={{ accentColor: 'var(--accent-primary)' }} />
                                                                    <span style={{ fontWeight: 500, fontSize: '13px' }}>{opt.label}</span>
                                                                </div>
                                                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px', marginLeft: '20px' }}>{opt.desc}</div>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {currentScope !== 'company' && permData?.scope_names?.length > 0 && (
                                                <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                    <span style={{ fontWeight: 500 }}>{t('agent.settings.perm.currentAccess', 'Current access')}:</span>{' '}
                                                    {permData.scope_names.map((s: any) => s.name).join(', ')}
                                                </div>
                                            )}

                                            {!isOwner && (
                                                <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                                                    {t('agent.settings.perm.readOnly', 'Only the creator or admin can change permissions')}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {/* Timezone */}
                                <div className="card" style={{ marginBottom: '12px' }}>
                                    <h4 style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {t('agent.settings.timezone.title', '🌐 Timezone')}
                                    </h4>
                                    <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                                        {t('agent.settings.timezone.description', 'The timezone used for this agent\'s scheduling, active hours, and time awareness. Defaults to the company timezone if not set.')}
                                    </p>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: '8px',
                                        border: '1px solid var(--border-subtle)',
                                    }}>
                                        <div>
                                            <div style={{ fontWeight: 500, fontSize: '13px' }}>{t('agent.settings.timezone.current', 'Agent Timezone')}</div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                                {agent?.timezone
                                                    ? t('agent.settings.timezone.override', 'Custom timezone for this agent')
                                                    : t('agent.settings.timezone.inherited', 'Using company default timezone')}
                                            </div>
                                        </div>
                                        <select
                                            className="input"
                                            disabled={!canManage}
                                            value={agent?.timezone || ''}
                                            onChange={async (e) => {
                                                if (!canManage) return;
                                                const val = e.target.value || null;
                                                await agentApi.update(id!, { timezone: val } as any);
                                                queryClient.invalidateQueries({ queryKey: ['agent', id] });
                                            }}
                                            style={{ width: '200px', fontSize: '12px', opacity: canManage ? 1 : 0.6 }}
                                        >
                                            <option value="">{t('agent.settings.timezone.default', '↩ Company default')}</option>
                                            {['UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Dubai',
                                                'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
                                                'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
                                                'America/Sao_Paulo', 'Australia/Sydney', 'Pacific/Auckland'].map(tz => (
                                                    <option key={tz} value={tz}>{tz}</option>
                                                ))}
                                        </select>
                                    </div>
                                </div>

                                {/* Heartbeat */}
                                <div className="card" style={{ marginBottom: '12px' }}>
                                    <h4 style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {t('agent.settings.heartbeat.title', 'Heartbeat')}
                                    </h4>
                                    <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                                        {t('agent.settings.heartbeat.description', 'Periodic awareness check — agent proactively monitors the plaza and work environment.')}
                                    </p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                        {/* Enable toggle */}
                                        <div style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: '8px',
                                            border: '1px solid var(--border-subtle)',
                                        }}>
                                            <div>
                                                <div style={{ fontWeight: 500, fontSize: '13px' }}>{t('agent.settings.heartbeat.enabled', 'Enable Heartbeat')}</div>
                                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{t('agent.settings.heartbeat.enabledDesc', 'Agent will periodically check plaza and work status')}</div>
                                            </div>
                                            <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px', cursor: canManage ? 'pointer' : 'default' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={agent?.heartbeat_enabled ?? true}
                                                    disabled={!canManage}
                                                    onChange={async (e) => {
                                                        if (!canManage) return;
                                                        await agentApi.update(id!, { heartbeat_enabled: e.target.checked } as any);
                                                        queryClient.invalidateQueries({ queryKey: ['agent', id] });
                                                    }}
                                                    style={{ opacity: 0, width: 0, height: 0 }}
                                                />
                                                <span style={{
                                                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                                    background: (agent?.heartbeat_enabled ?? true) ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                                                    borderRadius: '12px', transition: 'background 0.2s',
                                                    opacity: canManage ? 1 : 0.6
                                                }}>
                                                    <span style={{
                                                        position: 'absolute', top: '3px',
                                                        left: (agent?.heartbeat_enabled ?? true) ? '23px' : '3px',
                                                        width: '18px', height: '18px', background: 'white',
                                                        borderRadius: '50%', transition: 'left 0.2s',
                                                    }} />
                                                </span>
                                            </label>
                                        </div>

                                        {/* Interval */}
                                        <div style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: '8px',
                                            border: '1px solid var(--border-subtle)',
                                        }}>
                                            <div>
                                                <div style={{ fontWeight: 500, fontSize: '13px' }}>{t('agent.settings.heartbeat.interval', 'Check Interval')}</div>
                                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{t('agent.settings.heartbeat.intervalDesc', 'How often the agent checks for updates')}</div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <input
                                                    type="number"
                                                    className="input"
                                                    disabled={!canManage}
                                                    min={1}
                                                    defaultValue={agent?.heartbeat_interval_minutes ?? 120}
                                                    key={agent?.heartbeat_interval_minutes}
                                                    onBlur={async (e) => {
                                                        if (!canManage) return;
                                                        const val = Math.max(1, Number(e.target.value) || 120);
                                                        e.target.value = String(val);
                                                        await agentApi.update(id!, { heartbeat_interval_minutes: val } as any);
                                                        queryClient.invalidateQueries({ queryKey: ['agent', id] });
                                                    }}
                                                    style={{ width: '80px', fontSize: '12px', opacity: canManage ? 1 : 0.6 }}
                                                />
                                                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('common.minutes', 'min')}</span>
                                            </div>
                                        </div>

                                        {/* Active Hours */}
                                        <div style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: '8px',
                                            border: '1px solid var(--border-subtle)',
                                        }}>
                                            <div>
                                                <div style={{ fontWeight: 500, fontSize: '13px' }}>{t('agent.settings.heartbeat.activeHours', 'Active Hours')}</div>
                                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{t('agent.settings.heartbeat.activeHoursDesc', 'Only trigger heartbeat during these hours (HH:MM-HH:MM)')}</div>
                                            </div>
                                            <input
                                                className="input"
                                                disabled={!canManage}
                                                value={agent?.heartbeat_active_hours ?? '09:00-18:00'}
                                                onChange={async (e) => {
                                                    if (!canManage) return;
                                                    await agentApi.update(id!, { heartbeat_active_hours: e.target.value } as any);
                                                    queryClient.invalidateQueries({ queryKey: ['agent', id] });
                                                }}
                                                style={{ width: '140px', fontSize: '12px', textAlign: 'center', opacity: canManage ? 1 : 0.6 }}
                                                placeholder="09:00-18:00"
                                            />
                                        </div>



                                        {/* Last Heartbeat */}
                                        {agent?.last_heartbeat_at && (
                                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', paddingLeft: '4px' }}>
                                                {t('agent.settings.heartbeat.lastRun', 'Last heartbeat')}: {new Date(agent.last_heartbeat_at).toLocaleString()}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Channel Config */}
                                <div style={{ marginBottom: "12px" }}>
                                    <ChannelConfig mode="edit" agentId={id!} />
                                </div>

                                {/* Config Version History */}
                                <ConfigVersionHistory agentId={id!} />

                                {/* Danger Zone */}
                                <div className="card" style={{ borderColor: 'var(--error)' }}>
                                    <h4 style={{ color: 'var(--error)', marginBottom: '12px' }}>{t('agent.settings.danger.title')}</h4>
                                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                                        {t('agent.settings.danger.deleteWarning')}
                                    </p>
                                    {
                                        !showDeleteConfirm ? (
                                            <button className="btn btn-danger" onClick={() => setShowDeleteConfirm(true)}>× {t('agent.settings.danger.deleteAgent')}</button>
                                        ) : (
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                <span style={{ fontSize: '13px', color: 'var(--error)', fontWeight: 600 }}>{t('agent.settings.danger.deleteWarning')}</span>
                                                <button className="btn btn-danger" onClick={async () => {
                                                    try {
                                                        await agentApi.delete(id!);
                                                        queryClient.invalidateQueries({ queryKey: ['agents'] });
                                                        navigate('/');
                                                    } catch (err: any) {
                                                        alert(err?.message || 'Failed to delete agent');
                                                    }
                                                }}>{t('agent.settings.danger.confirmDelete')}</button>
                                                <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)}>{t('common.cancel')}</button>
                                            </div>
                                        )
                                    }
                                </div >
                            </div >
                        )
                    })()
                }
            </div >

            <PromptModal
                open={!!promptModal}
                title={promptModal?.title || ''}
                placeholder={promptModal?.placeholder || ''}
                onCancel={() => setPromptModal(null)}
                onConfirm={async (value) => {
                    const action = promptModal?.action;
                    setPromptModal(null);
                    if (action === 'newFolder') {
                        await fileApi.write(id!, `${workspacePath}/${value}/.gitkeep`, '');
                        queryClient.invalidateQueries({ queryKey: ['files', id, workspacePath] });
                    } else if (action === 'newFile') {
                        await fileApi.write(id!, `${workspacePath}/${value}`, '');
                        queryClient.invalidateQueries({ queryKey: ['files', id, workspacePath] });
                        setViewingFile(`${workspacePath}/${value}`);
                        setFileEditing(true);
                        setFileDraft('');
                    } else if (action === 'newSkill') {
                        const template = `---\nname: ${value}\ndescription: Describe what this skill does\n---\n\n# ${value}\n\n## Overview\nDescribe the purpose and when to use this skill.\n\n## Process\n1. Step one\n2. Step two\n\n## Output Format\nDescribe the expected output format.\n`;
                        await fileApi.write(id!, `skills/${value}/SKILL.md`, template);
                        queryClient.invalidateQueries({ queryKey: ['files', id, 'skills'] });
                        setViewingFile(`skills/${value}/SKILL.md`);
                        setFileEditing(true);
                        setFileDraft(template);
                    }
                }}
            />

            <ConfirmModal
                open={!!deleteConfirm}
                title={t('common.delete')}
                message={`${t('common.delete')}: ${deleteConfirm?.name}?`}
                confirmLabel={t('common.delete')}
                danger
                onCancel={() => setDeleteConfirm(null)}
                onConfirm={async () => {
                    const path = deleteConfirm?.path;
                    setDeleteConfirm(null);
                    if (path) {
                        try {
                            await fileApi.delete(id!, path);
                            setViewingFile(null);
                            setFileEditing(false);
                            queryClient.invalidateQueries({ queryKey: ['files', id, workspacePath] });
                            showToast(t('common.delete'));
                        } catch (err: any) {
                            showToast(t('agent.upload.failed'), 'error');
                        }
                    }
                }}
            />

            {
                uploadToast && (
                    <div style={{
                        position: 'fixed', top: '20px', right: '20px', zIndex: 20000,
                        padding: '12px 20px', borderRadius: '8px',
                        background: uploadToast.type === 'success' ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)',
                        color: '#fff', fontSize: '14px', fontWeight: 500,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    }}>
                        {''}{uploadToast.message}
                    </div>
                )
            }

            {/* ── Expiry Editor Modal (admin only) ── */}
            {
                showExpiryModal && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onClick={() => setShowExpiryModal(false)}>
                        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '24px', width: '360px', maxWidth: '90vw' }}
                            onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>⏰ {t('agent.settings.expiry.title')}</h3>
                                <button onClick={() => setShowExpiryModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: '18px', lineHeight: 1 }}>×</button>
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                                {(agent as any).is_expired
                                    ? <span style={{ color: 'var(--error)', fontWeight: 600 }}>⏰ {t('agent.settings.expiry.expired')}</span>
                                    : (agent as any).expires_at
                                        ? <>{t('agent.settings.expiry.currentExpiry')} <strong>{new Date((agent as any).expires_at).toLocaleString(i18n.language === 'zh' ? 'zh-CN' : 'en-US')}</strong></>
                                        : <span style={{ color: 'var(--success)' }}>{t('agent.settings.expiry.neverExpires')}</span>
                                }
                            </div>
                            <div style={{ marginBottom: '16px' }}>
                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>{t('agent.settings.expiry.quickRenew')}</div>
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                    {([
                                        ['+ 24h', 24],
                                        [`+ ${t('agent.settings.expiry.days', { count: 7 })}`, 168],
                                        [`+ ${t('agent.settings.expiry.days', { count: 30 })}`, 720],
                                        [`+ ${t('agent.settings.expiry.days', { count: 90 })}`, 2160],
                                    ] as [string, number][]).map(([label, h]) => (
                                        <button key={h} onClick={() => addHours(h)}
                                            style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border-subtle)', background: 'var(--bg-primary)', cursor: 'pointer', fontSize: '12px', color: 'var(--text-primary)' }}>
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div style={{ marginBottom: '20px' }}>
                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>{t('agent.settings.expiry.customDeadline')}</div>
                                <input type="datetime-local" value={expiryValue} onChange={e => setExpiryValue(e.target.value)}
                                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box' }} />
                            </div>
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', alignItems: 'center' }}>
                                <button onClick={() => saveExpiry(true)} disabled={expirySaving}
                                    style={{ padding: '7px 12px', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    🔓 {t('agent.settings.expiry.neverExpires')}
                                </button>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button onClick={() => setShowExpiryModal(false)} disabled={expirySaving}
                                        style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'none', cursor: 'pointer', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        {t('common.cancel')}
                                    </button>
                                    <button onClick={() => saveExpiry(false)} disabled={expirySaving || !expiryValue}
                                        className="btn btn-primary"
                                        style={{ opacity: !expiryValue ? 0.5 : 1 }}>
                                        {expirySaving ? t('agent.settings.expiry.saving') : t('common.save')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

        </>
    );
}

// Error boundary to catch unhandled React errors and prevent white screen
class AgentDetailErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }
    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('AgentDetail crash caught by error boundary:', error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '16px' }}>
                    <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>Something went wrong</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', maxWidth: '400px', textAlign: 'center' }}>
                        {this.state.error?.message || 'An unexpected error occurred while loading this page.'}
                    </div>
                    <button
                        className="btn btn-primary"
                        onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
                        style={{ marginTop: '8px' }}
                    >
                        Reload Page
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

// Wrap the AgentDetail component with error boundary
export default function AgentDetailWithErrorBoundary() {
    return (
        <AgentDetailErrorBoundary>
            <AgentDetailInner />
        </AgentDetailErrorBoundary>
    );
}
