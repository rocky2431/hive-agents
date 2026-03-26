import { useTranslation } from 'react-i18next';
import { CapabilitiesView } from './capabilities-view';
import { CapabilityPolicyManager } from './capability-policy-manager';
import { AgentOperationsPanel } from './agent-operations-panel';
import type { Agent } from '@/types';

interface CapabilitiesTabProps {
    agentId: string;
    agent: Agent;
    canManage: boolean;
}

export function CapabilitiesTab({ agentId, agent, canManage }: CapabilitiesTabProps) {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col gap-6 mt-4">
            {/* Capability packs & tools summary */}
            <CapabilitiesView agentId={agentId} canManage={canManage} />

            {/* Capability policies (allow/deny/approval) */}
            {canManage && (
                <div>
                    <h3 className="text-sm font-medium text-content-secondary mb-3">
                        {t('agent.tabs.capabilityPolicies', 'Capability Policies')}
                    </h3>
                    <CapabilityPolicyManager agentId={agentId} />
                </div>
            )}

            {/* Operations: start/stop, metrics, delete */}
            {canManage && <AgentOperationsPanel agentId={agentId} agent={agent} />}
        </div>
    );
}
