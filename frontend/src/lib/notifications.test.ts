import test from 'node:test';
import assert from 'node:assert/strict';

import { extractUnreadCount } from './notifications.ts';

test('extractUnreadCount reads the backend unread_count field', () => {
    assert.equal(extractUnreadCount({ unread_count: 7 }), 7);
});

test('extractUnreadCount keeps backward compatibility with count', () => {
    assert.equal(extractUnreadCount({ count: 3 }), 3);
});

test('extractUnreadCount falls back to zero for invalid payloads', () => {
    assert.equal(extractUnreadCount(null), 0);
    assert.equal(extractUnreadCount({}), 0);
    assert.equal(extractUnreadCount({ unread_count: 'x' }), 0);
});
