/**
 * Unified FileBrowser component
 * Replaces duplicated file browsing/editing logic across:
 * - Agent Workspace, Skills, Soul, Memory tabs
 * - Enterprise Knowledge Base
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import MarkdownRenderer from './MarkdownRenderer';
import { cn } from '@/lib/cn';

// ─── Types ─────────────────────────────────────────────

export interface FileItem {
    name: string;
    path: string;
    is_dir: boolean;
    size?: number;
}

export interface FileBrowserApi {
    list: (path: string) => Promise<FileItem[]>;
    read: (path: string) => Promise<{ content: string }>;
    write: (path: string, content: string) => Promise<any>;
    delete: (path: string) => Promise<any>;
    upload?: (file: File, path: string, onProgress?: (pct: number) => void) => Promise<any>;
    downloadUrl?: (path: string) => string;
}

export interface FileBrowserProps {
    api: FileBrowserApi;
    rootPath?: string;
    features?: {
        upload?: boolean;
        newFile?: boolean;
        newFolder?: boolean;
        edit?: boolean;
        delete?: boolean;
        directoryNavigation?: boolean;
    };
    fileFilter?: string[];
    singleFile?: string;
    uploadAccept?: string;
    title?: string;
    readOnly?: boolean;
    onRefresh?: () => void;
}

// ─── Text file detection ───────────────────────────────

const TEXT_EXTS = ['.txt', '.md', '.csv', '.json', '.xml', '.yaml', '.yml', '.js', '.ts', '.py', '.html', '.css', '.sh', '.log', '.gitkeep', '.env'];

function isTextFile(name: string): boolean {
    const n = name.toLowerCase();
    if (TEXT_EXTS.some(ext => n.endsWith(ext))) return true;
    const base = n.split('/').pop() || '';
    return !base.includes('.') || base.startsWith('.');
}

// ─── Component ─────────────────────────────────────────

export default function FileBrowser({
    api,
    rootPath = '',
    features = {},
    fileFilter,
    singleFile,
    uploadAccept = '.pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.xml,.yaml,.yml,.js,.ts,.py,.html,.css,.sh,.log',
    title,
    readOnly = false,
    onRefresh,
}: FileBrowserProps) {
    const { t } = useTranslation();
    const {
        upload = false,
        newFile = false,
        newFolder = false,
        edit = !readOnly,
        delete: canDelete = !readOnly,
        directoryNavigation = false,
    } = features;

    // ─── State ─────────────────────────────────────────
    const [currentPath, setCurrentPath] = useState(rootPath);
    const [files, setFiles] = useState<FileItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [contentLoaded, setContentLoaded] = useState(false);
    const [viewing, setViewing] = useState<string | null>(singleFile || null);
    const [content, setContent] = useState('');
    const [editing, setEditing] = useState(false);
    const [editContent, setEditContent] = useState('');
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<{ path: string; name: string } | null>(null);
    const [promptModal, setPromptModal] = useState<{ title: string; placeholder: string; action: string } | null>(null);
    const [promptValue, setPromptValue] = useState('');
    const [uploadProgress, setUploadProgress] = useState<{ fileName: string; percent: number } | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize textarea to match content height
    useEffect(() => {
        const el = textareaRef.current;
        if (el && editing) {
            el.style.height = 'auto';
            el.style.height = Math.max(200, el.scrollHeight) + 'px';
        }
    }, [editing, editContent]);

    // ─── Helpers ───────────────────────────────────────

    const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    }, []);

    // ─── Load files ───────────────────────────────────

    const reload = useCallback(async () => {
        if (singleFile) {
            // Single-file mode: just load the content
            try {
                const data = await api.read(singleFile);
                setContent(data.content || '');
            } catch {
                setContent('');
            }
            setContentLoaded(true);
            return;
        }
        setLoading(true);
        try {
            let data = await api.list(currentPath);
            if (fileFilter && fileFilter.length > 0) {
                data = data.filter(f => f.is_dir || fileFilter.some(ext => f.name.toLowerCase().endsWith(ext)));
            }
            setFiles(data);
        } catch {
            setFiles([]);
        }
        setLoading(false);
    }, [api, currentPath, singleFile, fileFilter]);

    useEffect(() => { reload(); }, [reload]);

    // ─── Load file content when viewing ───────────────

    useEffect(() => {
        if (!viewing || singleFile) return;
        api.read(viewing).then(data => {
            setContent(data.content || '');
        }).catch(() => setContent(''));
    }, [viewing, api, singleFile]);

    // ─── Actions ──────────────────────────────────────

    const handleSave = async () => {
        const target = singleFile || viewing;
        if (!target) return;
        setSaving(true);
        try {
            await api.write(target, editContent);
            setContent(editContent);
            setEditing(false);
            showToast('Saved');
            onRefresh?.();
        } catch (err: any) {
            showToast('Save failed: ' + (err.message || ''), 'error');
        }
        setSaving(false);
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        try {
            await api.delete(deleteTarget.path);
            setDeleteTarget(null);
            if (viewing === deleteTarget.path) {
                setViewing(null);
                setEditing(false);
            }
            reload();
            onRefresh?.();
            showToast('Deleted');
        } catch (err: any) {
            showToast('Delete failed: ' + (err.message || ''), 'error');
        }
    };

    const handleUpload = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = uploadAccept;
        input.multiple = true;
        input.onchange = async () => {
            if (!input.files || input.files.length === 0) return;
            try {
                const fileList = Array.from(input.files);
                for (const file of fileList) {
                    setUploadProgress({ fileName: file.name, percent: 0 });
                    await api.upload!(file, currentPath, (pct) => {
                        setUploadProgress({ fileName: file.name, percent: pct });
                    });
                }
                setUploadProgress(null);
                reload();
                onRefresh?.();
                showToast('Upload successful');
            } catch (err: any) {
                setUploadProgress(null);
                showToast('Upload failed: ' + (err.message || ''), 'error');
            }
        };
        input.click();
    };

    const handlePromptConfirm = async () => {
        const value = promptValue.trim();
        if (!value || !promptModal) return;
        const action = promptModal.action;
        setPromptModal(null);
        setPromptValue('');
        try {
            if (action === 'newFolder') {
                const folderPath = currentPath ? `${currentPath}/${value}` : value;
                await api.write(`${folderPath}/.gitkeep`, '');
            } else if (action === 'newFile') {
                const filePath = currentPath ? `${currentPath}/${value}` : value;
                await api.write(filePath, '');
                setViewing(filePath);
                setEditContent('');
                setEditing(true);
            } else if (action === 'newSkill') {
                const template = `# ${value}\n\n## Description\n_Describe the purpose and triggers_\n\n## Input\n- Param1: Description\n\n## Steps\n1. Step one\n2. Step two\n\n## Output\n_Describe the output format_\n`;
                const filePath = currentPath ? `${currentPath}/${value}.md` : `${value}.md`;
                await api.write(filePath, template);
                setViewing(filePath);
                setEditContent(template);
                setEditing(true);
            }
            reload();
            onRefresh?.();
        } catch (err: any) {
            showToast('Failed: ' + (err.message || ''), 'error');
        }
    };

    // ─── Breadcrumbs ──────────────────────────────────

    const pathParts = currentPath ? currentPath.split('/').filter(Boolean) : [];

    const renderBreadcrumbs = () => {
        if (!directoryNavigation || singleFile) return null;
        return (
            <div className="text-xs flex items-center gap-1 mb-2 flex-wrap">
                <span
                    className="cursor-pointer text-accent-primary font-medium"
                    onClick={() => { setCurrentPath(rootPath); setViewing(null); setEditing(false); }}
                >
                    📁 {rootPath || 'root'}
                </span>
                {pathParts.slice(rootPath ? rootPath.split('/').filter(Boolean).length : 0).map((part, i) => {
                    const upTo = pathParts.slice(0, (rootPath ? rootPath.split('/').filter(Boolean).length : 0) + i + 1).join('/');
                    return (
                        <span key={upTo}>
                            <span className="text-content-tertiary"> / </span>
                            <span
                                className="cursor-pointer text-accent-primary"
                                onClick={() => { setCurrentPath(upTo); setViewing(null); setEditing(false); }}
                            >
                                {part}
                            </span>
                        </span>
                    );
                })}
            </div>
        );
    };

    // ─── Toast ─────────────────────────────────────────

    const renderToast = () => {
        if (!toast) return null;
        return (
            <div className={cn(
                'fixed top-5 right-5 z-[20000] px-5 py-3 rounded-lg text-white text-sm font-medium shadow-lg',
                toast.type === 'success' ? 'bg-green-500/90' : 'bg-red-500/90'
            )}>
                {toast.message}
            </div>
        );
    };

    // ─── Delete confirmation modal ────────────────────

    const renderDeleteModal = () => {
        if (!deleteTarget) return null;
        return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000]"
                onClick={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
                <div className="bg-surface-primary rounded-xl p-6 w-[380px] border border-edge-subtle shadow-2xl">
                    <h4 className="mb-3 text-[15px]">{t('common.delete')}</h4>
                    <p className="text-[13px] text-content-secondary mb-5">Delete "{deleteTarget.name}"?</p>
                    <div className="flex justify-end gap-2">
                        <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</button>
                        <button className="btn btn-danger" onClick={handleDelete}>{t('common.delete')}</button>
                    </div>
                </div>
            </div>
        );
    };

    // ─── Prompt modal ─────────────────────────────────

    const renderPromptModal = () => {
        if (!promptModal) return null;
        return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000]"
                onClick={(e) => { if (e.target === e.currentTarget) { setPromptModal(null); setPromptValue(''); } }}>
                <div className="bg-surface-primary rounded-xl p-6 w-[400px] border border-edge-subtle shadow-2xl">
                    <h4 className="mb-4 text-[15px]">{promptModal.title}</h4>
                    <input
                        className="form-input mb-4"
                        autoFocus
                        placeholder={promptModal.placeholder}
                        value={promptValue}
                        onChange={e => setPromptValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handlePromptConfirm(); }}
                    />
                    <div className="flex justify-end gap-2">
                        <button className="btn btn-secondary" onClick={() => { setPromptModal(null); setPromptValue(''); }}>{t('common.cancel')}</button>
                        <button className="btn btn-primary" onClick={handlePromptConfirm} disabled={!promptValue.trim()}>OK</button>
                    </div>
                </div>
            </div>
        );
    };

    // ═══════════════════════════════════════════════════
    // SINGLE FILE MODE (Soul-style)
    // ═══════════════════════════════════════════════════
    if (singleFile) {
        return (
            <div className="card">
                <div className="flex justify-between items-center mb-3">
                    {title ? <h3>{title}</h3> : <div />}
                    {edit && (
                        !editing ? (
                            <button className="btn btn-secondary" onClick={() => { setEditContent(content); setEditing(true); }}>{t('agent.soul.editButton')}</button>
                        ) : (
                            <div className="flex gap-2">
                                <button className="btn btn-secondary" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
                                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                    {saving ? t('agent.soul.saving') : t('agent.soul.saveButton')}
                                </button>
                            </div>
                        )
                    )}
                </div>
                {editing ? (
                    <textarea ref={textareaRef} className="form-textarea font-mono text-[13px] leading-relaxed min-h-[200px] resize-y overflow-hidden" value={editContent} onChange={e => setEditContent(e.target.value)} />
                ) : !contentLoaded ? (
                    <div className="p-5 text-content-tertiary text-center">{t('common.loading')}</div>
                ) : content ? (
                    singleFile?.endsWith('.md') ? (
                        <MarkdownRenderer content={content} className="py-1" />
                    ) : (
                        <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed m-0">
                            {content}
                        </pre>
                    )
                ) : (
                    <div className="p-5 text-content-tertiary text-center text-[13px]">
                        {t('common.noData', 'No content yet. Click Edit to add.')}
                    </div>
                )}
                {renderToast()}
            </div>
        );
    }

    // ═══════════════════════════════════════════════════
    // FILE VIEWER MODE (viewing a specific file)
    // ═══════════════════════════════════════════════════
    if (viewing) {
        const isText = isTextFile(viewing);
        return (
            <div>
                <div className="flex items-center gap-2 mb-3">
                    <button className="btn btn-secondary px-2.5 py-1 text-xs"
                        onClick={() => { setViewing(null); setEditing(false); }}>← {t('common.back')}</button>
                    <span className="text-xs font-mono text-content-secondary flex-1">{viewing}</span>
                    {isText && edit && (
                        !editing ? (
                            <button className="btn btn-secondary px-3 py-1 text-xs"
                                onClick={() => { setEditContent(content); setEditing(true); }}>✏️ {t('agent.soul.editButton')}</button>
                        ) : (
                            <div className="flex gap-1.5">
                                <button className="btn btn-secondary px-3 py-1 text-xs"
                                    onClick={() => setEditing(false)}>{t('common.cancel')}</button>
                                <button className="btn btn-primary px-3 py-1 text-xs"
                                    disabled={saving} onClick={handleSave}>{saving ? 'Saving...' : t('common.save')}</button>
                            </div>
                        )
                    )}
                    {api.downloadUrl && (
                        <a href={api.downloadUrl(viewing)} download className="no-underline">
                            <button className="btn btn-secondary px-3 py-1 text-xs">⬇ {t('common.download', 'Download')}</button>
                        </a>
                    )}
                    {canDelete && (
                        <button className="btn btn-danger px-2.5 py-1 text-xs"
                            onClick={() => setDeleteTarget({ path: viewing, name: viewing.split('/').pop() || viewing })}>×</button>
                    )}
                </div>
                <div className="card">
                    {isText ? (
                        editing ? (
                            <textarea ref={textareaRef} className="form-textarea font-mono text-xs leading-relaxed min-h-[200px] resize-y overflow-hidden" value={editContent} onChange={e => setEditContent(e.target.value)} />
                        ) : viewing?.endsWith('.md') ? (
                            <MarkdownRenderer content={content || ''} className="p-1" />
                        ) : (
                            <pre className="whitespace-pre-wrap font-mono text-xs leading-normal m-0">
                                {content || t('common.noData', 'No content yet')}
                            </pre>
                        )
                    ) : (
                        <div className="text-center p-10 text-content-tertiary">
                            <div className="text-5xl mb-3">⌇</div>
                            <div className="text-sm font-medium mb-1">{viewing.split('/').pop()}</div>
                            <div className="text-xs mb-4">Binary file — cannot preview</div>
                            {api.downloadUrl && (
                                <a href={api.downloadUrl(viewing)} download className="no-underline">
                                    <button className="btn btn-primary text-[13px] px-5 py-2">⬇ {t('common.download', 'Download')}</button>
                                </a>
                            )}
                        </div>
                    )}
                </div>
                {renderDeleteModal()}
                {renderToast()}
            </div>
        );
    }

    // ═══════════════════════════════════════════════════
    // FILE LIST / BROWSER MODE
    // ═══════════════════════════════════════════════════
    return (
        <div>
            {/* Toolbar */}
            <div className="flex justify-between items-center mb-2.5 flex-wrap gap-2">
                {title && <h3 className="m-0">{title}</h3>}
                {renderBreadcrumbs()}
                <div className="flex gap-1.5 ml-auto">
                    {upload && api.upload && (
                        <button className="btn btn-secondary text-xs" onClick={handleUpload}>⬆ Upload</button>
                    )}
                    {newFolder && (
                        <button className="btn btn-secondary text-xs"
                            onClick={() => setPromptModal({ title: t('agent.workspace.newFolder'), placeholder: t('agent.workspace.newFolderName'), action: 'newFolder' })}>
                            📁 {t('agent.workspace.newFolder')}
                        </button>
                    )}
                    {newFile && !fileFilter && (
                        <button className="btn btn-primary text-xs"
                            onClick={() => setPromptModal({ title: t('agent.workspace.newFile', 'New File'), placeholder: 'filename.md', action: 'newFile' })}>
                            + {t('agent.workspace.newFile', 'New File')}
                        </button>
                    )}
                    {newFile && fileFilter?.includes('.md') && (
                        <button className="btn btn-primary text-xs"
                            onClick={() => setPromptModal({ title: 'New Skill', placeholder: 'skill-name', action: 'newSkill' })}>
                            + New Skill
                        </button>
                    )}
                </div>
            </div>

            {/* File list */}
            {loading ? (
                <div className="p-5 text-content-tertiary text-center">{t('common.loading')}</div>
            ) : uploadProgress ? (
                <div className="card p-4">
                    <div className="flex items-center gap-2.5 mb-2">
                        <span className="text-[13px]">⬆</span>
                        <span className="text-[13px] font-medium flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{uploadProgress.fileName}</span>
                        <span className="text-xs text-content-tertiary tabular-nums">{uploadProgress.percent}%</span>
                    </div>
                    <div className="h-1 rounded-sm bg-surface-secondary overflow-hidden">
                        <div className="h-full rounded-sm bg-accent-primary transition-[width] duration-150 ease-out" style={{ width: `${uploadProgress.percent}%` }} />
                    </div>
                </div>
            ) : files.length === 0 ? (
                <div className="card text-center p-10 text-content-tertiary">
                    {t('common.noData')}
                </div>
            ) : (
                <div className="flex flex-col gap-1">
                    {/* Back button for subdirectories */}
                    {directoryNavigation && currentPath !== rootPath && (
                        <div className="card flex items-center px-3 py-2 cursor-pointer opacity-70"
                            onClick={() => {
                                const parts = currentPath.split('/').filter(Boolean);
                                parts.pop();
                                setCurrentPath(parts.join('/') || rootPath);
                                setViewing(null);
                                setEditing(false);
                            }}>
                            <span className="text-[13px]">↩ ..</span>
                        </div>
                    )}
                    {files.map((f) => (
                        <div key={f.name} className="card flex items-center justify-between px-3 py-2.5 cursor-pointer"
                            onClick={() => {
                                if (f.is_dir && directoryNavigation) {
                                    setCurrentPath(f.path || `${currentPath}/${f.name}`);
                                    setViewing(null);
                                    setEditing(false);
                                } else if (!f.is_dir) {
                                    setViewing(f.path || `${currentPath}/${f.name}`);
                                    setEditing(false);
                                }
                            }}>
                            <div className="flex items-center gap-2">
                                <span className="text-[13px] text-content-tertiary">{f.is_dir ? '/' : '·'}</span>
                                <span className="font-medium text-[13px]">{fileFilter?.includes('.md') ? f.name.replace('.md', '') : f.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {f.size != null && <span className="text-[11px] text-content-tertiary">{(f.size / 1024).toFixed(1)} KB</span>}
                                {!f.is_dir && api.downloadUrl && (
                                    <a href={api.downloadUrl(f.path || `${currentPath}/${f.name}`)} download
                                        onClick={(e) => e.stopPropagation()}
                                        title={t('common.download', 'Download')}
                                        className="px-1.5 py-0.5 text-[11px] text-accent-primary no-underline rounded">
                                        ⬇
                                    </a>
                                )}
                                {canDelete && !f.is_dir && (
                                    <button className="btn btn-ghost px-1.5 py-0.5 text-[11px] text-error"
                                        onClick={(e) => { e.stopPropagation(); setDeleteTarget({ path: f.path || `${currentPath}/${f.name}`, name: f.name }); }}>
                                        ×
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {renderDeleteModal()}
            {renderPromptModal()}
            {renderToast()}
        </div>
    );
}
