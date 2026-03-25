import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const companySetupPath = path.resolve(process.cwd(), 'src/pages/CompanySetup.tsx');
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
const userManagementPath = path.resolve(process.cwd(), 'src/pages/UserManagement.tsx');
const apiPath = path.resolve(process.cwd(), 'src/services/api.ts');

const read = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('Company setup consumes both company self-create and invitation policy config', () => {
    const source = read(companySetupPath);

    assert.match(source, /tenantApi\.registrationConfig\(\)/);
    assert.match(source, /authApi\.registrationConfig\(\)/);
    assert.match(source, /invitation_code_required/);
    assert.match(source, /companySetup\.invitationRequired/);
});

test('Platform admin page exposes invitation-code policy toggle', () => {
    const source = read(adminCompaniesPath);

    assert.match(source, /invitation_code_enabled/);
    assert.match(source, /admin\.invitationCodeEnabled/);
    assert.match(source, /admin\.invitationCodeEnabledDesc/);
});

test('Frontend service layer exposes org management helpers for departments and tenant users', () => {
    const source = read(apiPath);

    assert.match(source, /export const orgApi = \{/);
    assert.match(source, /listDepartments:\s*\(tenantId\?: string\)/);
    assert.match(source, /createDepartment:\s*\(data: any,\s*tenantId\?: string\)/);
    assert.match(source, /updateDepartment:\s*\(deptId: string,\s*data: any,\s*tenantId\?: string\)/);
    assert.match(source, /deleteDepartment:\s*\(deptId: string,\s*tenantId\?: string\)/);
    assert.match(source, /listUsers:\s*\(params\?: Record<string, string>\)/);
    assert.match(source, /updateUser:\s*\(userId: string,\s*data: any\)/);
});

test('Enterprise settings org tab exposes department CRUD controls', () => {
    const source = readEnterpriseModule();

    assert.match(source, /orgApi\.createDepartment/);
    assert.match(source, /orgApi\.updateDepartment/);
    assert.match(source, /orgApi\.deleteDepartment/);
    assert.match(source, /enterprise\.org\.createDepartment/);
    assert.match(source, /enterprise\.org\.editDepartment/);
});

test('User management can update org profile fields alongside quota controls', () => {
    const source = read(userManagementPath);

    assert.match(source, /display_name:/);
    assert.match(source, /title:/);
    assert.match(source, /department_id:/);
    assert.match(source, /orgApi\.updateUser/);
    assert.match(source, /userMgmt\.department/);
    assert.match(source, /userMgmt\.title/);
});
