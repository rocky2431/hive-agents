import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { agentApi } from '../api/domains/agents';
import { chatApi, type ChatSession } from '../api/domains/chat';
import { useAuthStore } from '../stores';
import MarkdownRenderer from '../components/MarkdownRenderer';

type ChatMessage = {
    role: 'user' | 'assistant' | 'system';
    content: string;
    thinking?: string;
    toolName?: string;
    toolStatus?: 'running' | 'done';
    toolResult?: string;
};

export default function AgentCreate() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const token = useAuthStore((s) => s.token);

    // HR Agent state
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [loadError, setLoadError] = useState('');

    // Chat state
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [wsConnected, setWsConnected] = useState(false);
    const [isWaiting, setIsWaiting] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Fetch HR agent
    const { data: hrAgent, isLoading: hrLoading } = useQuery({
        queryKey: ['hr-agent'],
        queryFn: () => agentApi.getHrAgent(),
        retry: 1,
    });
    const hrAgentId = hrAgent?.id ?? null;

    // Load session list
    useEffect(() => {
        if (!hrAgentId) return;
        chatApi.listSessions(hrAgentId).then((list) => {
            setSessions(list);
            if (!sessionId) {
                if (list.length > 0) {
                    // Resume most recent session
                    selectSession(list[0].id);
                } else {
                    // First visit — auto-create a session
                    chatApi.createSession(hrAgentId!).then((sess) => {
                        setSessions([sess]);
                        selectSession(sess.id);
                    }).catch(() => {});
                }
            }
        }).catch(() => {});
    }, [hrAgentId]);

    // Load messages for a session
    const selectSession = useCallback(async (sid: string) => {
        if (!hrAgentId || sid === sessionId) return;
        setSessionId(sid);
        setMessages([]);
        setCreatedAgentId(null);
        setWsConnected(false);
        setIsWaiting(false);
        setIsStreaming(false);

        try {
            const history = await chatApi.getSessionMessages(hrAgentId, sid);
            const restored: ChatMessage[] = [];
            for (const m of history) {
                const role = (m as any).role;
                if (role === 'user' || role === 'assistant') {
                    restored.push({ role: role as 'user' | 'assistant', content: m.content || '' });
                } else if (role === 'tool_call') {
                    try {
                        const tc = JSON.parse(m.content || '{}');
                        restored.push({
                            role: 'assistant',
                            content: '',
                            toolName: tc.name || 'unknown',
                            toolStatus: 'done',
                            toolResult: (tc.result || '').slice(0, 500),
                        });
                    } catch { /* skip malformed */ }
                }
            }
            setMessages(restored);
        } catch {
            // Session might be empty — that's fine
        }
    }, [hrAgentId, sessionId]);

    // Create new session
    const createNewSession = useCallback(async () => {
        if (!hrAgentId) return;
        try {
            const sess = await chatApi.createSession(hrAgentId);
            setSessions((prev) => [sess, ...prev]);
            selectSession(sess.id);
        } catch (err: any) {
            setLoadError(err.message || 'Failed to create session');
        }
    }, [hrAgentId, selectSession]);

    // WebSocket connection
    useEffect(() => {
        if (!hrAgentId || !sessionId || !token) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(
            `${protocol}//${window.location.host}/ws/chat/${hrAgentId}?token=${token}&session_id=${sessionId}`
        );
        wsRef.current = ws;

        ws.onopen = () => {
            if (wsRef.current === ws) setWsConnected(true);
        };
        ws.onclose = () => {
            // Only clear state if this is still the active WebSocket
            // (prevents old WS onclose from destroying new WS reference)
            if (wsRef.current === ws) {
                setWsConnected(false);
                wsRef.current = null;
            }
        };
        ws.onerror = () => {
            if (wsRef.current === ws) setWsConnected(false);
        };

        ws.onmessage = (e) => {
            let d: any;
            try { d = JSON.parse(e.data); } catch { return; }

            if (d.type === 'chunk') {
                setIsWaiting(false);
                setIsStreaming(true);
                setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.role === 'assistant' && !last.toolName) {
                        return [...prev.slice(0, -1), { ...last, content: last.content + d.content }];
                    }
                    return [...prev, { role: 'assistant', content: d.content }];
                });
            } else if (d.type === 'thinking') {
                setIsWaiting(false);
                setIsStreaming(true);
                // Accumulate thinking into the current assistant message
                setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.role === 'assistant' && !last.toolName) {
                        return [...prev.slice(0, -1), { ...last, thinking: (last.thinking || '') + d.content }];
                    }
                    return [...prev, { role: 'assistant', content: '', thinking: d.content }];
                });
            } else if (d.type === 'tool_call') {
                setIsWaiting(false);
                setIsStreaming(true);
                // Display tool call as a message
                setMessages((prev) => {
                    const existing = prev.findIndex(
                        (m) => m.toolName === d.name && m.toolStatus === 'running'
                    );
                    if (d.status === 'done' && existing >= 0) {
                        // Update running → done
                        const updated = [...prev];
                        updated[existing] = {
                            ...updated[existing],
                            toolStatus: 'done',
                            toolResult: d.result?.slice(0, 500) || '',
                        };
                        return updated;
                    }
                    if (d.status === 'running') {
                        return [...prev, {
                            role: 'assistant',
                            content: '',
                            toolName: d.name,
                            toolStatus: 'running',
                            toolArgs: d.args,
                        }];
                    }
                    return prev;
                });
                // Detect agent creation success
                if (d.name === 'create_digital_employee' && d.status === 'done' && d.result) {
                    const idMatch = d.result.match(/ID:\s*([0-9a-f-]{36})/i);
                    if (idMatch) {
                        setCreatedAgentId(idMatch[1]);
                    }
                }
            } else if (d.type === 'done' || d.type === 'error') {
                setIsWaiting(false);
                setIsStreaming(false);
                if (d.type === 'error' && d.message) {
                    setMessages((prev) => [...prev, { role: 'system', content: d.message }]);
                }
            }
        };

        return () => {
            ws.close();
            wsRef.current = null;
        };
    }, [hrAgentId, sessionId, token]);

    // Auto-scroll
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isWaiting]);

    const sendMessage = useCallback((text?: string) => {
        const msg = (text || input).trim();
        if (!msg || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        setMessages((prev) => [...prev, { role: 'user', content: msg }]);
        wsRef.current.send(JSON.stringify({ type: 'chat', content: msg }));
        setInput('');
        setIsWaiting(true);
        inputRef.current?.focus();
    }, [input]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const suggestions = [
        { icon: '\uD83D\uDD2C', label: t('wizard.templates.Market Researcher', '\u5e02\u573a\u7814\u7a76\u5458'), prompt: t('hrChat.suggestResearcher', '\u6211\u60f3\u8981\u4e00\u4e2a\u5e02\u573a\u7814\u7a76\u5458\uff0c\u5e2e\u6211\u641c\u96c6\u884c\u4e1a\u65b0\u95fb\u548c\u7ade\u54c1\u52a8\u6001') },
        { icon: '\uD83D\uDCCB', label: t('wizard.templates.Project Manager', '\u9879\u76ee\u7ecf\u7406'), prompt: t('hrChat.suggestPM', '\u6211\u9700\u8981\u4e00\u4e2a\u9879\u76ee\u7ecf\u7406\u52a9\u624b\uff0c\u5e2e\u6211\u8ddf\u8e2a\u4efb\u52a1\u8fdb\u5ea6\u548c\u534f\u8c03\u56e2\u961f') },
        { icon: '\uD83C\uDFA8', label: t('hrChat.contentCreator', '\u5185\u5bb9\u521b\u4f5c'), prompt: t('hrChat.suggestContent', '\u6211\u60f3\u8981\u4e00\u4e2a\u5185\u5bb9\u521b\u4f5c\u52a9\u624b\uff0c\u5e2e\u6211\u5199\u8425\u9500\u6587\u6848\u548c\u793e\u4ea4\u5a92\u4f53\u5185\u5bb9') },
        { icon: '\uD83D\uDC69\u200D\uD83D\uDCBB', label: t('hrChat.customerService', '\u5ba2\u6237\u670d\u52a1'), prompt: t('hrChat.suggestCS', '\u6211\u9700\u8981\u4e00\u4e2a\u5ba2\u670d\u52a9\u624b\uff0c\u5e2e\u6211\u56de\u590d\u5ba2\u6237\u54a8\u8be2\u548c\u5904\u7406\u552e\u540e\u95ee\u9898') },
    ];

    if (hrLoading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <div className="spinner" style={{ margin: '0 auto 12px' }} />
                    <p>{t('hrChat.loading', 'Loading HR agent...')}</p>
                </div>
            </div>
        );
    }

    if (loadError) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
                <div style={{ textAlign: 'center', color: 'var(--error)' }}>
                    <p>{loadError}</p>
                    <button className="btn btn-primary" style={{ marginTop: '12px' }} onClick={() => window.location.reload()}>
                        {t('common.retry', 'Retry')}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', height: 'calc(100vh - 64px)' }}>
            {/* Session Sidebar */}
            <div style={{
                width: '220px', flexShrink: 0, borderRight: '1px solid var(--border-default)',
                display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)',
            }}>
                <div style={{ padding: '16px 12px 8px', flexShrink: 0 }}>
                    <h2 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 10px' }}>
                        {t('hrChat.sessions', 'Sessions')}
                    </h2>
                    <button
                        className="btn btn-secondary"
                        style={{ width: '100%', fontSize: '12px', padding: '6px 10px' }}
                        onClick={createNewSession}
                    >
                        + {t('hrChat.newSession', 'New Session')}
                    </button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
                    {sessions.map((s) => (
                        <div
                            key={s.id}
                            onClick={() => selectSession(s.id)}
                            style={{
                                padding: '8px 10px', borderRadius: '6px', cursor: 'pointer',
                                marginBottom: '2px', fontSize: '12px', lineHeight: 1.4,
                                background: s.id === sessionId ? 'var(--accent-subtle)' : 'transparent',
                                border: s.id === sessionId ? '1px solid var(--accent-primary)' : '1px solid transparent',
                                color: s.id === sessionId ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                        >
                            <div style={{ fontWeight: s.id === sessionId ? 600 : 400 }}>
                                {s.title || 'New Session'}
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                {new Date(s.created_at).toLocaleDateString()}
                            </div>
                        </div>
                    ))}
                    {sessions.length === 0 && (
                        <div style={{ padding: '16px 8px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '12px' }}>
                            {t('hrChat.noSessions', 'No sessions yet')}
                        </div>
                    )}
                </div>
            </div>

            {/* Main Chat Area */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: '780px', margin: '0 auto', padding: '0 16px' }}>
                {/* Header */}
                <div style={{ padding: '16px 0 8px', flexShrink: 0 }}>
                    <h1 className="page-title" style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>
                        {t('nav.newAgent', 'Create Digital Employee')}
                    </h1>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        {t('hrChat.subtitle', 'Tell the HR agent what kind of digital employee you need')}
                    </p>
                </div>

                {/* Chat Messages */}
                <div
                    ref={chatContainerRef}
                    style={{
                        flex: 1, overflowY: 'auto', padding: '12px 0',
                        display: 'flex', flexDirection: 'column', gap: '16px',
                    }}
                >
                    {/* Welcome / suggestions when empty */}
                    {messages.length === 0 && !sessionId && (
                        <div style={{ padding: '24px 0', textAlign: 'center' }}>
                            <div style={{ fontSize: '36px', marginBottom: '12px' }}>&#x1F464;</div>
                            <h3 style={{ fontWeight: 600, fontSize: '16px', marginBottom: '8px' }}>
                                {t('hrChat.welcome', 'Hi! I\'m the HR onboarding specialist.')}
                            </h3>
                            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', maxWidth: '480px', margin: '0 auto 24px', lineHeight: 1.6 }}>
                                {t('hrChat.welcomeDesc', 'Tell me what kind of digital employee you\'d like, and I\'ll help you create one through a simple conversation.')}
                            </p>
                        </div>
                    )}

                    {/* Suggestions at top of empty active session */}
                    {messages.length === 0 && sessionId && (
                        <div style={{ padding: '40px 0 16px', textAlign: 'center' }}>
                            <div style={{ fontSize: '36px', marginBottom: '12px' }}>&#x1F464;</div>
                            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                                {t('hrChat.welcomeDesc', 'Tell me what kind of digital employee you\'d like, and I\'ll help you create one through a simple conversation.')}
                            </p>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', maxWidth: '520px', margin: '0 auto' }}>
                                {suggestions.map((s) => (
                                    <button
                                        key={s.label}
                                        className="btn btn-ghost"
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '8px',
                                            padding: '12px 14px', borderRadius: '10px',
                                            border: '1px solid var(--border-default)',
                                            background: 'var(--bg-elevated)', textAlign: 'left',
                                            fontSize: '13px', lineHeight: 1.4, cursor: 'pointer',
                                        }}
                                        onClick={() => sendMessage(s.prompt)}
                                        disabled={!wsConnected}
                                    >
                                        <span style={{ fontSize: '20px', flexShrink: 0 }}>{s.icon}</span>
                                        <span>{s.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Messages */}
                    {messages.map((msg, i) => {
                        // Tool call message
                        if (msg.toolName) {
                            const isRunning = msg.toolStatus === 'running';
                            return (
                                <div key={i} style={{ paddingLeft: '4px' }}>
                                    <details style={{
                                        borderRadius: '8px', background: 'var(--accent-subtle)',
                                        border: '1px solid var(--accent-subtle)', fontSize: '12px', overflow: 'hidden',
                                    }}>
                                        <summary style={{
                                            padding: '6px 10px', cursor: 'pointer', display: 'flex',
                                            alignItems: 'center', gap: '6px', userSelect: 'none', listStyle: 'none',
                                        }}>
                                            <span style={{ fontSize: '13px' }}>{isRunning ? '\u23F3' : '\u26A1'}</span>
                                            <span style={{ fontWeight: 600, color: 'var(--accent-text)' }}>{msg.toolName}</span>
                                            {isRunning && <span style={{ color: 'var(--text-tertiary)', fontSize: '11px', marginLeft: 'auto' }}>{t('common.loading')}</span>}
                                        </summary>
                                        {msg.toolResult && (
                                            <div style={{ padding: '4px 10px 8px' }}>
                                                <div style={{
                                                    color: 'var(--text-secondary)', fontSize: '11px', fontFamily: 'var(--font-mono)',
                                                    whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '200px',
                                                    overflow: 'auto', background: 'rgba(0,0,0,0.08)', borderRadius: '4px', padding: '4px 6px',
                                                }}>{msg.toolResult}</div>
                                            </div>
                                        )}
                                    </details>
                                </div>
                            );
                        }

                        // Normal message (user / assistant / system)
                        return (
                            <div
                                key={i}
                                style={{
                                    display: 'flex',
                                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                                }}
                            >
                                <div
                                    style={{
                                        maxWidth: '85%',
                                        padding: '10px 14px',
                                        borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                                        background: msg.role === 'user'
                                            ? 'var(--accent-primary)'
                                            : msg.role === 'system'
                                                ? 'var(--error-subtle)'
                                                : 'var(--bg-elevated)',
                                        color: msg.role === 'user' ? '#fff' : msg.role === 'system' ? 'var(--error)' : 'var(--text-primary)',
                                        fontSize: '14px',
                                        lineHeight: 1.6,
                                        border: msg.role === 'assistant' ? '1px solid var(--border-default)' : 'none',
                                    }}
                                >
                                    {msg.thinking && (
                                        <details style={{ marginBottom: '6px', fontSize: '12px' }}>
                                            <summary style={{ cursor: 'pointer', color: 'var(--text-tertiary)', userSelect: 'none' }}>
                                                {t('chat.thinking', 'Thinking...')}
                                            </summary>
                                            <div style={{ color: 'var(--text-tertiary)', whiteSpace: 'pre-wrap', marginTop: '4px' }}>
                                                {msg.thinking}
                                            </div>
                                        </details>
                                    )}
                                    {msg.role === 'assistant' ? (
                                        <MarkdownRenderer content={msg.content} />
                                    ) : (
                                        <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {/* Waiting indicator */}
                    {isWaiting && (
                        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                            <div style={{
                                padding: '10px 14px', borderRadius: '14px 14px 14px 4px',
                                background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                                fontSize: '14px', color: 'var(--text-secondary)',
                            }}>
                                <span className="typing-dots">&#x2022;&#x2022;&#x2022;</span>
                            </div>
                        </div>
                    )}

                    {/* Created success card */}
                    {createdAgentId && (
                        <div style={{
                            padding: '20px', borderRadius: '12px',
                            background: 'var(--success-subtle, #f0fdf4)',
                            border: '1px solid var(--success, #22c55e)',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: '28px', marginBottom: '8px' }}>&#x2705;</div>
                            <h3 style={{ fontWeight: 600, fontSize: '15px', marginBottom: '8px' }}>
                                {t('hrChat.created', 'Digital employee created successfully!')}
                            </h3>
                            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                                {t('hrChat.createdDesc', 'You can now visit the detail page to further customize or start chatting.')}
                            </p>
                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                                <button className="btn btn-primary" onClick={() => navigate(`/agents/${createdAgentId}`)}>
                                    {t('hrChat.goToAgent', 'Go to Detail Page')}
                                </button>
                                <button className="btn btn-secondary" onClick={createNewSession}>
                                    {t('hrChat.createAnother', 'Create Another')}
                                </button>
                            </div>
                        </div>
                    )}

                    <div ref={chatEndRef} />
                </div>

                {/* Input Area */}
                <div style={{
                    flexShrink: 0, padding: '12px 0 20px',
                    borderTop: '1px solid var(--border-default)',
                }}>
                    {!wsConnected && sessionId && (
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '8px', textAlign: 'center' }}>
                            {t('hrChat.connecting', 'Connecting...')}
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                            ref={inputRef}
                            className="form-input"
                            style={{ flex: 1, fontSize: '14px', padding: '10px 14px', borderRadius: '12px' }}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={t('hrChat.inputPlaceholder', 'Describe the digital employee you want...')}
                            disabled={!wsConnected || isWaiting || isStreaming}
                            autoFocus
                        />
                        <button
                            className="btn btn-primary"
                            style={{ padding: '10px 20px', borderRadius: '12px', flexShrink: 0 }}
                            onClick={() => sendMessage()}
                            disabled={!wsConnected || !input.trim() || isWaiting || isStreaming}
                        >
                            {t('common.send', 'Send')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
