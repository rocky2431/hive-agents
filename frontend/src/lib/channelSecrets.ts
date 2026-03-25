const SECRET_FIELDS: Record<string, Set<string>> = {
    feishu: new Set(['app_secret', 'encrypt_key', 'verification_token']),
    slack: new Set(['bot_token', 'signing_secret']),
    discord: new Set(['bot_token', 'public_key']),
    teams: new Set(['app_secret']),
    wecom: new Set(['secret', 'token', 'encoding_aes_key', 'bot_secret']),
    dingtalk: new Set(['app_secret']),
    atlassian: new Set(['api_key']),
};

export function isMaskedSecretValue(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith('****');
}

export function sanitizeChannelPayload(channelId: string, payload: Record<string, unknown>): Record<string, unknown> {
    const secretFields = SECRET_FIELDS[channelId] || new Set<string>();
    return Object.fromEntries(
        Object.entries(payload).filter(([key, value]) => !(secretFields.has(key) && isMaskedSecretValue(value))),
    );
}
