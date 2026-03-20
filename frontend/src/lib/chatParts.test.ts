import test from 'node:test';
import assert from 'node:assert/strict';

import { applyStreamEvent, hydrateTimelineMessage, normalizeTimelineMessage } from './chatParts.ts';

test('normalizeTimelineMessage uses structured parts for assistant messages', () => {
    const message = normalizeTimelineMessage({
        role: 'assistant',
        content: 'fallback',
        thinking: 'fallback thinking',
        parts: [
            { type: 'reasoning', text: 'plan' },
            { type: 'text', text: 'answer' },
        ],
        created_at: '2026-03-20T00:00:00Z',
    });

    assert.deepEqual(message, {
        role: 'assistant',
        content: 'answer',
        thinking: 'plan',
        parts: [
            { type: 'reasoning', text: 'plan' },
            { type: 'text', text: 'answer' },
        ],
        timestamp: '2026-03-20T00:00:00Z',
        sender_name: undefined,
    });
});

test('normalizeTimelineMessage uses structured parts for tool messages', () => {
    const message = normalizeTimelineMessage({
        role: 'tool_call',
        content: '',
        parts: [{
            type: 'tool_call',
            name: 'load_skill',
            args: { name: 'web research' },
            status: 'done',
            result: 'loaded',
            reasoning: 'need skill',
        }],
        created_at: '2026-03-20T00:00:00Z',
    });

    assert.equal(message.role, 'tool_call');
    assert.equal(message.toolName, 'load_skill');
    assert.deepEqual(message.toolArgs, { name: 'web research' });
    assert.equal(message.toolStatus, 'done');
    assert.equal(message.toolResult, 'loaded');
    assert.equal(message.thinking, 'need skill');
});

test('applyStreamEvent builds streaming assistant and tool timeline', () => {
    const t1 = '2026-03-20T00:00:00Z';
    const t2 = '2026-03-20T00:00:01Z';
    const t3 = '2026-03-20T00:00:02Z';
    const t4 = '2026-03-20T00:00:03Z';
    const t5 = '2026-03-20T00:00:04Z';

    let messages = applyStreamEvent([], { type: 'thinking', content: 'plan' }, t1);
    messages = applyStreamEvent(messages, { type: 'chunk', content: 'hello' }, t2);
    messages = applyStreamEvent(messages, { type: 'tool_call', name: 'read_file', args: { path: 'focus.md' }, status: 'running' }, t3);
    messages = applyStreamEvent(messages, { type: 'tool_call', name: 'read_file', args: { path: 'focus.md' }, status: 'done', result: 'ok' }, t4);
    messages = applyStreamEvent(messages, {
        type: 'done',
        role: 'assistant',
        content: 'hello',
        parts: [
            { type: 'reasoning', text: 'plan' },
            { type: 'text', text: 'hello' },
        ],
    }, t5);

    assert.equal(messages.length, 2);
    assert.deepEqual(messages[0], {
        role: 'assistant',
        content: 'hello',
        thinking: 'plan',
        parts: [
            { type: 'reasoning', text: 'plan' },
            { type: 'text', text: 'hello' },
        ],
        timestamp: t5,
        sender_name: undefined,
        _streaming: false,
    });
    assert.deepEqual(messages[1], {
        role: 'tool_call',
        content: '',
        toolName: 'read_file',
        toolArgs: { path: 'focus.md' },
        toolStatus: 'done',
        toolResult: 'ok',
        thinking: undefined,
        timestamp: t4,
        sender_name: undefined,
        parts: [{
            type: 'tool_call',
            name: 'read_file',
            args: { path: 'focus.md' },
            status: 'done',
            result: 'ok',
            reasoning: undefined,
        }],
    });
});

test('hydrateTimelineMessage parses uploaded file markers for user messages', () => {
    const message = hydrateTimelineMessage({
        role: 'user',
        content: '[file:report.pdf]\nSummarize this',
        created_at: '2026-03-20T00:00:00Z',
    });

    assert.deepEqual(message, {
        role: 'user',
        content: 'Summarize this',
        thinking: undefined,
        fileName: 'report.pdf',
        parts: undefined,
        timestamp: '2026-03-20T00:00:00Z',
        sender_name: undefined,
    });
});

