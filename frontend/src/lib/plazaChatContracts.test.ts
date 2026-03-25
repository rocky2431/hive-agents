import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const apiPath = path.resolve(process.cwd(), 'src/services/api.ts');
const plazaPath = path.resolve(process.cwd(), 'src/pages/Plaza.tsx');
const chatPath = path.resolve(process.cwd(), 'src/pages/Chat.tsx');
const agentDetailPath = path.resolve(process.cwd(), 'src/pages/AgentDetail.tsx');

const read = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('frontend service layer exposes dedicated plaza and chat contract helpers', () => {
    const apiSource = read(apiPath);

    assert.match(apiSource, /export const plazaApi = \{/);
    assert.match(apiSource, /list:\s*\(tenantId\?: string\)/);
    assert.match(apiSource, /create:\s*\(content: string\)/);
    assert.match(apiSource, /comment:\s*\(postId: string, content: string\)/);
    assert.match(apiSource, /toggleLike:\s*\(postId: string\)/);
    assert.match(apiSource, /export const chatApi = \{/);
    assert.match(apiSource, /uploadAttachment:\s*\(file: File, agentId\?: string, onProgress\?: \(pct: number\) => void\)/);
});

test('Plaza page uses plazaApi and no longer sends forged author identity fields', () => {
    const plazaSource = read(plazaPath);

    assert.match(plazaSource, /plazaApi\.list/);
    assert.match(plazaSource, /plazaApi\.stats/);
    assert.match(plazaSource, /plazaApi\.get/);
    assert.match(plazaSource, /plazaApi\.create/);
    assert.match(plazaSource, /plazaApi\.comment/);
    assert.match(plazaSource, /plazaApi\.toggleLike/);
    assert.doesNotMatch(plazaSource, /author_id:\s*user\?\.id/);
    assert.doesNotMatch(plazaSource, /author_type:\s*'human'/);
    assert.doesNotMatch(plazaSource, /author_name:\s*user\?\.display_name/);
    assert.doesNotMatch(plazaSource, /tenant_id:\s*tenantId/);
    assert.doesNotMatch(plazaSource, /\/like\?author_id=/);
    assert.doesNotMatch(plazaSource, /const postJson = async/);
});

test('chat upload flows use shared chatApi helper instead of inline upload endpoints', () => {
    const chatSource = read(chatPath);
    const agentDetailSource = read(agentDetailPath);

    assert.match(chatSource, /chatApi\.uploadAttachment/);
    assert.match(agentDetailSource, /chatApi\.uploadAttachment/);
    assert.doesNotMatch(chatSource, /\/api\/v1\/chat\/upload/);
    assert.doesNotMatch(agentDetailSource, /`\/chat\/upload`/);
    assert.doesNotMatch(agentDetailSource, /uploadFileWithProgress/);
});
