import { useTranslation } from 'react-i18next';

import { formatTokens } from '@/lib/format';
import {
    CollaborationPanel,
    OpenClawGatewayPanel,
    MemoryInsightsPanel,
    FileEditorCard,
} from '@/pages/agent-detail';

interface OverviewTabProps {
    agentId: string;
    agent: any;
}

export function OverviewTab({ agentId, agent }: OverviewTabProps) {
    const { t } = useTranslation();

    const formatDate = (d: string) => {
        try {
            return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        } catch {
            return d;
        }
    };

    // Compute display status (same logic as parent)
    const computeStatusKey = () => {
        if (agent.status === 'error') return 'error';
        if (agent.status === 'creating') return 'creating';
        if (agent.status === 'stopped') return 'stopped';
        if (agent.agent_type === 'openclaw' && agent.status === 'running' && agent.openclaw_last_seen) {
            const elapsed = Date.now() - new Date(agent.openclaw_last_seen).getTime();
            if (elapsed > 60 * 60 * 1000) return 'disconnected';
        }
        return agent.status === 'running' ? 'running' : 'idle';
    };
    const statusKey = computeStatusKey();

    return (
        <div>
            {/* Identity card -- compact one-row */}
            <div className="card flex items-center gap-3.5 px-[18px] py-3.5 mb-4">
                <div className="w-10 h-10 rounded-[10px] bg-accent-subtle flex items-center justify-center text-xl shrink-0">
                    {(Array.from(agent.name || 'A')[0] as string || 'A').toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-[15px]">{agent.name}</span>
                        {agent.role_description && (
                            <span className="text-xs text-content-secondary">{agent.role_description}</span>
                        )}
                        <span className={`status-dot ${statusKey}`} />
                    </div>
                    <div className="text-[11px] text-content-tertiary mt-0.5 flex gap-3 flex-wrap">
                        <span>{agent.created_at ? formatDate(agent.created_at) : ''}</span>
                        {agent.creator_username && <span>@{agent.creator_username}</span>}
                    </div>
                </div>
            </div>

            {/* Token usage -- 3 small cards */}
            <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="card">
                    <div className="text-xs text-content-tertiary mb-1.5">{t('agent.settings.today')} Token</div>
                    <div className="text-[22px] font-semibold">{formatTokens(agent.tokens_used_today)}</div>
                    {agent.max_tokens_per_day && (
                        <div className="text-[11px] text-content-tertiary mt-0.5">/ {formatTokens(agent.max_tokens_per_day)}</div>
                    )}
                </div>
                <div className="card">
                    <div className="text-xs text-content-tertiary mb-1.5">{t('agent.settings.month')} Token</div>
                    <div className="text-[22px] font-semibold">{formatTokens(agent.tokens_used_month)}</div>
                    {agent.max_tokens_per_month && (
                        <div className="text-[11px] text-content-tertiary mt-0.5">/ {formatTokens(agent.max_tokens_per_month)}</div>
                    )}
                </div>
                <div className="card">
                    <div className="text-xs text-content-tertiary mb-1.5">Total Token</div>
                    <div className="text-[22px] font-semibold">{formatTokens(agent.tokens_used_total || 0)}</div>
                </div>
            </div>

            {agent.agent_type === 'openclaw' && <OpenClawGatewayPanel agentId={agentId} agent={agent} />}
            <MemoryInsightsPanel agentId={agentId} />
            <CollaborationPanel agentId={agentId} agent={agent} />

            {/* 5 MD file editor cards */}
            <FileEditorCard agentId={agentId} path="soul.md" title={t('agent.overview.personality')} />
            <FileEditorCard agentId={agentId} path="memory/memory.md" title={t('agent.overview.memory')} />
            <FileEditorCard agentId={agentId} path="HEARTBEAT.md" title={t('agent.overview.heartbeat')} />
            <FileEditorCard agentId={agentId} path="relationships.md" title={t('agent.overview.relationships')} />
            <FileEditorCard agentId={agentId} path="memory/reflections.md" title={t('agent.overview.reflections')} readOnly />
        </div>
    );
}
