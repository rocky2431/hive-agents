import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import MarkdownRenderer from '../components/MarkdownRenderer';
import { applyStreamEvent, hydrateTimelineMessage, type TimelineMessage } from '../lib/chatParts.ts';
import { agentApi, chatApi, enterpriseApi } from '../services/api';
import { useAuthStore } from '../stores';
import type { ChatAttachment } from '../types';

/* ── Inline SVG Icons ── */
const Icons = {
    bot: (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="12" height="10" rx="2" />
            <circle cx="7" cy="10" r="1" fill="currentColor" stroke="none" />
            <circle cx="11" cy="10" r="1" fill="currentColor" stroke="none" />
            <path d="M9 2v3M6 2h6" />
        </svg>
    ),
    user: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="5.5" r="2.5" />
            <path d="M3 14v-1a4 4 0 018 0v1" />
        </svg>
    ),
    chat: (
        <svg width="28" height="28" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z" />
            <path d="M5 5.5h6M5 8h4" />
        </svg>
    ),
    clip: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13.5 7l-5.8 5.8a3 3 0 01-4.2-4.2L9.3 2.8a2 2 0 012.8 2.8L6.3 11.4a1 1 0 01-1.4-1.4L10.7 4.2" />
        </svg>
    ),
    loader: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M8 2v3M8 11v3M3.8 3.8l2.1 2.1M10.1 10.1l2.1 2.1M2 8h3M11 8h3M3.8 12.2l2.1-2.1M10.1 5.9l2.1-2.1" />
        </svg>
    ),
    tool: (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.5 10.5L14 14M4.5 2a2.5 2.5 0 00-1.8 4.2l5.1 5.1A2.5 2.5 0 1012 7.2L6.8 2.2A2.5 2.5 0 004.5 2z" />
        </svg>
    ),
};

function getEventPresentation(msg: TimelineMessage) {
    if (msg.eventType === 'permission') {
        return {
            icon: '🔒',
            title: msg.eventTitle || 'Permission Gate',
            background: 'rgba(245, 158, 11, 0.10)',
        };
    }
    if (msg.eventType === 'pack_activation') {
        return {
            icon: '🧰',
            title: msg.eventTitle || 'Capability Packs Activated',
            background: 'rgba(59, 130, 246, 0.10)',
        };
    }
    return {
        icon: '🗜️',
        title: msg.eventTitle || 'Context Compacted',
        background: 'var(--bg-secondary)',
    };
}

