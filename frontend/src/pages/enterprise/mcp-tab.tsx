import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { packApi } from '@/services/api';

export function McpTab() {
    const { t } = useTranslation();
    const qc = useQueryClient();

    const { data: packCatalog = [], isLoading: packsLoading } = useQuery({
        queryKey: ['pack-catalog'],
        queryFn: () => packApi.catalog(),
    });

    const { data: tenantMcpServers = [], isLoading: mcpLoading } = useQuery({
        queryKey: ['tenant-mcp-registry'],
        queryFn: () => packApi.mcpRegistry(),
    });

    const [expandedPacks, setExpandedPacks] = useState<Record<string, boolean>>({});
    const [packSaving, setPackSaving] = useState<string | null>(null);
    const [mcpForm, setMcpForm] = useState({ server_id: '', mcp_url: '', server_name: '', api_key: '' });
    const [mcpError, setMcpError] = useState('');

    const handleImportMcp = async () => {
        setMcpError('');
        try {
            const payload = {
                server_id: mcpForm.server_id.trim() || undefined,
                mcp_url: mcpForm.mcp_url.trim() || undefined,
                server_name: mcpForm.server_name.trim() || undefined,
                config: mcpForm.api_key.trim() ? { api_key: mcpForm.api_key.trim() } : undefined,
            };
            await packApi.importMcp(payload);
            setMcpForm({ server_id: '', mcp_url: '', server_name: '', api_key: '' });
            qc.invalidateQueries({ queryKey: ['tenant-mcp-registry'] });
            qc.invalidateQueries({ queryKey: ['pack-catalog'] });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Import failed';
            setMcpError(msg);
        }
    };

    const handleDeleteMcp = async (serverKey: string) => {
        await packApi.deleteMcp(serverKey);
        qc.invalidateQueries({ queryKey: ['tenant-mcp-registry'] });
        qc.invalidateQueries({ queryKey: ['pack-catalog'] });
    };

    const handlePackPolicy = async (packName: string, enabled: boolean) => {
        setPackSaving(packName);
        try {
            await packApi.updatePolicy(packName, enabled);
            qc.invalidateQueries({ queryKey: ['pack-catalog'] });
        } finally {
            setPackSaving(null);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Import Form */}
            <div className="card">
                <h3 className="mb-1">{t('enterprise.importedTools.title')}</h3>
                <p className="text-xs text-content-tertiary mb-4">{t('enterprise.importedTools.description')}</p>
                <div className="mb-4">
                    <h4 className="mb-1">{t('enterprise.importedTools.connectTitle')}</h4>
                    <p className="text-xs text-content-tertiary">{t('enterprise.importedTools.connectDesc')}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="form-group">
                        <label htmlFor="mcp-server-id" className="form-label">{t('enterprise.importedTools.smitheryId')}</label>
                        <input id="mcp-server-id" className="form-input" value={mcpForm.server_id} onChange={e => setMcpForm(f => ({ ...f, server_id: e.target.value }))} placeholder="github / gmail / notion" autoComplete="off" spellCheck={false} />
                    </div>
                    <div className="form-group">
                        <label htmlFor="mcp-url" className="form-label">{t('enterprise.importedTools.directUrl')}</label>
                        <input id="mcp-url" className="form-input" value={mcpForm.mcp_url} onChange={e => setMcpForm(f => ({ ...f, mcp_url: e.target.value }))} placeholder="https://example.com/mcp" autoComplete="url" spellCheck={false} />
                    </div>
                    <div className="form-group">
                        <label htmlFor="mcp-display-name" className="form-label">{t('enterprise.importedTools.displayName')}</label>
                        <input id="mcp-display-name" className="form-input" value={mcpForm.server_name} onChange={e => setMcpForm(f => ({ ...f, server_name: e.target.value }))} placeholder="GitHub MCP" autoComplete="off" />
                    </div>
                    <div className="form-group">
                        <label htmlFor="mcp-api-key" className="form-label">{t('enterprise.importedTools.apiKey')}</label>
                        <input id="mcp-api-key" className="form-input" type="password" value={mcpForm.api_key} onChange={e => setMcpForm(f => ({ ...f, api_key: e.target.value }))} placeholder="Optional server credential" autoComplete="off" />
                    </div>
                </div>
                {mcpError && <div className="text-[var(--error)] text-xs mb-2">{mcpError}</div>}
                <div className="flex justify-end">
                    <button className="btn btn-primary" onClick={handleImportMcp}>{t('enterprise.importedTools.importAction')}</button>
                </div>
            </div>

            {/* Installed Servers */}
            <div className="card">
                <h4 className="mb-3">{t('enterprise.importedTools.installedTitle')}</h4>
                {mcpLoading ? (
                    <div className="text-content-tertiary">{t('common.loading')}</div>
                ) : tenantMcpServers.length === 0 ? (
                    <div className="text-content-tertiary">{t('enterprise.importedTools.installedEmpty')}</div>
                ) : (
                    <div className="flex flex-col gap-2.5">
                        {tenantMcpServers.map((server: any) => (
                            <div key={server.server_key} className="border border-edge-subtle rounded-lg px-3.5 py-3">
                                <div className="flex justify-between gap-3 items-start">
                                    <div>
                                        <div className="font-semibold text-[13px] mb-1">{server.server_name}</div>
                                        <div className="text-[11px] text-content-tertiary mb-1.5">{server.server_url || server.server_key}</div>
                                        <div className="text-xs text-content-secondary">
                                            {t('enterprise.importedTools.installedSummary', { toolCount: server.tool_count, agentCount: server.agent_count })}
                                        </div>
                                    </div>
                                    <button className="btn btn-secondary text-[11px] px-2.5 py-1" onClick={() => handleDeleteMcp(server.server_key)}>
                                        {t('common.delete')}
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-1 mt-2.5">
                                    {(server.tools || []).map((tool: string) => (
                                        <span key={tool} className="text-[11px] px-2 py-0.5 rounded bg-surface-secondary border border-edge-subtle">
                                            {tool}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* System Extensions (collapsible) */}
            <details className="card">
                <summary className="cursor-pointer font-semibold text-sm list-none flex items-center gap-2">
                    <span className="transition-transform inline-block text-xs">&#x25B6;</span>
                    {t('enterprise.importedTools.systemExtensionsTitle')}
                </summary>
                <div className="mt-3">
                    <p className="text-xs text-content-tertiary mb-4">{t('enterprise.importedTools.systemExtensionsDesc')}</p>
                    {packsLoading ? (
                        <div className="text-content-tertiary">{t('common.loading')}</div>
                    ) : packCatalog.length === 0 ? (
                        <div className="text-content-tertiary">{t('common.noData')}</div>
                    ) : (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
                            {packCatalog.map((pack: any) => {
                                const isExpanded = expandedPacks[pack.name] ?? false;
                                const sourceBadgeColors: Record<string, { bg: string; color: string }> = {
                                    system: { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
                                    channel: { bg: 'rgba(34,197,94,0.15)', color: '#4ade80' },
                                    mcp: { bg: 'rgba(168,85,247,0.15)', color: '#c084fc' },
                                    skill: { bg: 'rgba(251,146,60,0.15)', color: '#fb923c' },
                                };
                                const badge = sourceBadgeColors[pack.source] || sourceBadgeColors.system;
                                const sourceLabel = String(t(`enterprise.packs.source${pack.source.charAt(0).toUpperCase() + pack.source.slice(1)}`, pack.source));
                                return (
                                    <div key={pack.name} className="card p-4 flex flex-col gap-2.5">
                                        <div className="flex justify-between items-start">
                                            <span className="font-semibold text-sm text-content-primary">{pack.summary || pack.name}</span>
                                            <div className="flex gap-2 items-center">
                                                <span className="text-[11px] font-medium px-2 py-0.5 rounded-[10px]" style={{ background: badge.bg, color: badge.color }}>
                                                    {sourceLabel}
                                                </span>
                                                <button
                                                    className="btn btn-secondary text-[11px] px-2.5 py-1"
                                                    disabled={packSaving === pack.name}
                                                    onClick={() => handlePackPolicy(pack.name, !pack.enabled)}
                                                >
                                                    {packSaving === pack.name ? '...' : (pack.enabled ? t('enterprise.importedTools.disable') : t('enterprise.importedTools.enable'))}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex gap-4 text-xs text-content-tertiary">
                                            <span>{t('enterprise.importedTools.source')}: <strong className="text-content-secondary">{sourceLabel}</strong></span>
                                            <span>{pack.enabled ? t('enterprise.importedTools.enabled') : t('enterprise.importedTools.disabled')}</span>
                                        </div>
                                        {pack.capabilities && pack.capabilities.length > 0 ? (
                                            <div className="text-[11px] text-[#c084fc] bg-[rgba(168,85,247,0.08)] px-2 py-1 rounded">
                                                {t('enterprise.importedTools.restricted')}: {pack.capabilities.join(', ')}
                                            </div>
                                        ) : (
                                            <div className="text-[11px] text-content-tertiary">{t('enterprise.importedTools.unrestricted')}</div>
                                        )}
                                        {pack.tools && pack.tools.length > 0 && (
                                            <div>
                                                <button
                                                    onClick={() => setExpandedPacks(prev => ({ ...prev, [pack.name]: !isExpanded }))}
                                                    className="bg-transparent border-none cursor-pointer p-0 text-xs text-[var(--accent-primary)] flex items-center gap-1"
                                                >
                                                    <span className={`inline-block transition-transform text-xs ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                                                    {t('enterprise.importedTools.actions')} ({pack.tools.length})
                                                </button>
                                                {isExpanded && (
                                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                                        {pack.tools.map((tool: string) => (
                                                            <span key={tool} className="text-[11px] px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-content-secondary border border-edge-subtle">
                                                                {tool}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </details>
        </div>
    );
}
