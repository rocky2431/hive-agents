import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFeatureFlagPayload } from './featureFlags.ts';

test('buildFeatureFlagPayload normalizes advanced feature flag fields', () => {
    const payload = buildFeatureFlagPayload({
        key: 'unified_agent_runtime',
        description: 'Enable the unified runtime',
        flag_type: 'percentage',
        enabled: true,
        rollout_percentage: '25',
        allowed_tenant_ids: 'tenant-a, tenant-b',
        allowed_user_ids: 'user-a\nuser-b',
        overrides: '{"region":"apac","tier":"beta"}',
    });

    assert.deepEqual(payload, {
        key: 'unified_agent_runtime',
        description: 'Enable the unified runtime',
        flag_type: 'percentage',
        enabled: true,
        rollout_percentage: 25,
        allowed_tenant_ids: ['tenant-a', 'tenant-b'],
        allowed_user_ids: ['user-a', 'user-b'],
        overrides: { region: 'apac', tier: 'beta' },
    });
});

test('buildFeatureFlagPayload omits empty advanced fields', () => {
    const payload = buildFeatureFlagPayload({
        key: 'minimal_flag',
        description: '',
        flag_type: 'boolean',
        enabled: false,
        rollout_percentage: '',
        allowed_tenant_ids: '',
        allowed_user_ids: '',
        overrides: '',
    });

    assert.deepEqual(payload, {
        key: 'minimal_flag',
        description: '',
        flag_type: 'boolean',
        enabled: false,
    });
});

test('buildFeatureFlagPayload rejects invalid overrides JSON', () => {
    assert.throws(
        () => buildFeatureFlagPayload({
            key: 'broken_flag',
            description: '',
            flag_type: 'boolean',
            enabled: false,
            rollout_percentage: '',
            allowed_tenant_ids: '',
            allowed_user_ids: '',
            overrides: '{invalid json}',
        }),
        /valid JSON object/i,
    );
});

test('buildFeatureFlagPayload rejects invalid rollout values', () => {
    assert.throws(
        () => buildFeatureFlagPayload({
            key: 'bad_rollout',
            description: '',
            flag_type: 'percentage',
            enabled: false,
            rollout_percentage: '150',
            allowed_tenant_ids: '',
            allowed_user_ids: '',
            overrides: '',
        }),
        /between 0 and 100/i,
    );
});
