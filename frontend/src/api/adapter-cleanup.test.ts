import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('request cleanup adapters', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      'localStorage',
      {
        getItem: vi.fn(() => 'token'),
        removeItem: vi.fn(),
      } as unknown as Storage,
    );
    vi.stubGlobal(
      'window',
      {
        location: { href: '' },
      } as unknown as Window & typeof globalThis,
    );
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('passes RequestInit options such as AbortSignal through get()', async () => {
    const { get } = await import('./core/request');
    const signal = new AbortController().signal;
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify([{ id: 'm1' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await get('/agents/a1/sessions/s1/messages', { signal });

    expect(fetch).toHaveBeenCalledWith(
      '/api/agents/a1/sessions/s1/messages',
      expect.objectContaining({ method: 'GET', signal }),
    );
  });

  it('supports blob downloads through a dedicated helper', async () => {
    const { getBlob } = await import('./core/request');
    const blob = new Blob(['code,uses\nABC,1\n'], { type: 'text/csv' });
    vi.mocked(fetch).mockResolvedValue(new Response(blob, { status: 200 }));

    const result = await getBlob('/enterprise/invitation-codes/export');

    expect(await result.text()).toContain('ABC');
  });

  it('routes invitation export through enterpriseApi instead of page-level fetch', async () => {
    vi.doMock('./core/request', async () => {
      const actual = await vi.importActual<typeof import('./core/request')>('./core/request');
      return {
        ...actual,
        getBlob: vi.fn(),
      };
    });
    const { enterpriseApi } = await import('./domains/enterprise');
    const { getBlob } = await import('./core/request');
    const blob = new Blob(['csv'], { type: 'text/csv' });
    vi.mocked(getBlob).mockResolvedValue(blob);

    const result = await enterpriseApi.exportInvitationCodesCsv();

    expect(getBlob).toHaveBeenCalledWith('/enterprise/invitation-codes/export');
    expect(result).toBe(blob);
  });

  it('routes session message loading through chatApi with abort support', async () => {
    vi.doMock('./core/request', async () => {
      const actual = await vi.importActual<typeof import('./core/request')>('./core/request');
      return {
        ...actual,
        get: vi.fn(),
      };
    });
    const { chatApi } = await import('./domains/chat');
    const { get } = await import('./core/request');
    const signal = new AbortController().signal;
    vi.mocked(get).mockResolvedValue([{ id: 'm1', role: 'assistant', content: 'ok', created_at: '2026-03-27' }]);

    await chatApi.getSessionMessages('agent-1', 'session-1', { signal });

    expect(get).toHaveBeenCalledWith('/agents/agent-1/sessions/session-1/messages', { signal });
  });

  it('supports scoped session listing through chatApi', async () => {
    vi.doMock('./core/request', async () => {
      const actual = await vi.importActual<typeof import('./core/request')>('./core/request');
      return {
        ...actual,
        get: vi.fn(),
      };
    });
    const { chatApi } = await import('./domains/chat');
    const { get } = await import('./core/request');
    vi.mocked(get).mockResolvedValue([]);

    await chatApi.listSessions('agent-1', 'all');

    expect(get).toHaveBeenCalledWith('/agents/agent-1/sessions?scope=all');
  });

  it('routes notification center queries through notificationsApi with query params', async () => {
    vi.doMock('./core/request', async () => {
      const actual = await vi.importActual<typeof import('./core/request')>('./core/request');
      return {
        ...actual,
        get: vi.fn(),
      };
    });
    const { notificationsApi } = await import('./domains/notifications');
    const { get } = await import('./core/request');
    vi.mocked(get).mockResolvedValue([]);

    await notificationsApi.list({ limit: 50, category: 'system' });

    expect(get).toHaveBeenCalledWith('/notifications?limit=50&category=system');
  });

  it('routes agent tool removal through toolsApi', async () => {
    vi.doMock('./core/request', async () => {
      const actual = await vi.importActual<typeof import('./core/request')>('./core/request');
      return {
        ...actual,
        del: vi.fn(),
      };
    });
    const { toolsApi } = await import('./domains/tools');
    const { del } = await import('./core/request');
    vi.mocked(del).mockResolvedValue(undefined);

    await toolsApi.removeAgentTool('tool-123');

    expect(del).toHaveBeenCalledWith('/tools/agent-tool/tool-123');
  });

  it('routes relationship management through relationshipsApi', async () => {
    vi.doMock('./core/request', async () => {
      const actual = await vi.importActual<typeof import('./core/request')>('./core/request');
      return {
        ...actual,
        get: vi.fn(),
        put: vi.fn(),
        del: vi.fn(),
      };
    });
    const { relationshipsApi } = await import('./domains/relationships');
    const { get, put, del } = await import('./core/request');
    vi.mocked(get).mockResolvedValue([]);
    vi.mocked(put).mockResolvedValue(undefined);
    vi.mocked(del).mockResolvedValue(undefined);

    await relationshipsApi.listHuman('agent-1');
    await relationshipsApi.saveHuman('agent-1', [{ member_id: 'member-1', relation: 'collaborator', description: '' }]);
    await relationshipsApi.removeHuman('agent-1', 'rel-1');

    expect(get).toHaveBeenCalledWith('/agents/agent-1/relationships/');
    expect(put).toHaveBeenCalledWith('/agents/agent-1/relationships/', {
      relationships: [{ member_id: 'member-1', relation: 'collaborator', description: '' }],
    });
    expect(del).toHaveBeenCalledWith('/agents/agent-1/relationships/rel-1');
  });

  it('routes agent permission updates through agentApi with backend payload shape', async () => {
    vi.doMock('./core/request', async () => {
      const actual = await vi.importActual<typeof import('./core/request')>('./core/request');
      return {
        ...actual,
        put: vi.fn(),
      };
    });
    const { agentApi } = await import('./domains/agents');
    const { put } = await import('./core/request');
    vi.mocked(put).mockResolvedValue(undefined);

    await agentApi.updatePermissions('agent-1', {
      scope_type: 'company',
      scope_ids: [],
      access_level: 'use',
    });

    expect(put).toHaveBeenCalledWith('/agents/agent-1/permissions', {
      scope_type: 'company',
      scope_ids: [],
      access_level: 'use',
    });
  });
});
