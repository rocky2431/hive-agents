import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { enterpriseApi, skillApi } from '@/services/api';
import FileBrowser from '@/components/FileBrowser';
import type { FileBrowserApi } from '@/components/FileBrowser';

export function SkillsTab() {
    const { t } = useTranslation();
    const [refreshKey, setRefreshKey] = useState(0);
    const [showClawhubModal, setShowClawhubModal] = useState(false);
    const [showUrlModal, setShowUrlModal] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [installing, setInstalling] = useState<string | null>(null);
    const [urlInput, setUrlInput] = useState('');
    const [urlPreview, setUrlPreview] = useState<any | null>(null);
    const [urlPreviewing, setUrlPreviewing] = useState(false);
    const [urlImporting, setUrlImporting] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [tokenInput, setTokenInput] = useState('');
    const [tokenStatus, setTokenStatus] = useState<{ configured: boolean; source: string; masked: string; clawhub_configured?: boolean; clawhub_masked?: string } | null>(null);
    const [savingToken, setSavingToken] = useState(false);
    const [clawhubKeyInput, setClawhubKeyInput] = useState('');
    const [savingClawhubKey, setSavingClawhubKey] = useState(false);

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    const adapter: FileBrowserApi = useMemo(() => ({
        list: (path: string) => skillApi.browse.list(path),
        read: (path: string) => skillApi.browse.read(path),
        write: (path: string, content: string) => skillApi.browse.write(path, content),
        delete: (path: string) => skillApi.browse.delete(path),
    }), []);

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;
        setSearching(true);
        setSearchResults([]);
        setHasSearched(true);
        try {
            const results = await skillApi.clawhub.search(searchQuery);
            setSearchResults(results);
        } catch (e: any) {
            showToast(e.message || 'Search failed', 'error');
        }
        setSearching(false);
    };

    const handleInstall = async (slug: string) => {
        setInstalling(slug);
        try {
            const result = await skillApi.clawhub.install(slug);
            const tierLabel = result.tier === 1 ? 'Tier 1 (Pure Prompt)' : result.tier === 2 ? 'Tier 2 (CLI/API)' : 'Tier 3 (OpenClaw Native)';
            showToast(`Installed "${result.name}" — ${tierLabel}, ${result.file_count} files`);
            setRefreshKey(k => k + 1);
            // Remove from search results
            setSearchResults(prev => prev.filter(r => r.slug !== slug));
        } catch (e: any) {
            showToast(e.message || 'Install failed', 'error');
        }
        setInstalling(null);
    };

    const handleUrlPreview = async () => {
        if (!urlInput.trim()) return;
        setUrlPreviewing(true);
        setUrlPreview(null);
        try {
            const preview = await skillApi.previewUrl(urlInput);
            setUrlPreview(preview);
        } catch (e: any) {
            showToast(e.message || 'Preview failed', 'error');
        }
        setUrlPreviewing(false);
    };

    const handleUrlImport = async () => {
        if (!urlInput.trim()) return;
        setUrlImporting(true);
        try {
            const result = await skillApi.importFromUrl(urlInput);
            showToast(`Imported "${result.name}" — ${result.file_count} files`);
            setRefreshKey(k => k + 1);
            setShowUrlModal(false);
            setUrlInput('');
            setUrlPreview(null);
        } catch (e: any) {
            showToast(e.message || 'Import failed', 'error');
        }
        setUrlImporting(false);
    };

    const tierBadge = (tier: number) => {
        const styles: Record<number, { className: string; label: string }> = {
            1: { className: 'bg-[rgba(52,199,89,0.12)] text-success', label: 'Tier 1 · Pure Prompt' },
            2: { className: 'bg-[rgba(255,159,10,0.12)] text-warning', label: 'Tier 2 · CLI/API' },
            3: { className: 'bg-[rgba(255,59,48,0.12)] text-error', label: 'Tier 3 · OpenClaw Native' },
        };
        const s = styles[tier] || styles[1];
        return (
            <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${s.className}`}>
                {s.label}
            </span>
        );
    };

    return (
        <div>
            <div className="mb-3 flex justify-between items-start">
                <div>
                    <h3>{t('enterprise.tabs.skills', 'Skill Registry')}</h3>
                    <p className="text-[13px] text-content-tertiary mt-1">
                        公司级技能模板会出现在数字员工创建流程中。你可以从技能库或链接导入，再按需分配给具体数字员工。
                    </p>
                </div>
                <div className="flex gap-2 shrink-0">
                    <button
                        className="btn btn-secondary text-[13px] px-2.5 py-1.5 min-w-0"
                        onClick={async () => {
                            setShowSettings(s => !s);
                            if (!tokenStatus) {
                                try {
                                    const status = await skillApi.settings.getToken();
                                    setTokenStatus(status);
                                } catch { /* ignore */ }
                            }
                        }}
                        title="Settings"
                        aria-label="Settings"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                    </button>
                    <button
                        className="btn btn-secondary text-[13px]"
                        onClick={() => { setShowUrlModal(true); setUrlInput(''); setUrlPreview(null); }}
                    >
                        {t('agent.capability.skillsUrl')}
                    </button>
                    <button
                        className="btn btn-primary text-[13px]"
                        onClick={() => { setShowClawhubModal(true); setSearchQuery(''); setSearchResults([]); setHasSearched(false); }}
                    >
                        {t('agent.capability.skillsLibrary')}
                    </button>
                </div>
            </div>

            {/* GitHub Token Settings Panel */}
            {showSettings && (
                <div className="mb-4 p-4 rounded-lg border border-edge-default bg-surface-secondary">
                    <div className="text-[13px] font-semibold mb-2 flex items-center gap-1.5">
                        GitHub Token
                        <span className="metric-tooltip-trigger inline-flex items-center cursor-help text-content-tertiary">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5" /><path d="M8 7v4M8 5.5v0" /></svg>
                            <span className="metric-tooltip" style={{ width: '300px', bottom: 'auto', top: 'calc(100% + 6px)', left: '-8px' }}>
                                <div className="mb-1.5 font-medium">How to generate a GitHub Token:</div>
                                1. Go to github.com &rarr; Settings &rarr; Developer settings<br/>
                                2. Click "Personal access tokens" &rarr; "Tokens (classic)"<br/>
                                3. Click "Generate new token (classic)"<br/>
                                4. Set a name and expiration, no scopes needed for public repos<br/>
                                5. Click "Generate token" and copy the value<br/>
                                <div className="mt-1.5 text-[11px] text-content-tertiary">
                                    Or visit: github.com/settings/tokens
                                </div>
                            </span>
                        </span>
                    </div>
                    <p className="text-xs text-content-tertiary mb-3">
                        Increases GitHub API rate limits from 60/hr to 5,000/hr for skill imports.
                    </p>
                    {tokenStatus?.configured && (
                        <div className="text-xs text-content-secondary mb-2">
                            Current token: <code className="px-1.5 py-0.5 rounded bg-surface-tertiary text-[11px]">{tokenStatus.masked}</code>
                            <span className="ml-2 text-content-tertiary">({tokenStatus.source})</span>
                        </div>
                    )}
                    <div className="flex gap-2 items-center">
                        {/* Hidden inputs to absorb browser autofill */}
                        <input type="text" name="prevent_autofill_user" className="hidden" tabIndex={-1} />
                        <input type="password" name="prevent_autofill_pass" className="hidden" tabIndex={-1} />
                        <input
                            type="text"
                            className="input flex-1 text-[13px] font-mono"
                            autoComplete="off"
                            data-form-type="other"
                            placeholder="ghp_xxxxxxxxxxxx"
                            value={tokenInput}
                            onChange={e => setTokenInput(e.target.value)}
                            style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
                        />
                        <button
                            className="btn btn-primary text-[13px]"
                            disabled={!tokenInput.trim() || savingToken}
                            onClick={async () => {
                                setSavingToken(true);
                                try {
                                    await skillApi.settings.setToken(tokenInput.trim());
                                    const status = await skillApi.settings.getToken();
                                    setTokenStatus(status);
                                    setTokenInput('');
                                    showToast('GitHub token saved');
                                } catch (e: any) {
                                    showToast(e.message || 'Failed to save', 'error');
                                }
                                setSavingToken(false);
                            }}
                        >
                            {savingToken ? 'Saving...' : 'Save'}
                        </button>
                        {tokenStatus?.configured && tokenStatus.source === 'tenant' && (
                            <button
                                className="btn btn-secondary text-[13px]"
                                onClick={async () => {
                                    try {
                                        await skillApi.settings.setToken('');
                                        const status = await skillApi.settings.getToken();
                                        setTokenStatus(status);
                                        showToast('Token cleared');
                                    } catch (e: any) {
                                        showToast(e.message || 'Failed', 'error');
                                    }
                                }}
                            >
                                Clear
                            </button>
                        )}
                    </div>

                    {/* ClawHub API Key */}
                    <div className="mt-4">
                        <div className="text-[13px] font-semibold mb-2 flex items-center gap-1.5">
                            ClawHub API Key
                            <span className="metric-tooltip-trigger inline-flex items-center cursor-help text-content-tertiary">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5" /><path d="M8 7v4M8 5.5v0" /></svg>
                                <span className="metric-tooltip font-normal" style={{ width: '280px', bottom: 'auto', top: 'calc(100% + 6px)', left: '-8px' }}>
                                    Authenticate ClawHub API calls to avoid rate limiting when browsing and installing skills from ClawHub.
                                </span>
                            </span>
                        </div>
                        <p className="text-xs text-content-tertiary mb-3">
                            Authenticated requests get higher rate limits for ClawHub skill browsing and installation.
                        </p>
                        {tokenStatus?.clawhub_configured && (
                            <div className="text-xs text-content-secondary mb-2">
                                Current key: <code className="px-1.5 py-0.5 rounded bg-surface-tertiary text-[11px]">{tokenStatus.clawhub_masked}</code>
                            </div>
                        )}
                        <div className="flex gap-2 items-center">
                            <input type="text" name="prevent_autofill_ch_user" className="hidden" tabIndex={-1} />
                            <input type="password" name="prevent_autofill_ch_pass" className="hidden" tabIndex={-1} />
                            <input
                                type="text"
                                className="input flex-1 text-[13px] font-mono"
                                autoComplete="off"
                                data-form-type="other"
                                placeholder="sk-ant-xxxxxxxxxxxx"
                                value={clawhubKeyInput}
                                onChange={e => setClawhubKeyInput(e.target.value)}
                                style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
                            />
                            <button
                                className="btn btn-primary text-[13px]"
                                disabled={!clawhubKeyInput.trim() || savingClawhubKey}
                                onClick={async () => {
                                    setSavingClawhubKey(true);
                                    try {
                                        await skillApi.settings.setClawhubKey(clawhubKeyInput.trim());
                                        const status = await skillApi.settings.getToken();
                                        setTokenStatus(status);
                                        setClawhubKeyInput('');
                                        showToast('ClawHub API key saved');
                                    } catch (e: any) {
                                        showToast(e.message || 'Failed to save', 'error');
                                    }
                                    setSavingClawhubKey(false);
                                }}
                            >
                                {savingClawhubKey ? 'Saving...' : 'Save'}
                            </button>
                            {tokenStatus?.clawhub_configured && (
                                <button
                                    className="btn btn-secondary text-[13px]"
                                    onClick={async () => {
                                        try {
                                            await skillApi.settings.setClawhubKey('');
                                            const status = await skillApi.settings.getToken();
                                            setTokenStatus(status);
                                            showToast('ClawHub key cleared');
                                        } catch (e: any) {
                                            showToast(e.message || 'Failed', 'error');
                                        }
                                    }}
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <FileBrowser
                key={refreshKey}
                api={adapter}
                features={{ newFile: true, newFolder: true, edit: true, delete: true, directoryNavigation: true }}
                title={t('agent.skills.skillFiles', 'Skill Files')}
                onRefresh={() => setRefreshKey(k => k + 1)}
            />

            {/* Toast */}
            {toast && (
                <div className={`fixed bottom-6 right-6 z-[10000] px-5 py-3 rounded-lg text-[13px] font-medium text-white shadow-[0_4px_16px_rgba(0,0,0,0.2)] max-w-[400px] animate-[fadeIn_200ms_ease] ${toast.type === 'error' ? 'bg-[rgba(255,59,48,0.95)]' : 'bg-[rgba(52,199,89,0.95)]'}`}>
                    {toast.message}
                </div>
            )}

            {/* ClawHub Search Modal */}
            {showClawhubModal && (
                <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center" onClick={() => setShowClawhubModal(false)}>
                    <div className="bg-surface-primary rounded-xl w-[640px] max-h-[80vh] flex flex-col border border-edge-default shadow-[0_16px_48px_rgba(0,0,0,0.2)]" onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div className="px-6 pt-5 pb-4 border-b border-edge-subtle">
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="m-0 text-base">{t('agent.capability.skillsLibrary')}</h3>
                                <button className="btn btn-ghost px-2 py-1 text-base leading-none" onClick={() => setShowClawhubModal(false)} aria-label={t('common.close', 'Close')}>x</button>
                            </div>
                            <div className="flex gap-2">
                                <input
                                    className="input flex-1 text-[13px]"
                                    placeholder={t('common.search')}
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                    autoFocus
                                />
                                <button className="btn btn-primary text-[13px]" onClick={handleSearch} disabled={searching}>
                                    {searching ? 'Searching...' : 'Search'}
                                </button>
                            </div>
                        </div>
                        {/* Results */}
                        <div className="flex-1 overflow-y-auto px-6 py-3">
                            {searchResults.length === 0 && !searching && (
                                <div className="text-center py-10 text-content-tertiary text-[13px]">
                                    {hasSearched ? t('common.noData') : '从技能库中搜索并导入技能'}
                                </div>
                            )}
                            {searching && (
                                <div className="text-center py-10 text-content-tertiary text-[13px]">
                                    Searching ClawHub...
                                </div>
                            )}
                            {searchResults.map((r: any) => (
                                <div key={r.slug} className="py-3 border-b border-edge-subtle flex justify-between items-start gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-semibold text-sm">{r.displayName}</span>
                                            <span className="text-[11px] text-content-tertiary font-mono">{r.slug}</span>
                                        </div>
                                        <div className="text-xs text-content-secondary leading-snug">
                                            {r.summary?.slice(0, 160)}{r.summary?.length > 160 ? '...' : ''}
                                        </div>
                                    </div>
                                    <button
                                        className="btn btn-secondary text-xs shrink-0"
                                        disabled={installing === r.slug}
                                        onClick={() => handleInstall(r.slug)}
                                    >
                                        {installing === r.slug ? 'Installing...' : 'Install'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* URL Import Modal */}
            {showUrlModal && (
                <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center" onClick={() => setShowUrlModal(false)}>
                    <div className="bg-surface-primary rounded-xl w-[560px] border border-edge-default shadow-[0_16px_48px_rgba(0,0,0,0.2)]" onClick={e => e.stopPropagation()}>
                        <div className="px-6 pt-5 pb-4 border-b border-edge-subtle">
                            <div className="flex justify-between items-center mb-3">
                                                <h3 className="m-0 text-base">{t('agent.capability.skillsUrl')}</h3>
                                                <button className="btn btn-ghost px-2 py-1 text-base leading-none" onClick={() => setShowUrlModal(false)} aria-label={t('common.close', 'Close')}>x</button>
                                            </div>
                                            <p className="text-xs text-content-tertiary mb-3">
                                                贴入一个包含 `SKILL.md` 的 GitHub 技能目录链接，系统会先预览再导入。
                                            </p>
                            <div className="flex gap-2">
                                <input
                                    className="input flex-1 text-[13px] font-mono"
                                    placeholder="https://github.com/owner/repo/tree/main/skills/my-skill"
                                    value={urlInput}
                                    onChange={e => { setUrlInput(e.target.value); setUrlPreview(null); }}
                                    autoFocus
                                    onKeyDown={e => e.key === 'Enter' && handleUrlPreview()}
                                />
                                <button className="btn btn-secondary text-xs" onClick={handleUrlPreview} disabled={urlPreviewing || !urlInput.trim()}>
                                    {urlPreviewing ? 'Loading...' : 'Preview'}
                                </button>
                            </div>
                        </div>

                        {/* Preview result */}
                        {urlPreview && (
                            <div className="px-6 py-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="font-semibold text-sm">{urlPreview.name}</span>
                                    {tierBadge(urlPreview.tier)}
                                    {urlPreview.has_scripts && (
                                        <span className="px-2 py-0.5 rounded text-[11px] bg-[rgba(255,59,48,0.1)] text-error">
                                            Contains scripts
                                        </span>
                                    )}
                                </div>
                                {urlPreview.description && (
                                    <p className="text-xs text-content-secondary mb-2">{urlPreview.description}</p>
                                )}
                                <div className="text-[11px] text-content-tertiary mb-3">
                                    {urlPreview.files?.length} files, {(urlPreview.total_size / 1024).toFixed(1)} KB
                                </div>
                                <div className="flex gap-2 justify-end">
                                    <button className="btn btn-secondary text-[13px]" onClick={() => setShowUrlModal(false)}>Cancel</button>
                                    <button className="btn btn-primary text-[13px]" onClick={handleUrlImport} disabled={urlImporting}>
                                        {urlImporting ? 'Importing...' : 'Import'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}


// ─── Notification Bar Config ──────────────────────
