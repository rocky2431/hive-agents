import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const agentDetailPath = path.resolve(process.cwd(), 'src/pages/AgentDetail.tsx');
const zhI18nPath = path.resolve(process.cwd(), 'src/i18n/zh.json');
const enI18nPath = path.resolve(process.cwd(), 'src/i18n/en.json');
const read = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('AgentDetail exposes OpenClaw gateway management actions', () => {
    const source = read(agentDetailPath);

    assert.match(source, /agentApi\.generateApiKey/);
    assert.match(source, /agentApi\.gatewayMessages/);
    assert.match(source, /\/api\/v1\/gateway\/setup-guide\/\$\{agentId\}/);
    assert.match(source, /agentDetail\.generateApiKey/);
    assert.match(source, /agentDetail\.gatewayMessages/);
});

test('gateway management labels exist in both language packs', () => {
    const zh = JSON.parse(read(zhI18nPath));
    const en = JSON.parse(read(enI18nPath));

    assert.ok(en.agentDetail.generateApiKey);
    assert.ok(zh.agentDetail.generateApiKey);
    assert.ok(en.agentDetail.gatewayMessages);
    assert.ok(zh.agentDetail.gatewayMessages);
    assert.ok(en.agentDetail.apiKeyVisibleOnce);
    assert.ok(zh.agentDetail.apiKeyVisibleOnce);
});
