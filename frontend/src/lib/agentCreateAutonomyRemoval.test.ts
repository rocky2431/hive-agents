import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const agentCreatePath = path.resolve(process.cwd(), 'src/pages/AgentCreate.tsx');

test('AgentCreate no longer keeps or submits autonomy_policy', () => {
    const source = fs.readFileSync(agentCreatePath, 'utf8');

    assert.doesNotMatch(source, /autonomy_policy/);
    assert.doesNotMatch(source, /wizard\.boundaries\.autonomy/);
    assert.doesNotMatch(source, /wizard\.boundaries\.autonomyDesc/);
});
