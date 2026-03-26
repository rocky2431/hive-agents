import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const apiPath = path.resolve(process.cwd(), 'src/services/api.ts');
const chatPath = path.resolve(process.cwd(), 'src/pages/Chat.tsx');
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
const plazaPath = path.resolve(process.cwd(), 'src/pages/Plaza.tsx');
const adminCompaniesPath = path.resolve(process.cwd(), 'src/pages/AdminCompanies.tsx');
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
const channelConfigPath = path.resolve(process.cwd(), 'src/components/ChannelConfig.tsx');
const read = () => fs.readFileSync(apiPath, 'utf8');
const readFile = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('frontend api surface no longer exports legacy toolApi', () => {
    const source = read();

    assert.doesNotMatch(source, /export const toolApi = \{/);
    assert.doesNotMatch(source, /create:\s*\(data:\s*any\)\s*=>\s*request<any>\('\/agents\/'/);
    assert.doesNotMatch(source, /\/tools\/agents\/\$\{agentId\}/);
    assert.doesNotMatch(source, /templates:\s*\(\)\s*=>\s*request<any\[]>\('\/agents\/templates'\)/);
    assert.match(source, /updatePolicy:\s*\(packName: string, enabled: boolean\)/);
    assert.match(source, /mcpRegistry:\s*\(\)\s*=>/);
    assert.match(source, /importMcp:\s*\(data: \{/);
    assert.match(source, /deleteMcp:\s*\(serverKey: string\)/);
});

test('frontend pages normalize legacy direct API paths to /api/v1', () => {
    const apiSource = readFile(apiPath);
    const chatSource = readFile(chatPath);
    const agentDetailSource = readAgentDetailModule();
    const plazaSource = readFile(plazaPath);
    const adminCompaniesSource = readFile(adminCompaniesPath);
    const enterpriseSettingsSource = readEnterpriseModule();
    const channelConfigSource = readFile(channelConfigPath);

    assert.doesNotMatch(chatSource, /`\/api\/agents\/\$\{id\}\/files\/download/);
    assert.doesNotMatch(agentDetailSource, /`\/api\/agents\/\$\{id\}\/files\/download/);
    assert.doesNotMatch(plazaSource, /\/api\/plaza\//);
    assert.doesNotMatch(plazaSource, /\/api\/agents'/);
    assert.doesNotMatch(adminCompaniesSource, /\/api\/enterprise\/system-settings\/notification_bar/);
    assert.doesNotMatch(adminCompaniesSource, /\/api\/v1\/enterprise\/system-settings\/notification_bar/);
    assert.doesNotMatch(enterpriseSettingsSource, /\/api\/enterprise\/llm-test/);
    assert.doesNotMatch(enterpriseSettingsSource, /\/api\/v1\/enterprise\/llm-test/);
    assert.doesNotMatch(channelConfigSource, /\/api\/channel\//);

    assert.match(apiSource, /const API_BASE = '\/api\/v1'/);
    assert.match(chatSource, /`\/api\/v1\/agents\/\$\{id\}\/files\/download/);
    assert.match(agentDetailSource, /`\/api\/v1\/agents\/\$\{agentId\}\/files\/download/);
    assert.match(plazaSource, /plazaApi\./);
    assert.match(plazaSource, /agentApi\./);
    assert.match(adminCompaniesSource, /enterpriseApi\.getSystemSetting\('notification_bar'\)/);
    assert.match(adminCompaniesSource, /enterpriseApi\.updateSystemSetting\('notification_bar', \{ value: \{ enabled: nbEnabled, text: nbText \} \}\)/);
    assert.match(apiSource, /getSystemSetting:\s*\(key: string,\s*tenantId\?: string\)\s*=>\s*request<any>\(`\/enterprise\/system-settings\/\$\{key\}\$\{tenantId \? `\?tenant_id=\$\{tenantId\}` : ''\}`\)/);
    assert.match(apiSource, /updateSystemSetting:\s*\(key: string,\s*data: any,\s*tenantId\?: string\)\s*=>\s*request<any>\(`\/enterprise\/system-settings\/\$\{key\}\$\{tenantId \? `\?tenant_id=\$\{tenantId\}` : ''\}`,\s*\{/);
    assert.match(enterpriseSettingsSource, /enterpriseApi\.llmTest\(/);
    assert.match(apiSource, /llmTest:\s*\(data: any,\s*tenantId\?: string\)\s*=>\s*request<any>\(`\/enterprise\/llm-test\$\{tenantId \? `\?tenant_id=\$\{tenantId\}` : ''\}`/);
    assert.match(channelConfigSource, /\/api\/v1\/channel\//);
});
