import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { FileBrowserApi } from '@/components/FileBrowser';
import FileBrowser from '@/components/FileBrowser';
import { fileApi, skillApi } from '@/services/api';
import { CapabilitiesView } from '@/pages/agent-detail';

interface SkillsTabProps {
    agentId: string;
    canManage: boolean;
}

export function SkillsTab({ agentId, canManage }: SkillsTabProps) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();

    // Sub-tab state
    const [skillSubTab, setSkillSubTab] = useState<'skills' | 'mcp' | 'knowledge'>('skills');

    // Skill expand state
    const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
    const { data: expandedSkillContent } = useQuery({
        queryKey: ['skill-content', agentId, expandedSkill],
        queryFn: () => fileApi.read(agentId, expandedSkill!),
        enabled: !!agentId && !!expandedSkill,
    });
    const { data: skillFiles = [] } = useQuery({
        queryKey: ['files', agentId, 'skills'],
        queryFn: () => fileApi.list(agentId, 'skills'),
        enabled: !!agentId,
    });

    // Import skill from presets
    const [showImportSkillModal, setShowImportSkillModal] = useState(false);
    const [importingSkillId, setImportingSkillId] = useState<string | null>(null);
    const { data: globalSkillsForImport } = useQuery({
        queryKey: ['global-skills-for-import'],
        queryFn: () => skillApi.list(),
        enabled: showImportSkillModal,
    });

    // Agent-level import from ClawHub / URL
    const [showAgentClawhub, setShowAgentClawhub] = useState(false);
    const [agentClawhubQuery, setAgentClawhubQuery] = useState('');
    const [agentClawhubResults, setAgentClawhubResults] = useState<any[]>([]);
    const [agentClawhubSearching, setAgentClawhubSearching] = useState(false);
    const [agentClawhubInstalling, setAgentClawhubInstalling] = useState<string | null>(null);
    const [showAgentUrlImport, setShowAgentUrlImport] = useState(false);
    const [agentUrlInput, setAgentUrlInput] = useState('');
    const [agentUrlImporting, setAgentUrlImporting] = useState(false);

    const adapter: FileBrowserApi = {
        list: (p) => fileApi.list(agentId, p),
        read: (p) => fileApi.read(agentId, p),
        write: (p, c) => fileApi.write(agentId, p, c),
        delete: (p) => fileApi.delete(agentId, p),
        upload: (file, path, onProgress) => fileApi.upload(agentId, file, path, onProgress),
        downloadUrl: (p) => fileApi.downloadUrl(agentId, p),
    };
    const allSkillItems = [...skillFiles];

    return (
        <div>
            {/* Sub-tab pill navigation */}
            <div className="flex gap-1 mb-5 bg-surface-secondary p-1 rounded-lg">
                {(['skills', 'mcp', 'knowledge'] as const).map(sub => (
                    <button key={sub} onClick={() => setSkillSubTab(sub)}
                        className={`px-3.5 py-1.5 rounded-md text-[13px] font-medium border-none cursor-pointer transition-[background,color] duration-150 ${
                            skillSubTab === sub
                                ? 'bg-surface-primary text-content-primary'
                                : 'bg-transparent text-content-tertiary'
                        }`}>
                        {t(`agent.skillTabs.${sub}`)}
                    </button>
                ))}
            </div>

            {/* Sub-tab 1: Skills */}
            {skillSubTab === 'skills' && (
                <div>
                    {/* Import buttons */}
                    <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                        <p className="text-xs text-content-tertiary m-0">{t('agent.foundation.builtInHint')}</p>
                        <div className="flex gap-2 shrink-0 flex-wrap">
                            <button className="btn btn-secondary text-xs" onClick={() => { setShowAgentUrlImport(true); setAgentUrlInput(''); }}>
                                {t('agent.capability.skillsUrl')}
                            </button>
                            <button className="btn btn-secondary text-xs" onClick={() => { setShowAgentClawhub(true); setAgentClawhubQuery(''); setAgentClawhubResults([]); }}>
                                {t('agent.capability.skillsLibrary')}
                            </button>
                            <button className="btn btn-primary text-xs" onClick={() => setShowImportSkillModal(true)}>
                                {t('agent.capability.skillsPreset')}
                            </button>
                        </div>
                    </div>

                    {/* Expandable skill list */}
                    {allSkillItems.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            {allSkillItems.map((item: any) => {
                                const isExpanded = expandedSkill === item.path;
                                return (
                                    <div key={item.path} className="card p-3.5">
                                        <div className="flex items-center gap-3 cursor-pointer"
                                             onClick={() => setExpandedSkill(isExpanded ? null : item.path)}>
                                            <span>{item.is_dir ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}</span>
                                            <div className="flex-1">
                                                <div className="font-medium text-[13px]">{item.name}</div>
                                                <div className="text-xs text-content-tertiary">
                                                    {item.is_dir ? t('agent.skills.folderFormat') : t('agent.skills.flatFormat')}
                                                </div>
                                            </div>
                                            <span className="text-xs text-[var(--success)]">{'\u2713'}</span>
                                            <span className="text-[11px] text-content-tertiary">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                                        </div>
                                        {isExpanded && (
                                            <div className="mt-3 p-3 bg-surface-secondary rounded-lg">
                                                {item.is_dir ? (
                                                    <FileBrowser api={adapter} rootPath={item.path} features={{ newFile: true, edit: true, delete: true, upload: true, directoryNavigation: true }} />
                                                ) : (
                                                    <pre className="whitespace-pre-wrap text-xs m-0 text-content-secondary max-h-[400px] overflow-auto">
                                                        {expandedSkillContent?.content ?? t('common.loading')}
                                                    </pre>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="card text-center p-5 text-content-tertiary text-[13px]">
                            {t('agent.capability.skillsEmpty')}
                        </div>
                    )}

                    {/* ClawHub modal */}
                    {showAgentClawhub && (
                        <div className="fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center" onClick={() => setShowAgentClawhub(false)}>
                            <div onClick={e => e.stopPropagation()} className="bg-surface-primary rounded-xl p-6 max-w-[600px] w-[90%] max-h-[70vh] flex flex-col shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
                                <div className="flex justify-between items-center mb-3">
                                    <h3>{t('agent.capability.skillsLibrary')}</h3>
                                    <button onClick={() => setShowAgentClawhub(false)} className="bg-transparent border-none text-lg cursor-pointer text-content-secondary px-2 py-1">x</button>
                                </div>
                                <div className="flex gap-2 mb-4">
                                    <input className="input flex-1 text-[13px]" placeholder={t('common.search')} value={agentClawhubQuery} onChange={e => setAgentClawhubQuery(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter' && agentClawhubQuery.trim()) { setAgentClawhubSearching(true); skillApi.clawhub.search(agentClawhubQuery).then(r => { setAgentClawhubResults(r); setAgentClawhubSearching(false); }).catch(() => setAgentClawhubSearching(false)); } }}
                                    />
                                    <button className="btn btn-primary text-[13px]" disabled={!agentClawhubQuery.trim() || agentClawhubSearching}
                                        onClick={() => { setAgentClawhubSearching(true); skillApi.clawhub.search(agentClawhubQuery).then(r => { setAgentClawhubResults(r); setAgentClawhubSearching(false); }).catch(() => setAgentClawhubSearching(false)); }}>
                                        {agentClawhubSearching ? 'Searching...' : 'Search'}
                                    </button>
                                </div>
                                <div className="flex-1 overflow-y-auto">
                                    {agentClawhubResults.length === 0 && !agentClawhubSearching && (
                                        <div className="text-center p-6 text-content-tertiary text-[13px]">{t('agent.capability.skillsHint')}</div>
                                    )}
                                    {agentClawhubResults.map((r: any) => (
                                        <div key={r.slug} className="flex items-center justify-between px-3 py-2.5 rounded-lg mb-1.5 border border-edge-subtle bg-surface-secondary">
                                            <div className="flex-1">
                                                <div className="font-semibold text-[13px]">{r.displayName || r.slug}</div>
                                                <div className="text-xs text-content-tertiary mt-0.5">{r.summary?.substring(0, 100)}</div>
                                            </div>
                                            <button className="btn btn-secondary text-xs py-[5px] px-3 ml-3" disabled={agentClawhubInstalling === r.slug}
                                                onClick={async () => { setAgentClawhubInstalling(r.slug); try { const res = await skillApi.agentImport.fromClawhub(agentId, r.slug); alert(`Installed "${r.displayName || r.slug}" (${res.files_written} files)`); queryClient.invalidateQueries({ queryKey: ['files', agentId, 'skills'] }); } catch (err: any) { alert(`Import failed: ${err?.message || err}`); } finally { setAgentClawhubInstalling(null); } }}>
                                                {agentClawhubInstalling === r.slug ? t('common.loading') : t('common.confirm')}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* URL import modal */}
                    {showAgentUrlImport && (
                        <div className="fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center" onClick={() => setShowAgentUrlImport(false)}>
                            <div onClick={e => e.stopPropagation()} className="bg-surface-primary rounded-xl p-6 max-w-[500px] w-[90%] shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
                                <div className="flex justify-between items-center mb-3">
                                    <h3>{t('agent.capability.skillsUrl')}</h3>
                                    <button onClick={() => setShowAgentUrlImport(false)} className="bg-transparent border-none text-lg cursor-pointer text-content-secondary px-2 py-1">x</button>
                                </div>
                                <input className="input w-full text-[13px] mb-3 box-border" placeholder="https://github.com/owner/repo/tree/main/path/to/skill" value={agentUrlInput} onChange={e => setAgentUrlInput(e.target.value)} />
                                <div className="flex justify-end gap-2">
                                    <button className="btn btn-secondary" onClick={() => setShowAgentUrlImport(false)}>Cancel</button>
                                    <button className="btn btn-primary" disabled={!agentUrlInput.trim() || agentUrlImporting}
                                        onClick={async () => { setAgentUrlImporting(true); try { const res = await skillApi.agentImport.fromUrl(agentId, agentUrlInput.trim()); alert(`Imported ${res.files_written} files`); queryClient.invalidateQueries({ queryKey: ['files', agentId, 'skills'] }); setShowAgentUrlImport(false); } catch (err: any) { alert(`Import failed: ${err?.message || err}`); } finally { setAgentUrlImporting(false); } }}>
                                        {agentUrlImporting ? t('common.loading') : t('common.confirm')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Preset import modal */}
                    {showImportSkillModal && (
                        <div className="fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center" onClick={() => setShowImportSkillModal(false)}>
                            <div onClick={e => e.stopPropagation()} className="bg-surface-primary rounded-xl p-6 max-w-[600px] w-[90%] max-h-[70vh] flex flex-col shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
                                <div className="flex justify-between items-center mb-3">
                                    <h3>{t('agent.capability.skillsPreset')}</h3>
                                    <button onClick={() => setShowImportSkillModal(false)} className="bg-transparent border-none text-lg cursor-pointer text-content-secondary px-2 py-1">x</button>
                                </div>
                                <div className="flex-1 overflow-y-auto">
                                    {!globalSkillsForImport ? (
                                        <div className="text-center p-6 text-content-tertiary">{t('common.loading')}</div>
                                    ) : globalSkillsForImport.length === 0 ? (
                                        <div className="text-center p-6 text-content-tertiary">{t('agent.capability.skillsEmpty')}</div>
                                    ) : (
                                        globalSkillsForImport.map((skill: any) => (
                                            <div key={skill.id}
                                                className="flex items-center justify-between px-3.5 py-3 rounded-lg mb-2 border border-edge-subtle bg-surface-secondary transition-colors duration-150 hover:border-accent-primary">
                                                <div className="flex items-center gap-2.5 flex-1">
                                                    <span className="text-xl">{skill.icon || '\uD83D\uDCCB'}</span>
                                                    <div>
                                                        <div className="font-semibold text-sm">{skill.name}</div>
                                                        <div className="text-xs text-content-tertiary mt-0.5">{skill.description?.substring(0, 100)}{skill.description?.length > 100 ? '...' : ''}</div>
                                                    </div>
                                                </div>
                                                <button className="btn btn-secondary whitespace-nowrap text-xs py-1.5 px-3.5" disabled={importingSkillId === skill.id}
                                                    onClick={async () => { setImportingSkillId(skill.id); try { const res = await fileApi.importSkill(agentId, skill.id); alert(`Imported "${skill.name}" (${res.files_written} files)`); queryClient.invalidateQueries({ queryKey: ['files', agentId, 'skills'] }); setShowImportSkillModal(false); } catch (err: any) { alert(`Import failed: ${err?.message || err}`); } finally { setImportingSkillId(null); } }}>
                                                    {importingSkillId === skill.id ? t('common.loading') : t('common.confirm')}
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Sub-tab 2: MCP / Imported Tools */}
            {skillSubTab === 'mcp' && (
                <div>
                    {/* Existing CapabilitiesView -- pack cards + runtime records */}
                    <CapabilitiesView agentId={agentId} canManage={canManage} />

                    {/* MCP management link */}
                    <div className="card mt-5 p-4 flex items-center justify-between">
                        <div>
                            <div className="font-semibold text-sm mb-1">
                                {t('agent.mcp.manageTitle', 'MCP \u670D\u52A1\u5668')}
                            </div>
                            <div className="text-xs text-content-secondary">
                                {t('agent.mcp.manageDesc', '\u5728\u516C\u53F8\u8BBE\u7F6E\u4E2D\u6DFB\u52A0\u3001\u914D\u7F6E\u548C\u7BA1\u7406 MCP \u5916\u90E8\u5DE5\u5177\u670D\u52A1\u5668\u3002\u6240\u6709 Agent \u5171\u4EAB\u3002')}
                            </div>
                        </div>
                        <button
                            className="btn btn-secondary text-xs whitespace-nowrap"
                            onClick={() => window.location.href = '/enterprise?tab=mcp'}
                        >
                            {t('agent.mcp.goToSettings', '\u524D\u5F80\u516C\u53F8\u8BBE\u7F6E \u2192')}
                        </button>
                    </div>
                </div>
            )}

            {/* Sub-tab 3: Knowledge Base */}
            {skillSubTab === 'knowledge' && (() => {
                const kbAdapter: FileBrowserApi = {
                    list: (p) => fileApi.list(agentId, p),
                    read: (p) => fileApi.read(agentId, p),
                    write: (p, c) => fileApi.write(agentId, p, c),
                    delete: (p) => fileApi.delete(agentId, p),
                    upload: (file, path, onProgress) => fileApi.upload(agentId, file, path + '/', onProgress),
                    downloadUrl: (p) => fileApi.downloadUrl(agentId, p),
                };
                const eiAdapter: FileBrowserApi = {
                    list: (p) => fileApi.list(agentId, p),
                    read: (p) => fileApi.read(agentId, p),
                    write: (p, c) => fileApi.write(agentId, p, c),
                    delete: (p) => fileApi.delete(agentId, p),
                    downloadUrl: (p) => fileApi.downloadUrl(agentId, p),
                };
                return (
                    <div>
                        <div className="mb-6">
                            <FileBrowser api={kbAdapter} rootPath="workspace/knowledge_base" features={{ upload: true, newFile: true, newFolder: true, edit: true, delete: true, directoryNavigation: true }} />
                        </div>
                        <details className="card">
                            <summary className="cursor-pointer font-semibold text-sm list-none flex items-center gap-2">
                                <span className="transition-transform duration-150 inline-block text-xs">{'\u25B6'}</span>
                                enterprise_info/
                            </summary>
                            <div className="mt-3">
                                <FileBrowser api={eiAdapter} rootPath="enterprise_info" readOnly features={{}} />
                            </div>
                        </details>
                    </div>
                );
            })()}
        </div>
    );
}
