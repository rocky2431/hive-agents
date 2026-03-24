import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { canEditCompanyProfile, canManageCompanyLifecycle } from './companyPermissions.ts';

const enterpriseSettingsPath = path.resolve(process.cwd(), 'src/pages/EnterpriseSettings.tsx');
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
    const source = read();

    assert.doesNotMatch(source, /method:\s*'DELETE'[\s\S]*\/tenants\/\$\{selectedTenantId\}/);
    assert.match(source, /adminApi\.toggleCompany/);
});
