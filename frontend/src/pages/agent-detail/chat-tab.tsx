import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import MarkdownRenderer from '../../components/MarkdownRenderer';
import { applyStreamEvent, hydrateTimelineMessage, type TimelineMessage } from '../../lib/chatParts';
import { agentApi, chatApi, enterpriseApi } from '../../services/api';
import { useAuthStore } from '../../stores';
import type { ChatAttachment } from '../../types';

/* ── Helper: timeline event display ── */
const getTimelineEventPresentation = (msg: TimelineMessage) => {
    if (msg.eventType === 'permission') {
        return {
            icon: '\uD83D\uDD12',
            title: msg.eventTitle || 'Permission Gate',
            bgClass: 'bg-[rgba(245,158,11,0.10)]',
        };
    }
    if (msg.eventType === 'pack_activation') {
        return {
            icon: '\uD83E\uDDF0',
            title: msg.eventTitle || 'Capability Packs Activated',
            bgClass: 'bg-[rgba(59,130,246,0.10)]',
        };
    }
    return {
        icon: '\uD83D\uDDDC\uFE0F',
        title: msg.eventTitle || 'Context Compacted',
        bgClass: 'bg-surface-secondary',
    };
};

type ChatMsg = TimelineMessage;

export interface ChatTabProps {
    agentId: string;
    agent: any;
    canManage: boolean;
}

