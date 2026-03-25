import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const apiPath = path.resolve(process.cwd(), 'src/services/api.ts');
const messagesPagePath = path.resolve(process.cwd(), 'src/pages/Messages.tsx');
const bootstrapHelperPath = path.resolve(process.cwd(), 'src/lib/agentBootstrap.ts');

const read = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('message api surface matches the backend inbox contract', () => {
    const apiSource = read(apiPath);

    assert.match(
        apiSource,
        /export const messageApi = \{[\s\S]*inbox:\s*\(limit = 50\)\s*=>[\s\S]*unreadCount:\s*\(\)\s*=>[\s\S]*\};/,
    );
    const messageBlock = apiSource.match(/export const messageApi = \{[\s\S]*?\n\};/)?.[0] || '';
    assert.doesNotMatch(messageBlock, /markRead:\s*\(/);
    assert.doesNotMatch(messageBlock, /markAllRead:\s*\(/);
    assert.doesNotMatch(messageBlock, /\/messages\/\$\{messageId\}\/read/);
    assert.doesNotMatch(messageBlock, /\/messages\/read-all/);
});

test('messages page renders inbox items instead of notification-style read state', () => {
    const source = read(messagesPagePath);

    assert.doesNotMatch(source, /messageApi\.markRead/);
    assert.doesNotMatch(source, /messageApi\.markAllRead/);
    assert.doesNotMatch(source, /read_at/);
    assert.doesNotMatch(source, /receiver_name/);
    assert.doesNotMatch(source, /msg_type/);
    assert.match(source, /session_title/);
    assert.match(source, /sender_name/);
});

test('agent api surface uses direct create instead of legacy bootstrap flow', () => {
    const apiSource = read(apiPath);

    assert.match(apiSource, /create:\s*\(data:/);
    assert.doesNotMatch(apiSource, /bootstrap:\s*\(/);
    assert.doesNotMatch(apiSource, /\/agents\/bootstrap/);
    assert.equal(fs.existsSync(bootstrapHelperPath), false);
});
