import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { AgentAvatar } from '@/components/domain/agent-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import { formatRelative } from '@/lib/date';
import { applyStreamEvent, hydrateTimelineMessage, type TimelineMessage } from '@/lib/chatParts.ts';
import { agentApi, chatApi, enterpriseApi } from '@/services/api';
import { useAuthStore } from '@/stores';
import type { ChatAttachment } from '@/types';

import { ChatIcons as Icons, getEventPresentation } from '@/components/chat/chat-icons';

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
                        content: `\u26A0\uFE0F ${content}`,
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
                const imageMarker = `[image_data:${attachedFile.imageUrl}]`;
                contentForLLM = userMsg
                    ? `${imageMarker}\n${userMsg}`
                    : `${imageMarker}\n${t('chat.analyzeImage')}`;
                userMsg = userMsg || `${t('chat.imageLabel')} ${attachedFile.name}`;
            } else if (attachedFile.imageUrl) {
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
                <div className="flex items-center gap-3">
                    <AgentAvatar name={agent?.name || '...'} size="md" />
                    <div>
                        <h1 className="page-title text-lg">{agent?.name || '...'}</h1>
                        <div className="flex items-center gap-1.5 text-xs">
                            <span className={`status-dot ${connected ? 'running' : 'stopped'}`} />
                            <span className="text-content-tertiary">
                                {connected ? t('agent.chat.connected') : t('agent.chat.disconnected')}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="chat-container">
                <div className="chat-messages">
                    {messages.length === 0 && (
                        <div className="text-center py-15 text-content-tertiary">
                            <div className="mb-3 flex justify-center">{Icons.chat}</div>
                            <div>{t('agent.chat.startConversation', { name: agent?.name || t('nav.newAgent') })}</div>
                            <div className="text-xs mt-2 opacity-70">{t('agent.chat.fileSupport')}</div>
                        </div>
                    )}
                    {messages.map((msg, i) => (
                        <div key={i} className={`chat-message ${msg.role === 'user' ? 'user' : 'assistant'}`}>
                            <div className="chat-avatar text-content-tertiary">
                                {msg.role === 'user' ? Icons.user : msg.role === 'tool_call' ? Icons.tool : Icons.bot}
                            </div>
                            <div className="chat-bubble">
                                {msg.role === 'event' && (() => {
                                    const ev = getEventPresentation(msg, t);
                                    return (
                                        <div className={`mb-2 rounded-lg border border-edge-subtle p-2.5 ${ev.bg}`}>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-[13px]">{ev.icon}</span>
                                                <span className="text-xs font-semibold">{ev.title}</span>
                                                {msg.eventStatus && (
                                                    <span className="ml-auto text-[10px] text-content-tertiary uppercase">
                                                        {msg.eventStatus.replace(/_/g, ' ')}
                                                    </span>
                                                )}
                                            </div>
                                            {msg.eventToolName && (
                                                <div className="text-[11px] text-content-tertiary mb-1 font-mono">
                                                    {msg.eventToolName}
                                                </div>
                                            )}
                                            <div className="text-xs leading-relaxed text-content-secondary whitespace-pre-wrap break-words">
                                                {msg.content}
                                            </div>
                                            {msg.eventPacks && msg.eventPacks.length > 0 && (
                                                <div className="mt-2 flex flex-col gap-1.5">
                                                    {msg.eventPacks.map((pack, packIndex) => {
                                                        const packName = typeof pack.name === 'string' ? pack.name : 'unknown_pack';
                                                        const packSummary = typeof pack.summary === 'string' ? pack.summary : '';
                                                        const packTools = Array.isArray(pack.tools) ? pack.tools.map((tool) => String(tool)).join(', ') : '';
                                                        return (
                                                            <div key={packIndex} className="text-[11px] text-content-secondary border-t border-edge-subtle pt-1.5">
                                                                <div className="font-semibold">{packName}</div>
                                                                {packSummary && <div className="mt-0.5">{packSummary}</div>}
                                                                {packTools && (
                                                                    <div className="mt-1 font-mono text-content-tertiary">
                                                                        {packTools}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                            {msg.eventApprovalId && (
                                                <div className="mt-1.5 text-[11px] text-content-tertiary font-mono">
                                                    Approval ID: {msg.eventApprovalId}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                                {msg.fileName && (() => {
                                    const fe = msg.fileName!.split('.').pop()?.toLowerCase() ?? '';
                                    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(fe);
                                    if (isImage && msg.imageUrl) {
                                        return (
                                            <div className="mb-1">
                                                <img
                                                    src={msg.imageUrl}
                                                    alt={msg.fileName}
                                                    className="max-w-60 max-h-45 rounded-lg border border-edge-subtle"
                                                />
                                            </div>
                                        );
                                    }
                                    const fi = fe === 'pdf' ? '\uD83D\uDCC4' : (fe === 'csv' || fe === 'xlsx' || fe === 'xls') ? '\uD83D\uDCCA' : (fe === 'docx' || fe === 'doc') ? '\uD83D\uDCDD' : '\uD83D\uDCCE';
                                    return (
                                        <Badge variant="secondary" className={`gap-1.5 rounded-md ${msg.content ? 'mb-1' : ''}`}>
                                            <span>{fi}</span>
                                            <span className="font-medium text-content-primary max-w-[200px] truncate">
                                                {msg.fileName}
                                            </span>
                                        </Badge>
                                    );
                                })()}
                                {msg.thinking && (
                                    <details className="mb-2 text-xs rounded-md border border-[rgba(147,130,220,0.15)] bg-[rgba(147,130,220,0.08)]">
                                        <summary className="px-2.5 py-1.5 cursor-pointer text-[rgba(147,130,220,0.9)] font-medium select-none flex items-center gap-1">
                                            {'\uD83D\uDCAD'} Thinking
                                        </summary>
                                        <div className="px-2.5 pt-1 pb-2 text-xs leading-relaxed text-content-secondary whitespace-pre-wrap break-words max-h-[300px] overflow-auto">
                                            {msg.thinking}
                                        </div>
                                    </details>
                                )}
                                {msg.role === 'tool_call' ? (
                                    <details className="text-xs rounded-md border border-accent-subtle bg-accent-subtle overflow-hidden">
                                        <summary className="px-2.5 py-1.5 cursor-pointer text-accent-text font-medium select-none flex items-center gap-1.5">
                                            <span className="flex">{msg.toolStatus === 'running' ? Icons.loader : Icons.tool}</span>
                                            <span>{msg.toolName || 'tool'}</span>
                                            {msg.toolStatus === 'running' && (
                                                <span className="ml-auto text-content-tertiary text-[11px]">
                                                    {t('common.loading')}
                                                </span>
                                            )}
                                        </summary>
                                        <div className="px-2.5 pt-1 pb-2">
                                            {msg.toolArgs !== undefined && (
                                                <div className="font-mono text-[11px] text-content-tertiary whitespace-pre-wrap break-all">
                                                    {typeof msg.toolArgs === 'string' ? msg.toolArgs : JSON.stringify(msg.toolArgs, null, 2)}
                                                </div>
                                            )}
                                            {msg.toolResult && (
                                                <div className="mt-1.5 text-[11px] text-content-secondary font-mono whitespace-pre-wrap break-all max-h-[120px] overflow-auto">
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
                                            <span className="text-content-tertiary text-[13px]">{t('agent.chat.thinking', 'Thinking...')}</span>
                                        </div>
                                    ) : (
                                        <MarkdownRenderer content={msg.content} />
                                    )
                                ) : msg.role === 'event' ? null : (
                                    <div className="whitespace-pre-wrap">{msg.content}</div>
                                )}
                                {msg.timestamp && (
                                    <div className="text-[10px] text-content-tertiary mt-1 opacity-70">
                                        {formatRelative(msg.timestamp)}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {(isWaiting || (streaming && (messages.length === 0 || messages[messages.length - 1].role === 'user'))) && (
                        <div className="chat-message assistant">
                            <div className="chat-avatar text-content-tertiary">
                                {Icons.bot}
                            </div>
                            <div className="chat-bubble">
                                <div className="thinking-indicator">
                                    <div className="thinking-dots">
                                        <span /><span /><span />
                                    </div>
                                    <span className="text-content-tertiary text-[13px]">{t('agent.chat.thinking', 'Thinking...')}</span>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {attachedFile && (
                    <div className="flex items-center justify-between px-3 py-1.5 text-xs bg-surface-elevated border-t border-edge-subtle">
                        <span className="flex items-center gap-1.5">
                            {attachedFile.imageUrl ? (
                                <img src={attachedFile.imageUrl} alt={attachedFile.name} className="w-8 h-8 rounded object-cover" />
                            ) : (
                                <span className="flex">{Icons.clip}</span>
                            )}
                            {attachedFile.name}
                        </span>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAttachedFile(null)}
                            className="text-content-tertiary text-sm"
                        >
                            {'\u2715'}
                        </Button>
                    </div>
                )}

                <div className="chat-input-area">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        className="hidden"
                    />
                    <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!connected || uploading || isWaiting || streaming}
                        aria-label={t('agent.workspace.uploadFile')}
                    >
                        {uploading ? Icons.loader : Icons.clip}
                    </Button>
                    <Input
                        className="flex-1 h-10 rounded-[10px] bg-surface-secondary"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={attachedFile ? t('agent.chat.askAboutFile', { name: attachedFile.name }) : t('chat.placeholder')}
                        disabled={!connected || isWaiting || streaming}
                    />
                    {(streaming || isWaiting) ? (
                        <button
                            className="btn-stop-generation"
                            onClick={() => {
                                if (wsRef.current?.readyState === WebSocket.OPEN) {
                                    wsRef.current.send(JSON.stringify({ type: 'abort' }));
                                    setStreaming(false);
                                    setIsWaiting(false);
                                }
                            }}
                            aria-label={t('chat.stop', 'Stop')}
                        >
                            <span className="stop-icon" />
                        </button>
                    ) : (
                        <Button
                            onClick={sendMessage}
                            disabled={!connected || (!input.trim() && !attachedFile)}
                            aria-label={t('chat.send')}
                        >
                            {t('chat.send')}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
