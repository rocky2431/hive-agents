import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { agentApi } from '@/services/api';
import { useAuthStore } from '@/stores';
import { cn } from '@/lib/cn';

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
        <div className="card p-4 mb-6">
            <div className="mb-3">
                <div className="font-semibold text-sm mb-1">
                    {t('agentDetail.openclawConnection', 'OpenClaw Connection')}
                </div>
                <div className="text-xs text-content-tertiary">
                    {t('agentDetail.managedByOpenclaw', 'Managed by OpenClaw')}
                </div>
            </div>

            {notice && (
                <div
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

            <div className="grid grid-cols-[minmax(280px,1fr)_minmax(320px,1.2fr)] gap-4">
                <div className="flex flex-col gap-3">
                    <div className="card p-3 !m-0 bg-surface-secondary">
                        <div className="text-xs font-semibold mb-2">
                            {t('agentDetail.gatewayMessages', 'Gateway Messages')}
                        </div>
                        {gatewayLoading ? (
                            <div className="text-xs text-content-tertiary">{t('common.loading')}</div>
                        ) : gatewayMessages.length > 0 ? (
                            <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto">
                                {gatewayMessages.map((message: any) => (
                                    <div
                                        key={message.id}
                                        className="px-3 py-2.5 rounded-lg border border-edge-subtle bg-surface-primary"
                                    >
                                        <div className="flex justify-between gap-2 mb-1">
                                            <span className="text-xs font-semibold">
                                                {message.sender_agent_name || t('agentDetail.gatewaySystem', 'Platform')}
                                            </span>
                                            <span className="text-[11px] text-content-tertiary">
                                                {message.created_at ? new Date(message.created_at).toLocaleString() : ''}
                                            </span>
                                        </div>
                                        <div className="text-[11px] text-content-secondary mb-1.5">
                                            {message.status}
                                        </div>
                                        <div className="text-xs whitespace-pre-wrap break-words">
                                            {message.content}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-xs text-content-tertiary">
                                {t('agentDetail.noGatewayMessages', 'No gateway messages yet.')}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-col gap-3">
                    {canManageGateway && (
                        <div className="card p-3 !m-0 bg-surface-secondary">
                            <div className="flex justify-between items-center gap-3 mb-2">
                                <div>
                                    <div className="text-xs font-semibold mb-1">
                                        {t('agentDetail.generateApiKey', 'Generate API Key')}
                                    </div>
                                    <div className="text-[11px] text-content-tertiary">
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
                                <div className="flex flex-col gap-2">
                                    <textarea
                                        className="form-input font-mono resize-none"
                                        readOnly
                                        value={generatedApiKey}
                                        rows={3}
                                    />
                                    <div className="flex justify-end">
                                        <button className="btn" onClick={() => navigator.clipboard.writeText(generatedApiKey)}>
                                            {t('common.copy', 'Copy')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {setupGuide && (
                        <div className="card p-3 !m-0 bg-surface-secondary">
                            <div className="text-xs font-semibold mb-2">
                                {t('openclaw.setupInstruction', 'Setup Instruction')}
                            </div>
                            <div className="text-[11px] text-content-tertiary mb-2">
                                {t('openclaw.keyNote', 'The API key is already embedded in the instruction above. Save it separately if needed for manual configuration.')}
                            </div>
                            <textarea
                                className="form-input font-mono resize-y mb-2"
                                readOnly
                                value={setupGuide.skill_content || ''}
                                rows={12}
                            />
                            <textarea
                                className="form-input font-mono resize-none"
                                readOnly
                                value={setupGuide.heartbeat_addition || ''}
                                rows={3}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
