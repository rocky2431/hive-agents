import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const apiPath = path.resolve(process.cwd(), 'src/services/api.ts');
const messagesPagePath = path.resolve(process.cwd(), 'src/pages/Messages.tsx');

const read = (filePath: string) => fs.readFileSync(filePath, 'utf8');

test('message api surface matches the backend inbox contract', () => {
    const apiSource = read(apiPath);

    assert.match(apiSource, /export const messageApi = \{/);
    assert.match(apiSource, /inbox:\s*\(limit = 50\)\s*=>/);
    assert.match(apiSource, /unreadCount:\s*\(\)\s*=>/);
    assert.doesNotMatch(apiSource, /markRead:\s*\(/);
    assert.doesNotMatch(apiSource, /markAllRead:\s*\(/);
    assert.doesNotMatch(apiSource, /\/messages\/\$\{messageId\}\/read/);
    assert.doesNotMatch(apiSource, /\/messages\/read-all/);
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
