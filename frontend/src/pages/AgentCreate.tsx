import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { agentApi } from '../api/domains/agents';

/**
 * /agents/new — thin redirect to HR Agent's AgentDetail page (chat tab).
 * The HR Agent is fetched (or lazily created) via GET /agents/system/hr,
 * then the user is redirected to /agents/{hrAgentId}#chat where the full
 * AgentDetail UI handles chat, settings, skills, etc.
 */
export default function AgentCreate() {
    const { t } = useTranslation();
    const navigate = useNavigate();

    const { data: hrAgent, isLoading, error } = useQuery({
        queryKey: ['hr-agent'],
        queryFn: () => agentApi.getHrAgent(),
        retry: 2,
    });

    useEffect(() => {
        if (hrAgent?.id) {
            navigate(`/agents/${hrAgent.id}#chat`, { replace: true });
        }
    }, [hrAgent, navigate]);

    if (isLoading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <div className="spinner" style={{ margin: '0 auto 12px' }} />
                    <p>{t('hrChat.loading', 'Loading HR agent...')}</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
                <div style={{ textAlign: 'center', color: 'var(--error)' }}>
                    <p>{t('hrChat.loadError', 'Failed to load HR agent. Please check LLM model configuration.')}</p>
                    <button className="btn btn-primary" style={{ marginTop: '12px' }} onClick={() => window.location.reload()}>
                        {t('common.retry', 'Retry')}
                    </button>
                </div>
            </div>
        );
    }

    return null;
}
