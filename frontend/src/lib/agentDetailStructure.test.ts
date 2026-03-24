import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const agentDetailPath = path.resolve(process.cwd(), 'src/pages/AgentDetail.tsx');
const zhI18nPath = path.resolve(process.cwd(), 'src/i18n/zh.json');
const enI18nPath = path.resolve(process.cwd(), 'src/i18n/en.json');

const read = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('AgentDetail uses capabilities tab instead of legacy tools tab', () => {
    const source = read(agentDetailPath);

    assert.match(source, /const TABS = \['chat', 'overview', 'skills', 'activity', 'settings'\]/);
    assert.match(source, /useState<string>\(hashTab && validTabs\.includes\(hashTab\) \? hashTab : 'chat'\)/);
    assert.doesNotMatch(source, /const TABS = \['status', 'aware', 'mind', 'capabilities'/);
    assert.doesNotMatch(source, /activeTab === 'tools'/);
    assert.doesNotMatch(source, /function ToolsManager\(/);
    assert.doesNotMatch(source, /activeTab === 'status'/);
    assert.doesNotMatch(source, /activeTab === 'aware'/);
    assert.doesNotMatch(source, /activeTab === 'mind'/);
    assert.doesNotMatch(source, /activeTab === 'capabilities'/);
});

test('AgentDetail removes legacy autonomy policy panel', () => {
    const source = read(agentDetailPath);

    assert.doesNotMatch(source, /Legacy Autonomy Policy/);
    assert.doesNotMatch(source, /agent\.settings\.autonomy\.legacyTitle/);
    assert.doesNotMatch(source, /autonomy_policy/);
});

test('i18n exposes the new chat-first tab labels', () => {
    const zh = JSON.parse(read(zhI18nPath));
    const en = JSON.parse(read(enI18nPath));

    assert.equal(zh.agent.tabs.chat, '对话');
    assert.equal(zh.agent.tabs.overview, '概览');
    assert.equal(zh.agent.tabs.skills, '能力');
    assert.equal(zh.agent.tabs.activity, '动态');
    assert.equal(en.agent.tabs.chat, 'Chat');
    assert.equal(en.agent.tabs.overview, 'Overview');
    assert.equal(en.agent.tabs.skills, 'Capabilities');
    assert.equal(en.agent.tabs.activity, 'Activity');
    assert.equal(zh.agent.tools?.platformTools, undefined);
    assert.equal(en.agent.tools?.platformTools, undefined);
});

test('AgentDetail uses productized capability sections and normalized versioned API paths', () => {
    const source = read(agentDetailPath);

    assert.match(source, /agent\.capability\.sections\.skills/);
    assert.match(source, /agent\.capability\.sections\.tools/);
    assert.match(source, /agent\.capability\.sections\.advanced/);
    assert.doesNotMatch(source, /CapabilityPackCard/);
    assert.doesNotMatch(source, /Skill Format:/);
    assert.doesNotMatch(source, /skills\/my-skill\/SKILL\.md/);
    assert.doesNotMatch(source, /\/api\/agents\/\$\{id\}\/sessions/);
    assert.match(source, /\/api\/v1\/agents\/\$\{id\}\/sessions/);
});

test('AgentDetail does not contain dead bootstrap channel failure code', () => {
    const source = read(agentDetailPath);

    assert.doesNotMatch(source, /bootstrapChannelFailures/);
});
