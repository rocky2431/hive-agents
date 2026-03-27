import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import AgentApprovalsSection from './AgentApprovalsSection';
import AgentActivityLogSection from './AgentActivityLogSection';
import AgentStatusSection from './AgentStatusSection';
import CopyMessageButton from './CopyMessageButton';
import RelationshipEditor from './RelationshipEditor';
import ToolsManager from './ToolsManager';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key.split('.').pop() ?? key,
    i18n: {
      language: 'en',
    },
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey[0]);
    if (key === 'relationships') {
      return {
        data: [
          {
            id: 'rel-1',
            member_id: 'member-1',
            relation: 'collaborator',
            relation_label: 'Collaborator',
            description: 'Works with the agent daily.',
            member: {
              name: 'Alice',
              title: 'Engineer',
              department_path: 'Engineering',
            },
          },
        ],
      };
    }
    if (key === 'agent-relationships') {
      return {
        data: [
          {
            id: 'arel-1',
            target_agent_id: 'agent-2',
            relation: 'peer',
            relation_label: 'Peer',
            description: 'Peer reviewer.',
            target_agent: {
              name: 'Reviewer Bot',
              role_description: 'Quality reviewer',
            },
          },
        ],
      };
    }
    if (key === 'agents-for-rel') {
      return {
        data: [
          { id: 'agent-1', name: 'Primary Bot', role_description: 'Main agent' },
          { id: 'agent-2', name: 'Reviewer Bot', role_description: 'Quality reviewer' },
        ],
      };
    }
    if (key === 'agent-approvals') {
      return {
        data: [
          {
            id: 'approval-1',
            action_type: 'deploy_run',
            status: 'pending',
            created_at: '2026-03-27T09:00:00Z',
            details: { environment: 'prod' },
          },
          {
            id: 'approval-2',
            action_type: 'publish_post',
            status: 'approved',
            resolved_at: '2026-03-27T09:30:00Z',
          },
        ],
        refetch: vi.fn(),
      };
    }
    return { data: [] };
  },
  useMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock('../../stores', () => {
  const useAuthStore = Object.assign(vi.fn(), {
    getState: () => ({
      user: null,
      token: null,
    }),
  });
  return { useAuthStore };
});

describe('AgentDetail extracted sections', () => {
  it('renders ToolsManager as a standalone module with loading placeholder', () => {
    const markup = renderToStaticMarkup(<ToolsManager agentId="agent-1" canManage />);

    expect(markup).toContain('loading');
  });

  it('renders RelationshipEditor as a standalone module with human and agent sections', () => {
    const markup = renderToStaticMarkup(<RelationshipEditor agentId="agent-1" />);

    expect(markup).toContain('humanRelationships');
    expect(markup).toContain('agentRelationships');
    expect(markup).toContain('Alice');
    expect(markup).toContain('Reviewer Bot');
  });

  it('renders CopyMessageButton as a standalone message action', () => {
    const markup = renderToStaticMarkup(<CopyMessageButton text="Hello world" />);

    expect(markup).toContain('title="Copy"');
    expect(markup).toContain('<button');
  });

  it('renders AgentStatusSection as a standalone overview module', () => {
    const markup = renderToStaticMarkup(
      <AgentStatusSection
        agent={{
          id: 'agent-1',
          agent_type: 'native',
          tokens_used_today: 1234,
          max_tokens_per_day: 5000,
          tokens_used_month: 6789,
          max_tokens_per_month: 20000,
          llm_calls_today: 12,
          max_llm_calls_per_day: 100,
          tokens_used_total: 98765,
          role_description: 'Handles release coordination.',
          created_at: '2026-03-20T10:00:00Z',
          creator_username: 'rocky',
          last_active_at: '2026-03-27T09:00:00Z',
          effective_timezone: 'Asia/Shanghai',
          primary_model_id: 'model-1',
          context_window_size: 50,
        }}
        llmModels={[{ id: 'model-1', label: 'GPT-5.4', model: 'gpt-5.4', provider: 'openai' }]}
        metrics={{
          tasks: { done: 3, total: 5, completion_rate: 60 },
          approvals: { pending: 2 },
          activity: { actions_last_24h: 14 },
        }}
        activityLogs={[
          { id: 'log-1', created_at: '2026-03-27T09:15:00Z', summary: 'Sent release reminder', action_type: 'chat_reply' },
        ]}
        statusKey="active"
        onSelectTab={() => {}}
      />,
    );

    expect(markup).toContain('Recent Activity');
    expect(markup).toContain('GPT-5.4');
    expect(markup).toContain('Handles release coordination.');
    expect(markup).toContain('Sent release reminder');
  });

  it('renders AgentActivityLogSection as a standalone activity module', () => {
    const markup = renderToStaticMarkup(
      <AgentActivityLogSection
        agentType="native"
        activityLogs={[
          {
            id: 'log-1',
            created_at: '2026-03-27T09:15:00Z',
            summary: 'Heartbeat completed',
            action_type: 'heartbeat',
            detail: { cycle: 'morning' },
          },
        ]}
        logFilter="heartbeat"
        expandedLogId="log-1"
        onFilterChange={() => {}}
        onToggleExpandedLog={() => {}}
      />,
    );

    expect(markup).toContain('User Actions');
    expect(markup).toContain('Heartbeat completed');
    expect(markup).toContain('cycle');
  });

  it('renders AgentApprovalsSection as a standalone approvals module', () => {
    const markup = renderToStaticMarkup(<AgentApprovalsSection agentId="agent-1" />);

    expect(markup).toContain('deploy_run');
    expect(markup).toContain('publish_post');
    expect(markup).toContain('prod');
  });
});