test('hydrateTimelineMessage resolves image previews for historical uploads', () => {
    const message = hydrateTimelineMessage({
        role: 'user',
        content: '[文件已上传: workspace/uploads/diagram.png]\n请看一下',
        created_at: '2026-03-20T00:00:00Z',
    }, {
        resolveImageUrl: (fileName) => `/preview/${fileName}`,
    });

    assert.deepEqual(message, {
        role: 'user',
        content: '请看一下',
        thinking: undefined,
        fileName: 'diagram.png',
        imageUrl: '/preview/diagram.png',
        parts: undefined,
        timestamp: '2026-03-20T00:00:00Z',
        sender_name: undefined,
    });
});

test('normalizeTimelineMessage keeps structured runtime events as event messages', () => {
    const message = normalizeTimelineMessage({
        role: 'event',
        content: 'This action requires approval.',
        parts: [{
            type: 'event',
            event_type: 'permission',
            title: 'Permission Gate',
            text: 'This action requires approval.',
            status: 'approval_required',
            tool_name: 'write_file',
            approval_id: 'approval-123',
        }],
        created_at: '2026-03-20T00:00:00Z',
    });

    assert.equal(message.role, 'event');
    assert.equal(message.eventType, 'permission');
    assert.equal(message.eventTitle, 'Permission Gate');
    assert.equal(message.eventStatus, 'approval_required');
    assert.equal(message.eventToolName, 'write_file');
    assert.equal(message.eventApprovalId, 'approval-123');
});

test('applyStreamEvent appends permission and compaction events', () => {
    const t1 = '2026-03-20T00:00:00Z';
    const t2 = '2026-03-20T00:00:01Z';

    let messages = applyStreamEvent([], {
        type: 'permission',
        tool_name: 'write_file',
        status: 'approval_required',
        message: 'This action requires approval.',
        approval_id: 'approval-123',
        part: {
            type: 'event',
            event_type: 'permission',
            title: 'Permission Gate',
            text: 'This action requires approval.',
            status: 'approval_required',
            tool_name: 'write_file',
            approval_id: 'approval-123',
        },
    }, t1);

    messages = applyStreamEvent(messages, {
        type: 'session_compact',
        summary: 'older context compressed',
        original_message_count: 20,
        kept_message_count: 8,
        part: {
            type: 'event',
            event_type: 'session_compact',
            title: 'Context Compacted',
            text: 'older context compressed',
            status: 'info',
            original_message_count: 20,
            kept_message_count: 8,
        },
    }, t2);

    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'event');
    assert.equal(messages[0].eventType, 'permission');
    assert.equal(messages[1].role, 'event');
    assert.equal(messages[1].eventType, 'session_compact');
});

test('normalizeTimelineMessage and applyStreamEvent support pack activation events', () => {
    const message = normalizeTimelineMessage({
        role: 'event',
        content: 'Activated web_pack',
        parts: [{
            type: 'event',
            event_type: 'pack_activation',
            title: 'Capability Packs Activated',
            text: 'Activated web_pack',
            status: 'info',
            packs: [{
                name: 'web_pack',
                summary: '网页搜索与抓取能力',
                tools: ['web_search'],
            }],
        }],
        created_at: '2026-03-20T00:00:00Z',
    });

    assert.equal(message.role, 'event');
    assert.equal(message.eventType, 'pack_activation');

    const streamed = applyStreamEvent([], {
        type: 'pack_activation',
        message: 'Activated web_pack',
        status: 'info',
        part: {
            type: 'event',
            event_type: 'pack_activation',
            title: 'Capability Packs Activated',
            text: 'Activated web_pack',
            status: 'info',
            packs: [{
                name: 'web_pack',
                summary: '网页搜索与抓取能力',
                tools: ['web_search'],
            }],
        },
    }, '2026-03-20T00:00:01Z');

    assert.equal(streamed.length, 1);
    assert.equal(streamed[0].eventType, 'pack_activation');
    assert.equal(streamed[0].eventTitle, 'Capability Packs Activated');
});
