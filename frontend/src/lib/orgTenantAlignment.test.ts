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
const typesPath = path.resolve(process.cwd(), 'src/types/index.ts');

const read = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('EnterpriseSettings scopes org sync config and trigger requests to the selected tenant', () => {
    const source = readEnterpriseModule();

    assert.match(source, /queryKey:\s*\['system-settings', 'feishu_org_sync', currentTenantId\]/);
    assert.match(source, /\/enterprise\/system-settings\/feishu_org_sync\$\{currentTenantId \? `\?tenant_id=\$\{currentTenantId\}` : ''\}/);
    assert.match(source, /\/enterprise\/org\/sync\$\{currentTenantId \? `\?tenant_id=\$\{currentTenantId\}` : ''\}/);
});

test('AgentDetail scopes relationship searches and candidate agents to the agent tenant', () => {
    const source = readAgentDetailModule();
    const apiSource = read(apiPath);

    assert.match(source, /const relationshipTenantId = localStorage\.getItem\('current_tenant_id'\) \|\| '';/);
    assert.match(source, /queryKey:\s*\['agents-for-rel', relationshipTenantId\]/);
    assert.match(source, /agentApi\.list\(relationshipTenantId \|\| undefined\)/);
    assert.match(source, /params\.set\('tenant_id', relationshipTenantId\)/);
    assert.match(apiSource, /list:\s*\(tenantId\?: string\)\s*=>\s*request<Agent\[]>\(`\/agents\/\$\{tenantId \? `\?tenant_id=\$\{tenantId\}` : ''\}`\)/);
});

test('frontend Agent type exposes tenant_id for tenant-scoped detail flows', () => {
    const source = read(typesPath);

    assert.match(source, /export interface Agent \{[\s\S]*tenant_id\?: string;/);
});
