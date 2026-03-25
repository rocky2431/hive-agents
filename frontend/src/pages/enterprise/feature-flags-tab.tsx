import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { featureFlagApi } from '@/services/api';
import type { FeatureFlag } from '@/types';
import { buildFeatureFlagPayload, EMPTY_FEATURE_FLAG_FORM, featureFlagToFormState, type FeatureFlagFormState } from '@/lib/featureFlags';
import { formatDateTime } from '@/lib/date';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

function FeatureFlagEditor({
    form,
    onChange,
    isEditing,
    error,
}: {
    form: FeatureFlagFormState;
    onChange: (next: FeatureFlagFormState) => void;
    isEditing: boolean;
    error: string;
}) {
    const { t } = useTranslation();

    return (
        <div className="grid gap-4">
            {!isEditing && (
                <div className="grid gap-2">
                    <Label htmlFor="feature-flag-key">{t('enterprise.flags.key', 'Key')}</Label>
                    <Input
                        id="feature-flag-key"
                        value={form.key}
                        onChange={(e) => onChange({ ...form, key: e.target.value })}
                        placeholder="unified_agent_runtime"
                        autoComplete="off"
                        spellCheck={false}
                    />
                </div>
            )}

            <div className="grid gap-2">
                <Label htmlFor="feature-flag-description">{t('enterprise.flags.description', 'Description')}</Label>
                <Input
                    id="feature-flag-description"
                    value={form.description}
                    onChange={(e) => onChange({ ...form, description: e.target.value })}
                    placeholder={t('enterprise.flags.descriptionPlaceholder', 'Describe what this flag controls')}
                />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                    <Label htmlFor="feature-flag-type">{t('enterprise.flags.type', 'Type')}</Label>
                    <select
                        id="feature-flag-type"
                        className="form-input"
                        value={form.flag_type}
                        onChange={(e) => onChange({ ...form, flag_type: e.target.value })}
                    >
                        <option value="boolean">Boolean</option>
                        <option value="percentage">Percentage</option>
                        <option value="tenant_gate">Tenant Gate</option>
                        <option value="allowlist">Allowlist</option>
                    </select>
                </div>

                <div className="grid gap-2">
                    <Label htmlFor="feature-flag-rollout">{t('enterprise.flags.rolloutPercentage', 'Rollout %')}</Label>
                    <Input
                        id="feature-flag-rollout"
                        type="number"
                        min={0}
                        max={100}
                        value={form.rollout_percentage}
                        onChange={(e) => onChange({ ...form, rollout_percentage: e.target.value })}
                        placeholder="25"
                    />
                </div>
            </div>

            <div className="grid gap-2">
                <Label htmlFor="feature-flag-enabled">{t('enterprise.flags.enabled', 'Enabled')}</Label>
                <div className="flex items-center gap-3 rounded-md border border-edge-subtle bg-surface-secondary px-3 py-2">
                    <Switch
                        id="feature-flag-enabled"
                        checked={form.enabled}
                        onCheckedChange={(checked) => onChange({ ...form, enabled: checked })}
                    />
                    <span className="text-sm text-content-secondary">
                        {form.enabled ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled')}
                    </span>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                    <Label htmlFor="feature-flag-tenants">{t('enterprise.flags.allowedTenants', 'Allowed tenant IDs')}</Label>
                    <Textarea
                        id="feature-flag-tenants"
                        value={form.allowed_tenant_ids}
                        onChange={(e) => onChange({ ...form, allowed_tenant_ids: e.target.value })}
                        placeholder={t('enterprise.flags.allowlistPlaceholder', 'tenant-a, tenant-b')}
                        className="min-h-[96px]"
                    />
                </div>

                <div className="grid gap-2">
                    <Label htmlFor="feature-flag-users">{t('enterprise.flags.allowedUsers', 'Allowed user IDs')}</Label>
                    <Textarea
                        id="feature-flag-users"
                        value={form.allowed_user_ids}
                        onChange={(e) => onChange({ ...form, allowed_user_ids: e.target.value })}
                        placeholder={t('enterprise.flags.allowlistUserPlaceholder', 'user-a, user-b')}
                        className="min-h-[96px]"
                    />
                </div>
            </div>

            <div className="grid gap-2">
                <Label htmlFor="feature-flag-overrides">{t('enterprise.flags.overrides', 'Overrides (JSON)')}</Label>
                <Textarea
                    id="feature-flag-overrides"
                    value={form.overrides}
                    onChange={(e) => onChange({ ...form, overrides: e.target.value })}
                    placeholder={'{\n  "region": "apac"\n}'}
                    className="min-h-[120px] font-mono text-xs"
                    spellCheck={false}
                />
            </div>

            {error && (
                <div className="rounded-md border border-error/30 bg-error-subtle px-3 py-2 text-sm text-error">
                    {error}
                </div>
            )}
        </div>
    );
}

export function FeatureFlagsTab() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const [draft, setDraft] = useState<FeatureFlagFormState>({ ...EMPTY_FEATURE_FLAG_FORM });
    const [showCreate, setShowCreate] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [error, setError] = useState('');

    const { data: flags = [], isLoading } = useQuery({
        queryKey: ['feature-flags'],
        queryFn: featureFlagApi.list,
    });

    const resetDraft = () => {
        setDraft({ ...EMPTY_FEATURE_FLAG_FORM });
        setShowCreate(false);
        setEditingId(null);
        setError('');
    };

    const createMutation = useMutation({
        mutationFn: (data: Record<string, unknown>) => featureFlagApi.create(data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['feature-flags'] });
            resetDraft();
        },
        onError: (err: Error) => setError(err.message),
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
            featureFlagApi.update(id, data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['feature-flags'] });
            resetDraft();
        },
        onError: (err: Error) => setError(err.message),
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

    const startCreate = () => {
        setDraft({ ...EMPTY_FEATURE_FLAG_FORM });
        setShowCreate(true);
        setEditingId(null);
        setError('');
    };

    const startEdit = (flag: FeatureFlag) => {
        setDraft(featureFlagToFormState(flag));
        setEditingId(flag.id);
        setShowCreate(false);
        setError('');
    };

    const handleSubmit = () => {
        try {
            const payload = buildFeatureFlagPayload(draft, { includeKey: !editingId });
            if (editingId) {
                updateMutation.mutate({ id: editingId, data: payload });
            } else {
                createMutation.mutate(payload);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : t('enterprise.flags.invalidOverrides', 'Overrides must be valid JSON'));
        }
    };

    if (isLoading) {
        return <div className="px-5 py-8 text-sm text-content-tertiary">{t('common.loading', 'Loading...')}</div>;
    }

    return (
        <div className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold text-content-primary">{t('enterprise.flags.title', 'Feature Flags')}</h2>
                    <p className="text-sm text-content-tertiary">
                        {t('enterprise.flags.subtitle', 'Control staged rollout, allowlists, and JSON overrides from one place.')}
                    </p>
                </div>
                <Button onClick={startCreate}>{t('enterprise.flags.create', 'Create Flag')}</Button>
            </div>

            {(showCreate || editingId) && (
                <Card>
                    <CardHeader>
                        <CardTitle>
                            {editingId ? t('enterprise.flags.edit', 'Edit Flag') : t('enterprise.flags.create', 'Create Flag')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4">
                        <FeatureFlagEditor
                            form={draft}
                            onChange={setDraft}
                            isEditing={!!editingId}
                            error={error}
                        />
                        <div className="flex flex-wrap gap-2">
                            <Button
                                onClick={handleSubmit}
                                loading={createMutation.isPending || updateMutation.isPending}
                            >
                                {editingId ? t('common.save', 'Save') : t('enterprise.flags.create', 'Create Flag')}
                            </Button>
                            <Button variant="secondary" onClick={resetDraft}>
                                {t('common.cancel', 'Cancel')}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {flags.length === 0 ? (
                <Card>
                    <CardContent className="pt-4 text-sm text-content-tertiary">
                        {t('enterprise.flags.noFlags', 'No feature flags yet.')}
                    </CardContent>
                </Card>
            ) : (
                flags.map((flag) => (
                    <Card key={flag.id}>
                        <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="grid gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <CardTitle className="font-mono text-sm">{flag.key}</CardTitle>
                                    <Badge variant={flag.enabled ? 'success' : 'secondary'}>
                                        {flag.enabled ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled')}
                                    </Badge>
                                    <Badge variant="outline">{flag.flag_type}</Badge>
                                    {typeof flag.rollout_percentage === 'number' && (
                                        <Badge variant="warning">{flag.rollout_percentage}%</Badge>
                                    )}
                                </div>
                                <p className="text-sm text-content-secondary">{flag.description || t('common.noData', 'No data')}</p>
                                <div className="flex flex-wrap gap-3 text-xs text-content-tertiary">
                                    <span>{t('enterprise.flags.createdAt', 'Created')}: {formatDateTime(flag.created_at)}</span>
                                    <span>{t('enterprise.flags.updatedAt', 'Updated')}: {formatDateTime(flag.updated_at)}</span>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <div className="flex items-center gap-2 rounded-md border border-edge-subtle px-3 py-2">
                                    <Switch
                                        checked={flag.enabled}
                                        onCheckedChange={(checked) =>
                                            toggleMutation.mutate({ id: flag.id, enabled: checked })
                                        }
                                        aria-label={t('enterprise.flags.enabled', 'Enabled')}
                                    />
                                    <span className="text-xs text-content-secondary">
                                        {flag.enabled ? t('enterprise.flags.disable', 'Disable') : t('enterprise.flags.enable', 'Enable')}
                                    </span>
                                </div>
                                <Button variant="secondary" onClick={() => startEdit(flag)}>
                                    {t('common.edit', 'Edit')}
                                </Button>
                                <Button
                                    variant="destructive"
                                    onClick={() => {
                                        if (confirm(t('enterprise.flags.confirmDelete', 'Delete this flag?'))) {
                                            deleteMutation.mutate(flag.id);
                                        }
                                    }}
                                >
                                    {t('common.delete', 'Delete')}
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="grid gap-3">
                            <div className="grid gap-3 md:grid-cols-3">
                                <div className="rounded-md border border-edge-subtle bg-surface-primary p-3">
                                    <div className="text-xs text-content-tertiary">{t('enterprise.flags.allowedTenants', 'Allowed tenant IDs')}</div>
                                    <div className="mt-2 text-sm text-content-primary">
                                        {flag.allowed_tenant_ids?.length ? flag.allowed_tenant_ids.join(', ') : '—'}
                                    </div>
                                </div>
                                <div className="rounded-md border border-edge-subtle bg-surface-primary p-3">
                                    <div className="text-xs text-content-tertiary">{t('enterprise.flags.allowedUsers', 'Allowed user IDs')}</div>
                                    <div className="mt-2 text-sm text-content-primary">
                                        {flag.allowed_user_ids?.length ? flag.allowed_user_ids.join(', ') : '—'}
                                    </div>
                                </div>
                                <div className="rounded-md border border-edge-subtle bg-surface-primary p-3">
                                    <div className="text-xs text-content-tertiary">{t('enterprise.flags.overrides', 'Overrides (JSON)')}</div>
                                    <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-content-primary">
                                        {flag.overrides ? JSON.stringify(flag.overrides, null, 2) : '—'}
                                    </pre>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))
            )}
        </div>
    );
}
