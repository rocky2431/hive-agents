import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { AgentStatus } from '@/types';

interface AgentStatusBadgeProps {
    status: AgentStatus;
    isExpired?: boolean;
    className?: string;
}

const variantMap: Record<AgentStatus, 'success' | 'warning' | 'error' | 'secondary' | 'default'> = {
    draft: 'secondary',
    creating: 'default',
    running: 'success',
    idle: 'secondary',
    stopped: 'secondary',
    error: 'error',
};

export function AgentStatusBadge({ status, isExpired, className }: AgentStatusBadgeProps) {
    const { t } = useTranslation();

    if (isExpired) {
        return <Badge variant="warning" className={className}>{t('agents.status.expired', 'Expired')}</Badge>;
    }

    const variant = variantMap[status] ?? 'secondary';
    const label = t(`agents.status.${status}`, status);

    return <Badge variant={variant} className={className}>{label}</Badge>;
}
