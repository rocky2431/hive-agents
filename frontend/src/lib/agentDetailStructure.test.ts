import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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
const apiPath = path.resolve(process.cwd(), 'src/services/api.ts');
const zhI18nPath = path.resolve(process.cwd(), 'src/i18n/zh.json');
const enI18nPath = path.resolve(process.cwd(), 'src/i18n/en.json');

const read = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('AgentDetail uses capabilities tab instead of legacy tools tab', () => {
    const source = readAgentDetailModule();

    assert.match(source, /const TABS = \['chat', 'overview', 'capabilities', 'skills', 'automation', 'connections', 'activity', 'settings'\]/);
    assert.match(source, /import \{ parseAsStringLiteral, useQueryState \} from 'nuqs';/);
    assert.match(source, /const \[activeTab, setActiveTab\] = useQueryState\(\s*'tab',\s*parseAsStringLiteral\(TABS\)\.withDefault\('chat'\),/s);
    assert.doesNotMatch(source, /const TABS = \['status', 'aware', 'mind', 'capabilities'/);
    assert.doesNotMatch(source, /location\.hash/);
    assert.doesNotMatch(source, /window\.history\.replaceState/);
    assert.doesNotMatch(source, /activeTab === 'tools'/);
    assert.doesNotMatch(source, /function ToolsManager\(/);
    assert.doesNotMatch(source, /activeTab === 'status'/);
    assert.doesNotMatch(source, /activeTab === 'aware'/);
    assert.doesNotMatch(source, /activeTab === 'mind'/);
});

test('AgentDetail removes legacy autonomy policy panel', () => {
    const source = readAgentDetailModule();

    assert.doesNotMatch(source, /Legacy Autonomy Policy/);
    assert.doesNotMatch(source, /agent\.settings\.autonomy\.legacyTitle/);
    assert.doesNotMatch(source, /autonomy_policy/);
});

test('i18n exposes the new chat-first tab labels', () => {
    const zh = JSON.parse(read(zhI18nPath));
    const en = JSON.parse(read(enI18nPath));

    assert.equal(zh.agent.tabs.chat, '对话');
    assert.equal(zh.agent.tabs.overview, '概览');
    assert.equal(zh.agent.tabs.skills, '技能');
    assert.equal(zh.agent.tabs.activity, '动态');
    assert.equal(en.agent.tabs.chat, 'Chat');
    assert.equal(en.agent.tabs.overview, 'Overview');
    assert.equal(en.agent.tabs.skills, 'Capabilities');
    assert.equal(en.agent.tabs.activity, 'Activity');
    assert.equal(zh.agent.tools?.platformTools, undefined);
    assert.equal(en.agent.tools?.platformTools, undefined);
});

test('AgentDetail uses productized capability sections and normalized versioned API paths', () => {
    const source = readAgentDetailModule();
    const apiSource = read(apiPath);

    assert.match(source, /agent\.capability\.sections\.skills/);
    assert.match(source, /agent\.capability\.sections\.tools/);
    assert.match(source, /agent\.capability\.sections\.advanced/);
    assert.doesNotMatch(source, /CapabilityPackCard/);
    assert.doesNotMatch(source, /Skill Format:/);
    assert.doesNotMatch(source, /skills\/my-skill\/SKILL\.md/);
    assert.match(source, /agentApi\.sessions\(agentId, 'mine'\)/);
    assert.match(source, /agentApi\.sessions\(agentId, sessionScope\)/);
    assert.doesNotMatch(apiSource, /\/api\/agents\/\$\{id\}\/sessions/);
    assert.match(apiSource, /sessions:\s*\(id: string,\s*scope: 'mine' \| 'all' = 'mine'\)\s*=>\s*request<any\[]>\(`\/agents\/\$\{id\}\/sessions\?scope=\$\{scope\}`\)/);
});

test('AgentDetail does not contain dead bootstrap channel failure code', () => {
    const source = readAgentDetailModule();

    assert.doesNotMatch(source, /bootstrapChannelFailures/);
});

test('AgentDetail persists backend governance fields in settings', () => {
    const source = readAgentDetailModule();

    assert.match(source, /agent_class:\s*''/);
    assert.match(source, /security_zone:\s*'standard'/);
    assert.match(source, /agent_class:\s*agent\.agent_class \|\| 'internal_tenant'/);
    assert.match(source, /security_zone:\s*agent\.security_zone \|\| 'standard'/);
    assert.match(source, /agent_class:\s*settingsForm\.agent_class/);
    assert.match(source, /security_zone:\s*settingsForm\.security_zone/);
});

test('AgentDetail permission editor supports targeted scope_ids sharing', () => {
    const source = readAgentDetailModule();

    assert.match(source, /scope_ids:\s*selectedPermissionUserIds/);
    assert.match(source, /agent\.settings\.perm\.specificUsers/);
    assert.match(source, /agent\.settings\.perm\.specificUsersDesc/);
    assert.match(source, /orgApi\.listUsers/);
});

test('AgentDetail exposes task, schedule, and trigger management APIs', () => {
    const source = readAgentDetailModule();

    assert.match(source, /taskApi\.list/);
    assert.match(source, /taskApi\.create/);
    assert.match(source, /taskApi\.update/);
    assert.match(source, /taskApi\.getLogs/);
    assert.match(source, /taskApi\.trigger/);
    assert.match(source, /scheduleApi\.list/);
    assert.match(source, /scheduleApi\.history/);
    assert.match(source, /triggerApi\.list/);
    assert.match(source, /triggerApi\.update/);
    assert.match(source, /triggerApi\.delete/);
});
