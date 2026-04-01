export interface CreateEmployeeToolResult {
  agentId: string;
  message: string;
  raw: string;
}

export interface NormalizedToolCallResult {
  displayResult: string;
  createdAgentId: string | null;
  raw: string;
}

function coerceToolResultToString(rawResult: unknown): string {
  if (typeof rawResult === 'string') {
    return rawResult;
  }
  if (rawResult == null) {
    return '';
  }
  try {
    return JSON.stringify(rawResult);
  } catch {
    return String(rawResult);
  }
}

export function parseCreateEmployeeToolResult(rawResult: unknown): CreateEmployeeToolResult | null {
  if (typeof rawResult !== 'string' || !rawResult.trim()) {
    return null;
  }

  const raw = rawResult.trim();
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed
      && typeof parsed === 'object'
      && parsed.status === 'success'
      && typeof parsed.agent_id === 'string'
      && typeof parsed.message === 'string'
    ) {
      return {
        agentId: parsed.agent_id,
        message: parsed.message,
        raw,
      };
    }
  } catch {
    // fall through for backward compatibility with legacy plain-text tool output
  }

  const idMatch = raw.match(/ID:\s*([0-9a-f-]{36})/i);
  if (!idMatch) {
    return null;
  }

  return {
    agentId: idMatch[1],
    message: raw,
    raw,
  };
}

export function normalizeToolCallResult(toolName: string | undefined, rawResult: unknown): NormalizedToolCallResult {
  const raw = coerceToolResultToString(rawResult);

  if (toolName === 'create_digital_employee') {
    const parsed = parseCreateEmployeeToolResult(raw);
    if (parsed) {
      return {
        displayResult: parsed.message,
        createdAgentId: parsed.agentId,
        raw: parsed.raw,
      };
    }
  }

  return {
    displayResult: raw,
    createdAgentId: null,
    raw,
  };
}
