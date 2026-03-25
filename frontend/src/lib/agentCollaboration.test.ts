import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const apiPath = path.resolve(process.cwd(), 'src/services/api.ts');
const agentDetailPath = path.resolve(process.cwd(), 'src/pages/AgentDetail.tsx');
const agentDetailSubDir = path.resolve(process.cwd(), 'src/pages/agent-detail');
function readAgentDetailModule(): string {
    let src = fs.readFileSync(agentDetailPath, 'utf8');
    if (fs.existsSync(agentDetailSubDir)) {
        for (const f of fs.readdirSync(agentDetailSubDir)) {
            if (f.endsWith('.tsx') || f.endsWith('.ts')) {
                src += '\n' + fs.readFileSync(path.join(agentDetailSubDir, f), 'utf8');
            }
        }
    }
    return src;
}
const zhI18nPath = path.resolve(process.cwd(), 'src/i18n/zh.json');
const enI18nPath = path.resolve(process.cwd(), 'src/i18n/en.json');

const read = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('agentApi exposes collaboration and handover endpoints', () => {
    const source = read(apiPath);

    assert.match(source, /delegateTask:\s*\(id:\s*string,\s*data:\s*\{/);
    assert.match(source, /sendCollaborationMessage:\s*\(id:\s*string,\s*data:\s*\{/);
    assert.match(source, /handover:\s*\(id:\s*string,\s*newCreatorId:\s*string\)/);
});

test('AgentDetail renders collaboration actions backed by the API surface', () => {
    const source = readAgentDetailModule();

    assert.match(source, /agentDetail\.collaborationTitle/);
    assert.match(source, /agentDetail\.delegateTask/);
    assert.match(source, /agentDetail\.sendMessage/);
    assert.match(source, /agentDetail\.handoverAgent/);
    assert.match(source, /agentApi\.delegateTask/);
    assert.match(source, /agentApi\.sendCollaborationMessage/);
    assert.match(source, /agentApi\.handover/);
});

test('collaboration labels exist in both language packs', () => {
    const zh = JSON.parse(read(zhI18nPath));
    const en = JSON.parse(read(enI18nPath));

    assert.ok(en.agentDetail.collaborationTitle);
    assert.ok(zh.agentDetail.collaborationTitle);
    assert.ok(en.agentDetail.delegateTask);
    assert.ok(zh.agentDetail.delegateTask);
    assert.ok(en.agentDetail.sendMessage);
    assert.ok(zh.agentDetail.sendMessage);
    assert.ok(en.agentDetail.handoverAgent);
    assert.ok(zh.agentDetail.handoverAgent);
});
