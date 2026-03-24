import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { messageApi } from '../services/api';

const ACTION_ICONS: Record<string, string> = {
    agent: '🤖',
};

export default function Messages() {
    const { t, i18n } = useTranslation();
    const { data: messages = [], isLoading } = useQuery({
        queryKey: ['messages-inbox'],
        queryFn: () => messageApi.inbox(100),
        refetchInterval: 15000,
    });

    const formatTime = (iso: string) => {
        if (!iso) return '';
        const d = new Date(iso);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        if (diffMs < 60000) return t('messages.justNow');
        if (diffMs < 3600000) return t('messages.minutesAgo', { count: Math.floor(diffMs / 60000) });
        if (diffMs < 86400000) return t('messages.hoursAgo', { count: Math.floor(diffMs / 3600000) });
        return d.toLocaleDateString(i18n.language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                <h1 style={{ fontSize: '20px', fontWeight: 600, margin: 0 }}>{t('messages.title')}</h1>
            </div>

            {isLoading && (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>{t('common.loading')}</div>
            )}

            {!isLoading && messages.length === 0 && (
                <div style={{
                    textAlign: 'center', padding: '60px 20px', color: 'var(--text-tertiary)',
                    background: 'var(--bg-secondary)', borderRadius: '12px',
                }}>
                    <div style={{ fontSize: '13px', marginBottom: '12px', color: 'var(--text-tertiary)' }}>{t('messages.empty')}</div>
                    <div>{t('messages.empty')}</div>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {messages.map((msg: any) => (
                    <div
                        key={msg.id}
                        style={{
                            padding: '14px 16px',
                            borderRadius: '8px',
                            background: 'rgba(224,238,238,0.04)',
                            borderLeft: '3px solid var(--border-subtle)',
                            transition: 'background 0.15s',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                            <span style={{ fontSize: '14px' }}>{ACTION_ICONS[msg.sender_type] || '·'}</span>
                            <span style={{ fontWeight: 600, fontSize: '14px' }}>
                                {msg.sender_name}
                            </span>
                            {msg.session_title && (
                                <span style={{
                                    color: 'var(--text-tertiary)',
                                    fontSize: '11px',
                                    padding: '2px 8px',
                                    borderRadius: '999px',
                                    background: 'var(--bg-secondary)',
                                }}>
                                    {msg.session_title}
                                </span>
                            )}
                            <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                {formatTime(msg.created_at)}
                            </span>
                        </div>
                        <div style={{
                            fontSize: '13px', color: 'var(--text-secondary)',
                            lineHeight: '1.5', whiteSpace: 'pre-wrap',
                            maxHeight: '60px', overflow: 'hidden',
                        }}>
                            {msg.content}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
