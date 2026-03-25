import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { agentApi } from '@/services/api';
import { useAuthStore } from '@/stores';

export interface OpenClawGatewayPanelProps {
    agentId: string;
    agent: any;
}

export function OpenClawGatewayPanel({ agentId, agent }: OpenClawGatewayPanelProps) {
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
            const guide = await agentApi.gatewaySetupGuideWithKey(agentId, keyResult.api_key);
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
