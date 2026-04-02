import { describe, expect, it } from 'vitest';

import {
  buildRuntimeSummary,
  computeComposerHeight,
  getRuntimeEventMessage,
  getTransportNotice,
  normalizeStoredChatMessage,
} from './chatRuntime';

describe('chatRuntime helpers', () => {
  it('maps compaction runtime events into event messages', () => {
    const message = getRuntimeEventMessage({
      type: 'session_compact',
      summary: 'Trimmed older turns and kept the latest working set.',
      title: 'Context Compacted',
      status: 'info',
      original_message_count: 18,
      kept_message_count: 6,
    });

    expect(message).toMatchObject({
      role: 'event',
      eventType: 'session_compact',
      eventTitle: 'Context Compacted',
      eventStatus: 'info',
      content: 'Trimmed older turns and kept the latest working set.',
      originalMessageCount: 18,
      keptMessageCount: 6,
    });
  });

  it('treats websocket info events as transport notices instead of chat messages', () => {
    expect(
      getTransportNotice({
        type: 'info',
        content: 'Connection closed due to inactivity. Reconnect to continue.',
      }),
    ).toBe('Connection closed due to inactivity. Reconnect to continue.');
    expect(getRuntimeEventMessage({ type: 'info', content: 'ignored' })).toBeNull();
  });

  it('preserves stored event metadata from history payloads', () => {
    const message = normalizeStoredChatMessage({
      role: 'event',
      content: 'Context window compacted.',
      created_at: '2026-04-02T10:00:00Z',
      eventType: 'session_compact',
      eventTitle: 'Context Compacted',
      eventStatus: 'info',
      parts: [
        {
          type: 'event',
          original_message_count: 32,
          kept_message_count: 8,
        },
      ],
    });

    expect(message).toMatchObject({
      role: 'event',
      eventType: 'session_compact',
      eventTitle: 'Context Compacted',
      originalMessageCount: 32,
      keptMessageCount: 8,
      timestamp: '2026-04-02T10:00:00Z',
    });
  });

  it('clamps composer height to the configured min and max', () => {
    expect(computeComposerHeight(20)).toBe(44);
    expect(computeComposerHeight(96)).toBe(96);
    expect(computeComposerHeight(260)).toBe(160);
  });

  it('prefers backend runtime estimates and model metadata when available', () => {
    const summary = buildRuntimeSummary({
      persistedSummary: {
        activated_packs: ['web-pack'],
        used_tools: ['search_query'],
        blocked_capabilities: [],
        compaction_count: 1,
        model: {
          label: 'Claude Sonnet',
          provider: 'anthropic',
          name: 'claude-sonnet-4',
          context_window_tokens: 200000,
        },
        runtime: {
          connected: true,
          estimated_input_tokens: 4200,
          remaining_tokens_estimate: 195800,
        },
      },
      activeModel: {
        label: 'GPT-5.4',
        provider: 'openai',
        model: 'gpt-5.4',
        max_input_tokens: 128000,
      },
      agentPrimaryModelId: 'fallback-model',
      agentContextWindowSize: 32000,
      messages: [{ role: 'user', content: 'hello world' }],
      connected: false,
    });

    expect(summary.model).toMatchObject({
      label: 'Claude Sonnet',
      provider: 'anthropic',
      name: 'claude-sonnet-4',
      context_window_tokens: 200000,
    });
    expect(summary.runtime).toMatchObject({
      connected: true,
      estimated_input_tokens: 4200,
      remaining_tokens_estimate: 195800,
    });
  });
});
