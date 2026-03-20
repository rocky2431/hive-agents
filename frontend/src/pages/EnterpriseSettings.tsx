import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { enterpriseApi, skillApi, featureFlagApi, auditApi, capabilityApi, onboardingApi, oidcApi, packApi } from '../services/api';
import PromptModal from '../components/PromptModal';
import FileBrowser from '../components/FileBrowser';
import type { FileBrowserApi } from '../components/FileBrowser';
import { saveAccentColor, getSavedAccentColor, resetAccentColor, PRESET_COLORS } from '../utils/theme';
import UserManagement from './UserManagement';
import InvitationCodes from './InvitationCodes';

// API helpers for enterprise endpoints
async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api${url}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Error');
    if (res.status === 204) return undefined as T;
    return res.json();
}

interface LLMModel {
    id: string; provider: string; model: string; label: string;
    base_url?: string; api_key_masked?: string; max_tokens_per_day?: number; enabled: boolean; supports_vision?: boolean; max_output_tokens?: number; max_input_tokens?: number; created_at: string;
}

interface LLMProviderSpec {
    provider: string;
    display_name: string;
    protocol: string;
    default_base_url?: string | null;
    supports_tool_choice: boolean;
    default_max_tokens: number;
}

const FALLBACK_LLM_PROVIDERS: LLMProviderSpec[] = [
    { provider: 'anthropic', display_name: 'Anthropic', protocol: 'anthropic', default_base_url: 'https://api.anthropic.com', supports_tool_choice: false, default_max_tokens: 8192 },
    { provider: 'openai', display_name: 'OpenAI', protocol: 'openai_compatible', default_base_url: 'https://api.openai.com/v1', supports_tool_choice: true, default_max_tokens: 16384 },
    { provider: 'azure', display_name: 'Azure OpenAI', protocol: 'openai_compatible', default_base_url: '', supports_tool_choice: true, default_max_tokens: 16384 },
    { provider: 'deepseek', display_name: 'DeepSeek', protocol: 'openai_compatible', default_base_url: 'https://api.deepseek.com/v1', supports_tool_choice: true, default_max_tokens: 8192 },
    { provider: 'minimax', display_name: 'MiniMax', protocol: 'openai_compatible', default_base_url: 'https://api.minimaxi.com/v1', supports_tool_choice: true, default_max_tokens: 16384 },
    { provider: 'qwen', display_name: 'Qwen (DashScope)', protocol: 'openai_compatible', default_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', supports_tool_choice: true, default_max_tokens: 8192 },
    { provider: 'zhipu', display_name: 'Zhipu', protocol: 'openai_compatible', default_base_url: 'https://open.bigmodel.cn/api/paas/v4', supports_tool_choice: true, default_max_tokens: 8192 },
    { provider: 'gemini', display_name: 'Gemini', protocol: 'gemini', default_base_url: 'https://generativelanguage.googleapis.com/v1beta', supports_tool_choice: true, default_max_tokens: 8192 },
    { provider: 'openrouter', display_name: 'OpenRouter', protocol: 'openai_compatible', default_base_url: 'https://openrouter.ai/api/v1', supports_tool_choice: true, default_max_tokens: 4096 },
    { provider: 'kimi', display_name: 'Kimi (Moonshot)', protocol: 'openai_compatible', default_base_url: 'https://api.moonshot.cn/v1', supports_tool_choice: true, default_max_tokens: 8192 },
    { provider: 'vllm', display_name: 'vLLM', protocol: 'openai_compatible', default_base_url: 'http://localhost:8000/v1', supports_tool_choice: true, default_max_tokens: 4096 },
    { provider: 'ollama', display_name: 'Ollama', protocol: 'openai_compatible', default_base_url: 'http://localhost:11434/v1', supports_tool_choice: true, default_max_tokens: 4096 },
    { provider: 'sglang', display_name: 'SGLang', protocol: 'openai_compatible', default_base_url: 'http://localhost:30000/v1', supports_tool_choice: true, default_max_tokens: 4096 },
    { provider: 'custom', display_name: 'Custom', protocol: 'openai_compatible', default_base_url: '', supports_tool_choice: true, default_max_tokens: 4096 },
];



// ─── Department Tree ───────────────────────────────
function DeptTree({ departments, parentId, selectedDept, onSelect, level }: {
    departments: any[]; parentId: string | null; selectedDept: string | null;
    onSelect: (id: string | null) => void; level: number;
}) {
    const children = departments.filter((d: any) =>
        parentId === null ? !d.parent_id : d.parent_id === parentId
    );
    if (children.length === 0) return null;
    return (
        <>
            {children.map((d: any) => (
                <div key={d.id}>
                    <div
                        style={{
                            padding: '5px 8px', paddingLeft: `${8 + level * 16}px`, borderRadius: '4px',
                            cursor: 'pointer', fontSize: '13px', marginBottom: '1px',
                            background: selectedDept === d.id ? 'rgba(224,238,238,0.12)' : 'transparent',
                        }}
                        onClick={() => onSelect(d.id)}
                    >
                        <span style={{ color: 'var(--text-tertiary)', marginRight: '4px', fontSize: '11px' }}>
                            {departments.some((c: any) => c.parent_id === d.id) ? '▸' : '·'}
                        </span>
                        {d.name}
                        {d.member_count > 0 && <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginLeft: '4px' }}>({d.member_count})</span>}
                    </div>
                    <DeptTree departments={departments} parentId={d.id} selectedDept={selectedDept} onSelect={onSelect} level={level + 1} />
                </div>
            ))}
        </>
    );
}

