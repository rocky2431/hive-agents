/** Shared chat icon set — used by both Chat.tsx (fullscreen) and chat-tab.tsx (embedded) */

export const ChatIcons = {
    bot: (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="12" height="10" rx="2" />
            <circle cx="7" cy="10" r="1" fill="currentColor" stroke="none" />
            <circle cx="11" cy="10" r="1" fill="currentColor" stroke="none" />
            <path d="M9 2v3M6 2h6" />
        </svg>
    ),
    user: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="8" cy="5.5" r="2.5" />
            <path d="M3 14v-1a4 4 0 018 0v1" />
        </svg>
    ),
    chat: (
        <svg width="28" height="28" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z" />
            <path d="M5 5.5h6M5 8h4" />
        </svg>
    ),
    clip: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13.5 7l-5.8 5.8a3 3 0 01-4.2-4.2L9.3 2.8a2 2 0 012.8 2.8L6.3 11.4a1 1 0 01-1.4-1.4L10.7 4.2" />
        </svg>
    ),
    loader: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M8 2v3M8 11v3M3.8 3.8l2.1 2.1M10.1 10.1l2.1 2.1M2 8h3M11 8h3M3.8 12.2l2.1-2.1M10.1 5.9l2.1-2.1" />
        </svg>
    ),
    tool: (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.5 10.5L14 14M4.5 2a2.5 2.5 0 00-1.8 4.2l5.1 5.1A2.5 2.5 0 1012 7.2L6.8 2.2A2.5 2.5 0 004.5 2z" />
        </svg>
    ),
};

/** Shared event presentation helper */
export function getEventPresentation(msg: { eventType?: string; eventTitle?: string }, t: any) {
    if (msg.eventType === 'permission') {
        return { icon: '\uD83D\uDD12', title: msg.eventTitle || t('chat.event.permissionGate', 'Permission Gate'), bg: 'bg-warning-subtle', bgClass: 'bg-[rgba(245,158,11,0.10)]' };
    }
    if (msg.eventType === 'pack_activation') {
        return { icon: '\uD83E\udDF0', title: msg.eventTitle || t('chat.event.packActivated', 'Capability Packs Activated'), bg: 'bg-info/10', bgClass: 'bg-[rgba(59,130,246,0.10)]' };
    }
    return { icon: '\uD83D\uDDDC\uFE0F', title: msg.eventTitle || t('chat.event.contextCompacted', 'Context Compacted'), bg: 'bg-surface-secondary', bgClass: 'bg-surface-secondary' };
}
