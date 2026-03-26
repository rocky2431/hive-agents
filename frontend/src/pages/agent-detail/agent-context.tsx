import { createContext, useContext } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { Agent } from '@/types';

interface AgentContextValue {
    agentId: string;
    agent: Agent;
    canManage: boolean;
    queryClient: QueryClient;
    /** Invalidate the agent query and refetch */
    refreshAgent: () => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children, value }: { children: React.ReactNode; value: AgentContextValue }) {
    return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent(): AgentContextValue {
    const ctx = useContext(AgentContext);
    if (!ctx) throw new Error('useAgent must be used within AgentProvider');
    return ctx;
}
