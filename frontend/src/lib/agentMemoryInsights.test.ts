import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const apiPath = path.resolve(process.cwd(), 'src/services/api.ts');
const agentDetailPath = path.resolve(process.cwd(), 'src/pages/AgentDetail.tsx');
const zhI18nPath = path.resolve(process.cwd(), 'src/i18n/zh.json');
const enI18nPath = path.resolve(process.cwd(), 'src/i18n/en.json');

const read = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('enterpriseApi exposes structured memory and session summary endpoints', () => {
    const source = read(apiPath);

    assert.match(source, /agentMemory:\s*\(agentId:\s*string\)/);
    assert.match(source, /sessionSummary:\s*\(sessionId:\s*string\)/);
    assert.match(source, /sessions:\s*\(id:\s*string,\s*scope:\s*'mine'\s*\|\s*'all'/);
});

test('AgentDetail renders memory insights backed by the memory endpoints', () => {
    const source = read(agentDetailPath);

    assert.match(source, /function MemoryInsightsPanel/);
    assert.match(source, /enterpriseApi\.agentMemory/);
    assert.match(source, /enterpriseApi\.sessionSummary/);
    assert.match(source, /agentApi\.sessions/);
    assert.match(source, /agentDetail\.structuredMemory/);
    assert.match(source, /agentDetail\.sessionSummary/);
});

test('memory insight labels exist in both language packs', () => {
    const zh = JSON.parse(read(zhI18nPath));
    const en = JSON.parse(read(enI18nPath));

    assert.ok(en.agentDetail.structuredMemory);
    assert.ok(zh.agentDetail.structuredMemory);
    assert.ok(en.agentDetail.sessionSummary);
    assert.ok(zh.agentDetail.sessionSummary);
    assert.ok(en.agentDetail.noStructuredMemory);
    assert.ok(zh.agentDetail.noStructuredMemory);
    assert.ok(en.agentDetail.noSessionSummary);
    assert.ok(zh.agentDetail.noSessionSummary);
});