export default function Chat() {
    const { t } = useTranslation();
    const { id } = useParams<{ id: string }>();
    const token = useAuthStore((s) => s.token);
    const [messages, setMessages] = useState<TimelineMessage[]>([]);
    const [input, setInput] = useState('');
    const [connected, setConnected] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [streaming, setStreaming] = useState(false);
    const [isWaiting, setIsWaiting] = useState(false);
    const [attachedFile, setAttachedFile] = useState<ChatAttachment | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { data: agent } = useQuery({
        queryKey: ['agent', id],
        queryFn: () => agentApi.get(id!),
        enabled: !!id,
    });

    const { data: llmModels = [] } = useQuery({
        queryKey: ['llm-models'],
        queryFn: () => enterpriseApi.llmModels(),
        enabled: !!agent?.primary_model_id,
    });

    const supportsVision = !!agent?.primary_model_id && llmModels.some(
        (m: any) => m.id === agent.primary_model_id && m.supports_vision
    );

    const resolveHistoryImageUrl = (fileName: string) => {
        if (!id || !token) return undefined;
        return `/api/v1/agents/${id}/files/download?path=workspace/uploads/${encodeURIComponent(fileName)}&token=${token}`;
    };

    // Load chat history on mount
    useEffect(() => {
        if (!id || !token) return;
        chatApi.history(id)
            .then((history: any[]) => {
                if (history.length > 0) {
                    setMessages(history.map((entry) => hydrateTimelineMessage(entry, {
                        resolveImageUrl: resolveHistoryImageUrl,
                    })));
                }
            })
            .catch(() => { /* ignore */ });
    }, [id, token]);

    useEffect(() => {
        if (!id || !token) return;

        let cancelled = false;

        const connect = () => {
            if (cancelled) return;
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws/chat/${id}?token=${token}`;
            const ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                if (cancelled) {
                    ws.close();
                    return;
                }
                setConnected(true);
                wsRef.current = ws;
            };
            ws.onclose = () => {
                if (!cancelled) {
                    setConnected(false);
                    setTimeout(() => connect(), 2000);
                }
            };
            ws.onerror = () => {
                if (!cancelled) setConnected(false);
            };
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (['thinking', 'chunk', 'tool_call', 'done', 'error', 'quota_exceeded'].includes(data.type)) {
                    setIsWaiting(false);
                }
                if (['thinking', 'chunk', 'tool_call'].includes(data.type)) {
                    setStreaming(true);
                }
                if (['done', 'error', 'quota_exceeded'].includes(data.type)) {
                    setStreaming(false);
                }

                if (['thinking', 'chunk', 'tool_call', 'done'].includes(data.type)) {
                    setMessages((prev) => applyStreamEvent(prev, data, new Date().toISOString()));
                } else if (data.type === 'error' || data.type === 'quota_exceeded') {
                    const content = data.content || data.detail || data.message || 'Request denied';
                    setMessages((prev) => [...prev, {
                        role: 'assistant',
                        content: `⚠️ ${content}`,
                        timestamp: new Date().toISOString(),
                    }]);
                } else {
                    // Legacy format: {role, content}
                    setMessages((prev) => [...prev, hydrateTimelineMessage({
                        ...data,
                        created_at: new Date().toISOString(),
                    }, {
                        resolveImageUrl: resolveHistoryImageUrl,
                    })]);
                }
            };
        };

        connect();

        return () => {
            cancelled = true;
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [id, token]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        try {
            const { promise } = chatApi.uploadAttachment(file, id);
            const data = await promise;
            setAttachedFile(data);
        } catch (err) {
            alert(t('agent.upload.failed') + ': ' + (err as Error).message);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const sendMessage = () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (!input.trim() && !attachedFile) return;

        // Reset streaming state for new response
        setIsWaiting(true);
        setStreaming(true);

        let userMsg = input.trim();
        let contentForLLM = userMsg;

        if (attachedFile) {
            if (attachedFile.imageUrl && supportsVision) {
                // Vision model — embed image data marker for direct analysis
                const imageMarker = `[image_data:${attachedFile.imageUrl}]`;
                contentForLLM = userMsg
                    ? `${imageMarker}\n${userMsg}`
                    : `${imageMarker}\n${t('chat.analyzeImage')}`;
                userMsg = userMsg || `${t('chat.imageLabel')} ${attachedFile.name}`;
            } else if (attachedFile.imageUrl) {
                // Non-vision model — just reference the file path
                const wsPath = attachedFile.path || '';
                contentForLLM = userMsg
                    ? `[${t('chat.imageUploaded', 'Image uploaded')}: ${attachedFile.name}, ${t('chat.savedAt', 'saved at')} ${wsPath}]\n\n${userMsg}`
                    : `[${t('chat.imageUploaded', 'Image uploaded')}: ${attachedFile.name}, ${t('chat.savedAt', 'saved at')} ${wsPath}]\n${t('chat.analyzeImageFile', 'Please describe or process this image file. You can use the read_document tool to read it.')}`;
                userMsg = userMsg || `${t('chat.imageLabel')} ${attachedFile.name}`;
            } else {
                const wsPath = attachedFile.path || '';
                const codePath = wsPath.replace(/^workspace\//, '');
                const fileLoc = wsPath ? `\nFile location: ${wsPath} (for read_file/read_document tools)\nIn execute_code, use relative path: "${codePath}" (working directory is workspace/)` : '';
                const fileContext = `${t('chat.fileLabel')} ${attachedFile.name}]${fileLoc}\n\n${attachedFile.text}`;
                contentForLLM = userMsg
                    ? `${fileContext}\n\n${t('chat.userQuestion')} ${userMsg}`
                    : `${t('chat.analyzeFileContent', 'Please read and analyze the following file content')}:\n\n${fileContext}`;
                userMsg = userMsg || `[${t('agent.chat.attachment')}] ${attachedFile.name}`;
            }
        }

        setMessages((prev) => [...prev, {
            role: 'user',
            content: userMsg,
            fileName: attachedFile?.name,
            imageUrl: attachedFile?.imageUrl,
            timestamp: new Date().toISOString(),
        }]);
        wsRef.current.send(JSON.stringify({ content: contentForLLM, display_content: userMsg, file_name: attachedFile?.name || '' }));
        setInput('');
        setAttachedFile(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            sendMessage();
        }
    };

    return (
        <div>
            <div className="page-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-md)', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
                        {Icons.bot}
                    </div>
                    <div>
                        <h1 className="page-title" style={{ fontSize: '18px' }}>{agent?.name || '...'}</h1>
                        <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span className={`status-dot ${connected ? 'running' : 'stopped'}`} />
                            <span style={{ color: 'var(--text-tertiary)' }}>{connected ? t('agent.chat.connected') : t('agent.chat.disconnected')}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="chat-container">
                <div className="chat-messages">
                    {messages.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-tertiary)' }}>
                            <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>{Icons.chat}</div>
                            <div>{t('agent.chat.startConversation', { name: agent?.name || t('nav.newAgent') })}</div>
                            <div style={{ fontSize: '12px', marginTop: '8px', opacity: 0.7 }}>{t('agent.chat.fileSupport')}</div>
                        </div>
                    )}
                    {messages.map((msg, i) => (
                        <div key={i} className={`chat-message ${msg.role === 'user' ? 'user' : 'assistant'}`}>
                            <div className="chat-avatar" style={{ color: 'var(--text-tertiary)' }}>
                                {msg.role === 'user' ? Icons.user : msg.role === 'tool_call' ? Icons.tool : Icons.bot}
                            </div>
                            <div className="chat-bubble">
                                {msg.role === 'event' && (
                                    (() => {
                                        const eventUi = getEventPresentation(msg);
                                        return (
                                    <div style={{
                                        marginBottom: '8px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--border-subtle)',
                                        background: eventUi.background,
                                        padding: '10px 12px',
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                            <span style={{ fontSize: '13px' }}>{eventUi.icon}</span>
                                            <span style={{ fontSize: '12px', fontWeight: 600 }}>{eventUi.title}</span>
                                            {msg.eventStatus && (
                                                <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                                                    {msg.eventStatus.replace(/_/g, ' ')}
                                                </span>
                                            )}
                                        </div>
                                        {msg.eventToolName && (
                                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px', fontFamily: 'var(--font-mono)' }}>
                                                {msg.eventToolName}
                                            </div>
                                        )}
                                        <div style={{ fontSize: '12px', lineHeight: '1.6', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                            {msg.content}
                                        </div>
                                        {msg.eventPacks && msg.eventPacks.length > 0 && (
                                            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                {msg.eventPacks.map((pack, packIndex) => {
                                                    const packName = typeof pack.name === 'string' ? pack.name : 'unknown_pack';
                                                    const packSummary = typeof pack.summary === 'string' ? pack.summary : '';
                                                    const packTools = Array.isArray(pack.tools) ? pack.tools.map((tool) => String(tool)).join(', ') : '';
                                                    return (
                                                        <div key={packIndex} style={{ fontSize: '11px', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px' }}>
                                                            <div style={{ fontWeight: 600 }}>{packName}</div>
                                                            {packSummary && <div style={{ marginTop: '2px' }}>{packSummary}</div>}
                                                            {packTools && (
                                                                <div style={{ marginTop: '4px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                                                                    {packTools}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        {msg.eventApprovalId && (
                                            <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                                                Approval ID: {msg.eventApprovalId}
                                            </div>
                                        )}
                                    </div>
                                        );
                                    })()
                                )}
                                {msg.fileName && (() => {
                                    const fe = msg.fileName!.split('.').pop()?.toLowerCase() ?? '';
                                    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(fe);
                                    if (isImage && msg.imageUrl) {
                                        return (<div style={{ marginBottom: '4px' }}>
                                            <img src={msg.imageUrl} alt={msg.fileName} style={{ maxWidth: '240px', maxHeight: '180px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }} />
                                        </div>);
                                    }
                                    const fi = fe === 'pdf' ? '\uD83D\uDCC4' : (fe === 'csv' || fe === 'xlsx' || fe === 'xls') ? '\uD83D\uDCCA' : (fe === 'docx' || fe === 'doc') ? '\uD83D\uDCDD' : '\uD83D\uDCCE';
                                    return (<div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'rgba(0,0,0,0.08)', borderRadius: '6px', padding: '4px 8px', marginBottom: msg.content ? '4px' : '0', fontSize: '11px', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}><span>{fi}</span><span style={{ fontWeight: 500, color: 'var(--text-primary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.fileName}</span></div>);
                                })()}
                                {msg.thinking && (
                                    <details style={{
                                        marginBottom: '8px', fontSize: '12px',
                                        background: 'rgba(147, 130, 220, 0.08)', borderRadius: '6px',
                                        border: '1px solid rgba(147, 130, 220, 0.15)',
                                    }}>
                                        <summary style={{
                                            padding: '6px 10px', cursor: 'pointer',
                                            color: 'rgba(147, 130, 220, 0.9)', fontWeight: 500,
                                            userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px',
                                        }}>
                                            💭 Thinking
                                        </summary>
                                        <div style={{
                                            padding: '4px 10px 8px',
                                            fontSize: '12px', lineHeight: '1.6',
                                            color: 'var(--text-secondary)',
                                            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                            maxHeight: '300px', overflow: 'auto',
                                        }}>
                                            {msg.thinking}
                                        </div>
                                    </details>
                                )}
                                {msg.role === 'tool_call' ? (
                                    <details style={{
                                        fontSize: '12px',
                                        background: 'var(--accent-subtle)', borderRadius: '6px',
                                        border: '1px solid var(--accent-subtle)',
                                        overflow: 'hidden',
                                    }}>
                                        <summary style={{
                                            padding: '6px 10px', cursor: 'pointer',
                                            color: 'var(--accent-text)', fontWeight: 500, userSelect: 'none',
                                            display: 'flex', alignItems: 'center', gap: '6px',
                                        }}>
                                            <span style={{ display: 'flex' }}>{msg.toolStatus === 'running' ? Icons.loader : Icons.tool}</span>
                                            <span>{msg.toolName || 'tool'}</span>
                                            {msg.toolStatus === 'running' && (
                                                <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', fontSize: '11px' }}>
                                                    {t('common.loading')}
                                                </span>
                                            )}
                                        </summary>
                                        <div style={{ padding: '4px 10px 8px' }}>
                                            {msg.toolArgs !== undefined && (
                                                <div style={{
                                                    fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)',
                                                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                                }}>
                                                    {typeof msg.toolArgs === 'string' ? msg.toolArgs : JSON.stringify(msg.toolArgs, null, 2)}
                                                </div>
                                            )}
                                            {msg.toolResult && (
                                                <div style={{
                                                    marginTop: '6px', fontSize: '11px', color: 'var(--text-secondary)',
                                                    fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                                    maxHeight: '120px', overflow: 'auto',
                                                }}>
                                                    {msg.toolResult}
                                                </div>
                                            )}
                                        </div>
                                    </details>
                                ) : msg.role === 'assistant' ? (
                                    streaming && !msg.content && i === messages.length - 1 ? (
                                        <div className="thinking-indicator">
                                            <div className="thinking-dots">
                                                <span /><span /><span />
                                            </div>
                                            <span style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>{t('agent.chat.thinking', 'Thinking...')}</span>
                                        </div>
                                    ) : (
                                        <MarkdownRenderer content={msg.content} />
                                    )
                                ) : msg.role === 'event' ? null : (
                                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                                )}
                                {msg.timestamp && (
                                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px', opacity: 0.7 }}>
                                        {new Date(msg.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {(isWaiting || (streaming && (messages.length === 0 || messages[messages.length - 1].role === 'user'))) && (
                        <div className="chat-message assistant">
                            <div className="chat-avatar" style={{ color: 'var(--text-tertiary)' }}>
                                {Icons.bot}
                            </div>
                            <div className="chat-bubble">
                                <div className="thinking-indicator">
                                    <div className="thinking-dots">
                                        <span /><span /><span />
                                    </div>
                                    <span style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>{t('agent.chat.thinking', 'Thinking...')}</span>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {attachedFile && (
                    <div style={{
                        padding: '6px 12px',
                        background: 'var(--bg-elevated)',
                        borderTop: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '12px',
                    }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {attachedFile.imageUrl ? (
                                <img src={attachedFile.imageUrl} alt={attachedFile.name} style={{ width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover' }} />
                            ) : (
                                <span style={{ display: 'flex' }}>{Icons.clip}</span>
                            )}
                            {attachedFile.name}
                        </span>
                        <button
                            onClick={() => setAttachedFile(null)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: '14px' }}
                        >✕</button>
                    </div>
                )}

                <div className="chat-input-area">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}

                    />
                    <button
                        className="btn btn-secondary"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!connected || uploading || isWaiting || streaming}
                        style={{ padding: '8px 12px', fontSize: '16px', minWidth: 'auto' }}
                        title={t('agent.workspace.uploadFile')}
                    >
                        {uploading ? Icons.loader : Icons.clip}
                    </button>
                    <input
                        className="chat-input"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={attachedFile ? t('agent.chat.askAboutFile', { name: attachedFile.name }) : t('chat.placeholder')}
                        disabled={!connected || isWaiting || streaming}
                    />
                    {(streaming || isWaiting) ? (
                        <button className="btn btn-stop-generation" onClick={() => { if (wsRef.current?.readyState === WebSocket.OPEN) { wsRef.current.send(JSON.stringify({ type: 'abort' })); setStreaming(false); setIsWaiting(false); } }} title={t('chat.stop', 'Stop')}>
                            <span className="stop-icon" />
                        </button>
                    ) : (
                        <button className="btn btn-primary" onClick={sendMessage} disabled={!connected || (!input.trim() && !attachedFile)}>
                            {t('chat.send')}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
