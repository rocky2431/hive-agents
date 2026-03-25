import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const apiPath = path.resolve(process.cwd(), 'src/services/api.ts');
const chatPath = path.resolve(process.cwd(), 'src/pages/Chat.tsx');
const agentDetailPath = path.resolve(process.cwd(), 'src/pages/AgentDetail.tsx');
const plazaPath = path.resolve(process.cwd(), 'src/pages/Plaza.tsx');
const adminCompaniesPath = path.resolve(process.cwd(), 'src/pages/AdminCompanies.tsx');
const enterpriseSettingsPath = path.resolve(process.cwd(), 'src/pages/EnterpriseSettings.tsx');
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
    const chatSource = readFile(chatPath);
    const agentDetailSource = readFile(agentDetailPath);
    const plazaSource = readFile(plazaPath);
    const adminCompaniesSource = readFile(adminCompaniesPath);
    const enterpriseSettingsSource = readFile(enterpriseSettingsPath);
    const channelConfigSource = readFile(channelConfigPath);

    assert.doesNotMatch(chatSource, /`\/api\/agents\/\$\{id\}\/files\/download/);
    assert.doesNotMatch(agentDetailSource, /`\/api\/agents\/\$\{id\}\/files\/download/);
    assert.doesNotMatch(plazaSource, /\/api\/plaza\//);
    assert.doesNotMatch(plazaSource, /\/api\/agents'/);
    assert.doesNotMatch(adminCompaniesSource, /\/api\/enterprise\/system-settings\/notification_bar/);
    assert.doesNotMatch(enterpriseSettingsSource, /\/api\/enterprise\/llm-test/);
    assert.doesNotMatch(channelConfigSource, /\/api\/channel\//);

    assert.match(chatSource, /`\/api\/v1\/agents\/\$\{id\}\/files\/download/);
    assert.match(agentDetailSource, /`\/api\/v1\/agents\/\$\{id\}\/files\/download/);
    assert.match(plazaSource, /plazaApi\./);
    assert.match(plazaSource, /agentApi\./);
    assert.match(adminCompaniesSource, /\/api\/v1\/enterprise\/system-settings\/notification_bar/);
    assert.match(enterpriseSettingsSource, /\/api\/v1\/enterprise\/llm-test/);
    assert.match(channelConfigSource, /\/api\/v1\/channel\//);
});
