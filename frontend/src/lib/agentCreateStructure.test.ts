import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const agentCreatePath = path.resolve(process.cwd(), 'src/pages/AgentCreate.tsx');
const zhI18nPath = path.resolve(process.cwd(), 'src/i18n/zh.json');
const enI18nPath = path.resolve(process.cwd(), 'src/i18n/en.json');
const read = () => fs.readFileSync(agentCreatePath, 'utf8');
const readFile = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('AgentCreate uses 2-step flow (not 5-step wizard)', () => {
    const source = read();

    // No template gallery
    assert.doesNotMatch(source, /AGENT_TEMPLATES/);
    assert.doesNotMatch(source, /wizard\.templates\./);

    // Phase-based flow, not 5-step STEPS constant
    assert.match(source, /type Phase = 'identity' \| 'abilities' \| 'success'/);
    assert.doesNotMatch(source, /const STEPS\s*=/);

    // 2-step stepper labels only
    assert.match(source, /wizard\.steps\.identity/);
    assert.match(source, /wizard\.steps\.abilities/);
});

test('AgentCreate removed legacy wizard elements', () => {
    const source = read();

    // No channel config step
    assert.doesNotMatch(source, /ChannelConfig/);
    assert.doesNotMatch(source, /wizard\.stepChannel\./);

    // No review step
    assert.doesNotMatch(source, /wizard\.stepReview\./);

    // No kernel tools display
    assert.doesNotMatch(source, /kernelTools/);
    assert.doesNotMatch(source, /wizard\.step2New\.kernelTitle/);

    // No pack preview display
    assert.doesNotMatch(source, /starterPacks|selectedPacks|packPreview/);
    assert.doesNotMatch(source, /wizard\.step2New\.starterPacksTitle/);

    // No governed actions hint
    assert.doesNotMatch(source, /governedActionsHint/);

    // No security zone selection
    assert.doesNotMatch(source, /security_zone.*radio|agent\.zone\./);

    // No token limits in creation
    assert.doesNotMatch(source, /max_tokens_per_day|max_tokens_per_month/);

    // No agent class selector
    assert.doesNotMatch(source, /agent_class.*select|agent_class.*radio/);

    // No legacy openclaw
    assert.doesNotMatch(source, /const OPENCLAW_STEPS/);
    assert.doesNotMatch(source, /agentType/);
});

test('AgentCreate calls agentApi.create with smart defaults', () => {
    const source = read();

    assert.match(source, /agentApi\.create/);
    assert.doesNotMatch(source, /agentApi\.bootstrap/);
    assert.match(source, /security_zone:\s*'standard'/);
    assert.match(source, /permission_scope_type:\s*'company'/);
    assert.match(source, /agent_class:\s*'internal_tenant'/);
});

test('AgentCreate has success screen with navigation', () => {
    const source = read();

    assert.match(source, /wizard\.success\.title/);
    assert.match(source, /wizard\.success\.startChat/);
    assert.match(source, /wizard\.success\.connectChannel/);
    assert.match(source, /createdAgentId/);
    assert.match(source, /createdAgentName/);
});

test('AgentCreate uses Recommended badge instead of Required badge', () => {
    const source = read();

    assert.match(source, /wizard\.abilities\.recommendedBadge/);
    assert.doesNotMatch(source, /wizard\.step2New\.requiredBadge/);
});

test('AgentCreate uses dropdown for model selection instead of radio cards', () => {
    const source = read();

    assert.match(source, /<select/);
    assert.match(source, /wizard\.identity\.aiModel/);
    assert.doesNotMatch(source, /wizard\.step1\.primaryModel/);
});

test('i18n has no template gallery keys', () => {
    const zh = JSON.parse(readFile(zhI18nPath));
    const en = JSON.parse(readFile(enI18nPath));

    assert.equal(en.wizard.templates, undefined);
    assert.equal(zh.wizard.templates, undefined);
});

test('i18n has success screen keys in both languages', () => {
    const zh = JSON.parse(readFile(zhI18nPath));
    const en = JSON.parse(readFile(enI18nPath));

    assert.match(en.wizard.success.title, /\{\{name\}\}/);
    assert.match(zh.wizard.success.title, /\{\{name\}\}/);
    assert.equal(en.wizard.success.startChat, 'Start chatting');
    assert.equal(zh.wizard.success.startChat, '\u5F00\u59CB\u5BF9\u8BDD');
    assert.equal(en.wizard.success.connectChannel, 'Connect a channel');
    assert.equal(zh.wizard.success.connectChannel, '\u8FDE\u63A5\u901A\u4FE1\u6E20\u9053');
});

test('i18n has abilities step keys in both languages', () => {
    const zh = JSON.parse(readFile(zhI18nPath));
    const en = JSON.parse(readFile(enI18nPath));

    assert.ok(en.wizard.abilities.title);
    assert.ok(zh.wizard.abilities.title);
    assert.ok(en.wizard.abilities.recommendedBadge);
    assert.ok(zh.wizard.abilities.recommendedBadge);
    assert.ok(en.wizard.abilities.approvalHint);
    assert.ok(zh.wizard.abilities.approvalHint);
});

test('i18n removed legacy wizard sections', () => {
    const zhSource = readFile(zhI18nPath);
    const enSource = readFile(enI18nPath);

    // No step5 blocks
    assert.equal((zhSource.match(/"step5":\s*\{/g) || []).length, 0);
    assert.equal((enSource.match(/"step5":\s*\{/g) || []).length, 0);

    // stepChannel only retains partialFailure (used by AgentDetail), no wizard-step keys
    const zh = JSON.parse(zhSource);
    const en = JSON.parse(enSource);
    assert.equal(en.wizard.stepChannel?.title, undefined);
    assert.equal(zh.wizard.stepChannel?.title, undefined);
    assert.ok(en.wizard.stepChannel?.partialFailure);
    assert.ok(zh.wizard.stepChannel?.partialFailure);
    // stepReview fully removed
    assert.equal(zh.wizard.stepReview, undefined);
    assert.equal(en.wizard.stepReview, undefined);
});
