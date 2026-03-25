import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const agentDetailPath = path.resolve(process.cwd(), 'src/pages/AgentDetail.tsx');
const read = () => fs.readFileSync(agentDetailPath, 'utf8');

test('AgentDetail fetches config revision details and exposes rollback action', () => {
    const source = read();

    assert.match(source, /configHistoryApi\.getVersion\(agentId,\s*String\(expandedVersion\)\)/);
    assert.match(source, /configHistoryApi\.rollback\(agentId,\s*\{\s*target_version:\s*targetVersion\s*\}\)/);
    assert.match(source, /agentDetail\.rollback/);
    assert.match(source, /agentDetail\.rollbackConfirm/);
});
