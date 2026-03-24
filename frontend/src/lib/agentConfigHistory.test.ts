import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const agentDetailPath = path.resolve(process.cwd(), 'src/pages/AgentDetail.tsx');
const read = () => fs.readFileSync(agentDetailPath, 'utf8');

test('AgentDetail fetches config revision details and exposes rollback action', () => {
    const source = read();

    assert.match(source, /\/config-history\/agent\/\$\{agentId\}\/\$\{expandedVersion\}/);
    assert.match(source, /\/config-history\/agent\/\$\{agentId\}\/rollback/);
    assert.match(source, /agentDetail\.rollback/);
    assert.match(source, /agentDetail\.rollbackConfirm/);
});
