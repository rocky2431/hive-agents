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
        <div className="card" style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600 }}>{title}</h3>
                {fileExists && !readOnly && !editing && (
                    <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => { setDraft(data?.content || ''); setEditing(true); }}>
                        {t('agent.overview.editFile')}
                    </button>
                )}
                {editing && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => setEditing(false)}>
                            {t('agent.overview.cancelEdit')}
                        </button>
                        <button className="btn btn-primary" style={{ fontSize: '12px', padding: '4px 12px' }} disabled={saving} onClick={handleSave}>
                            {saving ? t('agent.overview.saving') : t('agent.overview.saveFile')}
                        </button>
                    </div>
                )}
            </div>
            {!fileExists && (isError || data === null) ? (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                    <div style={{ marginBottom: '8px' }}>{t('agent.overview.fileNotExists')}</div>
                    {!readOnly && (
                        <button className="btn btn-secondary" style={{ fontSize: '12px' }} disabled={saving} onClick={handleCreate}>
                            {saving ? t('agent.overview.saving') : t('agent.overview.createFile')}
                        </button>
                    )}
                </div>
            ) : editing ? (
                <textarea
                    className="input"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    rows={10}
                    style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box' }}
                />
            ) : (
                <div style={{ fontSize: '13px', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                    {data?.content ? (
                        <MarkdownRenderer content={data.content} />
                    ) : (
                        <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>{path}</span>
                    )}
                </div>
            )}
        </div>
    );
}