// ─── Org Structure Tab ─────────────────────────────
function OrgTab() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const [syncForm, setSyncForm] = useState({ app_id: '', app_secret: '' });
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<any>(null);
    const [memberSearch, setMemberSearch] = useState('');
    const [selectedDept, setSelectedDept] = useState<string | null>(null);

    const { data: config } = useQuery({
        queryKey: ['system-settings', 'feishu_org_sync'],
        queryFn: () => fetchJson<any>('/enterprise/system-settings/feishu_org_sync'),
    });

    useEffect(() => {
        if (config?.value?.app_id) {
            setSyncForm({ app_id: config.value.app_id, app_secret: '' });
        }
    }, [config]);

    const currentTenantId = localStorage.getItem('current_tenant_id') || '';
    const { data: departments = [] } = useQuery({
        queryKey: ['org-departments', currentTenantId],
        queryFn: () => fetchJson<any[]>(`/enterprise/org/departments${currentTenantId ? `?tenant_id=${currentTenantId}` : ''}`),
    });
    const { data: members = [] } = useQuery({
        queryKey: ['org-members', selectedDept, memberSearch, currentTenantId],
        queryFn: () => {
            const params = new URLSearchParams();
            if (selectedDept) params.set('department_id', selectedDept);
            if (memberSearch) params.set('search', memberSearch);
            if (currentTenantId) params.set('tenant_id', currentTenantId);
            return fetchJson<any[]>(`/enterprise/org/members?${params}`);
        },
    });

    const saveConfig = async () => {
        await fetchJson('/enterprise/system-settings/feishu_org_sync', {
            method: 'PUT',
            body: JSON.stringify({ value: { app_id: syncForm.app_id, app_secret: syncForm.app_secret } }),
        });
        qc.invalidateQueries({ queryKey: ['system-settings', 'feishu_org_sync'] });
    };

    const triggerSync = async () => {
        setSyncing(true);
        setSyncResult(null);
        try {
            if (syncForm.app_secret) await saveConfig();
            const result = await fetchJson<any>('/enterprise/org/sync', { method: 'POST' });
            setSyncResult(result);
            qc.invalidateQueries({ queryKey: ['org-departments'] });
            qc.invalidateQueries({ queryKey: ['org-members'] });
        } catch (e: any) {
            setSyncResult({ error: e.message });
        }
        setSyncing(false);
    };

    return (
        <div>
            {/* Sync Config */}
            <div className="card" style={{ marginBottom: '16px' }}>
                <h4 style={{ marginBottom: '12px' }}>{t('enterprise.org.feishuSync')}</h4>
                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                    {t('enterprise.org.feishuSync')}
                </p>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>App ID</label>
                        <input className="input" value={syncForm.app_id} onChange={e => setSyncForm({ ...syncForm, app_id: e.target.value })} placeholder="cli_xxxxxxxx" />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>App Secret</label>
                        <input className="input" type="password" value={syncForm.app_secret} onChange={e => setSyncForm({ ...syncForm, app_secret: e.target.value })} placeholder={config?.value?.app_id ? '' : ''} />
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button className="btn btn-primary" onClick={triggerSync} disabled={syncing || !syncForm.app_id}>
                        {syncing ? t('enterprise.org.syncing') : t('enterprise.org.syncNow')}
                    </button>
                    {config?.value?.last_synced_at && (
                        <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            Last sync: {new Date(config.value.last_synced_at).toLocaleString()}
                        </span>
                    )}
                </div>
                {syncResult && (
                    <div style={{ marginTop: '12px', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', background: syncResult.error ? 'rgba(255,0,0,0.1)' : 'rgba(0,200,0,0.1)' }}>
                        {syncResult.error ? `${syncResult.error}` : t('enterprise.org.syncComplete', { departments: syncResult.departments, members: syncResult.members })}
                    </div>
                )}
            </div>

            {/* Department & Members Browser */}
            <div className="card">
                <h4 style={{ marginBottom: '12px' }}>{t('enterprise.org.orgBrowser')}</h4>
                <div style={{ display: 'flex', gap: '16px' }}>
                    <div style={{ width: '260px', borderRight: '1px solid var(--border-subtle)', paddingRight: '16px', maxHeight: '500px', overflowY: 'auto' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>{t('enterprise.org.allDepartments')}</div>
                        <div
                            style={{ padding: '6px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', marginBottom: '2px', background: !selectedDept ? 'rgba(224,238,238,0.1)' : 'transparent' }}
                            onClick={() => setSelectedDept(null)}
                        >
                            {t('common.all')}
                        </div>
                        <DeptTree departments={departments} parentId={null} selectedDept={selectedDept} onSelect={setSelectedDept} level={0} />
                        {departments.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', padding: '8px' }}>{t('common.noData')}</div>}
                    </div>

                    <div style={{ flex: 1 }}>
                        <input className="input" placeholder={t("enterprise.org.searchMembers")} value={memberSearch} onChange={e => setMemberSearch(e.target.value)} style={{ marginBottom: '12px', fontSize: '13px' }} />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '400px', overflowY: 'auto' }}>
                            {members.map((m: any) => (
                                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(224,238,238,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 600 }}>
                                        {m.name?.[0] || '?'}
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 500, fontSize: '13px' }}>{m.name}</div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                            {m.title || '-'} · {m.department_path || '-'}
                                            {m.email && ` · ${m.email}`}
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {members.length === 0 && <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-tertiary)', fontSize: '13px' }}>{t('enterprise.org.noMembers')}</div>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}


// ─── Theme Color Picker ────────────────────────────
function ThemeColorPicker() {
    const { t } = useTranslation();
    const [currentColor, setCurrentColor] = useState(getSavedAccentColor() || '');
    const [customHex, setCustomHex] = useState('');

    const apply = (hex: string) => {
        setCurrentColor(hex);
        saveAccentColor(hex);
    };

    const handleReset = () => {
        setCurrentColor('');
        setCustomHex('');
        resetAccentColor();
    };

    const handleCustom = () => {
        const hex = customHex.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
            apply(hex);
        }
    };

    return (
        <div className="card" style={{ marginTop: '16px', marginBottom: '16px' }}>
            <h4 style={{ marginBottom: '12px' }}>{t('enterprise.config.themeColor')}</h4>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                {PRESET_COLORS.map(c => (
                    <div
                        key={c.hex}
                        onClick={() => apply(c.hex)}
                        title={c.name}
                        style={{
                            width: '32px', height: '32px', borderRadius: '8px',
                            background: c.hex, cursor: 'pointer',
                            border: currentColor === c.hex ? '2px solid var(--text-primary)' : '2px solid transparent',
                            outline: currentColor === c.hex ? '2px solid var(--bg-primary)' : 'none',
                            transition: 'all 120ms ease',
                        }}
                    />
                ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                    className="input"
                    value={customHex}
                    onChange={e => setCustomHex(e.target.value)}
                    placeholder="#hex"
                    style={{ width: '120px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}
                    onKeyDown={e => e.key === 'Enter' && handleCustom()}
                />
                <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={handleCustom}>Apply</button>
                {currentColor && (
                    <button className="btn btn-ghost" style={{ fontSize: '12px', color: 'var(--text-tertiary)' }} onClick={handleReset}>Reset</button>
                )}
                {currentColor && (
                    <div style={{ width: '20px', height: '20px', borderRadius: '4px', background: currentColor, border: '1px solid var(--border-default)' }} />
                )}
            </div>
        </div>
    );
}

// ─── Platform Settings ─────────────────────────────
function PlatformSettings() {
    const { t } = useTranslation();
    const [publicBaseUrl, setPublicBaseUrl] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        fetchJson<any>('/enterprise/system-settings/platform')
            .then(d => {
                if (d.value?.public_base_url) setPublicBaseUrl(d.value.public_base_url);
            }).catch(() => { });
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await fetchJson('/enterprise/system-settings/platform', {
                method: 'PUT', body: JSON.stringify({ value: { public_base_url: publicBaseUrl } }),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e) {
            alert(t('agent.upload.failed'));
        } finally { setSaving(false); }
    };

    return (
        <div className="card" style={{ padding: '16px' }}>
            <div className="form-group">
                <label className="form-label">{t('enterprise.config.publicUrl')}</label>
                <input className="form-input" value={publicBaseUrl} onChange={e => setPublicBaseUrl(e.target.value)}
                    placeholder={t("enterprise.config.publicUrlPlaceholder")} />
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                    {t('enterprise.config.publicUrl')}
                </div>
            </div>
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? t('common.loading') : t('enterprise.config.save')}
                </button>
                {saved && <span style={{ color: 'var(--success)', fontSize: '12px' }}>{t('enterprise.config.saved')}</span>}
            </div>
        </div>
    );
}


// ─── Main Component ────────────────────────────────
// ─── Enterprise KB Browser ─────────────────────────
function EnterpriseKBBrowser({ onRefresh }: { onRefresh: () => void; refreshKey: number }) {
    const kbAdapter: FileBrowserApi = {
        list: (path) => enterpriseApi.kbFiles(path),
        read: (path) => enterpriseApi.kbRead(path),
        write: (path, content) => enterpriseApi.kbWrite(path, content),
        delete: (path) => enterpriseApi.kbDelete(path),
        upload: (file, path) => enterpriseApi.kbUpload(file, path),
    };
    return <FileBrowser api={kbAdapter} features={{ upload: true, newFolder: true, edit: true, delete: true, directoryNavigation: true }} onRefresh={onRefresh} />;
}

// ─── Skills Tab ────────────────────────────────────
function SkillsTab() {
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
        const styles: Record<number, { bg: string; color: string; label: string }> = {
            1: { bg: 'rgba(52,199,89,0.12)', color: 'var(--success, #34c759)', label: 'Tier 1 · Pure Prompt' },
            2: { bg: 'rgba(255,159,10,0.12)', color: 'var(--warning, #ff9f0a)', label: 'Tier 2 · CLI/API' },
            3: { bg: 'rgba(255,59,48,0.12)', color: 'var(--error, #ff3b30)', label: 'Tier 3 · OpenClaw Native' },
        };
        const s = styles[tier] || styles[1];
        return (
            <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500, background: s.bg, color: s.color }}>
                {s.label}
            </span>
        );
    };

    return (
        <div>
            <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h3>{t('enterprise.tabs.skills', 'Skill Registry')}</h3>
                    <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                        Manage global skills. Each skill is a folder with a SKILL.md file. Skills selected during agent creation are copied to the agent's workspace.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button
                        className="btn btn-secondary"
                        style={{ fontSize: '13px', padding: '6px 10px', minWidth: 'auto' }}
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
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                    </button>
                    <button
                        className="btn btn-secondary"
                        style={{ fontSize: '13px' }}
                        onClick={() => { setShowUrlModal(true); setUrlInput(''); setUrlPreview(null); }}
                    >
                        Import from URL
                    </button>
                    <button
                        className="btn btn-primary"
                        style={{ fontSize: '13px' }}
                        onClick={() => { setShowClawhubModal(true); setSearchQuery(''); setSearchResults([]); setHasSearched(false); }}
                    >
                        Browse ClawHub
                    </button>
                </div>
            </div>

            {/* GitHub Token Settings Panel */}
            {showSettings && (
                <div style={{
                    marginBottom: '16px', padding: '16px', borderRadius: '8px',
                    border: '1px solid var(--border-primary)',
                    background: 'var(--bg-secondary, rgba(255,255,255,0.02))',
                }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        GitHub Token
                        <span className="metric-tooltip-trigger" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'help', color: 'var(--text-tertiary)' }}>
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5" /><path d="M8 7v4M8 5.5v0" /></svg>
                            <span className="metric-tooltip" style={{ width: '300px', bottom: 'auto', top: 'calc(100% + 6px)', left: '-8px', fontWeight: 400 }}>
                                <div style={{ marginBottom: '6px', fontWeight: 500 }}>How to generate a GitHub Token:</div>
                                1. Go to github.com &rarr; Settings &rarr; Developer settings<br/>
                                2. Click "Personal access tokens" &rarr; "Tokens (classic)"<br/>
                                3. Click "Generate new token (classic)"<br/>
                                4. Set a name and expiration, no scopes needed for public repos<br/>
                                5. Click "Generate token" and copy the value<br/>
                                <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                    Or visit: github.com/settings/tokens
                                </div>
                            </span>
                        </span>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                        Increases GitHub API rate limits from 60/hr to 5,000/hr for skill imports.
                    </p>
                    {tokenStatus?.configured && (
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                            Current token: <code style={{ padding: '2px 6px', borderRadius: '4px', background: 'var(--bg-tertiary)', fontSize: '11px' }}>{tokenStatus.masked}</code>
                            <span style={{ marginLeft: '8px', color: 'var(--text-tertiary)' }}>({tokenStatus.source})</span>
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {/* Hidden inputs to absorb browser autofill */}
                        <input type="text" name="prevent_autofill_user" style={{ display: 'none' }} tabIndex={-1} />
                        <input type="password" name="prevent_autofill_pass" style={{ display: 'none' }} tabIndex={-1} />
                        <input
                            type="text"
                            className="input"
                            autoComplete="off"
                            data-form-type="other"
                            placeholder="ghp_xxxxxxxxxxxx"
                            value={tokenInput}
                            onChange={e => setTokenInput(e.target.value)}
                            style={{ flex: 1, fontSize: '13px', fontFamily: 'monospace', WebkitTextSecurity: 'disc' } as React.CSSProperties}
                        />
                        <button
                            className="btn btn-primary"
                            style={{ fontSize: '13px' }}
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
                                className="btn btn-secondary"
                                style={{ fontSize: '13px' }}
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
                    <div style={{ marginTop: '16px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            ClawHub API Key
                            <span className="metric-tooltip-trigger" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'help', color: 'var(--text-tertiary)' }}>
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5" /><path d="M8 7v4M8 5.5v0" /></svg>
                                <span className="metric-tooltip" style={{ width: '280px', bottom: 'auto', top: 'calc(100% + 6px)', left: '-8px', fontWeight: 400 }}>
                                    Authenticate ClawHub API calls to avoid rate limiting when browsing and installing skills from ClawHub.
                                </span>
                            </span>
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                            Authenticated requests get higher rate limits for ClawHub skill browsing and installation.
                        </p>
                        {tokenStatus?.clawhub_configured && (
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                Current key: <code style={{ padding: '2px 6px', borderRadius: '4px', background: 'var(--bg-tertiary)', fontSize: '11px' }}>{tokenStatus.clawhub_masked}</code>
                            </div>
                        )}
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input type="text" name="prevent_autofill_ch_user" style={{ display: 'none' }} tabIndex={-1} />
                            <input type="password" name="prevent_autofill_ch_pass" style={{ display: 'none' }} tabIndex={-1} />
                            <input
                                type="text"
                                className="input"
                                autoComplete="off"
                                data-form-type="other"
                                placeholder="sk-ant-xxxxxxxxxxxx"
                                value={clawhubKeyInput}
                                onChange={e => setClawhubKeyInput(e.target.value)}
                                style={{ flex: 1, fontSize: '13px', fontFamily: 'monospace', WebkitTextSecurity: 'disc' } as React.CSSProperties}
                            />
                            <button
                                className="btn btn-primary"
                                style={{ fontSize: '13px' }}
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
                                    className="btn btn-secondary"
                                    style={{ fontSize: '13px' }}
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
                <div style={{
                    position: 'fixed', bottom: '24px', right: '24px', zIndex: 10000,
                    padding: '12px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
                    background: toast.type === 'error' ? 'rgba(255,59,48,0.95)' : 'rgba(52,199,89,0.95)',
                    color: '#fff', boxShadow: '0 4px 16px rgba(0,0,0,0.2)', maxWidth: '400px',
                    animation: 'fadeIn 200ms ease',
                }}>
                    {toast.message}
                </div>
            )}

            {/* ClawHub Search Modal */}
            {showClawhubModal && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 9999,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }} onClick={() => setShowClawhubModal(false)}>
                    <div style={{
                        background: 'var(--bg-primary)', borderRadius: '12px', width: '640px', maxHeight: '80vh',
                        display: 'flex', flexDirection: 'column', border: '1px solid var(--border-default)',
                        boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
                    }} onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <h3 style={{ margin: 0, fontSize: '16px' }}>Browse ClawHub</h3>
                                <button className="btn btn-ghost" onClick={() => setShowClawhubModal(false)} style={{ padding: '4px 8px', fontSize: '16px', lineHeight: 1 }}>x</button>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                    className="input"
                                    placeholder="Search skills..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                    autoFocus
                                    style={{ flex: 1, fontSize: '13px' }}
                                />
                                <button className="btn btn-primary" onClick={handleSearch} disabled={searching} style={{ fontSize: '13px' }}>
                                    {searching ? 'Searching...' : 'Search'}
                                </button>
                            </div>
                        </div>
                        {/* Results */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }}>
                            {searchResults.length === 0 && !searching && (
                                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                                    {hasSearched ? 'No results found' : 'Search for skills on ClawHub marketplace'}
                                </div>
                            )}
                            {searching && (
                                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                                    Searching ClawHub...
                                </div>
                            )}
                            {searchResults.map((r: any) => (
                                <div key={r.slug} style={{
                                    padding: '12px 0', borderBottom: '1px solid var(--border-subtle)',
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px',
                                }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                            <span style={{ fontWeight: 600, fontSize: '14px' }}>{r.displayName}</span>
                                            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{r.slug}</span>
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                                            {r.summary?.slice(0, 160)}{r.summary?.length > 160 ? '...' : ''}
                                        </div>
                                    </div>
                                    <button
                                        className="btn btn-secondary"
                                        style={{ fontSize: '12px', flexShrink: 0 }}
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
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 9999,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }} onClick={() => setShowUrlModal(false)}>
                    <div style={{
                        background: 'var(--bg-primary)', borderRadius: '12px', width: '560px',
                        border: '1px solid var(--border-default)', boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <h3 style={{ margin: 0, fontSize: '16px' }}>Import from URL</h3>
                                <button className="btn btn-ghost" onClick={() => setShowUrlModal(false)} style={{ padding: '4px 8px', fontSize: '16px', lineHeight: 1 }}>x</button>
                            </div>
                            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '0 0 12px' }}>
                                Paste a GitHub URL pointing to a skill directory containing SKILL.md
                            </p>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                    className="input"
                                    placeholder="https://github.com/owner/repo/tree/main/skills/my-skill"
                                    value={urlInput}
                                    onChange={e => { setUrlInput(e.target.value); setUrlPreview(null); }}
                                    autoFocus
                                    style={{ flex: 1, fontSize: '13px', fontFamily: 'var(--font-mono)' }}
                                    onKeyDown={e => e.key === 'Enter' && handleUrlPreview()}
                                />
                                <button className="btn btn-secondary" onClick={handleUrlPreview} disabled={urlPreviewing || !urlInput.trim()} style={{ fontSize: '12px' }}>
                                    {urlPreviewing ? 'Loading...' : 'Preview'}
                                </button>
                            </div>
                        </div>

                        {/* Preview result */}
                        {urlPreview && (
                            <div style={{ padding: '16px 24px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                    <span style={{ fontWeight: 600, fontSize: '14px' }}>{urlPreview.name}</span>
                                    {tierBadge(urlPreview.tier)}
                                    {urlPreview.has_scripts && (
                                        <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', background: 'rgba(255,59,48,0.1)', color: 'var(--error, #ff3b30)' }}>
                                            Contains scripts
                                        </span>
                                    )}
                                </div>
                                {urlPreview.description && (
                                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 8px' }}>{urlPreview.description}</p>
                                )}
                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                                    {urlPreview.files?.length} files, {(urlPreview.total_size / 1024).toFixed(1)} KB
                                </div>
                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                    <button className="btn btn-secondary" onClick={() => setShowUrlModal(false)} style={{ fontSize: '13px' }}>Cancel</button>
                                    <button className="btn btn-primary" onClick={handleUrlImport} disabled={urlImporting} style={{ fontSize: '13px' }}>
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
function NotificationBarConfig() {
    const { t } = useTranslation();
    const [enabled, setEnabled] = useState(false);
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        fetchJson<any>('/enterprise/system-settings/notification_bar')
            .then(d => {
                if (d?.value) {
                    setEnabled(!!d.value.enabled);
                    setText(d.value.text || '');
                }
            })
            .catch(() => { });
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await fetchJson('/enterprise/system-settings/notification_bar', {
                method: 'PUT',
                body: JSON.stringify({ value: { enabled, text } }),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e: any) { console.error('[EnterpriseSettings] save failed:', e?.message || e); }
        setSaving(false);
    };

    return (
        <div style={{ marginBottom: '24px' }}>
            <h3 style={{ marginBottom: '8px' }}>{t('enterprise.notificationBar.title', 'Notification Bar')}</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                {t('enterprise.notificationBar.description', 'Display a notification bar at the top of the page, visible to all users.')}
            </p>
            <div className="card" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>
                        <input
                            type="checkbox"
                            checked={enabled}
                            onChange={e => setEnabled(e.target.checked)}
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                        />
                        {t('enterprise.notificationBar.enabled', 'Enable notification bar')}
                    </label>
                </div>
                <div style={{ marginBottom: '12px' }}>
                    <label className="form-label">{t('enterprise.notificationBar.text', 'Notification text')}</label>
                    <input
                        className="form-input"
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder={t('enterprise.notificationBar.textPlaceholder', 'e.g. 🎉 v2.1 released with new features!')}
                        style={{ fontSize: '13px' }}
                    />
                </div>
                {/* Live preview — both themes */}
                {enabled && text && (() => {
                    // Read current accent color or default per theme
                    const savedAccent = getSavedAccentColor();
                    const darkAccent = savedAccent || '#e1e1e8';
                    const lightAccent = savedAccent || '#3a3a42';
                    // Compute text color via luminance
                    const hexLum = (hex: string) => {
                        const h = hex.replace('#', '');
                        const r = parseInt(h.substring(0, 2), 16) / 255;
                        const g = parseInt(h.substring(2, 4), 16) / 255;
                        const b = parseInt(h.substring(4, 6), 16) / 255;
                        return 0.299 * r + 0.587 * g + 0.114 * b;
                    };
                    const darkText = '#ffffff';
                    const lightText = '#ffffff';
                    const barStyle = (bg: string, fg: string) => ({
                        height: '32px', borderRadius: '6px', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: '12px', fontWeight: 500, background: bg, color: fg,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    });
                    return (
                        <div style={{ marginBottom: '12px' }}>
                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>
                                {t('enterprise.notificationBar.preview', 'Preview')}:
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '3px' }}>🌙 Dark</div>
                                    <div style={barStyle(darkAccent, darkText)}>
                                        <span style={{ maxWidth: 'calc(100% - 20px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
                                    </div>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '3px' }}>☀️ Light</div>
                                    <div style={barStyle(lightAccent, lightText)}>
                                        <span style={{ maxWidth: 'calc(100% - 20px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })()}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? t('common.loading') : t('common.save', 'Save')}
                    </button>
                    {saved && <span style={{ color: 'var(--success)', fontSize: '12px' }}>✅ {t('enterprise.config.saved', 'Saved')}</span>}
                </div>
            </div>
        </div>
    );
}


// ─── Company Name Editor ───────────────────────────
function CompanyNameEditor() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const tenantId = localStorage.getItem('current_tenant_id') || '';
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (!tenantId) return;
        fetchJson<any>(`/tenants/${tenantId}`)
            .then(d => { if (d?.name) setName(d.name); })
            .catch(() => { });
    }, [tenantId]);

    const handleSave = async () => {
        if (!tenantId || !name.trim()) return;
        setSaving(true);
        try {
            await fetchJson(`/tenants/${tenantId}`, {
                method: 'PUT', body: JSON.stringify({ name: name.trim() }),
            });
            qc.invalidateQueries({ queryKey: ['tenants'] });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e: any) { console.error('[EnterpriseSettings] save failed:', e?.message || e); }
        setSaving(false);
    };

    return (
        <div className="card" style={{ padding: '16px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <input
                    className="form-input"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={t('enterprise.companyName.placeholder', 'Enter company name')}
                    style={{ flex: 1, fontSize: '14px' }}
                    onKeyDown={e => e.key === 'Enter' && handleSave()}
                />
                <button className="btn btn-primary" onClick={handleSave} disabled={saving || !name.trim()}>
                    {saving ? t('common.loading') : t('common.save', 'Save')}
                </button>
                {saved && <span style={{ color: 'var(--success)', fontSize: '12px' }}>✅</span>}
            </div>
        </div>
    );
}


// ─── Company Timezone Editor ───────────────────────
const COMMON_TIMEZONES = [
    'UTC',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Asia/Singapore',
    'Asia/Kolkata',
    'Asia/Dubai',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Moscow',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'Australia/Sydney',
    'Pacific/Auckland',
];

function CompanyTimezoneEditor() {
    const { t } = useTranslation();
    const tenantId = localStorage.getItem('current_tenant_id') || '';
    const [timezone, setTimezone] = useState('UTC');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (!tenantId) return;
        fetchJson<any>(`/tenants/${tenantId}`)
            .then(d => { if (d?.timezone) setTimezone(d.timezone); })
            .catch(() => { });
    }, [tenantId]);

    const handleSave = async (tz: string) => {
        if (!tenantId) return;
        setTimezone(tz);
        setSaving(true);
        try {
            await fetchJson(`/tenants/${tenantId}`, {
                method: 'PUT', body: JSON.stringify({ timezone: tz }),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e: any) { console.error('[EnterpriseSettings] save failed:', e?.message || e); }
        setSaving(false);
    };

    return (
        <div className="card" style={{ padding: '16px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: '13px', marginBottom: '4px' }}>🌐 {t('enterprise.timezone.title', 'Company Timezone')}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        {t('enterprise.timezone.description', 'Default timezone for all agents. Agents can override individually.')}
                    </div>
                </div>
                <select
                    className="form-input"
                    value={timezone}
                    onChange={e => handleSave(e.target.value)}
                    style={{ width: '220px', fontSize: '13px' }}
                    disabled={saving}
                >
                    {COMMON_TIMEZONES.map(tz => (
                        <option key={tz} value={tz}>{tz}</option>
                    ))}
                </select>
                {saved && <span style={{ color: 'var(--success)', fontSize: '12px' }}>✅</span>}
            </div>
        </div>
    );
}


function FeatureFlagsTab() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({ key: '', description: '', flag_type: 'boolean', enabled: false });

    const { data: flags = [], isLoading } = useQuery({
        queryKey: ['feature-flags'],
        queryFn: featureFlagApi.list,
    });

    const toggleMutation = useMutation({
        mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
            featureFlagApi.update(id, { enabled }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['feature-flags'] }),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => featureFlagApi.delete(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['feature-flags'] }),
    });

    const createMutation = useMutation({
        mutationFn: () => featureFlagApi.create(form),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['feature-flags'] });
            setShowCreate(false);
            setForm({ key: '', description: '', flag_type: 'boolean', enabled: false });
        },
    });

    if (isLoading) return <div style={{ padding: '20px', opacity: 0.5 }}>Loading...</div>;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ {t('enterprise.flags.create')}</button>
            </div>

            {showCreate && (
                <div className="card" style={{ marginBottom: '16px', padding: '16px' }}>
                    <h3 style={{ marginBottom: '12px' }}>{t('enterprise.flags.create')}</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                        <input className="input" placeholder="Flag key (e.g. unified_agent_runtime)" value={form.key}
                            onChange={e => setForm({ ...form, key: e.target.value })} />
                        <select className="input" value={form.flag_type}
                            onChange={e => setForm({ ...form, flag_type: e.target.value })}>
                            <option value="boolean">Boolean</option>
                            <option value="percentage">Percentage</option>
                            <option value="tenant_gate">Tenant Gate</option>
                            <option value="allowlist">Allowlist</option>
                        </select>
                    </div>
                    <input className="input" placeholder={t('enterprise.flags.description')} value={form.description}
                        onChange={e => setForm({ ...form, description: e.target.value })} style={{ marginBottom: '12px', width: '100%' }} />
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-primary" onClick={() => createMutation.mutate()} disabled={!form.key}>
                            {t('enterprise.flags.create')}
                        </button>
                        <button className="btn" onClick={() => setShowCreate(false)}>{t('common.cancel', 'Cancel')}</button>
                    </div>
                </div>
            )}

            {flags.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', opacity: 0.5 }}>{t('enterprise.flags.noFlags')}</div>
            ) : (
                <table className="table" style={{ width: '100%' }}>
                    <thead>
                        <tr>
                            <th>{t('enterprise.flags.key')}</th>
                            <th>{t('enterprise.flags.description')}</th>
                            <th>{t('enterprise.flags.type')}</th>
                            <th>{t('enterprise.flags.enabled')}</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {flags.map((f: any) => (
                            <tr key={f.id}>
                                <td><code style={{ fontSize: '12px', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '4px' }}>{f.key}</code></td>
                                <td style={{ fontSize: '13px', opacity: 0.7 }}>{f.description || '—'}</td>
                                <td><span className="badge">{f.flag_type}</span></td>
                                <td>
                                    <label style={{ cursor: 'pointer' }}>
                                        <input type="checkbox" checked={f.enabled}
                                            onChange={() => toggleMutation.mutate({ id: f.id, enabled: !f.enabled })} />
                                    </label>
                                </td>
                                <td>
                                    <button className="btn btn-sm" style={{ color: 'var(--danger, #ef4444)', fontSize: '12px' }}
                                        onClick={() => { if (confirm(t('enterprise.flags.confirmDelete'))) deleteMutation.mutate(f.id); }}>
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}


// ─── Memory Tab ──────────────────────────────────────
function MemoryTab({ models }: { models: LLMModel[] }) {
    const { t } = useTranslation();
    const [config, setConfig] = useState({
        summary_model_id: '' as string,
        compress_threshold: 70,
        keep_recent: 10,
        extract_to_viking: false,
    });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        fetchJson<any>('/enterprise/memory/config').then(d => {
            if (d && Object.keys(d).length) {
                setConfig(c => ({
                    ...c,
                    ...d,
                    summary_model_id: d.summary_model_id || '',
                }));
            }
            setLoaded(true);
        }).catch(() => setLoaded(true));
    }, []);

    const saveConfig = async () => {
        setSaving(true);
        try {
            await fetchJson('/enterprise/memory/config', {
                method: 'PUT',
                body: JSON.stringify({
                    ...config,
                    summary_model_id: config.summary_model_id || null,
                }),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e: any) {
            alert(e.message || 'Failed to save');
        }
        setSaving(false);
    };

    if (!loaded) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading...</div>;

    return (
        <div className="card">
            <h3 style={{ marginBottom: '20px' }}>{t('enterprise.memory.title')}</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Summary Model */}
                <div className="form-group">
                    <label className="form-label">{t('enterprise.memory.summaryModel')}</label>
                    <select
                        className="form-input"
                        value={config.summary_model_id}
                        onChange={e => setConfig(c => ({ ...c, summary_model_id: e.target.value }))}
                    >
                        <option value="">— {t('enterprise.memory.noModelSelected')} —</option>
                        {models.filter(m => m.enabled).map(m => (
                            <option key={m.id} value={m.id}>{m.label} ({m.provider}/{m.model})</option>
                        ))}
                    </select>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                        {t('enterprise.memory.summaryModelDesc')}
                    </div>
                </div>

                {/* Compress Threshold */}
                <div className="form-group">
                    <label className="form-label">{t('enterprise.memory.compressThreshold')}</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                            className="form-input"
                            type="number"
                            min={30}
                            max={95}
                            value={config.compress_threshold}
                            onChange={e => setConfig(c => ({ ...c, compress_threshold: Number(e.target.value) }))}
                            style={{ width: '100px' }}
                        />
                        <span style={{ color: 'var(--text-secondary)' }}>%</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                        {t('enterprise.memory.compressThresholdDesc')}
                    </div>
                </div>

                {/* Keep Recent */}
                <div className="form-group">
                    <label className="form-label">{t('enterprise.memory.keepRecent')}</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                            className="form-input"
                            type="number"
                            min={2}
                            max={50}
                            value={config.keep_recent}
                            onChange={e => setConfig(c => ({ ...c, keep_recent: Number(e.target.value) }))}
                            style={{ width: '100px' }}
                        />
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                        {t('enterprise.memory.keepRecentDesc')}
                    </div>
                </div>

                {/* Extract to Viking */}
                <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                        <input
                            type="checkbox"
                            checked={config.extract_to_viking}
                            onChange={e => setConfig(c => ({ ...c, extract_to_viking: e.target.checked }))}
                        />
                        {t('enterprise.memory.extractToViking')}
                    </label>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                        {t('enterprise.memory.extractToVikingDesc')}
                    </div>
                </div>

                {/* Save */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center' }}>
                    {saved && <span style={{ color: 'var(--success)', fontSize: '13px' }}>{t('enterprise.memory.saved')}</span>}
                    <button className="btn btn-primary" onClick={saveConfig} disabled={saving}>
                        {saving ? '...' : t('common.save')}
                    </button>
                </div>
            </div>
        </div>
    );
}


export default function EnterpriseSettings() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const [activeTab, setActiveTab] = useState<'llm' | 'org' | 'info' | 'approvals' | 'audit' | 'packs' | 'skills' | 'quotas' | 'users' | 'flags' | 'invites' | 'memory' | 'sso' | 'capabilities'>('info');

    // OpenViking status for KB tab
    const { data: vikingStatus } = useQuery({
        queryKey: ['openviking-status'],
        queryFn: enterpriseApi.openvikingStatus,
        refetchInterval: 60000,
        retry: false,
    });

    // Track selected tenant as state so page refreshes on company switch
    const [selectedTenantId, setSelectedTenantId] = useState(localStorage.getItem('current_tenant_id') || '');
    useEffect(() => {
        const handler = (e: StorageEvent) => {
            if (e.key === 'current_tenant_id') {
                setSelectedTenantId(e.newValue || '');
            }
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, []);

    // Tenant quota defaults
    const [quotaForm, setQuotaForm] = useState({
        default_message_limit: 50, default_message_period: 'permanent',
        default_max_agents: 2, default_agent_ttl_hours: 48,
        default_max_llm_calls_per_day: 100, min_heartbeat_interval_minutes: 120,
        default_max_triggers: 20, min_poll_interval_floor: 5, max_webhook_rate_ceiling: 5,
    });
    const [quotaSaving, setQuotaSaving] = useState(false);
    const [quotaSaved, setQuotaSaved] = useState(false);
    useEffect(() => {
        if (activeTab === 'quotas') {
            fetchJson<any>('/enterprise/tenant-quotas').then(d => {
                if (d && Object.keys(d).length) setQuotaForm(f => ({ ...f, ...d }));
            }).catch(() => { });
        }
    }, [activeTab]);
    const saveQuotas = async () => {
        setQuotaSaving(true);
        try {
            await fetchJson('/enterprise/tenant-quotas', { method: 'PATCH', body: JSON.stringify(quotaForm) });
            setQuotaSaved(true); setTimeout(() => setQuotaSaved(false), 2000);
        } catch (e) { alert('Failed to save'); }
        setQuotaSaving(false);
    };
    const [companyIntro, setCompanyIntro] = useState('');
    const [companyIntroSaving, setCompanyIntroSaving] = useState(false);
    const [companyIntroSaved, setCompanyIntroSaved] = useState(false);

    // Company intro key: always per-tenant scoped
    const companyIntroKey = selectedTenantId ? `company_intro_${selectedTenantId}` : 'company_intro';

    // Load Company Intro (tenant-scoped only, no fallback to global)
    useEffect(() => {
        setCompanyIntro('');
        if (!selectedTenantId) return;
        const tenantKey = `company_intro_${selectedTenantId}`;
        fetchJson<any>(`/enterprise/system-settings/${tenantKey}`)
            .then(d => {
                if (d?.value?.content) {
                    setCompanyIntro(d.value.content);
                }
                // No fallback — each company starts empty with placeholder watermark
            })
            .catch(() => { });
    }, [selectedTenantId]);

    const saveCompanyIntro = async () => {
        setCompanyIntroSaving(true);
        try {
            await fetchJson(`/enterprise/system-settings/${companyIntroKey}`, {
                method: 'PUT', body: JSON.stringify({ value: { content: companyIntro } }),
            });
            setCompanyIntroSaved(true);
            setTimeout(() => setCompanyIntroSaved(false), 2000);
        } catch (e: any) { console.error('[EnterpriseSettings] save failed:', e?.message || e); }
        setCompanyIntroSaving(false);
    };
    const [auditFilter, setAuditFilter] = useState<'all' | 'background' | 'actions'>('all');
    // ─── New Audit state (rich search/filter/pagination)
    const [auditSearch, setAuditSearch] = useState('');
    const [auditEventType, setAuditEventType] = useState('');
    const [auditSeverity, setAuditSeverity] = useState('');
    const [auditDateFrom, setAuditDateFrom] = useState('');
    const [auditDateTo, setAuditDateTo] = useState('');
    const [auditPage, setAuditPage] = useState(1);
    const [auditPageSize] = useState(20);
    const [auditChainResult, setAuditChainResult] = useState<Record<string, { valid: boolean; event_hash: string; computed_hash: string } | null>>({});

    // ─── SSO state
    const [ssoForm, setSsoForm] = useState({ issuer_url: '', client_id: '', client_secret: '', scopes: 'openid profile email', auto_provision: false, display_name: '' });
    const [ssoSaving, setSsoSaving] = useState(false);
    const [ssoSaved, setSsoSaved] = useState(false);
    const [ssoLoaded, setSsoLoaded] = useState(false);

    // ─── Capabilities state
    const [capSaving, setCapSaving] = useState<string | null>(null);

    const [infoRefresh, setInfoRefresh] = useState(0);
    const [kbPromptModal, setKbPromptModal] = useState(false);
    const [kbToast, setKbToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const showKbToast = (message: string, type: 'success' | 'error' = 'success') => {
        setKbToast({ message, type });
        setTimeout(() => setKbToast(null), 3000);
    };

    // ─── Stats (scoped to selected tenant)
    const { data: stats } = useQuery({
        queryKey: ['enterprise-stats', selectedTenantId],
        queryFn: () => fetchJson<any>(`/enterprise/stats${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`),
    });

    // ─── LLM Models
    const { data: models = [] } = useQuery({
        queryKey: ['llm-models', selectedTenantId],
        queryFn: () => fetchJson<LLMModel[]>(`/enterprise/llm-models${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`),
        enabled: activeTab === 'llm',
    });
    const [showAddModel, setShowAddModel] = useState(false);
    const [editingModelId, setEditingModelId] = useState<string | null>(null);
    const [modelForm, setModelForm] = useState({ provider: 'anthropic', model: '', api_key: '', base_url: '', label: '', supports_vision: false, max_output_tokens: '' as string, max_input_tokens: '' as string });
    const { data: providerSpecs = [] } = useQuery({
        queryKey: ['llm-provider-specs'],
        queryFn: () => fetchJson<LLMProviderSpec[]>('/enterprise/llm-providers'),
        enabled: activeTab === 'llm',
    });
    const providerOptions = providerSpecs.length > 0 ? providerSpecs : FALLBACK_LLM_PROVIDERS;
    const addModel = useMutation({
        mutationFn: (data: any) => fetchJson(`/enterprise/llm-models${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`, { method: 'POST', body: JSON.stringify(data) }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['llm-models', selectedTenantId] }); setShowAddModel(false); setEditingModelId(null); },
    });
    const updateModel = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => fetchJson(`/enterprise/llm-models/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['llm-models', selectedTenantId] }); setShowAddModel(false); setEditingModelId(null); },
    });
    const deleteModel = useMutation({
        mutationFn: async ({ id, force = false }: { id: string; force?: boolean }) => {
            const url = force ? `/enterprise/llm-models/${id}?force=true` : `/enterprise/llm-models/${id}`;
            const res = await fetch(`/api${url}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
            });
            if (res.status === 409) {
                const data = await res.json();
                const agents = data.detail?.agents || [];
                const msg = `This model is used by ${agents.length} agent(s):\n\n${agents.join(', ')}\n\nDelete anyway? (their model config will be cleared)`;
                if (confirm(msg)) {
                    // Retry with force
                    const r2 = await fetch(`/api/v1/enterprise/llm-models/${id}?force=true`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
                    });
                    if (!r2.ok && r2.status !== 204) throw new Error('Delete failed');
                }
                return;
            }
            if (!res.ok && res.status !== 204) throw new Error('Delete failed');
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['llm-models', selectedTenantId] }),
    });

    // ─── Approvals
    const { data: approvals = [] } = useQuery({
        queryKey: ['approvals', selectedTenantId],
        queryFn: () => fetchJson<any[]>(`/enterprise/approvals${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`),
        enabled: activeTab === 'approvals',
    });
    const resolveApproval = useMutation({
        mutationFn: ({ id, action }: { id: string; action: string }) =>
            fetchJson(`/enterprise/approvals/${id}/resolve`, { method: 'POST', body: JSON.stringify({ action }) }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals', selectedTenantId] }),
    });

    // ─── Audit Logs (rich query via auditApi)
    const auditQueryParams = {
        search: auditSearch || undefined,
        event_type: auditEventType || undefined,
        severity: auditSeverity || undefined,
        date_from: auditDateFrom || undefined,
        date_to: auditDateTo || undefined,
        page: auditPage,
        page_size: auditPageSize,
    };
    const { data: auditData } = useQuery({
        queryKey: ['audit-events', auditSearch, auditEventType, auditSeverity, auditDateFrom, auditDateTo, auditPage, auditPageSize],
        queryFn: () => auditApi.query(auditQueryParams),
        enabled: activeTab === 'audit',
    });
    const auditEvents = auditData?.items || [];
    const auditTotal = auditData?.total || 0;
    const auditTotalPages = Math.max(1, Math.ceil(auditTotal / auditPageSize));

    const handleAuditExport = async () => {
        const res = await auditApi.exportCsv({
            search: auditSearch || undefined,
            event_type: auditEventType || undefined,
            severity: auditSeverity || undefined,
            date_from: auditDateFrom || undefined,
            date_to: auditDateTo || undefined,
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleVerifyChain = async (eventId: string) => {
        try {
            const result = await auditApi.verifyChain(eventId);
            setAuditChainResult(prev => ({ ...prev, [eventId]: result }));
        } catch {
            setAuditChainResult(prev => ({ ...prev, [eventId]: null }));
        }
    };

    // ─── SSO Config
    useEffect(() => {
        if (activeTab === 'sso' && !ssoLoaded) {
            oidcApi.getConfig().then((cfg: any) => {
                if (cfg) {
                    setSsoForm(f => ({
                        ...f,
                        issuer_url: cfg.issuer_url || '',
                        client_id: cfg.client_id || '',
                        client_secret: '',
                        scopes: cfg.scopes || 'openid profile email',
                        auto_provision: cfg.auto_provision ?? false,
                        display_name: cfg.display_name || '',
                    }));
                }
                setSsoLoaded(true);
            }).catch(() => { setSsoLoaded(true); });
        }
    }, [activeTab, ssoLoaded]);

    const saveSsoConfig = async () => {
        setSsoSaving(true);
        try {
            await oidcApi.updateConfig(ssoForm);
            setSsoSaved(true);
            setTimeout(() => setSsoSaved(false), 2000);
        } catch {
            // error handling
        }
        setSsoSaving(false);
    };

    // ─── Packs
    const { data: packCatalog = [], isLoading: packsLoading } = useQuery({
        queryKey: ['pack-catalog'],
        queryFn: () => packApi.catalog(),
        enabled: activeTab === 'packs',
    });
    const [expandedPacks, setExpandedPacks] = useState<Record<string, boolean>>({});

    // ─── Capabilities
    const { data: capDefinitions = [] } = useQuery({
        queryKey: ['cap-definitions'],
        queryFn: () => capabilityApi.definitions(),
        enabled: activeTab === 'capabilities',
    });
    const { data: capPolicies = [] } = useQuery({
        queryKey: ['cap-policies'],
        queryFn: () => capabilityApi.list(),
        enabled: activeTab === 'capabilities',
    });

    const handleCapUpsert = async (capability: string, allowed: boolean, requiresApproval: boolean) => {
        setCapSaving(capability);
        try {
            await capabilityApi.upsert({ capability, allowed, requires_approval: requiresApproval });
            qc.invalidateQueries({ queryKey: ['cap-policies'] });
        } catch {
            // error handling
        }
        setCapSaving(null);
    };

    const handleCapDelete = async (policyId: string) => {
        try {
            await capabilityApi.delete(policyId);
            qc.invalidateQueries({ queryKey: ['cap-policies'] });
        } catch {
            // error handling
        }
    };

    // ─── Onboarding
    const { data: onboardingData } = useQuery({
        queryKey: ['onboarding-status'],
        queryFn: () => onboardingApi.status(),
        enabled: activeTab === 'info',
    });

    return (
        <>
            <div>
                <div className="page-header">
                    <div>
                        <h1 className="page-title">{t('nav.enterprise')}</h1>
                        {stats && (
                            <div style={{ display: 'flex', gap: '24px', marginTop: '8px' }}>
                                <span className="badge badge-info">{t('enterprise.stats.users', { count: stats.total_users })}</span>
                                <span className="badge badge-success">{t('enterprise.stats.runningAgents', { running: stats.running_agents, total: stats.total_agents })}</span>
                                {stats.pending_approvals > 0 && <span className="badge badge-warning">{stats.pending_approvals} {t('enterprise.tabs.approvals')}</span>}
                            </div>
                        )}
                    </div>
                </div>

                <div className="tabs">
                    {(['info', 'llm', 'packs', 'skills', 'memory', 'invites', 'quotas', 'users', 'org', 'approvals', 'audit', 'sso', 'capabilities', 'flags'] as const).map(tab => (
                        <div key={tab} className={`tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
                            {tab === 'quotas' ? t('enterprise.tabs.quotas', 'Quotas') : tab === 'users' ? t('enterprise.tabs.users', 'Users') : tab === 'invites' ? t('enterprise.tabs.invites', 'Invitations') : t(`enterprise.tabs.${tab}`, tab)}
                        </div>
                    ))}
                </div>

                {/* ── LLM Model Pool ── */}
                {activeTab === 'llm' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                            <button className="btn btn-primary" onClick={() => {
                                setEditingModelId(null);
                                const defaultSpec = providerOptions[0];
                                setModelForm({
                                    provider: defaultSpec?.provider || 'anthropic',
                                    model: '', api_key: '',
                                    base_url: defaultSpec?.default_base_url || '',
                                    label: '', supports_vision: false,
                                    max_output_tokens: defaultSpec ? String(defaultSpec.default_max_tokens) : '4096',
                                    max_input_tokens: '',
                                });
                                setShowAddModel(true);
                            }}>+ {t('enterprise.llm.addModel')}</button>
                        </div>

                        {/* Add Model form — only shown at top when adding new */}
                        {showAddModel && !editingModelId && (
                            <div className="card" style={{ marginBottom: '16px' }}>
                                <h3 style={{ marginBottom: '16px' }}>{t('enterprise.llm.addModel')}</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <div className="form-group">
                                        <label className="form-label">Provider</label>
                                        <select className="form-input" value={modelForm.provider} onChange={e => {
                                            const newProvider = e.target.value;
                                            const spec = providerOptions.find(p => p.provider === newProvider);
                                            const updates: any = { provider: newProvider };
                                            if (spec?.default_base_url) {
                                                updates.base_url = spec.default_base_url;
                                            } else {
                                                updates.base_url = '';
                                            }
                                            if (spec) {
                                                updates.max_output_tokens = String(spec.default_max_tokens);
                                            }
                                            setModelForm(f => ({ ...f, ...updates }));
                                        }}>
                                            {providerOptions.map((p) => (
                                                <option key={p.provider} value={p.provider}>{p.display_name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Model</label>
                                        <input className="form-input" placeholder="claude-sonnet-4-5" value={modelForm.model} onChange={e => setModelForm({ ...modelForm, model: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">{t('enterprise.llm.label')}</label>
                                        <input className="form-input" placeholder="Claude Sonnet" value={modelForm.label} onChange={e => setModelForm({ ...modelForm, label: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">{t('enterprise.llm.baseUrl')}</label>
                                        <input className="form-input" placeholder="https://api.custom.com/v1" value={modelForm.base_url} onChange={e => setModelForm({ ...modelForm, base_url: e.target.value })} />
                                    </div>
                                    <div className="form-group" style={{ gridColumn: 'span 2' }}>
                                        <label className="form-label">API Key</label>
                                        <input className="form-input" type="password" placeholder="Enter API Key" value={modelForm.api_key} onChange={e => setModelForm({ ...modelForm, api_key: e.target.value })} />
                                    </div>
                                    <div className="form-group" style={{ gridColumn: 'span 2' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                                            <input type="checkbox" checked={modelForm.supports_vision} onChange={e => setModelForm({ ...modelForm, supports_vision: e.target.checked })} />
                                            👁 Supports Vision (Multimodal)
                                            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 400 }}>— Enable for models that can analyze images (GPT-4o, Claude, Qwen-VL, etc.)</span>
                                        </label>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Max Output Tokens</label>
                                        <input className="form-input" type="number" placeholder="Provider default" value={modelForm.max_output_tokens} onChange={e => setModelForm({ ...modelForm, max_output_tokens: e.target.value })} />
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>Override the default output token limit. Auto-filled from provider; adjust as needed.</div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Max Input Tokens (Context Window)</label>
                                        <input className="form-input" type="number" placeholder="Provider default" value={modelForm.max_input_tokens} onChange={e => setModelForm({ ...modelForm, max_input_tokens: e.target.value })} />
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>Override the context window size. Used for conversation compression timing.</div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                                    <button className="btn btn-secondary" onClick={() => { setShowAddModel(false); setEditingModelId(null); }}>{t('common.cancel')}</button>
                                    <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} disabled={!modelForm.model || !modelForm.api_key} onClick={async () => {
                                        const btn = document.activeElement as HTMLButtonElement;
                                        const origText = btn?.textContent || '';
                                        if (btn) btn.textContent = 'Testing...';
                                        try {
                                            const token = localStorage.getItem('token');
                                            const testData: any = { provider: modelForm.provider, model: modelForm.model, base_url: modelForm.base_url || undefined };
                                            if (modelForm.api_key) testData.api_key = modelForm.api_key;
                                            const res = await fetch('/api/enterprise/llm-test', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                                body: JSON.stringify(testData),
                                            });
                                            const result = await res.json();
                                            if (result.success) {
                                                if (btn) { btn.textContent = `OK (${result.latency_ms}ms)`; btn.style.color = 'var(--success)'; }
                                                setTimeout(() => { if (btn) { btn.textContent = origText; btn.style.color = ''; } }, 3000);
                                            } else {
                                                alert(`Test failed: ${result.error || 'Unknown error'}\n\nLatency: ${result.latency_ms}ms`);
                                                if (btn) btn.textContent = origText;
                                            }
                                        } catch (e: any) {
                                            alert(`Test error: ${e.message}`);
                                            if (btn) btn.textContent = origText;
                                        }
                                    }}>Test</button>
                                    <button className="btn btn-primary" onClick={() => {
                                        const data = { ...modelForm, max_output_tokens: modelForm.max_output_tokens ? Number(modelForm.max_output_tokens) : null, max_input_tokens: modelForm.max_input_tokens ? Number(modelForm.max_input_tokens) : null };
                                        addModel.mutate(data);
                                    }} disabled={!modelForm.model || !modelForm.api_key}>
                                        {t('common.save')}
                                    </button>
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {models.map((m) => (
                                <div key={m.id}>
                                    {editingModelId === m.id ? (
                                        /* Inline edit form */
                                        <div className="card" style={{ border: '1px solid var(--accent-primary)' }}>
                                            <h3 style={{ marginBottom: '16px' }}>Edit Model</h3>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                                <div className="form-group">
                                                    <label className="form-label">Provider</label>
                                                    <select className="form-input" value={modelForm.provider} onChange={e => {
                                                        const newProvider = e.target.value;
                                                        setModelForm(f => ({ ...f, provider: newProvider }));
                                                    }}>
                                                        {providerOptions.map((p) => (
                                                            <option key={p.provider} value={p.provider}>{p.display_name}</option>
                                                        ))}
                                                        {!providerOptions.some((p) => p.provider === modelForm.provider) && (
                                                            <option value={modelForm.provider}>{modelForm.provider}</option>
                                                        )}
                                                    </select>
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">Model</label>
                                                    <input className="form-input" placeholder="claude-sonnet-4-5" value={modelForm.model} onChange={e => setModelForm({ ...modelForm, model: e.target.value })} />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">{t('enterprise.llm.label')}</label>
                                                    <input className="form-input" placeholder="Claude Sonnet" value={modelForm.label} onChange={e => setModelForm({ ...modelForm, label: e.target.value })} />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">{t('enterprise.llm.baseUrl')}</label>
                                                    <input className="form-input" placeholder="https://api.custom.com/v1" value={modelForm.base_url} onChange={e => setModelForm({ ...modelForm, base_url: e.target.value })} />
                                                </div>
                                                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                                                    <label className="form-label">API Key</label>
                                                    <input className="form-input" type="password" placeholder="•••••••• (Leave blank to keep unchanged)" value={modelForm.api_key} onChange={e => setModelForm({ ...modelForm, api_key: e.target.value })} />
                                                </div>
                                                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                                                        <input type="checkbox" checked={modelForm.supports_vision} onChange={e => setModelForm({ ...modelForm, supports_vision: e.target.checked })} />
                                                        👁 Supports Vision (Multimodal)
                                                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 400 }}>— Enable for models that can analyze images (GPT-4o, Claude, Qwen-VL, etc.)</span>
                                                    </label>
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">Max Output Tokens</label>
                                                    <input className="form-input" type="number" placeholder="Provider default" value={modelForm.max_output_tokens} onChange={e => setModelForm({ ...modelForm, max_output_tokens: e.target.value })} />
                                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>Override the default output token limit. Auto-filled from provider; adjust as needed.</div>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                                                <button className="btn btn-secondary" onClick={() => { setShowAddModel(false); setEditingModelId(null); }}>{t('common.cancel')}</button>
                                                <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} disabled={!modelForm.model} onClick={async () => {
                                                    const btn = document.activeElement as HTMLButtonElement;
                                                    const origText = btn?.textContent || '';
                                                    if (btn) btn.textContent = 'Testing...';
                                                    try {
                                                        const token = localStorage.getItem('token');
                                                        const testData: any = { provider: modelForm.provider, model: modelForm.model, base_url: modelForm.base_url || undefined };
                                                        if (modelForm.api_key) testData.api_key = modelForm.api_key;
                                                        testData.model_id = editingModelId;
                                                        const res = await fetch('/api/enterprise/llm-test', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                                            body: JSON.stringify(testData),
                                                        });
                                                        const result = await res.json();
                                                        if (result.success) {
                                                            if (btn) { btn.textContent = `OK (${result.latency_ms}ms)`; btn.style.color = 'var(--success)'; }
                                                            setTimeout(() => { if (btn) { btn.textContent = origText; btn.style.color = ''; } }, 3000);
                                                        } else {
                                                            alert(`Test failed: ${result.error || 'Unknown error'}\n\nLatency: ${result.latency_ms}ms`);
                                                            if (btn) btn.textContent = origText;
                                                        }
                                                    } catch (e: any) {
                                                        alert(`Test error: ${e.message}`);
                                                        if (btn) btn.textContent = origText;
                                                    }
                                                }}>Test</button>
                                                <button className="btn btn-primary" onClick={() => {
                                                    const data = { ...modelForm, max_output_tokens: modelForm.max_output_tokens ? Number(modelForm.max_output_tokens) : null, max_input_tokens: modelForm.max_input_tokens ? Number(modelForm.max_input_tokens) : null };
                                                    updateModel.mutate({ id: editingModelId!, data });
                                                }} disabled={!modelForm.model}>
                                                    {t('common.save')}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        /* Normal model row */
                                        <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div>
                                                <div style={{ fontWeight: 500 }}>{m.label}</div>
                                                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                                    {m.provider}/{m.model}
                                                    {m.base_url && <span> · {m.base_url}</span>}
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                <span className={`badge ${m.enabled ? 'badge-success' : 'badge-warning'}`}>
                                                    {m.enabled ? t('enterprise.llm.enabled') : t('enterprise.llm.disabled')}
                                                </span>
                                                {m.supports_vision && <span className="badge" style={{ background: 'rgba(99,102,241,0.15)', color: 'rgb(99,102,241)', fontSize: '10px' }}>👁 Vision</span>}
                                                <button className="btn btn-ghost" onClick={() => {
                                                    setEditingModelId(m.id);
                                                    setModelForm({ provider: m.provider, model: m.model, label: m.label, base_url: m.base_url || '', api_key: m.api_key_masked || '', supports_vision: m.supports_vision || false, max_output_tokens: m.max_output_tokens ? String(m.max_output_tokens) : '', max_input_tokens: m.max_input_tokens ? String(m.max_input_tokens) : '' });
                                                    setShowAddModel(true);
                                                }} style={{ fontSize: '12px' }}>✏️ Edit</button>
                                                <button className="btn btn-ghost" onClick={() => deleteModel.mutate({ id: m.id })} style={{ color: 'var(--error)' }}>{t('common.delete')}</button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {models.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>{t('common.noData')}</div>}
                        </div>
                    </div>
                )}

                {/* ── Org Structure ── */}
                {activeTab === 'org' && <OrgTab />}

                {/* ── Approvals ── */}
                {activeTab === 'approvals' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {approvals.map((a: any) => (
                            <div key={a.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div>
                                    <div style={{ fontWeight: 500 }}>{a.action_type}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                        {a.agent_name || `Agent ${a.agent_id.slice(0, 8)}`} · {new Date(a.created_at).toLocaleString()}
                                    </div>
                                </div>
                                {a.status === 'pending' ? (
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button className="btn btn-primary" onClick={() => resolveApproval.mutate({ id: a.id, action: 'approve' })}>{t('common.confirm')}</button>
                                        <button className="btn btn-danger" onClick={() => resolveApproval.mutate({ id: a.id, action: 'reject' })}>Reject</button>
                                    </div>
                                ) : (
                                    <span className={`badge ${a.status === 'approved' ? 'badge-success' : 'badge-error'}`}>
                                        {a.status === 'approved' ? 'Approved' : 'Rejected'}
                                    </span>
                                )}
                            </div>
                        ))}
                        {approvals.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>{t('common.noData')}</div>}
                    </div>
                )}

                {/* ── Audit Logs (Rich) ── */}
                {activeTab === 'audit' && (
                    <div>
                        {/* Search & Filters */}
                        <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
                            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                <div style={{ flex: '2 1 200px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>{t('enterprise.audit.search')}</label>
                                    <input className="input" value={auditSearch} onChange={e => { setAuditSearch(e.target.value); setAuditPage(1); }} placeholder={t('enterprise.audit.search')} style={{ fontSize: '13px' }} />
                                </div>
                                <div style={{ flex: '1 1 160px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>{t('enterprise.audit.eventType')}</label>
                                    <select className="input" value={auditEventType} onChange={e => { setAuditEventType(e.target.value); setAuditPage(1); }} style={{ fontSize: '13px' }}>
                                        <option value="">{t('enterprise.audit.filterAll')}</option>
                                        {['auth.login', 'auth.login_failed', 'auth.oidc_login', 'agent.created', 'agent.deleted', 'agent.started', 'agent.stopped', 'approval.resolved', 'capability.denied', 'tool.installed', 'tool.removed', 'model.created', 'model.deleted', 'settings.updated'].map(et => (
                                            <option key={et} value={et}>{et}</option>
                                        ))}
                                    </select>
                                </div>
                                <div style={{ flex: '1 1 120px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>{t('enterprise.audit.severity')}</label>
                                    <select className="input" value={auditSeverity} onChange={e => { setAuditSeverity(e.target.value); setAuditPage(1); }} style={{ fontSize: '13px' }}>
                                        <option value="">{t('enterprise.audit.filterAll')}</option>
                                        <option value="info">Info</option>
                                        <option value="warn">Warn</option>
                                        <option value="error">Error</option>
                                    </select>
                                </div>
                                <div style={{ flex: '1 1 140px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>{t('enterprise.audit.dateRange')}</label>
                                    <input type="date" className="input" value={auditDateFrom} onChange={e => { setAuditDateFrom(e.target.value); setAuditPage(1); }} style={{ fontSize: '13px' }} />
                                </div>
                                <div style={{ flex: '1 1 140px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>&nbsp;</label>
                                    <input type="date" className="input" value={auditDateTo} onChange={e => { setAuditDateTo(e.target.value); setAuditPage(1); }} style={{ fontSize: '13px' }} />
                                </div>
                                <button className="btn btn-secondary" onClick={handleAuditExport} style={{ fontSize: '13px', whiteSpace: 'nowrap' }}>
                                    {t('enterprise.audit.export')}
                                </button>
                            </div>
                        </div>

                        {/* Results count */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                {t('enterprise.audit.records', { count: auditTotal })}
                            </span>
                        </div>

                        {/* Table */}
                        <div style={{ overflowX: 'auto' }}>
                            <table className="table" style={{ width: '100%', fontSize: '13px' }}>
                                <thead>
                                    <tr>
                                        <th style={{ whiteSpace: 'nowrap' }}>{t('enterprise.audit.time')}</th>
                                        <th>{t('enterprise.audit.eventType')}</th>
                                        <th>{t('enterprise.audit.severity')}</th>
                                        <th>{t('enterprise.audit.user')}</th>
                                        <th>{t('enterprise.audit.action')}</th>
                                        <th>{t('enterprise.audit.identity')}</th>
                                        <th>{t('enterprise.audit.target')}</th>
                                        <th style={{ width: '80px' }}>{t('enterprise.audit.chain')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {auditEvents.map((ev: any) => {
                                        const severityColors: Record<string, { bg: string; color: string }> = {
                                            info: { bg: 'rgba(99,102,241,0.12)', color: 'var(--accent-color, #6366f1)' },
                                            warn: { bg: 'rgba(255,159,10,0.12)', color: 'var(--warning, #ff9f0a)' },
                                            error: { bg: 'rgba(255,59,48,0.12)', color: 'var(--error, #ff3b30)' },
                                        };
                                        const sc = severityColors[ev.severity] || severityColors.info;
                                        const chainRes = auditChainResult[ev.id];
                                        const isBot = ev.execution_identity === 'bot' || ev.execution_identity === 'agent';
                                        return (
                                            <tr key={ev.id}>
                                                <td style={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                                    {new Date(ev.created_at || ev.timestamp).toLocaleString()}
                                                </td>
                                                <td>
                                                    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500, background: 'var(--bg-tertiary, rgba(255,255,255,0.05))' }}>
                                                        {ev.event_type || ev.action || '-'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500, background: sc.bg, color: sc.color }}>
                                                        {ev.severity || 'info'}
                                                    </span>
                                                </td>
                                                <td style={{ fontSize: '12px' }}>{ev.actor || ev.user_email || '-'}</td>
                                                <td style={{ fontSize: '12px', fontWeight: 500 }}>{ev.action || ev.event_type || '-'}</td>
                                                <td>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                        <span>{isBot ? '\u{1F916}' : '\u{1F464}'}</span>
                                                        {isBot ? t('enterprise.audit.identityBot') : t('enterprise.audit.identityUser')}
                                                    </span>
                                                </td>
                                                <td style={{ fontSize: '11px', color: 'var(--text-tertiary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {ev.details ? (typeof ev.details === 'string' ? ev.details.slice(0, 80) : JSON.stringify(ev.details).slice(0, 80)) : '-'}
                                                </td>
                                                <td>
                                                    {chainRes === undefined ? (
                                                        <button className="btn btn-ghost" style={{ fontSize: '11px', padding: '2px 6px' }} onClick={() => handleVerifyChain(ev.id)}>
                                                            {t('enterprise.audit.chain')}
                                                        </button>
                                                    ) : chainRes === null ? (
                                                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>-</span>
                                                    ) : (
                                                        <span style={{ fontSize: '11px', color: chainRes.valid ? 'var(--success, #34c759)' : 'var(--error, #ff3b30)' }}>
                                                            {chainRes.valid ? t('enterprise.audit.chainValid') : t('enterprise.audit.chainInvalid')}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {auditEvents.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>{t('common.noData')}</div>}

                        {/* Pagination */}
                        {auditTotalPages > 1 && (
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px', alignItems: 'center' }}>
                                <button className="btn btn-ghost" disabled={auditPage <= 1} onClick={() => setAuditPage(p => p - 1)} style={{ fontSize: '12px' }}>
                                    &laquo;
                                </button>
                                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{auditPage} / {auditTotalPages}</span>
                                <button className="btn btn-ghost" disabled={auditPage >= auditTotalPages} onClick={() => setAuditPage(p => p + 1)} style={{ fontSize: '12px' }}>
                                    &raquo;
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ── SSO Tab ── */}
                {activeTab === 'sso' && (
                    <div>
                        <h3 style={{ marginBottom: '4px' }}>{t('enterprise.sso.title')}</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                            {t('enterprise.sso.description')}
                        </p>
                        <div className="card" style={{ padding: '16px' }}>
                            {/* Status indicator */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                                <span style={{
                                    width: 8, height: 8, borderRadius: '50%',
                                    background: ssoLoaded && ssoForm.issuer_url ? 'var(--success, #34c759)' : 'var(--text-tertiary)',
                                }} />
                                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    {ssoLoaded && ssoForm.issuer_url ? t('enterprise.sso.configured') : t('enterprise.sso.notConfigured')}
                                </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.sso.issuerUrl')}</label>
                                    <input className="form-input" value={ssoForm.issuer_url} onChange={e => setSsoForm(f => ({ ...f, issuer_url: e.target.value }))} placeholder={t('enterprise.sso.issuerUrlPlaceholder')} />
                                </div>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <div className="form-group" style={{ flex: 1 }}>
                                        <label className="form-label">{t('enterprise.sso.clientId')}</label>
                                        <input className="form-input" value={ssoForm.client_id} onChange={e => setSsoForm(f => ({ ...f, client_id: e.target.value }))} placeholder={t('enterprise.sso.clientIdPlaceholder')} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1 }}>
                                        <label className="form-label">{t('enterprise.sso.clientSecret')}</label>
                                        <input className="form-input" type="password" value={ssoForm.client_secret} onChange={e => setSsoForm(f => ({ ...f, client_secret: e.target.value }))} placeholder={t('enterprise.sso.clientSecretPlaceholder')} />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.sso.scopes')}</label>
                                    <input className="form-input" value={ssoForm.scopes} onChange={e => setSsoForm(f => ({ ...f, scopes: e.target.value }))} placeholder={t('enterprise.sso.scopesPlaceholder')} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.sso.displayName')}</label>
                                    <input className="form-input" value={ssoForm.display_name} onChange={e => setSsoForm(f => ({ ...f, display_name: e.target.value }))} placeholder={t('enterprise.sso.displayNamePlaceholder')} />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input type="checkbox" id="sso-auto-provision" checked={ssoForm.auto_provision} onChange={e => setSsoForm(f => ({ ...f, auto_provision: e.target.checked }))} />
                                    <label htmlFor="sso-auto-provision" style={{ fontSize: '13px', cursor: 'pointer' }}>{t('enterprise.sso.autoProvision')}</label>
                                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{t('enterprise.sso.autoProvisionDesc')}</span>
                                </div>
                            </div>
                            <div style={{ marginTop: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <button className="btn btn-primary" onClick={saveSsoConfig} disabled={ssoSaving || !ssoForm.issuer_url || !ssoForm.client_id}>
                                    {ssoSaving ? t('common.loading') : t('enterprise.sso.save')}
                                </button>
                                {ssoSaved && <span style={{ color: 'var(--success)', fontSize: '12px' }}>{t('enterprise.sso.saved')}</span>}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Capabilities Tab ── */}
                {activeTab === 'capabilities' && (
                    <div>
                        <h3 style={{ marginBottom: '4px' }}>{t('enterprise.capabilities.title')}</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                            {t('enterprise.capabilities.description')}
                        </p>
                        <div style={{ overflowX: 'auto' }}>
                            <table className="table" style={{ width: '100%', fontSize: '13px' }}>
                                <thead>
                                    <tr>
                                        <th>{t('enterprise.capabilities.capability')}</th>
                                        <th>{t('enterprise.capabilities.tools')}</th>
                                        <th style={{ width: '120px' }}>{t('enterprise.audit.severity')}</th>
                                        <th style={{ width: '140px' }}>{t('enterprise.capabilities.requiresApproval')}</th>
                                        <th style={{ width: '100px' }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {capDefinitions.map((def: any) => {
                                        const policy = capPolicies.find((p: any) => p.capability === def.capability);
                                        const isAllowed = policy ? policy.allowed : true;
                                        const requiresApproval = policy?.requires_approval ?? false;
                                        const isSaving = capSaving === def.capability;
                                        return (
                                            <tr key={def.capability}>
                                                <td style={{ fontWeight: 500 }}>{def.capability}</td>
                                                <td style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                                    {def.tools?.join(', ') || '-'}
                                                </td>
                                                <td>
                                                    <button
                                                        className="btn btn-ghost"
                                                        disabled={isSaving}
                                                        onClick={() => handleCapUpsert(def.capability, !isAllowed, requiresApproval)}
                                                        style={{
                                                            fontSize: '11px', padding: '2px 10px', borderRadius: '4px',
                                                            background: isAllowed ? 'rgba(34,197,94,0.12)' : 'rgba(255,59,48,0.12)',
                                                            color: isAllowed ? 'var(--success, #34c759)' : 'var(--error, #ff3b30)',
                                                            border: 'none', cursor: 'pointer',
                                                        }}
                                                    >
                                                        {isAllowed ? t('enterprise.capabilities.allowed') : t('enterprise.capabilities.denied')}
                                                    </button>
                                                </td>
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        checked={requiresApproval}
                                                        disabled={isSaving}
                                                        onChange={e => handleCapUpsert(def.capability, isAllowed, e.target.checked)}
                                                    />
                                                </td>
                                                <td>
                                                    {policy && (
                                                        <button className="btn btn-ghost" onClick={() => handleCapDelete(policy.id)} style={{ fontSize: '11px', color: 'var(--text-tertiary)', padding: '2px 6px' }}>
                                                            {t('enterprise.capabilities.delete')}
                                                        </button>
                                                    )}
                                                    {!policy && (
                                                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{t('enterprise.capabilities.noPolicy')}</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {capDefinitions.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>{t('common.noData')}</div>}
                    </div>
                )}

                {/* ── Company Management ── */}
                {activeTab === 'info' && (
                    <div>

                        {/* ── Onboarding Progress ── */}
                        {onboardingData && onboardingData.total > 0 && (
                            <div className="card" style={{ padding: '16px', marginBottom: '24px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                    <h4 style={{ margin: 0 }}>{t('enterprise.onboarding.title')}</h4>
                                    <span style={{ fontSize: '12px', color: onboardingData.completed === onboardingData.total ? 'var(--success, #34c759)' : 'var(--text-secondary)' }}>
                                        {onboardingData.completed === onboardingData.total
                                            ? t('enterprise.onboarding.allDone')
                                            : t('enterprise.onboarding.completed', { completed: onboardingData.completed, total: onboardingData.total })}
                                    </span>
                                </div>
                                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                                    {t('enterprise.onboarding.description')}
                                </p>
                                {/* Progress bar */}
                                <div style={{ height: '8px', borderRadius: '4px', background: 'var(--bg-tertiary, rgba(255,255,255,0.06))', marginBottom: '12px', overflow: 'hidden' }}>
                                    <div style={{
                                        height: '100%', borderRadius: '4px',
                                        width: `${(onboardingData.completed / onboardingData.total) * 100}%`,
                                        background: onboardingData.completed === onboardingData.total ? 'var(--success, #34c759)' : 'var(--accent-primary, #6366f1)',
                                        transition: 'width 0.3s ease',
                                    }} />
                                </div>
                                {/* Onboarding items */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {onboardingData.items.map((item: any, idx: number) => (
                                        <div
                                            key={idx}
                                            onClick={() => {
                                                if (item.link) {
                                                    if (item.link.startsWith('/')) {
                                                        window.location.href = item.link;
                                                    } else if (item.tab) {
                                                        setActiveTab(item.tab);
                                                    }
                                                }
                                            }}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '10px',
                                                padding: '8px 12px', borderRadius: '6px',
                                                background: item.completed ? 'rgba(34,197,94,0.06)' : 'transparent',
                                                border: '1px solid var(--border-subtle)',
                                                cursor: item.link || item.tab ? 'pointer' : 'default',
                                                transition: 'background 0.15s',
                                            }}
                                        >
                                            <span style={{
                                                width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '12px', flexShrink: 0,
                                                background: item.completed ? 'rgba(34,197,94,0.15)' : 'var(--bg-tertiary, rgba(255,255,255,0.06))',
                                                color: item.completed ? 'var(--success, #34c759)' : 'var(--text-tertiary)',
                                            }}>
                                                {item.completed ? '\u2713' : (idx + 1)}
                                            </span>
                                            <span style={{ fontSize: '13px', color: item.completed ? 'var(--text-tertiary)' : 'var(--text-primary)', textDecoration: item.completed ? 'line-through' : 'none' }}>
                                                {t(`enterprise.onboarding.step_${item.key}`, item.title || item.key) as string}
                                            </span>
                                            {(item.link || item.tab) && !item.completed && (
                                                <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--accent-primary, #6366f1)' }}>&rarr;</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── 0. Company Name ── */}
                        <h3 style={{ marginBottom: '8px' }}>{t('enterprise.companyName.title', 'Company Name')}</h3>
                        <CompanyNameEditor key={`name-${selectedTenantId}`} />

                        {/* ── 0.5. Company Timezone ── */}
                        <CompanyTimezoneEditor key={`tz-${selectedTenantId}`} />

                        {/* ── 1. Company Intro ── */}
                        <h3 style={{ marginBottom: '8px' }}>{t('enterprise.companyIntro.title', 'Company Intro')}</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                            {t('enterprise.companyIntro.description', 'Describe your company\'s mission, products, and culture. This information is included in every agent conversation as context.')}
                        </p>
                        <div className="card" style={{ padding: '16px', marginBottom: '24px' }}>
                            <textarea
                                className="form-input"
                                value={companyIntro}
                                onChange={e => setCompanyIntro(e.target.value)}
                                placeholder={`# Company Name\nClawith\n\n# About\nOpenClaw\uD83E\uDD9E For Teams\nOpen Source \u00B7 Multi-OpenClaw Collaboration\n\nOpenClaw empowers individuals.\nClawith scales it to frontier organizations.`}
                                style={{
                                    minHeight: '200px', resize: 'vertical',
                                    fontFamily: 'var(--font-mono)', fontSize: '13px',
                                    lineHeight: '1.6', whiteSpace: 'pre-wrap',
                                }}
                            />
                            <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <button className="btn btn-primary" onClick={saveCompanyIntro} disabled={companyIntroSaving}>
                                    {companyIntroSaving ? t('common.loading') : t('common.save', 'Save')}
                                </button>
                                {companyIntroSaved && <span style={{ color: 'var(--success)', fontSize: '12px' }}>✅ {t('enterprise.config.saved', 'Saved')}</span>}
                                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                                    💡 {t('enterprise.companyIntro.hint', 'This content appears in every agent\'s system prompt')}
                                </span>
                            </div>
                        </div>

                        {/* ── 2. Company Knowledge Base ── */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                            <h3 style={{ margin: 0 }}>{t('enterprise.kb.title')}</h3>
                            {vikingStatus?.connected ? (
                                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: 'rgba(16,185,129,0.15)', color: 'rgb(16,185,129)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgb(16,185,129)' }} />
                                    OpenViking {vikingStatus.version || ''}
                                </span>
                            ) : vikingStatus ? (
                                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: 'var(--bg-secondary)', color: 'var(--text-tertiary)', fontWeight: 500 }}>
                                    {t('enterprise.kb.vikingOffline', 'Knowledge engine offline')}
                                </span>
                            ) : null}
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                            {t('enterprise.kb.description', 'Shared files accessible to all agents via enterprise_info/ directory.')}
                        </p>
                        <div className="card" style={{ marginBottom: '24px', padding: '16px' }}>
                            <EnterpriseKBBrowser onRefresh={() => setInfoRefresh((v: number) => v + 1)} refreshKey={infoRefresh} />
                        </div>

                        {/* ── 3. Platform Configuration ── */}
                        <h3 style={{ marginBottom: '8px' }}>{t('enterprise.config.title')}</h3>
                        <PlatformSettings />

                        {/* ── Theme Color ── */}
                        <ThemeColorPicker />

                        {/* ── Danger Zone: Delete Company ── */}
                        <div style={{ marginTop: '32px', padding: '16px', border: '1px solid var(--status-error, #e53e3e)', borderRadius: '8px' }}>
                            <h3 style={{ marginBottom: '4px', color: 'var(--status-error, #e53e3e)' }}>{t('enterprise.dangerZone', 'Danger Zone')}</h3>
                            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                                {t('enterprise.deleteCompanyDesc', 'Permanently delete this company and all its data including agents, models, tools, and skills. This action cannot be undone.')}
                            </p>
                            <button
                                className="btn"
                                onClick={async () => {
                                    const name = document.querySelector<HTMLInputElement>('.company-name-input')?.value || selectedTenantId;
                                    if (!confirm(t('enterprise.deleteCompanyConfirm', 'Are you sure you want to delete this company and ALL its data? This cannot be undone.'))) return;
                                    try {
                                        const res = await fetchJson<any>(`/tenants/${selectedTenantId}`, { method: 'DELETE' });
                                        // Switch to fallback tenant
                                        const fallbackId = res.fallback_tenant_id;
                                        localStorage.setItem('current_tenant_id', fallbackId);
                                        setSelectedTenantId(fallbackId);
                                        window.dispatchEvent(new StorageEvent('storage', { key: 'current_tenant_id', newValue: fallbackId }));
                                        qc.invalidateQueries({ queryKey: ['tenants'] });
                                    } catch (e: any) {
                                        alert(e.message || 'Delete failed');
                                    }
                                }}
                                style={{
                                    background: 'transparent', color: 'var(--status-error, #e53e3e)',
                                    border: '1px solid var(--status-error, #e53e3e)', borderRadius: '6px',
                                    padding: '6px 16px', fontSize: '13px', cursor: 'pointer',
                                }}
                            >
                                {t('enterprise.deleteCompany', 'Delete This Company')}
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Quotas Tab ── */}
                {activeTab === 'quotas' && (
                    <div>
                        <h3 style={{ marginBottom: '4px' }}>{t('enterprise.quotas.title', 'Default User Quotas')}</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                            {t('enterprise.quotas.description', 'These defaults apply to newly registered users. Existing users are not affected.')}
                        </p>
                        <div className="card" style={{ padding: '16px' }}>
                            {/* ── Conversation Limits ── */}
                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>{t('enterprise.quotas.conversationLimits', 'Conversation Limits')}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.messageLimit', 'Message Limit')}</label>
                                    <input className="form-input" type="number" min={0} value={quotaForm.default_message_limit}
                                        onChange={e => setQuotaForm({ ...quotaForm, default_message_limit: Number(e.target.value) })} />
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{t('enterprise.quotas.messageLimitDesc', 'Max messages per period')}</div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.messagePeriod', 'Message Period')}</label>
                                    <select className="form-input" value={quotaForm.default_message_period}
                                        onChange={e => setQuotaForm({ ...quotaForm, default_message_period: e.target.value })}>
                                        <option value="permanent">{t('enterprise.quotas.permanent', 'Permanent')}</option>
                                        <option value="daily">{t('enterprise.quotas.daily', 'Daily')}</option>
                                        <option value="weekly">{t('enterprise.quotas.weekly', 'Weekly')}</option>
                                        <option value="monthly">{t('enterprise.quotas.monthly', 'Monthly')}</option>
                                    </select>
                                </div>
                            </div>

                            {/* ── Agent Limits ── */}
                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>{t('enterprise.quotas.agentLimits', 'Agent Limits')}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.maxAgents', 'Max Agents')}</label>
                                    <input className="form-input" type="number" min={0} value={quotaForm.default_max_agents}
                                        onChange={e => setQuotaForm({ ...quotaForm, default_max_agents: Number(e.target.value) })} />
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{t('enterprise.quotas.maxAgentsDesc', 'Agents a user can create')}</div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.agentTTL', 'Agent TTL (hours)')}</label>
                                    <input className="form-input" type="number" min={1} value={quotaForm.default_agent_ttl_hours}
                                        onChange={e => setQuotaForm({ ...quotaForm, default_agent_ttl_hours: Number(e.target.value) })} />
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{t('enterprise.quotas.agentTTLDesc', 'Agent auto-expiry time from creation')}</div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.dailyLLMCalls', 'Daily LLM Calls / Agent')}</label>
                                    <input className="form-input" type="number" min={0} value={quotaForm.default_max_llm_calls_per_day}
                                        onChange={e => setQuotaForm({ ...quotaForm, default_max_llm_calls_per_day: Number(e.target.value) })} />
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{t('enterprise.quotas.dailyLLMCallsDesc', 'Max LLM calls per agent per day')}</div>
                                </div>
                            </div>

                            {/* ── System Limits ── */}
                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>{t('enterprise.quotas.system', 'System')}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.minHeartbeat', 'Min Heartbeat Interval (min)')}</label>
                                    <input className="form-input" type="number" min={1} value={quotaForm.min_heartbeat_interval_minutes}
                                        onChange={e => setQuotaForm({ ...quotaForm, min_heartbeat_interval_minutes: Number(e.target.value) })} />
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{t('enterprise.quotas.minHeartbeatDesc', 'Minimum heartbeat interval for all agents')}</div>
                                </div>
                            </div>

                            {/* ── Trigger Limits ── */}
                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>Trigger Limits</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.defaultMaxTriggers', 'Default Max Triggers')}</label>
                                    <input className="form-input" type="number" min={1} max={100} value={quotaForm.default_max_triggers}
                                        onChange={e => setQuotaForm({ ...quotaForm, default_max_triggers: Number(e.target.value) })} />
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                        {t('enterprise.quotas.defaultMaxTriggersDesc', 'Default trigger limit for new agents')}
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.minPollInterval', 'Min Poll Interval (min)')}</label>
                                    <input className="form-input" type="number" min={1} max={60} value={quotaForm.min_poll_interval_floor}
                                        onChange={e => setQuotaForm({ ...quotaForm, min_poll_interval_floor: Number(e.target.value) })} />
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                        {t('enterprise.quotas.minPollIntervalDesc', 'Company-wide floor: agents cannot poll faster than this')}
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">{t('enterprise.quotas.maxWebhookRate', 'Max Webhook Rate (/min)')}</label>
                                    <input className="form-input" type="number" min={1} max={60} value={quotaForm.max_webhook_rate_ceiling}
                                        onChange={e => setQuotaForm({ ...quotaForm, max_webhook_rate_ceiling: Number(e.target.value) })} />
                                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                                        {t('enterprise.quotas.maxWebhookRateDesc', 'Company-wide ceiling: max webhook hits per minute per agent')}
                                    </div>
                                </div>
                            </div>
                            <div style={{ marginTop: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <button className="btn btn-primary" onClick={saveQuotas} disabled={quotaSaving}>
                                    {quotaSaving ? t('common.loading') : t('common.save', 'Save')}
                                </button>
                                {quotaSaved && <span style={{ color: 'var(--success)', fontSize: '12px' }}>✅ Saved</span>}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Users Tab ── */}
                {activeTab === 'users' && (
                    <UserManagement key={selectedTenantId} />
                )}

                {/* ── Packs Tab ── */}
                {activeTab === 'packs' && (
                    <div>
                        <h3 style={{ marginBottom: '4px' }}>{t('enterprise.packs.title')}</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                            {t('enterprise.packs.description')}
                        </p>
                        {packsLoading ? (
                            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>Loading...</div>
                        ) : packCatalog.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>{t('common.noData')}</div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '12px' }}>
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
                                        <div key={pack.name} className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>{pack.name}</span>
                                                <span style={{
                                                    fontSize: '11px', fontWeight: 500, padding: '2px 8px', borderRadius: '10px',
                                                    background: badge.bg, color: badge.color,
                                                }}>{sourceLabel}</span>
                                            </div>
                                            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.4' }}>{pack.summary}</p>
                                            <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                                <span>{t('enterprise.packs.activation')}: <strong style={{ color: 'var(--text-secondary)' }}>{pack.activation_mode}</strong></span>
                                            </div>
                                            {pack.requires_channel && (
                                                <div style={{ fontSize: '11px', color: '#60a5fa', background: 'rgba(59,130,246,0.08)', padding: '4px 8px', borderRadius: '4px' }}>
                                                    {t('enterprise.packs.requiresChannel')}
                                                </div>
                                            )}
                                            {pack.capabilities && pack.capabilities.length > 0 ? (
                                                <div style={{ fontSize: '11px', color: '#c084fc', background: 'rgba(168,85,247,0.08)', padding: '4px 8px', borderRadius: '4px' }}>
                                                    {t('enterprise.packs.restricted')}: {pack.capabilities.join(', ')}
                                                </div>
                                            ) : (
                                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                                    {t('enterprise.packs.noCapabilityRestriction')}
                                                </div>
                                            )}
                                            {pack.tools && pack.tools.length > 0 && (
                                                <div>
                                                    <button
                                                        onClick={() => setExpandedPacks(prev => ({ ...prev, [pack.name]: !isExpanded }))}
                                                        style={{
                                                            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                                                            fontSize: '12px', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '4px',
                                                        }}
                                                    >
                                                        <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'inline-block' }}>&#9654;</span>
                                                        {t('enterprise.packs.tools')} ({pack.tools.length})
                                                    </button>
                                                    {isExpanded && (
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                                                            {pack.tools.map((tool: string) => (
                                                                <span key={tool} style={{
                                                                    fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
                                                                    background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                                                                    border: '1px solid var(--border-subtle)',
                                                                }}>
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
                )}

                {/* ── Skills Tab ── */}
                {activeTab === 'skills' && <SkillsTab />}

                {activeTab === 'flags' && <FeatureFlagsTab />}

                {/* ── Memory Tab ── */}
                {activeTab === 'memory' && <MemoryTab models={models} />}

                {/* ── Invitation Codes Tab ── */}
                {activeTab === 'invites' && <InvitationCodes />}
            </div>

            {
                kbToast && (
                    <div style={{
                        position: 'fixed', top: '20px', right: '20px', zIndex: 20000,
                        padding: '12px 20px', borderRadius: '8px',
                        background: kbToast.type === 'success' ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)',
                        color: '#fff', fontSize: '14px', fontWeight: 500,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    }}>
                        {''}{kbToast.message}
                    </div>
                )
            }
        </>
    );
}
