import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { enterpriseApi } from '@/services/api';
import { fetchJson, FALLBACK_LLM_PROVIDERS } from './shared';
import type { LLMModel, LLMProviderSpec } from './shared';

interface ModelFormState {
    provider: string;
    model: string;
    api_key: string;
    base_url: string;
    label: string;
    supports_vision: boolean;
    max_output_tokens: string;
    max_input_tokens: string;
}

function ModelForm({
    form,
    setForm,
    providerOptions,
    editingModelId,
    selectedTenantId,
    onCancel,
    onSave,
    saving,
}: {
    form: ModelFormState;
    setForm: React.Dispatch<React.SetStateAction<ModelFormState>>;
    providerOptions: LLMProviderSpec[];
    editingModelId: string | null;
    selectedTenantId?: string;
    onCancel: () => void;
    onSave: () => void;
    saving: boolean;
}) {
    const { t } = useTranslation();

    const handleProviderChange = (newProvider: string) => {
        const spec = providerOptions.find(p => p.provider === newProvider);
        setForm(f => ({
            ...f,
            provider: newProvider,
            base_url: spec?.default_base_url || '',
            ...(spec ? { max_output_tokens: String(spec.default_max_tokens) } : {}),
        }));
    };

    const handleTest = async () => {
        const btn = document.activeElement as HTMLButtonElement;
        const origText = btn?.textContent || '';
        if (btn) btn.textContent = 'Testing...';
        try {
            const testData: Record<string, unknown> = {
                provider: form.provider,
                model: form.model,
                base_url: form.base_url || undefined,
            };
            if (form.api_key) testData.api_key = form.api_key;
            if (editingModelId) testData.model_id = editingModelId;
            const result = await enterpriseApi.llmTest(testData, selectedTenantId || undefined);
            if (result.success) {
                if (btn) {
                    btn.textContent = `OK (${result.latency_ms}ms)`;
                    btn.style.color = 'var(--success)';
                }
                setTimeout(() => {
                    if (btn) {
                        btn.textContent = origText;
                        btn.style.color = '';
                    }
                }, 3000);
            } else {
                alert(`Test failed: ${result.error || 'Unknown error'}\n\nLatency: ${result.latency_ms}ms`);
                if (btn) btn.textContent = origText;
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            alert(`Test error: ${msg}`);
            if (btn) btn.textContent = origText;
        }
    };

    return (
        <div className="card mb-4 border border-edge-subtle">
            {editingModelId && <div className="border-t-2 border-accent-primary" />}
            <h3 className="mb-4">{editingModelId ? 'Edit Model' : t('enterprise.llm.addModel')}</h3>
            <div className="grid grid-cols-2 gap-3">
                <div className="form-group">
                    <label className="form-label">Provider</label>
                    <select className="form-input" value={form.provider} onChange={e => handleProviderChange(e.target.value)}>
                        {providerOptions.map(p => (
                            <option key={p.provider} value={p.provider}>{p.display_name}</option>
                        ))}
                        {editingModelId && !providerOptions.some(p => p.provider === form.provider) && (
                            <option value={form.provider}>{form.provider}</option>
                        )}
                    </select>
                </div>
                <div className="form-group">
                    <label className="form-label">Model</label>
                    <input className="form-input" placeholder="claude-sonnet-4-5" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
                </div>
                <div className="form-group">
                    <label className="form-label">{t('enterprise.llm.label')}</label>
                    <input className="form-input" placeholder="Claude Sonnet" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
                </div>
                <div className="form-group">
                    <label className="form-label">{t('enterprise.llm.baseUrl')}</label>
                    <input className="form-input" placeholder="https://api.custom.com/v1" value={form.base_url} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))} />
                </div>
                <div className="form-group col-span-2">
                    <label className="form-label">API Key</label>
                    <input
                        className="form-input"
                        type="password"
                        placeholder={editingModelId ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (Leave blank to keep unchanged)' : 'Enter API Key'}
                        value={form.api_key}
                        onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))}
                    />
                </div>
                <div className="form-group col-span-2">
                    <label className="flex items-center gap-2 cursor-pointer text-[13px]">
                        <input type="checkbox" checked={form.supports_vision} onChange={e => setForm(f => ({ ...f, supports_vision: e.target.checked }))} />
                        Supports Vision (Multimodal)
                        <span className="text-[11px] text-content-tertiary font-normal">
                            — Enable for models that can analyze images (GPT-4o, Claude, Qwen-VL, etc.)
                        </span>
                    </label>
                </div>
                <div className="form-group">
                    <label className="form-label">Max Output Tokens</label>
                    <input className="form-input" type="number" placeholder="Provider default" value={form.max_output_tokens} onChange={e => setForm(f => ({ ...f, max_output_tokens: e.target.value }))} />
                    <div className="text-[11px] text-content-tertiary mt-1">Override the default output token limit. Auto-filled from provider; adjust as needed.</div>
                </div>
                <div className="form-group">
                    <label className="form-label">Max Input Tokens (Context Window)</label>
                    <input className="form-input" type="number" placeholder="Provider default" value={form.max_input_tokens} onChange={e => setForm(f => ({ ...f, max_input_tokens: e.target.value }))} />
                    <div className="text-[11px] text-content-tertiary mt-1">Override the context window size. Used for conversation compression timing.</div>
                </div>
            </div>
            <div className="flex gap-2 justify-end items-center">
                <button className="btn btn-secondary" onClick={onCancel}>{t('common.cancel')}</button>
                <button
                    className="btn btn-secondary flex items-center gap-1.5"
                    disabled={!form.model || (!editingModelId && !form.api_key)}
                    onClick={handleTest}
                >
                    Test
                </button>
                <button
                    className="btn btn-primary"
                    onClick={onSave}
                    disabled={saving || !form.model || (!editingModelId && !form.api_key)}
                >
                    {t('common.save')}
                </button>
            </div>
        </div>
    );
}

