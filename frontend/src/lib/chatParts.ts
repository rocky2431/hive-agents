export type MessageRole = 'user' | 'assistant' | 'tool_call' | 'event';

export interface TextPart {
    type: 'text' | 'text_delta';
    text: string;
}

export interface ReasoningPart {
    type: 'reasoning';
    text: string;
}

export interface ToolCallPart {
    type: 'tool_call';
    name: string;
    args?: unknown;
    status?: 'running' | 'done';
    result?: string;
    reasoning?: string;
}

export interface EventPart {
    type: 'event';
    event_type: 'permission' | 'session_compact' | 'pack_activation';
    title: string;
    text: string;
    status?: string;
    tool_name?: string;
    approval_id?: string;
    original_message_count?: number;
    kept_message_count?: number;
    packs?: Array<Record<string, unknown>>;
    skill_name?: string;
    trigger_tool?: string;
}

export type MessagePart = TextPart | ReasoningPart | ToolCallPart | EventPart;

export interface TimelineMessage {
    role: MessageRole;
    content: string;
    thinking?: string;
    fileName?: string;
    imageUrl?: string;
    toolName?: string;
    toolArgs?: unknown;
    toolStatus?: 'running' | 'done';
    toolResult?: string;
    eventType?: 'permission' | 'session_compact' | 'pack_activation';
    eventTitle?: string;
    eventStatus?: string;
    eventToolName?: string;
    eventApprovalId?: string;
    eventPacks?: Array<Record<string, unknown>>;
    parts?: MessagePart[];
    timestamp?: string;
    _streaming?: boolean;
    sender_name?: string;
}

export interface TimelineHydrateOptions {
    resolveImageUrl?: (fileName: string) => string | undefined;
}

function isToolCallPart(part: MessagePart): part is ToolCallPart {
    return part.type === 'tool_call';
}

function isReasoningPart(part: MessagePart): part is ReasoningPart {
    return part.type === 'reasoning';
}

function isTextPart(part: MessagePart): part is TextPart {
    return part.type === 'text' || part.type === 'text_delta';
}

function isEventPart(part: MessagePart): part is EventPart {
    return part.type === 'event';
}

export function extractMessageText(parts?: MessagePart[], fallback = ''): string {
    const text = (parts || [])
        .filter(isTextPart)
        .map((part) => part.text)
        .join('');
    return text || fallback;
}

export function extractMessageThinking(parts?: MessagePart[], fallback?: string): string | undefined {
    const reasoning = (parts || [])
        .filter(isReasoningPart)
        .map((part) => part.text)
        .join('');
    return reasoning || fallback;
}

function extractToolCall(parts?: MessagePart[]): ToolCallPart | undefined {
    return (parts || []).find(isToolCallPart);
}

function extractEventPart(parts?: MessagePart[]): EventPart | undefined {
    return (parts || []).find(isEventPart);
}

function ensureToolParts(message: TimelineMessage): MessagePart[] | undefined {
    if (message.parts?.length) {
        return message.parts;
    }
    if (message.role !== 'tool_call') {
        return undefined;
    }
    return [{
        type: 'tool_call',
        name: message.toolName || '',
        args: message.toolArgs,
        status: message.toolStatus,
        result: message.toolResult,
        reasoning: message.thinking,
    }];
}

export function normalizeTimelineMessage(input: Record<string, unknown>): TimelineMessage {
    const parts = Array.isArray(input.parts) ? input.parts as MessagePart[] : undefined;
    const timestamp = (input.created_at as string | undefined) || (input.timestamp as string | undefined);
    const senderName = input.sender_name as string | undefined;
    const fileName = input.fileName as string | undefined;
    const imageUrl = input.imageUrl as string | undefined;

    if (input.role === 'event' || input.role === 'system') {
        const eventPart = extractEventPart(parts);
        return {
            role: 'event',
            content: (eventPart?.text || input.content || '') as string,
            eventType: (eventPart?.event_type || input.eventType) as 'permission' | 'session_compact' | 'pack_activation' | undefined,
            eventTitle: (eventPart?.title || input.eventTitle || '') as string,
            eventStatus: (eventPart?.status || input.eventStatus || 'info') as string,
            eventToolName: (eventPart?.tool_name || input.eventToolName || input.tool_name) as string | undefined,
            eventApprovalId: (eventPart?.approval_id || input.eventApprovalId || input.approval_id) as string | undefined,
            eventPacks: (eventPart?.packs || input.eventPacks || input.packs) as Array<Record<string, unknown>> | undefined,
            parts,
            timestamp,
            sender_name: senderName,
        };
    }

    if (input.role === 'tool_call') {
        const toolPart = extractToolCall(parts);
        const message: TimelineMessage = {
            role: 'tool_call',
            content: '',
            toolName: (toolPart?.name || input.toolName || '') as string,
            toolArgs: toolPart?.args ?? input.toolArgs,
            toolStatus: (toolPart?.status || input.toolStatus || 'done') as 'running' | 'done',
            toolResult: (toolPart?.result || input.toolResult || '') as string,
            thinking: (toolPart?.reasoning || input.thinking) as string | undefined,
            timestamp,
            sender_name: senderName,
        };
        message.parts = ensureToolParts(message);
        return message;
    }

    return {
        role: input.role === 'assistant' ? 'assistant' : 'user',
        content: extractMessageText(parts, (input.content || '') as string),
        thinking: extractMessageThinking(parts, input.thinking as string | undefined),
        ...(fileName ? { fileName } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        parts,
        timestamp,
        sender_name: senderName,
    };
}

function isImageFile(fileName: string): boolean {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext);
}

