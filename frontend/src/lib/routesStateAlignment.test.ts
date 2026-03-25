import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) =>
    fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

test('frontend bootstraps nuqs and exposes the missing dedicated routes', () => {
    const mainSource = read('src/main.tsx');
    const appSource = read('src/App.tsx');

    assert.match(mainSource, /NuqsAdapter/);
    assert.match(appSource, /const NotificationCenter = lazy\(\(\) => import\('\.\/pages\/NotificationCenter'\)\)/);
    assert.match(appSource, /const FeatureFlagsPage = lazy\(\(\) => import\('\.\/pages\/FeatureFlagsPage'\)\)/);
    assert.match(appSource, /path="notifications"/);
    assert.match(appSource, /path="admin\/feature-flags"/);
});

test('AgentDetail and EnterpriseSettings use query-string state for tabs', () => {
    const agentDetailSource = read('src/pages/AgentDetail.tsx');
    const enterpriseSource = read('src/pages/EnterpriseSettings.tsx');

    assert.match(agentDetailSource, /useQueryState/);
    assert.match(agentDetailSource, /\[activeTab,\s*setActiveTab\].*useQueryState/s);
    assert.doesNotMatch(agentDetailSource, /window\.history\.replaceState\(null,\s*'',\s*`#\$\{tab\}`\)/);

    assert.match(enterpriseSource, /useQueryState/);
    assert.match(enterpriseSource, /\[activeTab,\s*setActiveTab\].*useQueryState/s);
});

test('feature flag management UI exposes advanced backend fields', () => {
    const source = read('src/pages/enterprise/feature-flags-tab.tsx');

    assert.match(source, /rollout_percentage/);
    assert.match(source, /allowed_tenant_ids/);
    assert.match(source, /allowed_user_ids/);
    assert.match(source, /overrides/);
});
