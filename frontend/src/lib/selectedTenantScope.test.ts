import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const apiPath = path.resolve(process.cwd(), 'src/services/api.ts');
const enterpriseSettingsPath = path.resolve(process.cwd(), 'src/pages/EnterpriseSettings.tsx');
const invitationCodesPath = path.resolve(process.cwd(), 'src/pages/InvitationCodes.tsx');

const read = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('oidc api can scope requests to a selected tenant', () => {
    const source = read(apiPath);

    assert.match(source, /getConfig:\s*\(tenantId\?:\s*string\)/);
    assert.match(source, /updateConfig:\s*\(data:.*tenantId\?:\s*string\)/s);
    assert.match(source, /\/enterprise\/oidc-config\$\{tenantId \? `\?tenant_id=\$\{tenantId\}` : ''\}/);
});

test('memory config api can scope requests to a selected tenant', () => {
    const source = read(apiPath);

    assert.match(source, /memoryConfig:\s*\(tenantId\?:\s*string\)/);
    assert.match(source, /updateMemoryConfig:\s*\(data:\s*any,\s*tenantId\?:\s*string\)/);
    assert.match(source, /\/enterprise\/memory\/config\$\{tenantId \? `\?tenant_id=\$\{tenantId\}` : ''\}/);
});

test('EnterpriseSettings scopes tenant config tabs to the selected tenant', () => {
    const source = read(enterpriseSettingsPath);

    assert.match(source, /\/enterprise\/tenant-quotas\$\{selectedTenantId \? `\?tenant_id=\$\{selectedTenantId\}` : ''\}/);
    assert.match(source, /\/enterprise\/memory\/config\$\{tenantId \? `\?tenant_id=\$\{tenantId\}` : ''\}/);
    assert.match(source, /<MemoryTab key=\{selectedTenantId \|\| 'memory-default'\} models=\{models\} tenantId=\{selectedTenantId \|\| undefined\} \/>/);
    assert.match(source, /oidcApi\.getConfig\(selectedTenantId \|\| undefined\)/);
    assert.match(source, /oidcApi\.updateConfig\(ssoForm,\s*selectedTenantId \|\| undefined\)/);
});

test('EnterpriseSettings scopes llm test update and delete requests to the selected tenant', () => {
    const source = read(enterpriseSettingsPath);

    assert.match(source, /\/api\/v1\/enterprise\/llm-test\$\{selectedTenantId \? `\?tenant_id=\$\{selectedTenantId\}` : ''\}/);
    assert.match(source, /\/enterprise\/llm-models\/\$\{id\}\$\{selectedTenantId \? `\?tenant_id=\$\{selectedTenantId\}` : ''\}/);
    assert.match(source, /\/api\/v1\/enterprise\/llm-models\/\$\{id\}\?force=true&tenant_id=\$\{selectedTenantId\}/);
});

test('InvitationCodes scopes CRUD requests to the selected tenant', () => {
    const source = read(invitationCodesPath);

    assert.match(source, /params\.set\('tenant_id', tenantId\)/);
    assert.match(source, /\/api\/v1\/enterprise\/invitation-codes\$\{tenantId \? `\?tenant_id=\$\{tenantId\}` : ''\}/);
    assert.match(source, /\/api\/v1\/enterprise\/invitation-codes\/\$\{id\}\$\{tenantId \? `\?tenant_id=\$\{tenantId\}` : ''\}/);
    assert.match(source, /\/api\/v1\/enterprise\/invitation-codes\/export\$\{tenantId \? `\?tenant_id=\$\{tenantId\}` : ''\}/);
});
