import { useTranslation } from 'react-i18next';
import { EnterpriseKBBrowser } from './enterprise-kb-browser';

const noop = () => {};

export function KbTab({ vikingStatus }: { vikingStatus?: { connected: boolean; version?: string } | null }) {
    const { t } = useTranslation();

    return (
        <div>
            <div className="flex items-center gap-3 mb-2">
                <h3 className="m-0">{t('enterprise.kb.title')}</h3>
                {vikingStatus?.connected ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-[10px] font-medium flex items-center gap-1" style={{ background: 'rgba(16,185,129,0.15)', color: 'rgb(16,185,129)' }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-[rgb(16,185,129)]" />
                        OpenViking {vikingStatus.version || ''}
                    </span>
                ) : vikingStatus ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-[10px] bg-surface-secondary text-content-tertiary font-medium">
                        {t('enterprise.kb.vikingOffline', 'Knowledge engine offline')}
                    </span>
                ) : null}
            </div>
            <p className="text-xs text-content-tertiary mb-3">
                {t('enterprise.kb.description', 'Shared files accessible to all agents via enterprise_info/ directory.')}
            </p>
            <div className="card mb-6 p-4">
                <EnterpriseKBBrowser onRefresh={noop} />
            </div>
        </div>
    );
}