export function LlmTab({ selectedTenantId }: { selectedTenantId?: string }) {
    const { t } = useTranslation();
    const qc = useQueryClient();

    const { data: models = [] } = useQuery({
        queryKey: ['llm-models', selectedTenantId],
        queryFn: () => fetchJson<LLMModel[]>(`/enterprise/llm-models${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`),
    });

    const { data: providerSpecs = [] } = useQuery({
        queryKey: ['llm-provider-specs'],
        queryFn: () => fetchJson<LLMProviderSpec[]>('/enterprise/llm-providers'),
    });

    const providerOptions = providerSpecs.length > 0 ? providerSpecs : FALLBACK_LLM_PROVIDERS;

    const [showAddModel, setShowAddModel] = useState(false);
    const [editingModelId, setEditingModelId] = useState<string | null>(null);
    const emptyForm: ModelFormState = { provider: 'anthropic', model: '', api_key: '', base_url: '', label: '', supports_vision: false, max_output_tokens: '', max_input_tokens: '' };
    const [modelForm, setModelForm] = useState<ModelFormState>(emptyForm);

    const closeForm = () => { setShowAddModel(false); setEditingModelId(null); };

    const addModel = useMutation({
        mutationFn: (data: Record<string, unknown>) =>
            fetchJson(`/enterprise/llm-models${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`, { method: 'POST', body: JSON.stringify(data) }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['llm-models', selectedTenantId] }); closeForm(); },
    });

    const updateModel = useMutation({
        mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
            fetchJson(`/enterprise/llm-models/${id}${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`, { method: 'PUT', body: JSON.stringify(data) }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['llm-models', selectedTenantId] }); closeForm(); },
    });

    const deleteModel = useMutation({
        mutationFn: async ({ id, force = false }: { id: string; force?: boolean }) => {
            const url = force
                ? `/enterprise/llm-models/${id}${selectedTenantId ? `?force=true&tenant_id=${selectedTenantId}` : '?force=true'}`
                : `/enterprise/llm-models/${id}${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`;
            const res = await fetch(`/api${url}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
            });
            if (res.status === 409) {
                const data = await res.json();
                const agents = data.detail?.agents || [];
                const msg = `This model is used by ${agents.length} agent(s):\n\n${agents.join(', ')}\n\nDelete anyway? (their model config will be cleared)`;
                if (confirm(msg)) {
                    const retryUrl = selectedTenantId
                        ? `/api/v1/enterprise/llm-models/${id}?force=true&tenant_id=${selectedTenantId}`
                        : `/api/v1/enterprise/llm-models/${id}?force=true`;
                    const r2 = await fetch(retryUrl, {
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

    const handleAdd = () => {
        const defaultSpec = providerOptions[0];
        setEditingModelId(null);
        setModelForm({
            provider: defaultSpec?.provider || 'anthropic',
            model: '', api_key: '',
            base_url: defaultSpec?.default_base_url || '',
            label: '', supports_vision: false,
            max_output_tokens: defaultSpec ? String(defaultSpec.default_max_tokens) : '4096',
            max_input_tokens: '',
        });
        setShowAddModel(true);
    };

    const handleEdit = (m: LLMModel) => {
        setEditingModelId(m.id);
        setModelForm({
            provider: m.provider, model: m.model, label: m.label,
            base_url: m.base_url || '', api_key: m.api_key_masked || '',
            supports_vision: m.supports_vision || false,
            max_output_tokens: m.max_output_tokens ? String(m.max_output_tokens) : '',
            max_input_tokens: m.max_input_tokens ? String(m.max_input_tokens) : '',
        });
        setShowAddModel(true);
    };

    const handleSave = () => {
        const data = {
            ...modelForm,
            max_output_tokens: modelForm.max_output_tokens ? Number(modelForm.max_output_tokens) : null,
            max_input_tokens: modelForm.max_input_tokens ? Number(modelForm.max_input_tokens) : null,
        };
        if (editingModelId) {
            updateModel.mutate({ id: editingModelId, data });
        } else {
            addModel.mutate(data);
        }
    };

    return (
        <div>
            <div className="flex justify-end mb-4">
                <button className="btn btn-primary" onClick={handleAdd}>+ {t('enterprise.llm.addModel')}</button>
            </div>

            {showAddModel && !editingModelId && (
                <ModelForm
                    form={modelForm}
                    setForm={setModelForm}
                    providerOptions={providerOptions}
                    editingModelId={null}
                    selectedTenantId={selectedTenantId}
                    onCancel={closeForm}
                    onSave={handleSave}
                    saving={addModel.isPending}
                />
            )}

            <div className="flex flex-col gap-2">
                {models.map(m => (
                    <div key={m.id}>
                        {editingModelId === m.id ? (
                            <ModelForm
                                form={modelForm}
                                setForm={setModelForm}
                                providerOptions={providerOptions}
                                editingModelId={editingModelId}
                                selectedTenantId={selectedTenantId}
                                onCancel={closeForm}
                                onSave={handleSave}
                                saving={updateModel.isPending}
                            />
                        ) : (
                            <div className="card flex items-center justify-between">
                                <div>
                                    <div className="font-medium">{m.label}</div>
                                    <div className="text-xs text-content-tertiary">
                                        {m.provider}/{m.model}
                                        {m.base_url && <span> &middot; {m.base_url}</span>}
                                    </div>
                                </div>
                                <div className="flex gap-2 items-center">
                                    <span className={`badge ${m.enabled ? 'badge-success' : 'badge-warning'}`}>
                                        {m.enabled ? t('enterprise.llm.enabled') : t('enterprise.llm.disabled')}
                                    </span>
                                    {m.supports_vision && (
                                        <span className="badge text-[10px]" style={{ background: 'rgba(99,102,241,0.15)', color: 'rgb(99,102,241)' }}>
                                            Vision
                                        </span>
                                    )}
                                    <button className="btn btn-ghost text-xs" onClick={() => handleEdit(m)}>Edit</button>
                                    <button className="btn btn-ghost text-xs text-[var(--error)]" onClick={() => deleteModel.mutate({ id: m.id })}>{t('common.delete')}</button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
                {models.length === 0 && (
                    <div className="text-center py-10 text-content-tertiary">{t('common.noData')}</div>
                )}
            </div>
        </div>
    );
}
