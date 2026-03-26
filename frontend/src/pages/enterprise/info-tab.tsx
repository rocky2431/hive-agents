import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { onboardingApi } from '@/services/api';
import { CompanyNameEditor } from './company-name-editor';
import { CompanyTimezoneEditor } from './company-timezone-editor';
import { fetchJson } from './shared';

export function InfoTab({
    selectedTenantId,
    onNavigateTab,
}: {
    selectedTenantId?: string;
    onNavigateTab: (tab: any) => void;
}) {
    const { t } = useTranslation();

    const { data: onboardingData } = useQuery({
        queryKey: ['onboarding-status'],
        queryFn: () => onboardingApi.status(),
    });

    // Company intro state
    const [companyIntro, setCompanyIntro] = useState('');
    const [companyIntroSaving, setCompanyIntroSaving] = useState(false);
    const [companyIntroSaved, setCompanyIntroSaved] = useState(false);

    const companyIntroKey = selectedTenantId ? `company_intro_${selectedTenantId}` : 'company_intro';

    useEffect(() => {
        setCompanyIntro('');
        if (!selectedTenantId) return;
        const tenantKey = `company_intro_${selectedTenantId}`;
        fetchJson<any>(`/enterprise/system-settings/${tenantKey}`)
            .then(d => {
                if (d?.value?.content) {
                    setCompanyIntro(d.value.content);
                }
            })
            .catch(() => { /* non-critical: company intro starts empty if fetch fails */ });
    }, [selectedTenantId]);

    const saveCompanyIntro = async () => {
        setCompanyIntroSaving(true);
        try {
            await fetchJson(`/enterprise/system-settings/${companyIntroKey}`, {
                method: 'PUT', body: JSON.stringify({ value: { content: companyIntro } }),
            });
            setCompanyIntroSaved(true);
            setTimeout(() => setCompanyIntroSaved(false), 2000);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            if (import.meta.env.DEV) console.error('[InfoTab] save failed:', msg);
        }
        setCompanyIntroSaving(false);
    };

    return (
        <div>
            {/* Onboarding Progress */}
            {onboardingData && onboardingData.total > 0 && (
                <div className="card p-4 mb-6">
                    <div className="flex justify-between items-center mb-3">
                        <h4 className="m-0">{t('enterprise.onboarding.title')}</h4>
                        <span className={`text-xs ${onboardingData.completed === onboardingData.total ? 'text-success' : 'text-content-secondary'}`}>
                            {onboardingData.completed === onboardingData.total
                                ? t('enterprise.onboarding.allDone')
                                : t('enterprise.onboarding.completed', { completed: onboardingData.completed, total: onboardingData.total })}
                        </span>
                    </div>
                    <p className="text-xs text-content-tertiary mb-3">{t('enterprise.onboarding.description')}</p>
                    {/* Progress bar */}
                    <div className="h-2 rounded bg-[var(--bg-tertiary,rgba(255,255,255,0.06))] mb-3 overflow-hidden">
                        <div
                            className="h-full rounded transition-[width] duration-300"
                            style={{
                                width: `${(onboardingData.completed / onboardingData.total) * 100}%`,
                                background: onboardingData.completed === onboardingData.total ? 'var(--success, #34c759)' : 'var(--accent-primary, #6366f1)',
                            }}
                        />
                    </div>
                    {/* Onboarding items */}
                    <div className="flex flex-col gap-1.5">
                        {onboardingData.items.map((item: any, idx: number) => (
                            <button
                                type="button"
                                key={idx}
                                onClick={() => {
                                    if (item.link) {
                                        if (item.link.startsWith('/')) {
                                            window.location.href = item.link;
                                        } else if (item.tab) {
                                            onNavigateTab(item.tab);
                                        }
                                    }
                                }}
                                className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-md border border-edge-subtle transition-colors bg-transparent"
                                style={{
                                    background: item.completed ? 'rgba(34,197,94,0.06)' : 'transparent',
                                    cursor: item.link || item.tab ? 'pointer' : 'default',
                                }}
                            >
                                <span
                                    className="w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0"
                                    style={{
                                        background: item.completed ? 'rgba(34,197,94,0.15)' : 'var(--bg-tertiary, rgba(255,255,255,0.06))',
                                        color: item.completed ? 'var(--success, #34c759)' : 'var(--text-tertiary)',
                                    }}
                                >
                                    {item.completed ? '\u2713' : (idx + 1)}
                                </span>
                                <span className={`text-[13px] ${item.completed ? 'text-content-tertiary line-through' : 'text-content-primary'}`}>
                                    {t(`enterprise.onboarding.step_${item.key}`, item.title || item.key) as string}
                                </span>
                                {(item.link || item.tab) && !item.completed && (
                                    <span className="ml-auto text-[11px] text-[var(--accent-primary,#6366f1)]" aria-hidden="true">&rarr;</span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Company Name */}
            <h3 className="mb-2">{t('enterprise.companyName.title', 'Company Name')}</h3>
            <CompanyNameEditor key={`name-${selectedTenantId}`} />

            {/* Company Timezone */}
            <CompanyTimezoneEditor key={`tz-${selectedTenantId}`} />

            {/* Company Intro */}
            <h3 className="mb-2">{t('enterprise.companyIntro.title', 'Company Intro')}</h3>
            <p className="text-xs text-content-tertiary mb-3">
                {t('enterprise.companyIntro.description', 'Describe your company\'s mission, products, and culture. This information is included in every agent conversation as context.')}
            </p>
            <div className="card p-4 mb-6">
                <textarea
                    className="form-input min-h-[200px] resize-y font-mono text-[13px] leading-relaxed whitespace-pre-wrap"
                    aria-label={t('enterprise.companyIntro.title', 'Company Intro')}
                    value={companyIntro}
                    onChange={e => setCompanyIntro(e.target.value)}
                    placeholder={`# Company Name\nHive\n\n# About\nOpenClaw\uD83E\uDD9E For Teams\nOpen Source \u00B7 Multi-Agent Collaboration\n\nOpenClaw empowers individuals.\nHive scales it to frontier organizations.`}
                />
                <div className="mt-3 flex gap-2 items-center">
                    <button className="btn btn-primary" onClick={saveCompanyIntro} disabled={companyIntroSaving}>
                        {companyIntroSaving ? t('common.loading') : t('common.save', 'Save')}
                    </button>
                    {companyIntroSaved && <span className="text-[var(--success)] text-xs">{t('enterprise.config.saved', 'Saved')}</span>}
                    <span className="text-[11px] text-content-tertiary ml-auto">
                        {t('enterprise.companyIntro.hint', 'This content appears in every agent\'s system prompt')}
                    </span>
                </div>
            </div>
        </div>
    );
}