export function ChatTab({ agentId, agent, canManage }: ChatTabProps) {
    const { t, i18n } = useTranslation();
    const token = useAuthStore((s) => s.token);
    const currentUser = useAuthStore((s) => s.user);
    const isAdmin = currentUser?.role === 'platform_admin' || currentUser?.role === 'org_admin';

    /* ── LLM models query (for supportsVision check) ── */
    const { data: llmModels = [] } = useQuery({
        queryKey: ['llm-models'],
        queryFn: () => enterpriseApi.llmModels(),
    });

    const supportsVision = !!agent?.primary_model_id && llmModels.some(
        (m: any) => m.id === agent.primary_model_id && m.supports_vision,
    );

    /* ── Chat state ── */
    const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [wsConnected, setWsConnected] = useState(false);
    const [isWaiting, setIsWaiting] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(-1);
    const [attachedFiles, setAttachedFiles] = useState<ChatAttachment[]>([]);

    /* ── Session state ── */
    const [sessions, setSessions] = useState<any[]>([]);
    const [allSessions, setAllSessions] = useState<any[]>([]);
    const [activeSession, setActiveSession] = useState<any | null>(null);
    const [chatScope, setChatScope] = useState<'mine' | 'all'>('mine');
    const [allUserFilter, setAllUserFilter] = useState('');
    const [historyMsgs, setHistoryMsgs] = useState<any[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [agentExpired, setAgentExpired] = useState(false);

    /* ── Refs ── */
    const wsRef = useRef<WebSocket | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const chatInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadAbortRef = useRef<(() => void) | null>(null);
    const isNearBottom = useRef(true);
    const isFirstLoad = useRef(true);
    const historyContainerRef = useRef<HTMLDivElement>(null);

    /* ── Scroll state ── */
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [showHistoryScrollBtn, setShowHistoryScrollBtn] = useState(false);

    /* ── Helper: resolve image URL for history ── */
    const resolveHistoryImageUrl = (fileName: string) => {
        if (!agentId || !token) return undefined;
        return `/api/v1/agents/${agentId}/files/download?path=workspace/uploads/${encodeURIComponent(fileName)}&token=${token}`;
    };

    /* ── Helper: parse chat message ── */
    const parseChatMsg = (msg: Record<string, unknown>): ChatMsg => {
        return hydrateTimelineMessage(msg, {
            resolveImageUrl: resolveHistoryImageUrl,
        });
    };

    const hasToolArgs = (toolArgs: unknown): toolArgs is Record<string, unknown> => (
        typeof toolArgs === 'object'
        && toolArgs !== null
        && Object.keys(toolArgs).length > 0
    );

    const formatToolArgsSummary = (toolArgs: unknown) => {
        if (!hasToolArgs(toolArgs)) return '';
        return Object.entries(toolArgs)
            .map(([key, value]) => `${key}: ${typeof value === 'string' ? value.slice(0, 30) : JSON.stringify(value)}`)
            .join(', ');
    };

    const formatChatTimestamp = (value?: string) => {
        if (!value) return '';
        const d = new Date(value);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const isToday = d.toDateString() === now.toDateString();
        if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (diffMs < 7 * 86400000) {
            return `${d.toLocaleDateString([], { weekday: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        }
        return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    };

    /* ── Session fetch helpers ── */
    const fetchMySessions = async (silent = false) => {
        if (!agentId) return;
        if (!silent) setSessionsLoading(true);
        try {
            const data = await agentApi.sessions(agentId, 'mine');
            setSessions(data);
            return data;
        } catch { /* ignored */ }
        if (!silent) setSessionsLoading(false);
        return [];
    };

    const fetchAllSessions = async () => {
        if (!agentId) return;
        try {
            const all = await agentApi.sessions(agentId, 'all');
            setAllSessions(all.filter((s: any) => s.source_channel !== 'trigger'));
        } catch { /* ignored */ }
    };

    const createNewSession = async () => {
        try {
            const newSess = await agentApi.createSession(agentId);
            setSessions(prev => [newSess, ...prev]);
            setChatMessages([]);
            setHistoryMsgs([]);
            setActiveSession(newSess);
        } catch (err: any) {
            alert(`Failed to create session: ${err.message || err}`);
        }
    };

    const deleteSession = async (sessionId: string) => {
        if (!confirm(t('chat.deleteConfirm', 'Delete this session and all its messages? This cannot be undone.'))) return;
        try {
            await agentApi.deleteSession(agentId, sessionId);
            if (activeSession?.id === sessionId) {
                setActiveSession(null);
                setChatMessages([]);
                setHistoryMsgs([]);
            }
            const [mine, all] = await Promise.all([
                agentApi.sessions(agentId, 'mine').catch(() => []),
                agentApi.sessions(agentId, 'all').catch(() => []),
            ]);
            setSessions(mine);
            setAllSessions(all.filter((s: any) => s.source_channel !== 'trigger'));
        } catch (e: any) {
            alert(e.message || 'Delete failed');
        }
    };

    const selectSession = async (sess: any) => {
        setChatMessages([]);
        setHistoryMsgs([]);
        setActiveSession(sess);
        try {
            const msgs = await agentApi.getSessionMessages(agentId, sess.id);
            const normalizedMsgs = msgs.map((m: any) => (
                m.role === 'tool_result'
                    ? { ...m, timestamp: m.created_at || undefined }
                    : parseChatMsg(m)
            ));
            const isAgentSession = sess.source_channel === 'agent' || sess.participant_type === 'agent';
            if (!isAgentSession && sess.user_id === String(currentUser?.id)) {
                setChatMessages(normalizedMsgs.filter((m: any) => m.role !== 'tool_result'));
            } else {
                setHistoryMsgs(normalizedMsgs);
            }
        } catch { /* session messages load failed silently */ }
    };

    /* ── Reset state on agent change ── */
    useEffect(() => {
        setActiveSession(null);
        setChatMessages([]);
        setHistoryMsgs([]);
        setChatScope('mine');
        setAgentExpired(false);
    }, [agentId]);

    /* ── Load sessions on mount ── */
    useEffect(() => {
        if (!agentId || !token) return;
        fetchMySessions().then((data: any) => {
            setSessionsLoading(false);
            if (data && data.length > 0) selectSession(data[0]);
        });
    }, [agentId]);

    /* ── WebSocket connection ── */
    useEffect(() => {
        if (!agentId || !token) return;
        if (!activeSession) return;
        const isAgentSession = activeSession.source_channel === 'agent' || activeSession.participant_type === 'agent';
        if (isAgentSession) return;
        if (activeSession.user_id && currentUser && activeSession.user_id !== String(currentUser.id)) return;
        let cancelled = false;
        const sessionParam = activeSession?.id ? `&session_id=${activeSession.id}` : '';
        const connect = () => {
            if (cancelled) return;
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(`${protocol}//${window.location.host}/ws/chat/${agentId}?token=${token}${sessionParam}`);
            ws.onopen = () => { if (cancelled) { ws.close(); return; } setWsConnected(true); wsRef.current = ws; };
            ws.onclose = (e) => {
                if (e.code === 4003 || e.code === 4002) {
                    if (e.code === 4003) setAgentExpired(true);
                    setWsConnected(false);
                    setIsWaiting(false);
                    setIsStreaming(false);
                    return;
                }
                if (!cancelled) { setWsConnected(false); setIsWaiting(false); setIsStreaming(false); setTimeout(connect, 2000); }
            };
            ws.onerror = () => { if (!cancelled) setWsConnected(false); };
            ws.onmessage = (e) => {
                const d = JSON.parse(e.data);
                if (['thinking', 'chunk', 'tool_call', 'done', 'error', 'quota_exceeded'].includes(d.type)) {
                    setIsWaiting(false);
                    if (['thinking', 'chunk', 'tool_call'].includes(d.type)) setIsStreaming(true);
                    if (['done', 'error', 'quota_exceeded'].includes(d.type)) setIsStreaming(false);
                }

                if (['thinking', 'tool_call', 'chunk', 'done'].includes(d.type)) {
                    setChatMessages((prev) => applyStreamEvent(prev, d, new Date().toISOString()));
                    fetchMySessions(true);
                } else if (d.type === 'error' || d.type === 'quota_exceeded') {
                    const msg = d.content || d.detail || d.message || 'Request denied';
                    setChatMessages(prev => {
                        const last = prev[prev.length - 1];
                        if (last && last.role === 'assistant' && last.content === `\u26A0\uFE0F ${msg}`) return prev;
                        return [...prev, { role: 'assistant', content: `\u26A0\uFE0F ${msg}` }];
                    });
                    if (msg.includes('expired') || msg.includes('Setup failed') || msg.includes('no LLM model') || msg.includes('No model')) {
                        cancelled = true;
                        if (msg.includes('expired')) setAgentExpired(true);
                    }
                } else if (d.type === 'trigger_notification') {
                    setChatMessages(prev => [...prev, { role: 'assistant', content: d.content }]);
                    fetchMySessions(true);
                } else {
                    setChatMessages(prev => [...prev, parseChatMsg({
                        ...d,
                        created_at: new Date().toISOString(),
                    })]);
                }
            };
        };
        connect();
        return () => { cancelled = true; wsRef.current?.close(); wsRef.current = null; setWsConnected(false); };
    }, [agentId, token, activeSession?.id]);

    /* ── Scroll: read-only history ── */
    const handleHistoryScroll = () => {
        const el = historyContainerRef.current;
        if (!el) return;
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        setShowHistoryScrollBtn(distFromBottom > 200);
    };
    const scrollHistoryToBottom = () => {
        const el = historyContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
        setShowHistoryScrollBtn(false);
    };
    useEffect(() => {
        const el = historyContainerRef.current;
        if (!el) return;
        const timer = setTimeout(() => {
            const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            setShowHistoryScrollBtn(distFromBottom > 200);
        }, 100);
        return () => clearTimeout(timer);
    }, [historyMsgs, activeSession?.id]);

    /* ── Scroll: live chat ── */
    const handleChatScroll = () => {
        const el = chatContainerRef.current;
        if (!el) return;
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        isNearBottom.current = distFromBottom < 5;
        setShowScrollBtn(distFromBottom > 200);
    };
    const scrollToBottom = () => {
        chatEndRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
        setShowScrollBtn(false);
    };
    useEffect(() => {
        if (!chatEndRef.current) return;
        if (isFirstLoad.current && chatMessages.length > 0) {
            chatEndRef.current.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
            isFirstLoad.current = false;
            setTimeout(() => chatInputRef.current?.focus(), 100);
            return;
        }
        if (isNearBottom.current) {
            chatEndRef.current.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
        }
    }, [chatMessages]);

    /* ── Auto-focus on session switch ── */
    useEffect(() => {
        if (activeSession) {
            setTimeout(() => chatInputRef.current?.focus(), 150);
        }
    }, [activeSession?.id]);

    /* ── Send message ── */
    const sendChatMsg = () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (!chatInput.trim() && attachedFiles.length === 0) return;

        let userMsg = chatInput.trim();
        let contentForLLM = userMsg;
        let displayFiles = '';

        if (attachedFiles.length > 0) {
            let filesPrompt = '';
            let filesDisplay = '';

            attachedFiles.forEach(file => {
                filesDisplay += `[\uD83D\uDCCE ${file.name}] `;
                if (file.imageUrl && supportsVision) {
                    filesPrompt += `[image_data:${file.imageUrl}]\n`;
                } else if (file.imageUrl) {
                    filesPrompt += `[\u56FE\u7247\u6587\u4EF6\u5DF2\u4E0A\u4F20: ${file.name}\uFF0C\u4FDD\u5B58\u5728 ${file.path || ''}]\n`;
                } else {
                    const wsPath = file.path || '';
                    const codePath = wsPath.replace(/^workspace\//, '');
                    const fileLoc = wsPath ? `\nFile location: ${wsPath} (for read_file/read_document tools)\nIn execute_code, use relative path: "${codePath}" (working directory is workspace/)\n` : '';
                    filesPrompt += `[File: ${file.name}]${fileLoc}\n${file.text}\n\n`;
                }
            });

            if (supportsVision && attachedFiles.some(f => f.imageUrl)) {
                contentForLLM = userMsg ? `${filesPrompt}\n${userMsg}` : `${filesPrompt}\n\u8BF7\u5206\u6790\u8FD9\u4E9B\u6587\u4EF6`;
            } else {
                contentForLLM = userMsg ? `${filesPrompt}\nQuestion: ${userMsg}` : `Please analyze these files:\n\n${filesPrompt}`;
            }

            displayFiles = filesDisplay.trim();
            userMsg = userMsg ? `${displayFiles}\n${userMsg}` : displayFiles;
        }

        setIsWaiting(true);
        setIsStreaming(false);
        setChatMessages(prev => [...prev, {
            role: 'user',
            content: userMsg,
            fileName: attachedFiles.map(f => f.name).join(', '),
            imageUrl: attachedFiles.length === 1 ? attachedFiles[0].imageUrl : undefined,
            timestamp: new Date().toISOString(),
        }]);
        wsRef.current.send(JSON.stringify({
            content: contentForLLM,
            display_content: userMsg,
            file_name: attachedFiles.map(f => f.name).join(', '),
        }));

        setChatInput('');
        setAttachedFiles([]);
    };

    /* ── File upload ── */
    const uploadChatFiles = async (filesToUpload: File[]) => {
        const progress = filesToUpload.map(() => 0);
        const requests = filesToUpload.map((file, index) =>
            chatApi.uploadAttachment(file, agentId, (pct) => {
                progress[index] = pct;
                const allUploaded = progress.every((value) => value >= 101);
                if (allUploaded) {
                    setUploadProgress(101);
                    return;
                }
                const bounded = progress.map((value) => Math.min(value, 100));
                const average = bounded.reduce((sum, value) => sum + value, 0) / bounded.length;
                setUploadProgress(Math.round(average));
            }),
        );
        uploadAbortRef.current = () => requests.forEach((request) => request.abort());
        const results = await Promise.all(requests.map((request) => request.promise));
        setAttachedFiles((prev) => [...prev, ...results].slice(0, 10));
    };

    const handleChatFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        const allowedFiles = files.slice(0, 10 - attachedFiles.length);
        if (!allowedFiles.length) {
            alert('Limit of 10 attached files reached.');
            return;
        }

        setUploading(true); setUploadProgress(0);
        try {
            await uploadChatFiles(allowedFiles);
        } catch (err: any) {
            if (err?.message !== 'Upload cancelled') alert(t('agent.upload.failed'));
        } finally {
            setUploading(false); setUploadProgress(-1); uploadAbortRef.current = null;
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    /* ── Paste handler ── */
    const handlePaste = async (e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const filesToUpload: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                const blob = items[i].getAsFile();
                if (blob) {
                    const ext = blob.type.split('/')[1] || 'png';
                    const fileName = `paste-${Date.now()}-${i}.${ext}`;
                    filesToUpload.push(new File([blob], fileName, { type: blob.type }));
                }
            }
        }

        if (!filesToUpload.length) return;
        e.preventDefault();
        const allowedFiles = filesToUpload.slice(0, 10 - attachedFiles.length);
        if (!allowedFiles.length) {
            alert('Limit of 10 attached files reached.');
            return;
        }

        setUploading(true); setUploadProgress(0);
        try {
            await uploadChatFiles(allowedFiles);
        } catch (err: any) {
            if (err?.message !== 'Upload cancelled') alert(t('agent.upload.failed'));
        } finally { setUploading(false); setUploadProgress(-1); uploadAbortRef.current = null; }
    };

    /* ── Shared rendering helpers ── */

    /** Render a timeline event row (permission gate, pack activation, context compacted) */
    const renderEventRow = (msg: ChatMsg, i: number) => {
        const eventUi = getTimelineEventPresentation(msg);
        return (
            <div key={i} className="flex gap-2 mb-1.5 pl-9 min-w-0">
                <div className={`flex-1 min-w-0 rounded-lg ${eventUi.bgClass} border border-edge-subtle px-3 py-2.5`}>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[13px]">{eventUi.icon}</span>
                        <span className="text-xs font-semibold">{eventUi.title}</span>
                        {msg.eventStatus && <span className="ml-auto text-[10px] text-content-tertiary uppercase">{String(msg.eventStatus).replace(/_/g, ' ')}</span>}
                    </div>
                    {msg.eventToolName && <div className="text-[11px] text-content-tertiary mb-1 font-mono">{msg.eventToolName}</div>}
                    <div className="text-xs leading-relaxed text-content-secondary whitespace-pre-wrap break-words">{msg.content}</div>
                    {msg.eventPacks && msg.eventPacks.length > 0 && (
                        <div className="mt-2 flex flex-col gap-1.5">
                            {msg.eventPacks.map((pack: any, packIndex: number) => (
                                <div key={packIndex} className="text-[11px] text-content-secondary border-t border-edge-subtle pt-1.5">
                                    <div className="font-semibold">{String(pack.name || 'unknown_pack')}</div>
                                    {pack.summary && <div className="mt-0.5">{String(pack.summary)}</div>}
                                    {Array.isArray(pack.tools) && pack.tools.length > 0 && (
                                        <div className="mt-1 font-mono text-content-tertiary">
                                            {pack.tools.join(', ')}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                    {msg.eventApprovalId && <div className="mt-1.5 text-[11px] text-content-tertiary font-mono">Approval ID: {msg.eventApprovalId}</div>}
                    {(msg.timestamp || (msg as any).created_at) && <div className="text-[10px] text-content-tertiary mt-1.5 opacity-60">{formatChatTimestamp(msg.timestamp || (msg as any).created_at)}</div>}
                </div>
            </div>
        );
    };

    /** Render a tool call row */
    const renderToolCallRow = (msg: ChatMsg, i: number, isLive: boolean) => {
        const tName = msg.toolName || 'tool';
        const tArgs = msg.toolArgs || {};
        const tResult = msg.toolResult || '';
        return (
            <div key={i} className="flex gap-2 mb-1.5 pl-9 min-w-0">
                <details className="flex-1 min-w-0 rounded-lg bg-accent-subtle border border-accent-subtle text-xs overflow-hidden">
                    <summary className="px-2.5 py-1.5 cursor-pointer flex items-center gap-1.5 select-none list-none overflow-hidden">
                        <span className="text-[13px]">{isLive && msg.toolStatus === 'running' ? '\u23F3' : '\u26A1'}</span>
                        <span className="font-semibold text-accent-text">{tName}</span>
                        {hasToolArgs(tArgs) && <span className="text-content-tertiary text-[11px] font-mono overflow-hidden text-ellipsis whitespace-nowrap flex-1">{`(${formatToolArgsSummary(tArgs)})`}</span>}
                        {isLive && msg.toolStatus === 'running' && <span className="text-content-tertiary text-[11px] ml-auto">{t('common.loading')}</span>}
                    </summary>
                    {(isLive ? msg.toolResult : tResult) && (
                        <div className="px-2.5 pb-2 pt-1">
                            <div className="text-content-secondary text-[11px] font-mono whitespace-pre-wrap break-words max-h-60 overflow-auto bg-[rgba(0,0,0,0.15)] rounded px-1.5 py-1">
                                {isLive ? msg.toolResult : tResult}
                            </div>
                        </div>
                    )}
                </details>
            </div>
        );
    };

    /** Render a thinking-only assistant message (no content) */
    const renderThinkingOnly = (msg: ChatMsg, i: number) => (
        <div key={i} className="pl-9 mb-1.5">
            <details className="text-xs bg-[rgba(147,130,220,0.08)] rounded-md border border-[rgba(147,130,220,0.15)]">
                <summary className="px-2.5 py-1.5 cursor-pointer text-[rgba(147,130,220,0.9)] font-medium select-none flex items-center gap-1">Thinking</summary>
                <div className="px-2.5 pb-2 pt-1 text-xs leading-relaxed text-content-secondary whitespace-pre-wrap break-words max-h-[300px] overflow-auto">
                    {msg.thinking}
                </div>
            </details>
        </div>
    );

    /** Render a thinking details block (inside a message bubble) */
    const renderThinkingDetails = (thinking: string) => (
        <details className="mb-2 text-xs bg-[rgba(147,130,220,0.08)] rounded-md border border-[rgba(147,130,220,0.15)]">
            <summary className="px-2.5 py-1.5 cursor-pointer text-[rgba(147,130,220,0.9)] font-medium select-none flex items-center gap-1">
                {'\uD83D\uDCAD'} Thinking
            </summary>
            <div className="px-2.5 pb-2 pt-1 text-xs leading-relaxed text-content-secondary whitespace-pre-wrap break-words max-h-[300px] overflow-auto">
                {thinking}
            </div>
        </details>
    );

    /** File icon for a given extension */
    const fileIcon = (ext: string) => {
        if (ext === 'pdf') return '\uD83D\uDCC4';
        if (['csv', 'xlsx', 'xls'].includes(ext)) return '\uD83D\uDCCA';
        if (['docx', 'doc'].includes(ext)) return '\uD83D\uDCDD';
        return '\uD83D\uDCCE';
    };

    /* ══════════════════════════════════════════════
       Render
       ══════════════════════════════════════════════ */
    return (
        <div className="flex flex-1 min-h-0" style={{ height: 'calc(100vh - 206px)' }}>
            {/* ── Left: session sidebar ── */}
            <div className="w-[220px] shrink-0 border-r border-edge-subtle flex flex-col overflow-hidden">
                {/* Tab row */}
                <div className="flex items-center px-3 pt-2.5 gap-1 border-b border-edge-subtle">
                    <button
                        onClick={() => setChatScope('mine')}
                        className={`flex-1 py-1.5 bg-transparent border-none cursor-pointer text-xs pb-2 ${
                            chatScope === 'mine'
                                ? 'font-semibold text-content-primary border-b-2 border-accent-primary'
                                : 'font-normal text-content-tertiary border-b-2 border-transparent'
                        }`}
                    >
                        My Sessions
                    </button>
                    {isAdmin && (
                        <button
                            onClick={() => { setChatScope('all'); fetchAllSessions(); }}
                            className={`flex-1 py-1.5 bg-transparent border-none cursor-pointer text-xs pb-2 ${
                                chatScope === 'all'
                                    ? 'font-semibold text-content-primary border-b-2 border-accent-primary'
                                    : 'font-normal text-content-tertiary border-b-2 border-transparent'
                            }`}
                        >
                            All Users
                        </button>
                    )}
                </div>

                {/* Actions row */}
                {chatScope === 'mine' && (
                    <div className="px-3 py-2 border-b border-edge-subtle">
                        <button
                            onClick={createNewSession}
                            className="w-full py-1.5 px-2 bg-transparent border border-edge-subtle rounded-md cursor-pointer text-xs text-content-secondary text-left flex items-center gap-1.5 hover:bg-surface-secondary hover:text-content-primary transition-colors"
                        >
                            + New Session
                        </button>
                    </div>
                )}

                {/* Session list */}
                <div className="flex-1 overflow-y-auto py-1">
                    {chatScope === 'mine' ? (
                        sessionsLoading ? (
                            <div className="px-3 py-5 text-xs text-content-tertiary">{t('common.loading')}</div>
                        ) : sessions.length === 0 ? (
                            <div className="px-3 py-5 text-xs text-content-tertiary">No sessions yet.<br />Click "+ New Session" to start.</div>
                        ) : sessions.map((s: any) => {
                            const isActive = activeSession?.id === s.id;
                            const isOwn = s.user_id === String(currentUser?.id);
                            const channelLabel: Record<string, string> = {
                                feishu: t('common.channels.feishu'),
                                discord: t('common.channels.discord'),
                                slack: t('common.channels.slack'),
                                dingtalk: t('common.channels.dingtalk'),
                                wecom: t('common.channels.wecom'),
                            };
                            const chLabel = channelLabel[s.source_channel];
                            return (
                                <div
                                    key={s.id}
                                    onClick={() => selectSession(s)}
                                    className={`session-item px-3 py-2 cursor-pointer mb-px relative ${
                                        isActive
                                            ? 'border-l-2 border-accent-primary bg-surface-secondary'
                                            : 'border-l-2 border-transparent hover:bg-surface-secondary'
                                    }`}
                                >
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                        <div className={`text-xs overflow-hidden text-ellipsis whitespace-nowrap flex-1 text-content-primary ${isActive ? 'font-semibold' : 'font-normal'}`}>{s.title}</div>
                                        {chLabel && <span className="text-[9px] px-1 py-px rounded bg-surface-tertiary text-content-tertiary shrink-0">{chLabel}</span>}
                                    </div>
                                    <div className="text-[10px] text-content-tertiary flex items-center gap-1.5">
                                        {isOwn && isActive && wsConnected && <span className="status-dot running w-[5px] h-[5px] shrink-0" />}
                                        {s.last_message_at
                                            ? new Date(s.last_message_at).toLocaleString(i18n.language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                            : new Date(s.created_at).toLocaleString(i18n.language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })}
                                        {s.message_count > 0 && <span className="ml-auto">{s.message_count}</span>}
                                    </div>
                                    <button
                                        className="del-btn absolute top-1 right-1 bg-transparent border-none cursor-pointer px-1 py-0.5 opacity-0 text-sm text-content-tertiary leading-none transition-opacity hover:!opacity-100 hover:!text-status-error"
                                        onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                                        title={t('chat.deleteSession', 'Delete session')}
                                        aria-label={t('chat.deleteSession', 'Delete session')}
                                    >
                                        <span aria-hidden="true">{'\u00D7'}</span>
                                    </button>
                                </div>
                            );
                        })
                    ) : (
                        /* All Users tab */
                        <>
                            <div className="px-2.5 py-2 border-b border-edge-subtle">
                                <select
                                    value={allUserFilter}
                                    onChange={e => setAllUserFilter(e.target.value)}
                                    className="w-full px-1.5 py-1 text-[11px] bg-surface-secondary border border-edge-subtle rounded-[5px] text-content-primary cursor-pointer"
                                >
                                    <option value="">All Users</option>
                                    {Array.from(new Set(allSessions.map((s: any) => s.username || s.user_id))).filter(Boolean).map((u: any) => (
                                        <option key={u} value={u}>{u}</option>
                                    ))}
                                </select>
                            </div>
                            {allSessions
                                .filter((s: any) => !allUserFilter || (s.username || s.user_id) === allUserFilter)
                                .map((s: any) => {
                                    const isActive = activeSession?.id === s.id;
                                    return (
                                        <div
                                            key={s.id}
                                            onClick={() => selectSession(s)}
                                            className={`session-item px-3 py-1.5 cursor-pointer relative ${
                                                isActive
                                                    ? 'border-l-2 border-accent-primary bg-surface-secondary'
                                                    : 'border-l-2 border-transparent hover:bg-surface-secondary'
                                            }`}
                                        >
                                            <div className="flex items-center gap-1.5 mb-px">
                                                <div className="text-xs overflow-hidden text-ellipsis whitespace-nowrap text-content-primary flex-1">{s.title}</div>
                                                {({
                                                    feishu: t('common.channels.feishu'),
                                                    discord: t('common.channels.discord'),
                                                    slack: t('common.channels.slack'),
                                                    dingtalk: t('common.channels.dingtalk'),
                                                    wecom: t('common.channels.wecom'),
                                                } as Record<string, string>)[s.source_channel] && (
                                                    <span className="text-[9px] px-1 py-px rounded bg-surface-tertiary text-content-tertiary shrink-0">
                                                        {({
                                                            feishu: t('common.channels.feishu'),
                                                            discord: t('common.channels.discord'),
                                                            slack: t('common.channels.slack'),
                                                            dingtalk: t('common.channels.dingtalk'),
                                                            wecom: t('common.channels.wecom'),
                                                        } as Record<string, string>)[s.source_channel]}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-[10px] text-content-tertiary flex gap-1">
                                                <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1">{s.username || ''}</span>
                                                <span className="shrink-0">{s.last_message_at ? new Date(s.last_message_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}{s.message_count > 0 ? ` \u00B7 ${s.message_count}` : ''}</span>
                                            </div>
                                            <button
                                                className="del-btn absolute top-1 right-1 bg-transparent border-none cursor-pointer px-1 py-0.5 opacity-0 text-sm text-content-tertiary leading-none transition-opacity hover:!opacity-100 hover:!text-status-error"
                                                onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                                                title={t('chat.deleteSession', 'Delete session')}
                                            >
                                                {'\u00D7'}
                                            </button>
                                        </div>
                                    );
                                })}
                        </>
                    )}
                </div>
            </div>

            {/* ── Right: chat / message area ── */}
            <div className="flex-1 flex flex-col relative min-w-0 overflow-hidden">
                {!activeSession ? (
                    <div className="flex-1 flex items-center justify-center text-content-tertiary text-[13px] flex-col gap-2">
                        <div>No session selected</div>
                        <button className="btn btn-secondary text-xs" onClick={createNewSession}>Start a new session</button>
                    </div>
                ) : (activeSession.user_id && currentUser && activeSession.user_id !== String(currentUser.id)) || activeSession.source_channel === 'agent' || activeSession.participant_type === 'agent' ? (
                    /* ── Read-only history view ── */
                    <>
                        <div ref={historyContainerRef} onScroll={handleHistoryScroll} className="flex-1 overflow-y-auto px-4 py-3" role="log" aria-label="Chat history">
                            <div className="text-[11px] text-content-tertiary mb-3 px-2 py-1 bg-surface-secondary rounded inline-block">
                                {activeSession.source_channel === 'agent' ? `\uD83E\uDD16 Agent Conversation \u00B7 ${activeSession.username || 'Agents'}` : `Read-only \u00B7 ${activeSession.username || 'User'}`}
                            </div>
                            {historyMsgs.map((m: any, i: number) => {
                                if (m.role === 'event') return renderEventRow(m, i);
                                if (m.role === 'tool_call') return renderToolCallRow(m, i, false);
                                if (m.role === 'assistant' && !m.content?.trim()) {
                                    if (m.thinking) return renderThinkingOnly(m, i);
                                    return null;
                                }
                                return (
                                    <div key={i} className={`flex gap-2 mb-2 ${m.role === 'assistant' ? 'flex-row' : 'flex-row-reverse'}`}>
                                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] shrink-0 font-semibold ${m.role === 'assistant' ? 'bg-surface-elevated text-content-secondary' : 'bg-[rgba(16,185,129,0.15)] text-content-secondary'}`}>
                                            {m.sender_name ? m.sender_name[0] : (m.role === 'assistant' ? 'A' : 'U')}
                                        </div>
                                        <div className={`max-w-[70%] px-3 py-2 rounded-xl text-[13px] leading-normal break-words ${m.role === 'assistant' ? 'bg-surface-secondary' : 'bg-[rgba(16,185,129,0.1)]'}`}>
                                            {m.sender_name && <div className="text-[10px] text-content-tertiary mb-0.5 font-semibold">{'\uD83E\uDD16'} {m.sender_name}</div>}
                                            {(() => {
                                                const pm = m as ChatMsg;
                                                const fe = pm.fileName?.split('.').pop()?.toLowerCase() ?? '';
                                                const fi = fileIcon(fe);
                                                return (
                                                    <>
                                                        {m.thinking && renderThinkingDetails(m.thinking)}
                                                        {pm.fileName && (
                                                            <div className="inline-flex items-center gap-1.5 bg-surface-elevated rounded-md px-2 py-1 mb-1 text-[11px] border border-edge-subtle text-content-secondary">
                                                                <span>{fi}</span>
                                                                <span className="font-medium text-content-primary max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">{pm.fileName}</span>
                                                            </div>
                                                        )}
                                                        {pm.content ? (m.role === 'assistant' ? <MarkdownRenderer content={pm.content} /> : <div className="whitespace-pre-wrap">{pm.content}</div>) : null}
                                                    </>
                                                );
                                            })()}
                                            {(m.timestamp || m.created_at) && <div className="text-[10px] text-content-tertiary mt-1 opacity-60">{formatChatTimestamp(m.timestamp || m.created_at)}</div>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {showHistoryScrollBtn && (
                            <button
                                onClick={scrollHistoryToBottom}
                                className="absolute bottom-5 right-5 w-8 h-8 rounded-full bg-surface-elevated border border-edge-default text-content-secondary cursor-pointer flex items-center justify-center text-base z-10"
                                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
                                title="Scroll to bottom"
                                aria-label="Scroll to bottom"
                            >
                                <span aria-hidden="true">{'\u2193'}</span>
                            </button>
                        )}
                    </>
                ) : (
                    /* ── Live WebSocket chat (own session) ── */
                    <>
                        <div ref={chatContainerRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto px-4 py-3" role="log" aria-label="Live chat">
                            {chatMessages.length === 0 && (
                                <div className="text-center py-15 px-5 text-content-tertiary">
                                    <div className="text-[13px] mb-1">{activeSession?.title || t('agent.chat.startChat')}</div>
                                    <div className="text-xs">{t('agent.chat.startConversation', { name: agent.name })}</div>
                                    <div className="text-[11px] mt-1 opacity-70">{t('agent.chat.fileSupport')}</div>
                                </div>
                            )}
                            {chatMessages.map((msg, i) => {
                                if (msg.role === 'event') return renderEventRow(msg, i);
                                if (msg.role === 'tool_call') return renderToolCallRow(msg, i, true);
                                if (msg.role === 'assistant' && !msg.content?.trim()) {
                                    if (msg.thinking) return renderThinkingOnly(msg, i);
                                    return null;
                                }
                                return (
                                    <div key={i} className={`flex gap-2 mb-2 ${msg.role === 'assistant' ? 'flex-row' : 'flex-row-reverse'}`}>
                                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] shrink-0 font-semibold ${msg.role === 'assistant' ? 'bg-surface-elevated text-content-secondary' : 'bg-[rgba(16,185,129,0.15)] text-content-secondary'}`}>
                                            {msg.role === 'user' ? 'U' : 'A'}
                                        </div>
                                        <div className={`max-w-[70%] px-3 py-2 rounded-xl text-[13px] leading-normal break-words ${msg.role === 'assistant' ? 'bg-surface-secondary' : 'bg-[rgba(16,185,129,0.1)]'}`}>
                                            {msg.fileName && (() => {
                                                const fe = msg.fileName!.split('.').pop()?.toLowerCase() ?? '';
                                                const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(fe);
                                                if (isImage && msg.imageUrl) {
                                                    return (
                                                        <div className="mb-1">
                                                            <img src={msg.imageUrl} alt={msg.fileName} className="max-w-[200px] max-h-[150px] rounded-lg border border-edge-subtle" />
                                                        </div>
                                                    );
                                                }
                                                const fi = fileIcon(fe);
                                                return (
                                                    <div className={`inline-flex items-center gap-1.5 bg-[rgba(0,0,0,0.08)] rounded-md px-2 py-1 text-[11px] border border-edge-subtle text-content-secondary ${msg.content ? 'mb-1' : ''}`}>
                                                        <span>{fi}</span>
                                                        <span className="font-medium text-content-primary max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">{msg.fileName}</span>
                                                    </div>
                                                );
                                            })()}
                                            {msg.thinking && renderThinkingDetails(msg.thinking)}
                                            {msg.role === 'assistant' ? (
                                                (msg as any)._streaming && !msg.content ? (
                                                    <div className="thinking-indicator">
                                                        <div className="thinking-dots">
                                                            <span /><span /><span />
                                                        </div>
                                                        <span className="text-content-tertiary text-[13px]">{t('agent.chat.thinking', 'Thinking...')}</span>
                                                    </div>
                                                ) : <MarkdownRenderer content={msg.content} />
                                            ) : msg.content ? <div className="whitespace-pre-wrap">{msg.content}</div> : null}
                                            {msg.timestamp && <div className={`text-[10px] text-content-tertiary mt-1 opacity-60 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>{formatChatTimestamp(msg.timestamp)}</div>}
                                        </div>
                                    </div>
                                );
                            })}
                            {isWaiting && (
                                <div className="flex gap-2 mb-2 animate-[fadeIn_.2s_ease]">
                                    <div className="w-7 h-7 rounded-full bg-surface-elevated flex items-center justify-center text-[11px] shrink-0 text-content-secondary font-semibold">A</div>
                                    <div className="px-3 py-2 rounded-xl bg-surface-secondary text-[13px]">
                                        <div className="thinking-indicator">
                                            <div className="thinking-dots">
                                                <span /><span /><span />
                                            </div>
                                            <span className="text-content-tertiary text-[13px]">{t('agent.chat.thinking', 'Thinking...')}</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>
                        {showScrollBtn && (
                            <button
                                onClick={scrollToBottom}
                                className="absolute bottom-[70px] right-5 w-8 h-8 rounded-full bg-surface-elevated border border-edge-default text-content-secondary cursor-pointer flex items-center justify-center text-base z-10"
                                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
                                title="Scroll to bottom"
                                aria-label="Scroll to bottom"
                            >
                                <span aria-hidden="true">{'\u2193'}</span>
                            </button>
                        )}
                        {agentExpired ? (
                            <div role="alert" className="px-4 py-[7px] border-t border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] flex items-center gap-2 text-xs text-[rgb(180,100,0)]">
                                <span aria-hidden="true">{'\u23F8'}</span>
                                <span>This Agent has <strong>expired</strong> and is off duty. Contact your admin to extend its service.</span>
                            </div>
                        ) : !wsConnected && (!activeSession?.user_id || !currentUser || activeSession.user_id === String(currentUser?.id)) ? (
                            <div role="status" aria-live="polite" className="px-4 py-[3px] flex items-center gap-1.5 text-[11px] text-content-tertiary">
                                <span className="inline-block w-[5px] h-[5px] rounded-full bg-accent-primary opacity-80 animate-pulse" aria-hidden="true" />
                                Connecting...
                            </div>
                        ) : null}
                        {attachedFiles.length > 0 && (
                            <div className="px-4 py-1.5 bg-surface-elevated border-t border-edge-subtle flex items-center gap-2 flex-wrap">
                                {attachedFiles.map((file, idx) => (
                                    <div key={idx} className="flex items-center gap-1.5 text-[11px] bg-surface-secondary px-1.5 py-1 rounded border border-edge-subtle max-w-[200px]">
                                        {file.imageUrl ? (
                                            <img src={file.imageUrl} alt={file.name} className="w-5 h-5 rounded object-cover" />
                                        ) : (
                                            <span>{'\uD83D\uDCCE'}</span>
                                        )}
                                        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{file.name}</span>
                                        <button onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))} className="bg-transparent border-none text-content-tertiary cursor-pointer text-sm px-0.5" title="Remove file" aria-label={`Remove ${file.name}`}><span aria-hidden="true">{'\u2715'}</span></button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="flex gap-2 px-3 py-1.5 border-t border-edge-subtle">
                            <input type="file" multiple ref={fileInputRef} onChange={handleChatFile} className="hidden" />
                            <button
                                className={`btn btn-secondary px-2.5 py-1.5 text-sm min-w-0 ${(!wsConnected || uploading || isWaiting || isStreaming) ? 'cursor-not-allowed opacity-40' : ''}`}
                                onClick={() => fileInputRef.current?.click()}
                                disabled={!wsConnected || uploading || isWaiting || isStreaming || attachedFiles.length >= 10}
                                aria-label={uploading ? t('common.loading') : t('agent.chat.attachFile', 'Attach file')}
                            >
                                <span aria-hidden="true">{uploading ? '\u23F3' : '\u29B9'}</span>
                            </button>
                            {uploading && uploadProgress >= 0 && (
                                <div className="flex items-center gap-1.5 flex-[0_0_140px]">
                                    {uploadProgress <= 100 ? (
                                        <>
                                            <div className="flex-1 h-1 rounded-sm bg-surface-tertiary overflow-hidden">
                                                <div className="h-full rounded-sm bg-accent-primary transition-[width] duration-150 ease-linear" style={{ width: `${uploadProgress}%` }} />
                                            </div>
                                            <span className="text-[11px] text-content-tertiary tabular-nums whitespace-nowrap">{uploadProgress}%</span>
                                        </>
                                    ) : (
                                        <div className="flex items-center gap-1">
                                            <span className="inline-block w-[5px] h-[5px] rounded-full bg-accent-primary animate-pulse" />
                                            <span className="text-[11px] text-content-tertiary whitespace-nowrap">Processing...</span>
                                        </div>
                                    )}
                                    <button onClick={() => { uploadAbortRef.current?.(); }} className="bg-transparent border-none text-content-tertiary cursor-pointer text-xs px-0.5 leading-none" title="Cancel upload" aria-label="Cancel upload"><span aria-hidden="true">{'\u2715'}</span></button>
                                </div>
                            )}
                            <input
                                ref={chatInputRef}
                                className="chat-input flex-1"
                                value={chatInput}
                                onChange={e => setChatInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendChatMsg(); } }}
                                onPaste={handlePaste}
                                placeholder={!wsConnected && (!activeSession?.user_id || !currentUser || activeSession.user_id === String(currentUser?.id)) ? 'Connecting...' : attachedFiles.length > 0 ? t('agent.chat.askAboutFile', { name: attachedFiles.length === 1 ? attachedFiles[0].name : `${attachedFiles.length} files` }) : t('chat.placeholder')}
                                disabled={!wsConnected || isWaiting || isStreaming}
                                autoFocus
                            />
                            {(isStreaming || isWaiting) ? (
                                <button className="btn btn-stop-generation px-4 py-1.5" onClick={() => { if (wsRef.current?.readyState === WebSocket.OPEN) { wsRef.current.send(JSON.stringify({ type: 'abort' })); setIsStreaming(false); setIsWaiting(false); } }} title={t('chat.stop', 'Stop')} aria-label={t('chat.stop', 'Stop generation')}>
                                    <span className="stop-icon" aria-hidden="true" />
                                </button>
                            ) : (
                                <button className="btn btn-primary px-4 py-1.5" onClick={sendChatMsg} disabled={!wsConnected || (!chatInput.trim() && attachedFiles.length === 0)}>{t('chat.send')}</button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