function parseUserFileMarker(message: TimelineMessage): TimelineMessage {
    if (message.role !== 'user') {
        return message;
    }

    const newFmt = message.content.match(/^\[file:([^\]]+)\]\n?/);
    if (newFmt) {
        return {
            ...message,
            fileName: newFmt[1],
            content: message.content.slice(newFmt[0].length).trim(),
        };
    }

    const chanFmt = message.content.match(/^\[文件已上传: (?:workspace\/uploads\/)?([^\]\n]+)\]/);
    if (chanFmt) {
        const raw = chanFmt[1];
        return {
            ...message,
            fileName: raw.split('/').pop() || raw,
            content: message.content.slice(chanFmt[0].length).trim(),
        };
    }

    const oldFmt = message.content.match(/^\[File: ([^\]]+)\]/);
    if (oldFmt) {
        const qMatch = message.content.match(/\nQuestion: ([\s\S]+)$/);
        return {
            ...message,
            fileName: oldFmt[1],
            content: qMatch ? qMatch[1].trim() : '',
        };
    }

    return message;
}

export function hydrateTimelineMessage(
    input: Record<string, unknown>,
    options: TimelineHydrateOptions = {},
): TimelineMessage {
    const normalized = parseUserFileMarker(normalizeTimelineMessage(input));
    if (normalized.fileName && !normalized.imageUrl && options.resolveImageUrl && isImageFile(normalized.fileName)) {
        return {
            ...normalized,
            imageUrl: options.resolveImageUrl(normalized.fileName),
        };
    }
    return normalized;
}

function appendReasoningPart(parts: MessagePart[] | undefined, text: string): MessagePart[] {
    const next = [...(parts || [])];
    const last = next[next.length - 1];
    if (last && last.type === 'reasoning') {
        next[next.length - 1] = { ...last, text: last.text + text };
        return next;
    }
    next.push({ type: 'reasoning', text });
    return next;
}

function appendTextPart(parts: MessagePart[] | undefined, text: string): MessagePart[] {
    const next = [...(parts || [])];
    const last = next[next.length - 1];
    if (last && isTextPart(last)) {
        next[next.length - 1] = { ...last, text: last.text + text };
        return next;
    }
    next.push({ type: 'text', text });
    return next;
}

export function applyStreamEvent(
    messages: TimelineMessage[],
    event: Record<string, unknown>,
    timestamp: string,
): TimelineMessage[] {
    const next = [...messages];

    if (event.type === 'thinking') {
        const delta = ((event.part as MessagePart | undefined) && 'text' in (event.part as MessagePart)
            ? (event.part as ReasoningPart).text
            : (event.content as string)) || '';
        const last = next[next.length - 1];
        if (last && last.role === 'assistant' && last._streaming) {
            return [
                ...next.slice(0, -1),
                {
                    ...last,
                    thinking: (last.thinking || '') + delta,
                    parts: appendReasoningPart(last.parts, delta),
                },
            ];
        }
        return [...next, {
            role: 'assistant',
            content: '',
            thinking: delta,
            parts: [{ type: 'reasoning', text: delta }],
            timestamp,
            _streaming: true,
        }];
    }

    if (event.type === 'chunk') {
        const delta = ((event.part as MessagePart | undefined) && 'text' in (event.part as MessagePart)
            ? (event.part as TextPart).text
            : (event.content as string)) || '';
        const last = next[next.length - 1];
        if (last && last.role === 'assistant' && last._streaming) {
            return [
                ...next.slice(0, -1),
                {
                    ...last,
                    content: last.content + delta,
                    parts: appendTextPart(last.parts, delta),
                },
            ];
        }
        return [...next, {
            role: 'assistant',
            content: delta,
            parts: [{ type: 'text', text: delta }],
            timestamp,
            _streaming: true,
        }];
    }

    if (event.type === 'tool_call') {
        const toolMessage = normalizeTimelineMessage({
            role: 'tool_call',
            toolName: event.name,
            toolArgs: event.args,
            toolStatus: event.status,
            toolResult: event.result,
            thinking: event.reasoning_content,
            parts: event.part ? [event.part] : undefined,
            created_at: timestamp,
        });
        const last = next[next.length - 1];
        if (
            toolMessage.toolStatus === 'done'
            && last?.role === 'tool_call'
            && last.toolName === toolMessage.toolName
            && last.toolStatus === 'running'
        ) {
            return [...next.slice(0, -1), toolMessage];
        }
        return [...next, toolMessage];
    }

    if (event.type === 'done') {
        const assistantMessage = normalizeTimelineMessage({
            role: (event.role || 'assistant') as string,
            content: event.content,
            thinking: event.thinking,
            parts: event.parts,
            created_at: timestamp,
        });
        const streamingIndex = [...next]
            .map((message, index) => ({ message, index }))
            .reverse()
            .find(({ message }) => message.role === 'assistant' && message._streaming)?.index;
        if (streamingIndex !== undefined) {
            return [
                ...next.slice(0, streamingIndex),
                { ...assistantMessage, _streaming: false },
                ...next.slice(streamingIndex + 1),
            ];
        }
        return [...next, { ...assistantMessage, _streaming: false }];
    }

    if (event.type === 'permission' || event.type === 'session_compact' || event.type === 'pack_activation') {
        return [...next, normalizeTimelineMessage({
            role: 'event',
            content: event.message || event.summary || '',
            eventType: event.type,
            eventStatus: event.status,
            eventToolName: event.tool_name,
            eventApprovalId: event.approval_id,
            eventPacks: event.packs as Array<Record<string, unknown>> | undefined,
            parts: event.part ? [event.part as MessagePart] : undefined,
            created_at: timestamp,
        })];
    }

    if (typeof event.role === 'string') {
        return [...next, normalizeTimelineMessage({ ...event, created_at: timestamp })];
    }

    return next;
}
