import { useTranslation } from 'react-i18next';
import { useLlmModels } from '@/services/queries';
import { LLM_PROVIDER_CONFIG } from '@/lib/constants';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

interface ModelSelectorProps {
    value?: string;
    onChange: (modelId: string) => void;
    label: string;
    description?: string;
    error?: boolean;
    className?: string;
}

export function ModelSelector({ value, onChange, label, description, error, className }: ModelSelectorProps) {
    const { t } = useTranslation();
    const { data: models = [], isLoading } = useLlmModels();

    // Group models by provider
    const grouped = models.reduce<Record<string, typeof models>>((acc, model) => {
        const provider = model.provider || 'other';
        if (!acc[provider]) acc[provider] = [];
        acc[provider].push(model);
        return acc;
    }, {});

    return (
        <div className={className}>
            <Label error={error}>{label}</Label>
            {description && (
                <p className="text-xs text-content-tertiary mt-0.5 mb-1">{description}</p>
            )}
            <Select value={value || '__none__'} onValueChange={(v) => onChange(v === '__none__' ? '' : v)}>
                <SelectTrigger error={error}>
                    <SelectValue placeholder={isLoading ? t('common.loading', 'Loading\u2026') : t('enterprise.llm.selectModel', 'Select model\u2026')} />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="__none__">
                        {t('common.none', 'None')}
                    </SelectItem>
                    {Object.entries(grouped).map(([provider, providerModels]) => {
                        const config = LLM_PROVIDER_CONFIG[provider];
                        return (
                            <SelectGroup key={provider}>
                                <SelectLabel>
                                    {config?.icon ?? '⚙️'} {config?.label ?? provider}
                                </SelectLabel>
                                {providerModels.filter((m) => m.enabled).map((m) => (
                                    <SelectItem key={m.id} value={m.id}>
                                        {m.label || m.model}
                                        {m.supports_vision && ' 👁️'}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        );
                    })}
                </SelectContent>
            </Select>
        </div>
    );
}
