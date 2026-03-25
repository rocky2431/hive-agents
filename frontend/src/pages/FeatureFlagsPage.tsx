import { useTranslation } from 'react-i18next';

import { FeatureFlagsTab } from './enterprise';

export default function FeatureFlagsPage() {
    const { t } = useTranslation();

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
            <div>
                <h1 className="text-2xl font-semibold text-content-primary">
                    {t('enterprise.flags.title', 'Feature Flags')}
                </h1>
                <p className="mt-1 text-sm text-content-tertiary">
                    {t('enterprise.flags.pageSubtitle', 'Manage rollout, allowlists, and JSON overrides as a dedicated admin surface.')}
                </p>
            </div>
            <FeatureFlagsTab />
        </div>
    );
}
