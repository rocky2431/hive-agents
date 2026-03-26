import { useTranslation } from 'react-i18next';
import { CollaborationPanel } from './collaboration-panel';
import { OpenClawGatewayPanel } from './openclaw-gateway-panel';
import { RelationshipEditor } from './relationship-editor';
import ChannelConfig from '@/components/ChannelConfig';
import type { Agent } from '@/types';

interface ConnectionsTabProps {
    agentId: string;
    agent: Agent;
    canManage: boolean;
}

export function ConnectionsTab({ agentId, agent, canManage }: ConnectionsTabProps) {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col gap-6 mt-4">
            {/* Channel integrations (Feishu, Slack, Discord, etc.) */}
            {canManage && (
                <div>
                    <h3 className="text-sm font-medium text-content-secondary mb-3">
                        {t('agent.tabs.channels', 'Channels')}
                    </h3>
                    <ChannelConfig mode="edit" agentId={agentId} canManage={canManage} />
                </div>
            )}

            {/* OpenClaw gateway (for openclaw agents) */}
            {agent.agent_type === 'openclaw' && (
                <OpenClawGatewayPanel agentId={agentId} agent={agent} />
            )}

            {/* Human & agent relationships */}
            {canManage && (
                <div>
                    <h3 className="text-sm font-medium text-content-secondary mb-3">
                        {t('agent.tabs.relationships', 'Relationships')}
                    </h3>
                    <RelationshipEditor agentId={agentId} />
                </div>
            )}

            {/* Agent-to-agent collaboration */}
            <CollaborationPanel agentId={agentId} agent={agent} />
        </div>
    );
}
