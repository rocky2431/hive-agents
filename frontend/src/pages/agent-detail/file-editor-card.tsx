import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fileApi } from '@/services/api';
import MarkdownRenderer from '@/components/MarkdownRenderer';

export function FileEditorCard({ agentId, path, title, readOnly = false }: { agentId: string; path: string; title: string; readOnly?: boolean }) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const { data, isError, refetch } = useQuery({
        queryKey: ['agent-file', agentId, path],
        queryFn: () => fileApi.read(agentId, path).catch(() => null),
        enabled: !!agentId,
    });
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const fileExists = data !== null && data !== undefined;

    const handleSave = async () => {
        setSaving(true);
        try {
            await fileApi.write(agentId, path, draft);
            queryClient.invalidateQueries({ queryKey: ['agent-file', agentId, path] });
            setEditing(false);
        } finally {
            setSaving(false);
        }
    };

    const handleCreate = async () => {
        setSaving(true);
        try {
            await fileApi.write(agentId, path, '');
            queryClient.invalidateQueries({ queryKey: ['agent-file', agentId, path] });
            refetch();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="card mb-4">
            <div className="flex justify-between items-center mb-2.5">
                <h3 className="text-sm font-semibold">{title}</h3>
                {fileExists && !readOnly && !editing && (
                    <button className="btn btn-ghost text-xs" onClick={() => { setDraft(data?.content || ''); setEditing(true); }}>
                        {t('agent.overview.editFile')}
                    </button>
                )}
                {editing && (
                    <div className="flex gap-1.5">
                        <button className="btn btn-ghost text-xs" onClick={() => setEditing(false)}>
                            {t('agent.overview.cancelEdit')}
                        </button>
                        <button className="btn btn-primary text-xs px-3 py-1" disabled={saving} onClick={handleSave}>
                            {saving ? t('agent.overview.saving') : t('agent.overview.saveFile')}
                        </button>
                    </div>
                )}
            </div>
            {!fileExists && (isError || data === null) ? (
                <div className="p-4 text-center text-content-tertiary text-[13px]">
                    <div className="mb-2">{t('agent.overview.fileNotExists')}</div>
                    {!readOnly && (
                        <button className="btn btn-secondary text-xs" disabled={saving} onClick={handleCreate}>
                            {saving ? t('agent.overview.saving') : t('agent.overview.createFile')}
                        </button>
                    )}
                </div>
            ) : editing ? (
                <textarea
                    className="input w-full font-mono text-[13px] leading-relaxed resize-y box-border"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    rows={10}
                />
            ) : (
                <div className="text-[13px] leading-[1.7] text-content-secondary">
                    {data?.content ? (
                        <MarkdownRenderer content={data.content} />
                    ) : (
                        <span className="text-content-tertiary italic">{path}</span>
                    )}
                </div>
            )}
        </div>
    );
}
