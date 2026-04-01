import { describe, expect, it } from 'vitest';

import { normalizeToolCallResult, parseCreateEmployeeToolResult } from './toolResultEnvelope';

describe('parseCreateEmployeeToolResult', () => {
  it('parses structured JSON payloads', () => {
    const parsed = parseCreateEmployeeToolResult(JSON.stringify({
      status: 'success',
      agent_id: '7a5b31cb-89b4-4053-a48e-6dfb42a8af20',
      agent_name: 'Research Bot',
      message: 'Successfully created digital employee Research Bot.',
    }));

    expect(parsed).toEqual({
      agentId: '7a5b31cb-89b4-4053-a48e-6dfb42a8af20',
      message: 'Successfully created digital employee Research Bot.',
      raw: expect.any(String),
    });
  });

  it('keeps backward compatibility with legacy plain-text output', () => {
    const parsed = parseCreateEmployeeToolResult(
      "Successfully created digital employee 'Research Bot' (ID: 7a5b31cb-89b4-4053-a48e-6dfb42a8af20).",
    );

    expect(parsed).toEqual({
      agentId: '7a5b31cb-89b4-4053-a48e-6dfb42a8af20',
      message: "Successfully created digital employee 'Research Bot' (ID: 7a5b31cb-89b4-4053-a48e-6dfb42a8af20).",
      raw: expect.any(String),
    });
  });

  it('returns null for unrelated tool output', () => {
    expect(parseCreateEmployeeToolResult('No agent created here.')).toBeNull();
  });

  it('normalizes create employee JSON result into user-facing text and agent id', () => {
    const normalized = normalizeToolCallResult(
      'create_digital_employee',
      JSON.stringify({
        status: 'success',
        agent_id: '7a5b31cb-89b4-4053-a48e-6dfb42a8af20',
        message: 'Successfully created digital employee Research Bot.',
      }),
    );

    expect(normalized).toEqual({
      displayResult: 'Successfully created digital employee Research Bot.',
      createdAgentId: '7a5b31cb-89b4-4053-a48e-6dfb42a8af20',
      raw: expect.any(String),
    });
  });

  it('preserves non-create tool results untouched', () => {
    const normalized = normalizeToolCallResult('web_search', 'raw search result');

    expect(normalized).toEqual({
      displayResult: 'raw search result',
      createdAgentId: null,
      raw: 'raw search result',
    });
  });

  it('falls back to raw create employee output when payload is not parseable', () => {
    const normalized = normalizeToolCallResult('create_digital_employee', 'temporary downstream error');

    expect(normalized).toEqual({
      displayResult: 'temporary downstream error',
      createdAgentId: null,
      raw: 'temporary downstream error',
    });
  });
});
