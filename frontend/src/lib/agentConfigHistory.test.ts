import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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
// Use readAgentDetailModule() instead of read()

test('AgentDetail fetches config revision details and exposes rollback action', () => {
    const source = readAgentDetailModule();

    assert.match(source, /configHistoryApi\.getVersion\(agentId,\s*String\(expandedVersion\)\)/);
    assert.match(source, /configHistoryApi\.rollback\(agentId,\s*\{\s*target_version:\s*targetVersion\s*\}\)/);
    assert.match(source, /agentDetail\.rollback/);
    assert.match(source, /agentDetail\.rollbackConfirm/);
});
