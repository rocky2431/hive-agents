import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const apiPath = path.resolve(process.cwd(), 'src/services/api.ts');
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
    const source = readEnterpriseModule();

    assert.match(source, /\/enterprise\/tenant-quotas\$\{selectedTenantId \? `\?tenant_id=\$\{selectedTenantId\}` : ''\}/);
    assert.match(source, /\/enterprise\/memory\/config\$\{tenantId \? `\?tenant_id=\$\{tenantId\}` : ''\}/);
    assert.match(source, /<MemoryTab key=\{selectedTenantId \|\| 'memory-default'\} models=\{models\} tenantId=\{selectedTenantId \|\| undefined\} \/>/);
    assert.match(source, /oidcApi\.getConfig\(selectedTenantId \|\| undefined\)/);
    assert.match(source, /oidcApi\.updateConfig\(ssoForm,\s*selectedTenantId \|\| undefined\)/);
});

test('EnterpriseSettings scopes llm test update and delete requests to the selected tenant', () => {
    const source = readEnterpriseModule();
    const apiSource = read(apiPath);

    assert.match(source, /enterpriseApi\.llmTest\(testData,\s*selectedTenantId \|\| undefined\)/);
    assert.match(source, /\/enterprise\/llm-models\/\$\{id\}\$\{selectedTenantId \? `\?tenant_id=\$\{selectedTenantId\}` : ''\}/);
    assert.match(source, /\/api\/v1\/enterprise\/llm-models\/\$\{id\}\?force=true&tenant_id=\$\{selectedTenantId\}/);
    assert.match(apiSource, /llmTest:\s*\(data: any,\s*tenantId\?: string\)\s*=>\s*request<any>\(`\/enterprise\/llm-test\$\{tenantId \? `\?tenant_id=\$\{tenantId\}` : ''\}`/);
});

test('InvitationCodes scopes CRUD requests to the selected tenant', () => {
    const source = read(invitationCodesPath);
    const apiSource = read(apiPath);

    assert.match(source, /params\.set\('tenant_id', tenantId\)/);
    assert.match(source, /enterpriseApi\.listInvitationCodes\(Object\.fromEntries\(params\.entries\(\)\)\)/);
    assert.match(source, /enterpriseApi\.createInvitationCodes\(\{ count: batchCount, max_uses: maxUses \}, tenantId \|\| undefined\)/);
    assert.match(source, /enterpriseApi\.deleteInvitationCode\(id, tenantId \|\| undefined\)/);
    assert.match(source, /enterpriseApi\.exportInvitationCodes\(tenantId \|\| undefined\)/);
    assert.match(apiSource, /\/enterprise\/invitation-codes\$\{qs \? `\?\$\{qs\}` : ''\}/);
    assert.match(apiSource, /\/enterprise\/invitation-codes\$\{tenantId \? `\?tenant_id=\$\{tenantId\}` : ''\}/);
    assert.match(apiSource, /\/enterprise\/invitation-codes\/\$\{id\}\$\{tenantId \? `\?tenant_id=\$\{tenantId\}` : ''\}/);
    assert.match(apiSource, /\/enterprise\/invitation-codes\/export\$\{tenantId \? `\?tenant_id=\$\{tenantId\}` : ''\}/);
});
