import type { FeatureFlag } from '@/types';

export interface FeatureFlagFormState {
    key: string;
    description: string;
    flag_type: string;
    enabled: boolean;
    rollout_percentage: string;
    allowed_tenant_ids: string;
    allowed_user_ids: string;
    overrides: string;
}

export const EMPTY_FEATURE_FLAG_FORM: FeatureFlagFormState = {
    key: '',
    description: '',
    flag_type: 'boolean',
    enabled: false,
    rollout_percentage: '',
    allowed_tenant_ids: '',
    allowed_user_ids: '',
    overrides: '',
};

const splitList = (value: string): string[] | undefined => {
    const items = value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
    return items.length > 0 ? items : undefined;
};

const parseOverrides = (value: string): Record<string, unknown> | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        throw new Error('Overrides must be a valid JSON object');
    }

    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('Overrides must be a valid JSON object');
    }

    return parsed as Record<string, unknown>;
};

export function buildFeatureFlagPayload(
    form: FeatureFlagFormState,
    options: { includeKey?: boolean } = {},
): Record<string, unknown> {
    const includeKey = options.includeKey ?? true;
    const payload: Record<string, unknown> = {
        description: form.description.trim(),
        flag_type: form.flag_type,
        enabled: form.enabled,
    };

    if (includeKey) {
        payload.key = form.key.trim();
    }

    const rollout = form.rollout_percentage.trim();
    if (rollout) {
        const parsedRollout = Number.parseInt(rollout, 10);
        if (Number.isNaN(parsedRollout) || parsedRollout < 0 || parsedRollout > 100) {
            throw new Error('Rollout percentage must be an integer between 0 and 100');
        }
        payload.rollout_percentage = parsedRollout;
    }

    const allowedTenantIds = splitList(form.allowed_tenant_ids);
    if (allowedTenantIds) {
        payload.allowed_tenant_ids = allowedTenantIds;
    }

    const allowedUserIds = splitList(form.allowed_user_ids);
    if (allowedUserIds) {
        payload.allowed_user_ids = allowedUserIds;
    }

    const overrides = parseOverrides(form.overrides);
    if (overrides) {
        payload.overrides = overrides;
    }

    return payload;
}

export function featureFlagToFormState(flag?: Partial<FeatureFlag>): FeatureFlagFormState {
    if (!flag) {
        return { ...EMPTY_FEATURE_FLAG_FORM };
    }

    return {
        key: flag.key ?? '',
        description: flag.description ?? '',
        flag_type: flag.flag_type ?? 'boolean',
        enabled: flag.enabled ?? false,
        rollout_percentage:
            typeof flag.rollout_percentage === 'number' ? String(flag.rollout_percentage) : '',
        allowed_tenant_ids: flag.allowed_tenant_ids?.join(', ') ?? '',
        allowed_user_ids: flag.allowed_user_ids?.join(', ') ?? '',
        overrides: flag.overrides ? JSON.stringify(flag.overrides, null, 2) : '',
    };
}
