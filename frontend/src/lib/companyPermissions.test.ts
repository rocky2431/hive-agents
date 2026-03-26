import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { canEditCompanyProfile, canManageCompanyLifecycle } from './companyPermissions.ts';

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
const read = () => fs.readFileSync(enterpriseSettingsPath, 'utf8');

test('company profile editing matches tenant roles', () => {
    assert.equal(canEditCompanyProfile('platform_admin'), true);
    assert.equal(canEditCompanyProfile('org_admin'), true);
    assert.equal(canEditCompanyProfile('agent_admin'), false);
    assert.equal(canEditCompanyProfile('member'), false);
    assert.equal(canEditCompanyProfile(undefined), false);
});

test('company lifecycle actions are reserved for platform admins', () => {
    assert.equal(canManageCompanyLifecycle('platform_admin'), true);
    assert.equal(canManageCompanyLifecycle('org_admin'), false);
    assert.equal(canManageCompanyLifecycle('agent_admin'), false);
    assert.equal(canManageCompanyLifecycle('member'), false);
    assert.equal(canManageCompanyLifecycle(undefined), false);
});

test('EnterpriseSettings no longer issues DELETE /tenants requests for company lifecycle actions', () => {
    const source = readEnterpriseModule();

    assert.doesNotMatch(source, /method:\s*'DELETE'[\s\S]*\/tenants\/\$\{selectedTenantId\}/);
    assert.match(source, /adminApi\.toggleCompany/);
});
