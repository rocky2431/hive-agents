import test from 'node:test';
import assert from 'node:assert/strict';

import { isMaskedSecretValue, sanitizeChannelPayload } from './channelSecrets.ts';

test('detects masked channel secret placeholders', () => {
    assert.equal(isMaskedSecretValue('****abcd'), true);
    assert.equal(isMaskedSecretValue('real-secret'), false);
    assert.equal(isMaskedSecretValue(''), false);
});

test('sanitizeChannelPayload drops masked secret placeholders but keeps normal fields', () => {
    const payload = sanitizeChannelPayload('wecom', {
        connection_mode: 'webhook',
        corp_id: 'corp-id',
        wecom_agent_id: '1000001',
        secret: '****7890',
        token: '****4321',
        encoding_aes_key: '****6543',
    });

    assert.deepEqual(payload, {
        connection_mode: 'webhook',
        corp_id: 'corp-id',
        wecom_agent_id: '1000001',
    });
});

test('sanitizeChannelPayload keeps real secret updates', () => {
    const payload = sanitizeChannelPayload('slack', {
        bot_token: 'xoxb-real-token',
        signing_secret: 'real-signing-secret',
    });

    assert.deepEqual(payload, {
        bot_token: 'xoxb-real-token',
        signing_secret: 'real-signing-secret',
    });
});
