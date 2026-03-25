import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const enterpriseSettingsPath = path.resolve(process.cwd(), 'src/pages/EnterpriseSettings.tsx');
const enterpriseSubDir = path.resolve(process.cwd(), 'src/pages/enterprise');
function readEnterpriseModule(): string {
    let src = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/EnterpriseSettings.tsx'), 'utf8');
    if (fs.existsSync(enterpriseSubDir)) {
        for (const f of fs.readdirSync(enterpriseSubDir)) {
            if (f.endsWith('.tsx') || f.endsWith('.ts')) {
                src += '\n' + fs.readFileSync(path.join(enterpriseSubDir, f), 'utf8');
            }
        }
    }
    return src;
}
const zhI18nPath = path.resolve(process.cwd(), 'src/i18n/zh.json');
const enI18nPath = path.resolve(process.cwd(), 'src/i18n/en.json');

const read = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('EnterpriseSettings uses grouped sidebar navigation with a consolidated AI tools area', () => {
    const source = readEnterpriseModule();

    assert.doesNotMatch(source, /activeTab === 'tools'/);
    assert.doesNotMatch(source, /useState<'llm' \| 'org' \| 'info' \| 'approvals' \| 'audit' \| 'tools'/);
    assert.doesNotMatch(source, /\['info', 'llm', 'tools', 'packs'/);
    assert.match(source, /\{ key: 'ai', tabs: \['llm', 'skills', 'mcp', 'memory'\] \}/);
    assert.doesNotMatch(source, /activeTab === 'packs'/);
    assert.match(source, /activeTab === 'mcp'/);
    assert.match(source, /activeTab === 'capabilities'/);
    assert.match(source, /SIDEBAR_GROUPS/);
});

test('EnterpriseSettings keeps backend pack controls but hides raw pack and MCP engineering language from the main view', () => {
    const source = readEnterpriseModule();

    assert.doesNotMatch(source, /const \[allTools, setAllTools\]/);
    assert.doesNotMatch(source, /const \[showAddMCP, setShowAddMCP\]/);
    assert.doesNotMatch(source, /const \[toolsView, setToolsView\]/);
    assert.doesNotMatch(source, /loadAllTools/);
    assert.doesNotMatch(source, /loadAgentInstalledTools/);
    assert.doesNotMatch(source, /jina_api_key/);
    assert.match(source, /packApi\.updatePolicy/);
    assert.match(source, /packApi\.mcpRegistry/);
    assert.match(source, /packApi\.importMcp/);
    assert.match(source, /packApi\.deleteMcp/);
    assert.doesNotMatch(source, /MCP Registry/);
    assert.doesNotMatch(source, /pack \{server\.pack_name\}/);
});

test('enterprise i18n uses business-facing AI capability language', () => {
    const zh = JSON.parse(read(zhI18nPath));
    const en = JSON.parse(read(enI18nPath));

    assert.equal(zh.enterprise.tabs.tools, undefined);
    assert.equal(en.enterprise.tabs.tools, undefined);
    assert.equal(zh.enterprise.tabs.mcp, '导入工具');
    assert.equal(en.enterprise.tabs.mcp, 'Imported Tools');
    assert.equal(zh.enterprise.groups.ai, 'AI 能力');
    assert.equal(en.enterprise.groups.ai, 'AI Capabilities');
    assert.equal(zh.agent.tools?.platformTools, undefined);
    assert.equal(en.agent.tools?.platformTools, undefined);
});
