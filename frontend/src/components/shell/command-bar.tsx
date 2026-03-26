import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { agentApi } from '@/services/api';
import { AgentAvatar } from '@/components/domain/agent-avatar';
import type { Agent } from '@/types';
import {
    Search,
    Plus,
    Settings,
    LayoutDashboard,
    Users,
    MessageSquare,
    Bell,
    Landmark,
} from 'lucide-react';

interface CommandItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    action: () => void;
    section: 'navigation' | 'agents' | 'actions';
    keywords?: string;
}

interface CommandBarProps {
    tenantId?: string;
}

export function CommandBar({ tenantId }: CommandBarProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const navigate = useNavigate();
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const { data: agents = [] } = useQuery({
        queryKey: ['agents', tenantId],
        queryFn: () => agentApi.list(tenantId),
        enabled: open,
    });

    // Cmd+K / Ctrl+K to toggle
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setOpen(v => !v);
                setQuery('');
                setSelectedIndex(0);
            }
            if (e.key === 'Escape' && open) {
                setOpen(false);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open]);

    // Custom event for programmatic open (e.g. sidebar search button)
    useEffect(() => {
        const handler = () => { setOpen(true); setQuery(''); setSelectedIndex(0); };
        window.addEventListener('open-command-bar', handler);
        return () => window.removeEventListener('open-command-bar', handler);
    }, []);

    // Focus input when opened
    useEffect(() => {
        if (open) {
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [open]);

    const go = useCallback((path: string) => {
        navigate(path);
        setOpen(false);
    }, [navigate]);

    const navItems: CommandItem[] = [
        { id: 'nav-home', label: t('nav.dashboard'), icon: <LayoutDashboard size={16} />, action: () => go('/home'), section: 'navigation', keywords: 'dashboard home' },
        { id: 'nav-plaza', label: t('nav.plaza', 'Plaza'), icon: <Landmark size={16} />, action: () => go('/plaza'), section: 'navigation', keywords: 'plaza square' },
        { id: 'nav-messages', label: t('nav.messages', 'Messages'), icon: <MessageSquare size={16} />, action: () => go('/messages'), section: 'navigation', keywords: 'messages inbox' },
        { id: 'nav-notifications', label: t('notifications.title', 'Notifications'), icon: <Bell size={16} />, action: () => go('/notifications'), section: 'navigation', keywords: 'notifications alerts' },
        { id: 'nav-workspace', label: t('nav.enterprise'), icon: <Settings size={16} />, action: () => go('/workspace'), section: 'navigation', keywords: 'enterprise settings workspace company' },
        { id: 'nav-team', label: t('enterprise.tabs.org', 'Team'), icon: <Users size={16} />, action: () => go('/workspace?tab=org'), section: 'navigation', keywords: 'team organization members' },
    ];

    const actionItems: CommandItem[] = [
        { id: 'action-new-agent', label: t('nav.newAgent'), icon: <Plus size={16} />, action: () => go('/agents/new'), section: 'actions', keywords: 'create new agent' },
    ];

    const agentItems: CommandItem[] = (agents as Agent[]).map(a => ({
        id: `agent-${a.id}`,
        label: a.name,
        icon: <AgentAvatar name={a.name} status={a.status} size="sm" />,
        action: () => go(`/agents/${a.id}`),
        section: 'agents' as const,
        keywords: a.role_description || '',
    }));

    const allItems = [...actionItems, ...navItems, ...agentItems];

    const q = query.trim().toLowerCase();
    const filtered = q
        ? allItems.filter(item =>
            item.label.toLowerCase().includes(q) ||
            (item.keywords || '').toLowerCase().includes(q)
        )
        : allItems;

    // Reset selection when filter changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    // Keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter' && filtered[selectedIndex]) {
            e.preventDefault();
            filtered[selectedIndex].action();
        }
    };

    // Scroll selected item into view
    useEffect(() => {
        const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
        el?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    if (!open) return null;

    const sections = [
        { key: 'actions', label: t('commandBar.actions', 'Actions'), items: filtered.filter(i => i.section === 'actions') },
        { key: 'navigation', label: t('commandBar.navigation', 'Navigation'), items: filtered.filter(i => i.section === 'navigation') },
        { key: 'agents', label: t('commandBar.agents', 'Agents'), items: filtered.filter(i => i.section === 'agents') },
    ].filter(s => s.items.length > 0);

    // Pre-compute flat index map so we don't rely on mutable counter during render
    const flatItems: { item: CommandItem; sectionKey: string }[] = [];
    for (const section of sections) {
        for (const item of section.items) {
            flatItems.push({ item, sectionKey: section.key });
        }
    }

    return (
        <div className="fixed inset-0 z-[10000] flex items-start justify-center pt-[20vh]" onClick={() => setOpen(false)}>
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
            <div
                className="relative w-full max-w-[520px] rounded-xl border border-edge-subtle bg-surface-secondary shadow-lg overflow-hidden"
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-label={t('commandBar.title', 'Command palette')}
            >
                {/* Search input */}
                <div className="flex items-center gap-3 px-4 border-b border-edge-subtle">
                    <Search size={16} className="text-content-tertiary shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t('commandBar.placeholder', 'Search agents, pages, actions...')}
                        className="flex-1 bg-transparent border-none outline-none py-3.5 text-sm text-content-primary placeholder:text-content-tertiary"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-edge-subtle bg-surface-tertiary px-1.5 py-0.5 text-[10px] text-content-tertiary font-mono">
                        ESC
                    </kbd>
                </div>

                {/* Results */}
                <div ref={listRef} className="max-h-[320px] overflow-y-auto py-2">
                    {filtered.length === 0 && (
                        <div className="px-4 py-8 text-center text-sm text-content-tertiary">
                            {t('commandBar.noResults', 'No results found')}
                        </div>
                    )}
                    {sections.map(section => {
                        const sectionItems = flatItems
                            .map((fi, idx) => ({ ...fi, idx }))
                            .filter(fi => fi.sectionKey === section.key);
                        return (
                            <div key={section.key}>
                                <div className="px-4 py-1.5 text-[11px] font-medium text-content-tertiary uppercase tracking-wider">
                                    {section.label}
                                </div>
                                {sectionItems.map(({ item, idx }) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={item.action}
                                        onMouseEnter={() => setSelectedIndex(idx)}
                                        className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                                            idx === selectedIndex
                                                ? 'bg-surface-hover text-content-primary'
                                                : 'text-content-secondary hover:bg-surface-hover'
                                        }`}
                                    >
                                        <span className="shrink-0 text-content-tertiary">{item.icon}</span>
                                        <span className="truncate">{item.label}</span>
                                    </button>
                                ))}
                            </div>
                        );
                    })}
                </div>

                {/* Footer hint */}
                <div className="flex items-center gap-4 px-4 py-2 border-t border-edge-subtle text-[11px] text-content-tertiary">
                    <span className="flex items-center gap-1">
                        <kbd className="rounded border border-edge-subtle bg-surface-tertiary px-1 py-0.5 font-mono text-[10px]">&uarr;&darr;</kbd>
                        {t('commandBar.navigate', 'Navigate')}
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd className="rounded border border-edge-subtle bg-surface-tertiary px-1 py-0.5 font-mono text-[10px]">&crarr;</kbd>
                        {t('commandBar.select', 'Select')}
                    </span>
                </div>
            </div>
        </div>
    );
}
