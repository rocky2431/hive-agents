import React, { useState, useEffect, useRef, Component, ErrorInfo } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import ConfirmModal from '../components/ConfirmModal';
import type { FileBrowserApi } from '../components/FileBrowser';
import FileBrowser from '../components/FileBrowser';
import MarkdownRenderer from '../components/MarkdownRenderer';
import PromptModal from '../components/PromptModal';
import AgentApprovalsSection from './agent-detail/AgentApprovalsSection';
import AgentActivityLogSection from './agent-detail/AgentActivityLogSection';
import AgentAwareSection from './agent-detail/AgentAwareSection';
import AgentMindSection from './agent-detail/AgentMindSection';
import AgentSettingsSection from './agent-detail/AgentSettingsSection';
import AgentSkillsSection from './agent-detail/AgentSkillsSection';
import AgentStatusSection from './agent-detail/AgentStatusSection';
import AgentWorkspaceSection from './agent-detail/AgentWorkspaceSection';
import CopyMessageButton from './agent-detail/CopyMessageButton';
import RelationshipEditor from './agent-detail/RelationshipEditor';
import ToolsManager from './agent-detail/ToolsManager';
import OpenClawSettings from './OpenClawSettings';
import { agentApi } from '../api/domains/agents';
import { activityApi } from '../api/domains/activity';
import { channelApi } from '../api/domains/channels';
import { enterpriseApi } from '../api/domains/enterprise';
import { fileApi } from '../api/domains/files';
import { scheduleApi } from '../api/domains/schedules';
import { taskApi } from '../api/domains/tasks';
import { triggerApi } from '../api/domains/triggers';
import { chatApi } from '../api/domains/chat';
import { uploadFileWithProgress } from '../api/core/upload-progress';
import { useAuthStore } from '../stores';

const TABS = ['status', 'aware', 'mind', 'tools', 'skills', 'relationships', 'workspace', 'chat', 'activityLog', 'approvals', 'settings'] as const;

/** Convert rich schedule JSON to cron expression */
function schedToCron(sched: { freq: string; interval: number; time: string; weekdays?: number[] }): string {
    const [h, m] = (sched.time || '09:00').split(':').map(Number);
    if (sched.freq === 'weekly') {
        const days = (sched.weekdays || [1, 2, 3, 4, 5]).join(',');
        return sched.interval > 1 ? `${m} ${h} * * ${days}` : `${m} ${h} * * ${days}`;
    }
    // daily
    if (sched.interval === 1) return `${m} ${h} * * *`;
    return `${m} ${h} */${sched.interval} * *`;
}

function AgentDetailInner() {
    const { t, i18n } = useTranslation();
    const { id } = useParams<{ id: string }>();
    const queryClient = useQueryClient();
    const location = useLocation();
    const validTabs = ['status', 'aware', 'mind', 'tools', 'skills', 'relationships', 'workspace', 'chat', 'activityLog', 'approvals', 'settings'];
    const hashTab = location.hash?.replace('#', '');
    const [activeTab, setActiveTabRaw] = useState<string>(hashTab && validTabs.includes(hashTab) ? hashTab : 'status');

    // Sync URL hash when tab changes
    const setActiveTab = (tab: string) => {
        setActiveTabRaw(tab);
        window.history.replaceState(null, '', `#${tab}`);
    };

    const { data: agent, isLoading } = useQuery({
        queryKey: ['agent', id],
        queryFn: () => agentApi.getById(id!),
        enabled: !!id,
    });

    // ── Aware tab data: triggers ──
    const { data: awareTriggers = [], refetch: refetchTriggers } = useQuery({
        queryKey: ['triggers', id],
        queryFn: () => triggerApi.list(id!),
        enabled: !!id && activeTab === 'aware',
        refetchInterval: activeTab === 'aware' ? 5000 : false,
    });

    // ── Aware tab data: focus.md ──
    const { data: focusFile } = useQuery({
        queryKey: ['file', id, 'focus.md'],
        queryFn: () => fileApi.read(id!, 'focus.md').catch(() => null),
        enabled: !!id && activeTab === 'aware',
    });

    // ── Aware tab data: reflection sessions (trigger monologues) ──
    const { data: reflectionSessions = [] } = useQuery({
        queryKey: ['reflection-sessions', id],
        queryFn: async () => {
            const all = await chatApi.listSessions(id!, 'all').catch(() => [] as any[]);
            return all.filter((s: any) => s.source_channel === 'trigger');
        },
        enabled: !!id && activeTab === 'aware',
        refetchInterval: activeTab === 'aware' ? 10000 : false,
    });

    // ── Aware tab state ──
    const [expandedFocus, setExpandedFocus] = useState<string | null>(null);
    const [expandedReflection, setExpandedReflection] = useState<string | null>(null);
    const [reflectionMessages, setReflectionMessages] = useState<Record<string, any[]>>({});
    const [showAllFocus, setShowAllFocus] = useState(false);
    const [showCompletedFocus, setShowCompletedFocus] = useState(false);
    const [showAllTriggers, setShowAllTriggers] = useState(false);
    const [reflectionPage, setReflectionPage] = useState(0);

    const { data: soulContent } = useQuery({
        queryKey: ['file', id, 'soul.md'],
        queryFn: () => fileApi.read(id!, 'soul.md'),
        enabled: !!id && activeTab === 'mind',
    });

    const { data: memoryFiles = [] } = useQuery({
        queryKey: ['files', id, 'memory'],
        queryFn: () => fileApi.list(id!, 'memory'),
        enabled: !!id && activeTab === 'mind',
    });
    const [expandedMemory, setExpandedMemory] = useState<string | null>(null);
    const { data: memoryFileContent } = useQuery({
        queryKey: ['file', id, expandedMemory],
        queryFn: () => fileApi.read(id!, expandedMemory!),
        enabled: !!id && !!expandedMemory,
    });

    const [workspacePath, setWorkspacePath] = useState('workspace');
    const { data: workspaceFiles = [] } = useQuery({
        queryKey: ['files', id, workspacePath],
        queryFn: () => fileApi.list(id!, workspacePath),
        enabled: !!id && activeTab === 'workspace',
    });

    const { data: activityLogs = [] } = useQuery({
        queryKey: ['activity', id],
        queryFn: () => activityApi.list(id!, 100),
        enabled: !!id && (activeTab === 'activityLog' || activeTab === 'status'),
        refetchInterval: activeTab === 'activityLog' ? 10000 : false,
    });

    // Chat history
    // ── Session state (replaces old conversations query) ──────────────────
    const [sessions, setSessions] = useState<any[]>([]);
    const [allSessions, setAllSessions] = useState<any[]>([]);
    const [activeSession, setActiveSession] = useState<any | null>(null);
    const [chatScope, setChatScope] = useState<'mine' | 'all'>('mine');
    const [allUserFilter, setAllUserFilter] = useState<string>('');  // filter by username in All Users
    const [historyMsgs, setHistoryMsgs] = useState<any[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [allSessionsLoading, setAllSessionsLoading] = useState(false);
    const [agentExpired, setAgentExpired] = useState(false);
    // Websocket chat state (for 'me' conversation)
    const token = useAuthStore((s) => s.token);
    const currentUser = useAuthStore((s) => s.user);
    const isAdmin = currentUser?.role === 'platform_admin' || currentUser?.role === 'org_admin';
    type SessionRuntimeKey = string;
    const wsMapRef = useRef<Record<SessionRuntimeKey, WebSocket>>({});
    const reconnectTimerRef = useRef<Record<SessionRuntimeKey, ReturnType<typeof setTimeout> | null>>({});
    const reconnectDisabledRef = useRef<Record<SessionRuntimeKey, boolean>>({});
    const sessionUiStateRef = useRef<Record<SessionRuntimeKey, { isWaiting: boolean; isStreaming: boolean }>>({});
    const activeSessionIdRef = useRef<string | null>(null);
    const currentAgentIdRef = useRef<string | undefined>(id);
    const sessionMsgAbortRef = useRef<AbortController | null>(null);
    const sessionLoadSeqRef = useRef(0);

    const buildSessionRuntimeKey = (agentId: string, sessionId: string) => `${agentId}:${sessionId}`;

    const clearReconnectTimer = (key: SessionRuntimeKey) => {
        const timer = reconnectTimerRef.current[key];
        if (timer) {
            clearTimeout(timer);
            reconnectTimerRef.current[key] = null;
        }
    };

    const closeSessionSocket = (key: SessionRuntimeKey, disableReconnect = true) => {
        if (disableReconnect) reconnectDisabledRef.current[key] = true;
        clearReconnectTimer(key);
        const ws = wsMapRef.current[key];
        if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
        delete wsMapRef.current[key];
        delete sessionUiStateRef.current[key];
    };

    const setSessionUiState = (key: SessionRuntimeKey, next: Partial<{ isWaiting: boolean; isStreaming: boolean }>) => {
        const prev = sessionUiStateRef.current[key] || { isWaiting: false, isStreaming: false };
        sessionUiStateRef.current[key] = { ...prev, ...next };
    };

    const isWritableSession = (sess: any) => {
        if (!sess) return false;
        const isAgentSession = sess.source_channel === 'agent' || sess.participant_type === 'agent';
        if (isAgentSession) return false;
        if (sess.user_id && currentUser && sess.user_id !== String(currentUser.id)) return false;
        return true;
    };

    const syncActiveSocketState = (sess: any | null = activeSession, agentId: string | undefined = id) => {
        if (!sess || !agentId) {
            wsRef.current = null;
            setWsConnected(false);
            return;
        }
        const key = buildSessionRuntimeKey(agentId, sess.id);
        const ws = wsMapRef.current[key];
        wsRef.current = ws ?? null;
        setWsConnected(!!ws && ws.readyState === WebSocket.OPEN);
    };

    const fetchMySessions = async (silent = false, agentId: string | undefined = id) => {
        if (!agentId) return [];
        if (!silent && currentAgentIdRef.current === agentId) setSessionsLoading(true);
        try {
            const data = await chatApi.listSessions(agentId, 'mine');
            if (currentAgentIdRef.current === agentId) setSessions(data);
            if (!silent && currentAgentIdRef.current === agentId) setSessionsLoading(false);
            return data;
        } catch { }
        if (!silent && currentAgentIdRef.current === agentId) setSessionsLoading(false);
        return [];
    };

    const fetchAllSessions = async () => {
        if (!id) return;
        setAllSessionsLoading(true);
        try {
            const all = await chatApi.listSessions(id, 'all');
            if (currentAgentIdRef.current === id) {
                setAllSessions(all.filter((s: any) => s.source_channel !== 'trigger'));
            }
        } catch { }
        setAllSessionsLoading(false);
    };

    const selectSession = async (sess: any) => {
        const targetAgentId = id;
        if (!targetAgentId) return;
        const runtimeKey = buildSessionRuntimeKey(targetAgentId, String(sess.id));
        const runtimeState = sessionUiStateRef.current[runtimeKey] || { isWaiting: false, isStreaming: false };
        activeSessionIdRef.current = sess.id;
        setChatMessages([]);
        setHistoryMsgs([]);
        setIsStreaming(runtimeState.isStreaming);
        setIsWaiting(runtimeState.isWaiting);
        setActiveSession(sess);
        setAgentExpired(false);
        syncActiveSocketState(sess, targetAgentId);

        // Abort any pending message load and increment sequence
        sessionMsgAbortRef.current?.abort();
        const controller = new AbortController();
        sessionMsgAbortRef.current = controller;
        const loadSeq = ++sessionLoadSeqRef.current;
        try {
            const msgs = await chatApi.getSessionMessages(targetAgentId, String(sess.id), { signal: controller.signal });
            if (controller.signal.aborted || loadSeq !== sessionLoadSeqRef.current) return;
            if (currentAgentIdRef.current !== targetAgentId) return;
            if (activeSessionIdRef.current !== sess.id) return;
            const isAgentSession = sess.source_channel === 'agent' || sess.participant_type === 'agent';
            const preParsed = msgs.map((m: any) => parseChatMsg({
                role: m.role, content: m.content || '',
                ...(m.toolName && { toolName: m.toolName, toolArgs: m.toolArgs, toolStatus: m.toolStatus, toolResult: m.toolResult }),
                ...(m.thinking && { thinking: m.thinking }),
                ...(m.created_at && { timestamp: m.created_at }),
                ...(m.id && { id: m.id }),
            }));
            
            if (!isAgentSession && sess.user_id === String(currentUser?.id)) {
                setChatMessages(preParsed);
            } else {
                setHistoryMsgs(preParsed);
            }
        } catch (err: any) {
            if (err?.name === 'AbortError') return;
            console.error('Failed to load session messages:', err);
        }
    };

    const createNewSession = async () => {
        if (!id) return;
        try {
            const newSess = await chatApi.createSession(id);
            setSessions(prev => [newSess, ...prev]);
            setIsStreaming(false);
            setIsWaiting(false);
            await selectSession(newSess);
        } catch (err: any) {
            console.error('Failed to create session:', err);
            alert(`Failed to create session: ${err.message || err}`);
        }
    };

    const deleteSession = async (sessionId: string) => {
        if (!confirm(t('chat.deleteConfirm', 'Delete this session and all its messages? This cannot be undone.'))) return;
        try {
            await chatApi.deleteSession(id!, sessionId);
            if (id) closeSessionSocket(buildSessionRuntimeKey(id, sessionId), true);
            // If deleted the active session, clear it
            if (activeSession?.id === sessionId) {
                activeSessionIdRef.current = null;
                setActiveSession(null);
                setChatMessages([]);
                setHistoryMsgs([]);
                setWsConnected(false);
                setIsStreaming(false);
                setIsWaiting(false);
            }
            await fetchMySessions(false, id);
            await fetchAllSessions();
        } catch (e: any) {
            alert(e.message || 'Delete failed');
        }
    };

    // Expiry editor modal state
    const [showExpiryModal, setShowExpiryModal] = useState(false);
    const [expiryValue, setExpiryValue] = useState('');       // datetime-local string or ''
    const [expirySaving, setExpirySaving] = useState(false);

    const openExpiryModal = () => {
        const cur = (agent as any)?.expires_at;
        // Convert ISO to datetime-local format (YYYY-MM-DDTHH:MM)
        setExpiryValue(cur ? new Date(cur).toISOString().slice(0, 16) : '');
        setShowExpiryModal(true);
    };

    const addHours = (h: number) => {
        const base = (agent as any)?.expires_at ? new Date((agent as any).expires_at) : new Date();
        const next = new Date(base.getTime() + h * 3600_000);
        setExpiryValue(next.toISOString().slice(0, 16));
    };

    const saveExpiry = async (permanent = false) => {
        setExpirySaving(true);
        try {
            const body = permanent ? { expires_at: null } : { expires_at: expiryValue ? new Date(expiryValue).toISOString() : null };
            await agentApi.update(id!, body as any);
            queryClient.invalidateQueries({ queryKey: ['agent', id] });
            setShowExpiryModal(false);
        } catch (e) { alert('Failed: ' + e); }
        setExpirySaving(false);
    };
    interface ChatMsg { role: 'user' | 'assistant' | 'tool_call'; content: string; fileName?: string; toolName?: string; toolArgs?: any; toolStatus?: 'running' | 'done'; toolResult?: string; thinking?: string; imageUrl?: string; timestamp?: string; }
    const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [wsConnected, setWsConnected] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [isWaiting, setIsWaiting] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(-1);
    const uploadAbortRef = useRef<(() => void) | null>(null);
    const [attachedFiles, setAttachedFiles] = useState<{ name: string; text: string; path?: string; imageUrl?: string }[]>([]);
    const wsRef = useRef<WebSocket | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const chatInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Settings form local state
    const [settingsForm, setSettingsForm] = useState({
        primary_model_id: '',
        fallback_model_id: '',
        context_window_size: 100,
        max_tool_rounds: 50,
        max_tokens_per_day: '' as string | number,
        max_tokens_per_month: '' as string | number,
        max_triggers: 20,
        min_poll_interval_min: 5,
        webhook_rate_limit: 5,
    });
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [settingsSaved, setSettingsSaved] = useState(false);
    const [settingsError, setSettingsError] = useState('');
    const settingsInitRef = useRef(false);

    // Sync settings form from server data on load
    useEffect(() => {
        if (agent && !settingsInitRef.current) {
            setSettingsForm({
                primary_model_id: agent.primary_model_id || '',
                fallback_model_id: agent.fallback_model_id || '',
                context_window_size: agent.context_window_size ?? 100,
                max_tool_rounds: (agent as any).max_tool_rounds ?? 50,
                max_tokens_per_day: agent.max_tokens_per_day || '',
                max_tokens_per_month: agent.max_tokens_per_month || '',
                max_triggers: (agent as any).max_triggers ?? 20,
                min_poll_interval_min: (agent as any).min_poll_interval_min ?? 5,
                webhook_rate_limit: (agent as any).webhook_rate_limit ?? 5,
            });
            settingsInitRef.current = true;
        }
    }, [agent]);

    // Welcome message editor state (must be at top level -- not inside IIFE)
    const [wmDraft, setWmDraft] = useState('');
    const [wmSaved, setWmSaved] = useState(false);
    useEffect(() => { setWmDraft((agent as any)?.welcome_message || ''); }, [(agent as any)?.welcome_message]);

    // Reset cached state when switching to a different agent
    const prevIdRef = useRef(id);
    useEffect(() => {
        if (id && id !== prevIdRef.current) {
            prevIdRef.current = id;
            settingsInitRef.current = false;
            setSettingsSaved(false);
            setSettingsError('');
            setWmDraft('');
            setWmSaved(false);
            // Invalidate all queries for the old agent to force fresh data
            queryClient.invalidateQueries({ queryKey: ['agent', id] });
            // Re-apply hash so refresh preserves the current tab
            window.history.replaceState(null, '', `#${activeTab}`);
        }
    }, [id]);

    // Load chat history + connect websocket when chat tab is active
    const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
    const parseChatMsg = (msg: ChatMsg): ChatMsg => {
        if (msg.role !== 'user') return msg;
        let parsed = { ...msg };
        // Standard web chat format: [file:name.pdf]\ncontent
        const newFmt = msg.content.match(/^\[file:([^\]]+)\]\n?/);
        if (newFmt) { parsed = { ...msg, fileName: newFmt[1], content: msg.content.slice(newFmt[0].length).trim() }; }
        // Feishu/Slack channel format: [文件已上传: workspace/uploads/name]
        const chanFmt = !newFmt && msg.content.match(/^\[\u6587\u4ef6\u5df2\u4e0a\u4f20: (?:workspace\/uploads\/)?([^\]\n]+)\]/);
        if (chanFmt) {
            const raw = chanFmt[1]; const fileName = raw.split('/').pop() || raw;
            parsed = { ...msg, fileName, content: msg.content.slice(chanFmt[0].length).trim() };
        }
        // Old format: [File: name.pdf]\nFile location:...\nQuestion: user_msg
        const oldFmt = !newFmt && !chanFmt && msg.content.match(/^\[File: ([^\]]+)\]/);
        if (oldFmt) {
            const fileName = oldFmt[1];
            const qMatch = msg.content.match(/\nQuestion: ([\s\S]+)$/);
            parsed = { ...msg, fileName, content: qMatch ? qMatch[1].trim() : '' };
        }
        // If file is an image and no imageUrl yet, build download URL for preview
        if (parsed.fileName && !parsed.imageUrl && id) {
            const ext = parsed.fileName.split('.').pop()?.toLowerCase() || '';
            if (IMAGE_EXTS.includes(ext)) {
                parsed.imageUrl = `/api/agents/${id}/files/download?path=workspace/uploads/${encodeURIComponent(parsed.fileName)}&token=${token}`;
            }
        }
        return parsed;
    };


    useEffect(() => {
        currentAgentIdRef.current = id;
    }, [id]);

    // Reset visible state whenever the viewed agent changes.
    // Existing background sockets keep running and will be cleaned up on unmount.
    useEffect(() => {
        sessionMsgAbortRef.current?.abort();
        activeSessionIdRef.current = null;
        setActiveSession(null);
        setChatMessages([]);
        setHistoryMsgs([]);
        setIsStreaming(false);
        setIsWaiting(false);
        setWsConnected(false);
        wsRef.current = null;
        setChatScope('mine');
        setAgentExpired(false);
        settingsInitRef.current = false;
    }, [id]);

    useEffect(() => {
        if (!id || !token || activeTab !== 'chat') return;
        fetchMySessions(false, id).then((data: any) => {
            if (currentAgentIdRef.current !== id) return;
            setSessionsLoading(false);
            if (data && data.length > 0) selectSession(data[0]);
        });
    }, [id, token, activeTab]);

    const ensureSessionSocket = (sess: any, agentId: string, authToken: string) => {
        const sessionId = String(sess.id);
        const key = buildSessionRuntimeKey(agentId, sessionId);
        const existing = wsMapRef.current[key];
        if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) return;
        reconnectDisabledRef.current[key] = false;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const sessionParam = `&session_id=${sessionId}`;

        const scheduleReconnect = () => {
            if (reconnectDisabledRef.current[key]) return;
            clearReconnectTimer(key);
            reconnectTimerRef.current[key] = setTimeout(() => {
                reconnectTimerRef.current[key] = null;
                if (!reconnectDisabledRef.current[key]) ensureSessionSocket(sess, agentId, authToken);
            }, 2000);
        };

        const ws = new WebSocket(`${protocol}//${window.location.host}/ws/chat/${agentId}?token=${authToken}${sessionParam}`);
        wsMapRef.current[key] = ws;
        ws.onopen = () => {
            if (reconnectDisabledRef.current[key]) {
                ws.close();
                return;
            }
            if (currentAgentIdRef.current === agentId && activeSessionIdRef.current === sessionId) {
                wsRef.current = ws;
                setWsConnected(true);
            }
        };
        ws.onclose = (e) => {
            if (wsMapRef.current[key] === ws) delete wsMapRef.current[key];
            setSessionUiState(key, { isWaiting: false, isStreaming: false });
            const isActiveRuntime = currentAgentIdRef.current === agentId && activeSessionIdRef.current === sessionId;
            if (isActiveRuntime) {
                wsRef.current = null;
                setWsConnected(false);
                setIsWaiting(false);
                setIsStreaming(false);
            }
            if (e.code === 4003 || e.code === 4002) {
                reconnectDisabledRef.current[key] = true;
                clearReconnectTimer(key);
                if (isActiveRuntime && e.code === 4003) setAgentExpired(true);
                return;
            }
            scheduleReconnect();
        };
        ws.onerror = (error) => {
            const isActiveRuntime = currentAgentIdRef.current === agentId && activeSessionIdRef.current === sessionId;
            if (isActiveRuntime) setWsConnected(false);
            console.warn(`WebSocket error for session ${sessionId}:`, error);
            // Error automatically triggers onclose with abnormal code, which handles reconnect
        };
        ws.onmessage = (e) => {
            const d = JSON.parse(e.data);
            const isActiveRuntime = currentAgentIdRef.current === agentId && activeSessionIdRef.current === sessionId;
            if (['thinking', 'chunk', 'tool_call', 'done', 'error', 'quota_exceeded'].includes(d.type)) {
                const nextStreaming = ['thinking', 'chunk', 'tool_call'].includes(d.type);
                const endStreaming = ['done', 'error', 'quota_exceeded'].includes(d.type);
                setSessionUiState(key, {
                    isWaiting: false,
                    isStreaming: endStreaming ? false : nextStreaming,
                });
            }
            if (!isActiveRuntime) {
                if (['done', 'error', 'quota_exceeded', 'trigger_notification'].includes(d.type)) {
                    fetchMySessions(true, agentId);
                }
                if (['done', 'error', 'quota_exceeded'].includes(d.type)) {
                    closeSessionSocket(key, true);
                }
                return;
            }

            if (['thinking', 'chunk', 'tool_call', 'done', 'error', 'quota_exceeded'].includes(d.type)) {
                setIsWaiting(false);
                if (['thinking', 'chunk', 'tool_call'].includes(d.type)) setIsStreaming(true);
                if (['done', 'error', 'quota_exceeded'].includes(d.type)) setIsStreaming(false);
            }

            if (d.type === 'thinking') {
                setChatMessages(prev => {
                    const last = prev[prev.length - 1];
                    if (last && last.role === 'assistant' && (last as any)._streaming) {
                        return [...prev.slice(0, -1), { ...last, thinking: (last.thinking || '') + d.content } as any];
                    }
                    return [...prev, { role: 'assistant', content: '', thinking: d.content, _streaming: true } as any];
                });
            } else if (d.type === 'tool_call') {
                setChatMessages(prev => {
                    const toolMsg: ChatMsg = { role: 'tool_call', content: '', toolName: d.name, toolArgs: d.args, toolStatus: d.status, toolResult: d.result };
                    if (d.status === 'done') {
                        const lastIdx = prev.length - 1;
                        const last = prev[lastIdx];
                        if (last && last.role === 'tool_call' && last.toolName === d.name && last.toolStatus === 'running') return [...prev.slice(0, lastIdx), toolMsg];
                    }
                    return [...prev, toolMsg];
                });
            } else if (d.type === 'chunk') {
                setChatMessages(prev => {
                    const last = prev[prev.length - 1];
                    if (last && last.role === 'assistant' && (last as any)._streaming) return [...prev.slice(0, -1), { ...last, content: last.content + d.content } as any];
                    return [...prev, { role: 'assistant', content: d.content, _streaming: true } as any];
                });
            } else if (d.type === 'done') {
                setChatMessages(prev => {
                    const last = prev[prev.length - 1];
                    const thinking = (last && last.role === 'assistant' && (last as any)._streaming) ? last.thinking : undefined;
                    if (last && last.role === 'assistant' && (last as any)._streaming) return [...prev.slice(0, -1), parseChatMsg({ role: 'assistant', content: d.content, thinking, timestamp: new Date().toISOString() })];
                    return [...prev, parseChatMsg({ role: d.role, content: d.content, timestamp: new Date().toISOString() })];
                });
                fetchMySessions(true, agentId);
            } else if (d.type === 'error' || d.type === 'quota_exceeded') {
                const msg = d.content || d.detail || d.message || 'Request denied';
                setChatMessages(prev => {
                    const last = prev[prev.length - 1];
                    if (last && last.role === 'assistant' && last.content === `⚠️ ${msg}`) return prev;
                    return [...prev, parseChatMsg({ role: 'assistant', content: `⚠️ ${msg}` })];
                });
                if (msg.includes('expired') || msg.includes('Setup failed') || msg.includes('no LLM model') || msg.includes('No model')) {
                    reconnectDisabledRef.current[key] = true;
                    if (msg.includes('expired')) setAgentExpired(true);
                }
            } else if (d.type === 'trigger_notification') {
                setChatMessages(prev => [...prev, parseChatMsg({ role: 'assistant', content: d.content })]);
                fetchMySessions(true, agentId);
            } else {
                setChatMessages(prev => [...prev, parseChatMsg({ role: d.role, content: d.content })]);
            }
        };
    };

    useEffect(() => {
        if (!id || !token || activeTab !== 'chat') return;
        if (!activeSession) {
            syncActiveSocketState(null, id);
            return;
        }
        activeSessionIdRef.current = String(activeSession.id);
        if (!isWritableSession(activeSession)) {
            syncActiveSocketState(activeSession, id);
            return;
        }
        ensureSessionSocket(activeSession, id, token);
        syncActiveSocketState(activeSession, id);
    }, [id, token, activeTab, activeSession?.id]);

    useEffect(() => {
        return () => {
            sessionMsgAbortRef.current?.abort();
            Object.keys(reconnectDisabledRef.current).forEach((key) => { reconnectDisabledRef.current[key] = true; });
            Object.keys(reconnectTimerRef.current).forEach((key) => clearReconnectTimer(key));
            Object.values(wsMapRef.current).forEach((ws) => {
                if (ws.readyState !== WebSocket.CLOSED) ws.close();
            });
            wsMapRef.current = {};
            wsRef.current = null;
        };
    }, []);

    // Smart scroll: only auto-scroll if user is at the bottom
    const isNearBottom = useRef(true);
    const isFirstLoad = useRef(true);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    // Read-only history scroll-to-bottom
    const historyContainerRef = useRef<HTMLDivElement>(null);
    const [showHistoryScrollBtn, setShowHistoryScrollBtn] = useState(false);
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
    // Auto-show button when history messages overflow the container
    useEffect(() => {
        const el = historyContainerRef.current;
        if (!el) return;
        // Use a small timeout to let the DOM render the messages first
        const timer = setTimeout(() => {
            const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            setShowHistoryScrollBtn(distFromBottom > 200);
        }, 100);
        return () => clearTimeout(timer);
    }, [historyMsgs, activeSession?.id]);
    // Memoized component for each chat message to avoid re-renders while typing
    const ChatMessageItem = React.useMemo(() => React.memo(({ msg, i, isLeft, t }: { msg: any, i: number, isLeft: boolean, t: any }) => {
        const fe = msg.fileName?.split('.').pop()?.toLowerCase() ?? '';
        const fi = fe === 'pdf' ? '📄' : (fe === 'csv' || fe === 'xlsx' || fe === 'xls') ? '📊' : (fe === 'docx' || fe === 'doc') ? '📝' : '📎';
        const isImage = msg.imageUrl && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(fe);
        
        const timestampHtml = msg.timestamp ? (() => {
            const d = new Date(msg.timestamp);
            const now = new Date();
            const diffMs = now.getTime() - d.getTime();
            const isToday = d.toDateString() === now.toDateString();
            let timeStr = '';
            if (isToday) timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            else if (diffMs < 7 * 86400000) timeStr = d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            else timeStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return (
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px', opacity: 0.6, display: 'flex', alignItems: 'center', justifyContent: isLeft ? 'flex-start' : 'flex-end' }}>
                    {timeStr}
                    {msg.content && <CopyMessageButton text={msg.content} />}
                </div>
            );
        })() : null;

        return (
            <div key={i} style={{ display: 'flex', flexDirection: isLeft ? 'row' : 'row-reverse', gap: '8px', marginBottom: '8px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: isLeft ? 'var(--bg-elevated)' : 'rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', flexShrink: 0, color: 'var(--text-secondary)', fontWeight: 600 }}>{isLeft ? (msg.sender_name ? msg.sender_name[0] : 'A') : 'U'}</div>
                <div style={{ maxWidth: '75%', padding: '8px 12px', borderRadius: '12px', background: isLeft ? 'var(--bg-secondary)' : 'rgba(16,185,129,0.1)', fontSize: '13px', lineHeight: '1.5', wordBreak: 'break-word' }}>
                    {isLeft && msg.sender_name && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '2px', fontWeight: 600 }}>🤖 {msg.sender_name}</div>}
                    {isImage ? (
                        <div style={{ marginBottom: '4px' }}>
                            <img src={msg.imageUrl} alt={msg.fileName} style={{ maxWidth: '200px', maxHeight: '150px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }} loading="lazy" />
                        </div>
                    ) : (msg.fileName && (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: isLeft ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.08)', borderRadius: '6px', padding: '4px 8px', marginBottom: msg.content ? '4px' : '0', fontSize: '11px', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                            <span>{fi}</span>
                            <span style={{ fontWeight: 500, color: 'var(--text-primary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.fileName}</span>
                        </div>
                    ))}
                    {msg.thinking && (
                        <details style={{ marginBottom: '8px', fontSize: '12px', background: 'rgba(147, 130, 220, 0.08)', borderRadius: '6px', border: '1px solid rgba(147, 130, 220, 0.15)' }}>
                            <summary style={{ padding: '6px 10px', cursor: 'pointer', color: 'rgba(147, 130, 220, 0.9)', fontWeight: 500, userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>💭 Thinking</summary>
                            <div style={{ padding: '4px 10px 8px', fontSize: '12px', lineHeight: '1.6', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '300px', overflow: 'auto' }}>{msg.thinking}</div>
                        </details>
                    )}
                    {msg.role === 'assistant' ? (
                        (msg as any)._streaming && !msg.content ? (
                            <div className="thinking-indicator">
                                <div className="thinking-dots"><span /><span /><span /></div>
                                <span style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>{t('agent.chat.thinking', 'Thinking...')}</span>
                            </div>
                        ) : <MarkdownRenderer content={msg.content} />
                    ) : <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>}
                    {timestampHtml}
                </div>
            </div>
        );
    }), [t]);

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
            // First load: instant jump to bottom, no animation
            chatEndRef.current.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
            isFirstLoad.current = false;
            // Auto-focus the input
            setTimeout(() => chatInputRef.current?.focus(), 100);
            return;
        }
        if (isNearBottom.current) {
            chatEndRef.current.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
        }
    }, [chatMessages]);

    // Auto-focus input when switching sessions
    useEffect(() => {
        if (activeSession && activeTab === 'chat') {
            setTimeout(() => chatInputRef.current?.focus(), 150);
        }
    }, [activeSession?.id, activeTab]);

    const sendChatMsg = () => {
        if (!id || !activeSession?.id) return;
        const activeRuntimeKey = buildSessionRuntimeKey(id, String(activeSession.id));
        const activeSocket = wsMapRef.current[activeRuntimeKey];
        if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) return;
        if (!chatInput.trim() && attachedFiles.length === 0) return;
        
        let userMsg = chatInput.trim();
        let contentForLLM = userMsg;
        let displayFiles = '';

        if (attachedFiles.length > 0) {
            let filesPrompt = '';
            let filesDisplay = '';
            
            attachedFiles.forEach(file => {
                filesDisplay += `[📎 ${file.name}] `;
                if (file.imageUrl && supportsVision) {
                    filesPrompt += `[image_data:${file.imageUrl}]\n`;
                } else if (file.imageUrl) {
                    filesPrompt += `[图片文件已上传: ${file.name}，保存在 ${file.path || ''}]\n`;
                } else {
                    const wsPath = file.path || '';
                    const codePath = wsPath.replace(/^workspace\//, '');
                    const fileLoc = wsPath ? `\nFile location: ${wsPath} (for read_file/read_document tools)\nIn execute_code, use relative path: "${codePath}" (working directory is workspace/)\n` : '';
                    filesPrompt += `[File: ${file.name}]${fileLoc}\n${file.text}\n\n`;
                }
            });

            if (supportsVision && attachedFiles.some(f => f.imageUrl)) {
                contentForLLM = userMsg ? `${filesPrompt}\n${userMsg}` : `${filesPrompt}\n请分析这些文件`;
            } else {
                contentForLLM = userMsg ? `${filesPrompt}\nQuestion: ${userMsg}` : `Please analyze these files:\n\n${filesPrompt}`;
            }
            
            displayFiles = filesDisplay.trim();
            userMsg = userMsg ? `${displayFiles}\n${userMsg}` : displayFiles;
        }

        setIsWaiting(true);
        setIsStreaming(false);
        setSessionUiState(activeRuntimeKey, { isWaiting: true, isStreaming: false });
        setChatMessages(prev => [...prev, parseChatMsg({ 
            role: 'user', 
            content: userMsg, 
            fileName: attachedFiles.map(f => f.name).join(', '), 
            imageUrl: attachedFiles.length === 1 ? attachedFiles[0].imageUrl : undefined, 
            timestamp: new Date().toISOString() 
        })]);
        activeSocket.send(JSON.stringify({
            content: contentForLLM, 
            display_content: userMsg, 
            file_name: attachedFiles.map(f => f.name).join(', ') 
        }));
        
        setChatInput(''); 
        setAttachedFiles([]);
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
            const uploadPromises = allowedFiles.map(file => {
                const { promise } = uploadFileWithProgress(
                    `/chat/upload`,
                    file,
                    () => {}, // Avoid updating progress per file to prevent flickering, could implement total progress
                    id ? { agent_id: id } : undefined,
                );
                return promise;
            });
            const results = await Promise.all(uploadPromises);
            const newAttached = results.map(data => ({
                name: data.filename, text: data.extracted_text, path: data.workspace_path, imageUrl: data.image_data_url || undefined
            }));
            setAttachedFiles(prev => [...prev, ...newAttached].slice(0, 10));
        } catch (err: any) {
            if (err?.message !== 'Upload cancelled') alert(t('agent.upload.failed'));
        } finally { 
            setUploading(false); setUploadProgress(-1); uploadAbortRef.current = null; 
            if (fileInputRef.current) fileInputRef.current.value = ''; 
        }
    };

    // Clipboard paste handler — auto-upload pasted images
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
            const uploadPromises = allowedFiles.map(file => {
                const { promise } = uploadFileWithProgress(
                    `/chat/upload`,
                    file,
                    () => {},
                    id ? { agent_id: id } : undefined,
                );
                return promise;
            });
            const results = await Promise.all(uploadPromises);
            const newAttached = results.map(data => ({
                name: data.filename, text: data.extracted_text, path: data.workspace_path, imageUrl: data.image_data_url || undefined
            }));
            setAttachedFiles(prev => [...prev, ...newAttached].slice(0, 10));
        } catch (err: any) {
            if (err?.message !== 'Upload cancelled') alert(t('agent.upload.failed'));
        } finally { setUploading(false); setUploadProgress(-1); uploadAbortRef.current = null; }
    };

    // Expandable activity log
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
    const [logFilter, setLogFilter] = useState<string>('user'); // 'user' | 'backend' | 'heartbeat' | 'schedule' | 'messages'

    const { data: schedules = [] } = useQuery({
        queryKey: ['schedules', id],
        queryFn: () => scheduleApi.list(id!),
        enabled: !!id && activeTab === 'tasks',
    });

    // Schedule form state
    const [showScheduleForm, setShowScheduleForm] = useState(false);
    const schedDefaults = { freq: 'daily', interval: 1, time: '09:00', weekdays: [1, 2, 3, 4, 5] };
    const [schedForm, setSchedForm] = useState({ name: '', instruction: '', schedule: JSON.stringify(schedDefaults), due_date: '' });

    const createScheduleMut = useMutation({
        mutationFn: () => {
            let sched: any;
            try { sched = JSON.parse(schedForm.schedule); } catch { sched = schedDefaults; }
            return scheduleApi.create(id!, { name: schedForm.name, instruction: schedForm.instruction, cron_expr: schedToCron(sched) });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schedules', id] });
            setShowScheduleForm(false);
            setSchedForm({ name: '', instruction: '', schedule: JSON.stringify(schedDefaults), due_date: '' });
        },
        onError: (err: any) => {
            const msg = err?.detail || err?.message || String(err);
            alert(`Failed to create schedule: ${msg}`);
        },
    });

    const toggleScheduleMut = useMutation({
        mutationFn: ({ sid, enabled }: { sid: string; enabled: boolean }) =>
            scheduleApi.update(id!, sid, { is_enabled: enabled }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules', id] }),
    });

    const deleteScheduleMut = useMutation({
        mutationFn: (sid: string) => scheduleApi.delete(id!, sid),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules', id] }),
    });

    const triggerScheduleMut = useMutation({
        mutationFn: async (sid: string) => {
            const res = await scheduleApi.trigger(id!, sid);
            return res;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schedules', id] });
            showToast('✅ Schedule triggered — executing in background', 'success');
        },
        onError: (err: any) => {
            const msg = err?.response?.data?.detail || err?.message || 'Failed to trigger schedule';
            showToast(msg, 'error');
        },
    });


    const { data: metrics } = useQuery({
        queryKey: ['metrics', id],
        queryFn: () => agentApi.getMetrics(id!).catch(() => null),
        enabled: !!id && activeTab === 'status',
        retry: false,
    });

    const { data: channelConfig } = useQuery({
        queryKey: ['channel', id],
        queryFn: () => channelApi.get(id!),
        enabled: !!id && activeTab === 'settings',
    });

    const { data: webhookData } = useQuery({
        queryKey: ['webhook-url', id],
        queryFn: () => channelApi.webhookUrl(id!),
        enabled: !!id && activeTab === 'settings',
    });

    const { data: llmModels = [] } = useQuery({
        queryKey: ['llm-models'],
        queryFn: () => enterpriseApi.llmModels(),
        enabled: activeTab === 'settings' || activeTab === 'status' || activeTab === 'chat',
    });

    const supportsVision = !!agent?.primary_model_id && llmModels.some(
        (m: any) => m.id === agent.primary_model_id && m.supports_vision
    );

    const { data: permData } = useQuery({
        queryKey: ['agent-permissions', id],
        queryFn: () => agentApi.getPermissions(id!),
        enabled: !!id && activeTab === 'settings',
    });

    // ─── Soul editor ─────────────────────────────────────
    const [soulEditing, setSoulEditing] = useState(false);
    const [soulDraft, setSoulDraft] = useState('');

    const saveSoul = useMutation({
        mutationFn: () => fileApi.write(id!, 'soul.md', soulDraft),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['file', id, 'soul.md'] });
            setSoulEditing(false);
        },
    });


    const CopyBtn = ({ url }: { url: string }) => (
        <button title="Copy" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginLeft: '6px', padding: '1px 4px', cursor: 'pointer', borderRadius: '3px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-secondary)', verticalAlign: 'middle', lineHeight: 1 }}
            onClick={() => navigator.clipboard.writeText(url).then(() => { })}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="9" height="11" rx="1.5" /><path d="M3 11H2a1 1 0 01-1-1V2a1 1 0 011-1h8a1 1 0 011 1v1" />
            </svg>
        </button>
    );

    // ─── File viewer ─────────────────────────────────────
    const [viewingFile, setViewingFile] = useState<string | null>(null);
    const [fileEditing, setFileEditing] = useState(false);
    const [fileDraft, setFileDraft] = useState('');
    const [promptModal, setPromptModal] = useState<{ title: string; placeholder: string; action: string } | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; name: string; isDir: boolean } | null>(null);
    const [uploadToast, setUploadToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [editingRole, setEditingRole] = useState(false);
    const [roleInput, setRoleInput] = useState('');
    const [editingName, setEditingName] = useState(false);
    const [nameInput, setNameInput] = useState('');
    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setUploadToast({ message, type });
        setTimeout(() => setUploadToast(null), 3000);
    };
    const { data: fileContent } = useQuery({
        queryKey: ['file-content', id, viewingFile],
        queryFn: () => fileApi.read(id!, viewingFile!),
        enabled: !!viewingFile,
    });

    // ─── Task creation & detail ───────────────────────────────────
    const [showTaskForm, setShowTaskForm] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [taskForm, setTaskForm] = useState({ title: '', description: '', priority: 'medium', type: 'todo' as 'todo' | 'supervision', supervision_target_name: '', remind_schedule: '', due_date: '' });
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const { data: taskLogs = [] } = useQuery({
        queryKey: ['task-logs', id, selectedTaskId],
        queryFn: () => taskApi.getLogs(id!, selectedTaskId!),
        enabled: !!id && !!selectedTaskId,
        refetchInterval: selectedTaskId ? 3000 : false,
    });

    // Schedule execution history (selectedTaskId format: 'sched-{uuid}')
    const expandedScheduleId = selectedTaskId?.startsWith('sched-') ? selectedTaskId.slice(6) : null;
    const { data: scheduleHistoryData } = useQuery({
        queryKey: ['schedule-history', id, expandedScheduleId],
        queryFn: () => scheduleApi.history(id!, expandedScheduleId!),
        enabled: !!id && !!expandedScheduleId,
    });
    const createTask = useMutation({
        mutationFn: (data: any) => {
            const cleaned = { ...data };
            if (!cleaned.due_date) delete cleaned.due_date;
            return taskApi.create(id!, cleaned);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tasks', id] });
            setShowTaskForm(false);
            setTaskForm({ title: '', description: '', priority: 'medium', type: 'todo', supervision_target_name: '', remind_schedule: '', due_date: '' });
        },
    });

    if (isLoading || !agent) {
        return <div style={{ padding: '40px', color: 'var(--text-tertiary)' }}>{t('common.loading')}</div>;
    }

    // Compute display status (including OpenClaw disconnected detection)
    const computeStatusKey = () => {
        if (agent.status === 'error') return 'error';
        if (agent.status === 'creating') return 'creating';
        if (agent.status === 'stopped') return 'stopped';
        if ((agent as any).agent_type === 'openclaw' && agent.status === 'running' && (agent as any).openclaw_last_seen) {
            const elapsed = Date.now() - new Date((agent as any).openclaw_last_seen).getTime();
            if (elapsed > 60 * 60 * 1000) return 'disconnected';
        }
        return agent.status === 'running' ? 'running' : 'idle';
    };
    const statusKey = computeStatusKey();
    const canManage = (agent as any).access_level === 'manage' || isAdmin;

    return (
        <>
            <div>
                {/* Header */}
                <div className="page-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--accent-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>{(Array.from(agent.name || 'A')[0] as string || 'A').toUpperCase()}</div>
                        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                            {canManage && editingName ? (
                                <input
                                    className="page-title"
                                    autoFocus
                                    value={nameInput}
                                    onChange={e => setNameInput(e.target.value)}
                                    onBlur={async () => {
                                        setEditingName(false);
                                        if (nameInput.trim() && nameInput !== agent.name) {
                                            await agentApi.update(id!, { name: nameInput.trim() } as any);
                                            queryClient.invalidateQueries({ queryKey: ['agent', id] });
                                        } else {
                                            setNameInput(agent.name);
                                        }
                                    }}
                                    onKeyDown={async e => {
                                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                        if (e.key === 'Escape') { setEditingName(false); setNameInput(agent.name); }
                                    }}
                                    style={{
                                        background: 'var(--bg-elevated)', border: '1px solid var(--accent-primary)',
                                        borderRadius: '6px', color: 'var(--text-primary)',
                                        padding: '4px 10px', minWidth: '320px', width: 'auto', outline: 'none',
                                        marginBottom: '0', display: 'block',
                                    }}
                                />
                            ) : (
                                <h1 className="page-title"
                                    title={canManage ? "Click to edit name" : undefined}
                                    onClick={() => { if (canManage) { setNameInput(agent.name); setEditingName(true); } }}
                                    style={{ cursor: canManage ? 'text' : 'default', borderBottom: canManage ? '1px dashed transparent' : 'none', display: 'inline-block', marginBottom: '0' }}
                                    onMouseEnter={e => { if (canManage) e.currentTarget.style.borderBottomColor = 'var(--text-tertiary)'; }}
                                    onMouseLeave={e => { if (canManage) e.currentTarget.style.borderBottomColor = 'transparent'; }}
                                >
                                    {agent.name}
                                </h1>
                            )}
                            <p className="page-subtitle" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                                <span className={`status-dot ${statusKey}`} />
                                {t(`agent.status.${statusKey}`)}
                                {canManage && editingRole ? (
                                    <textarea
                                        autoFocus
                                        value={roleInput}
                                        onChange={e => setRoleInput(e.target.value)}
                                        onBlur={async () => {
                                            setEditingRole(false);
                                            if (roleInput !== agent.role_description) {
                                                await agentApi.update(id!, { role_description: roleInput } as any);
                                                queryClient.invalidateQueries({ queryKey: ['agent', id] });
                                            }
                                        }}
                                        onKeyDown={async e => {
                                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
                                            if (e.key === 'Escape') { setEditingRole(false); setRoleInput(agent.role_description || ''); }
                                        }}
                                        rows={2}
                                        style={{
                                            background: 'var(--bg-elevated)', border: '1px solid var(--accent-primary)',
                                            borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px',
                                            padding: '6px 10px', width: 'min(500px, 50vw)', outline: 'none',
                                            resize: 'vertical', lineHeight: '1.5', fontFamily: 'inherit',
                                        }}
                                    />
                                ) : (
                                    <span
                                        title={canManage ? (agent.role_description || 'Click to edit') : (agent.role_description || '')}
                                        onClick={() => { if (canManage) { setRoleInput(agent.role_description || ''); setEditingRole(true); } }}
                                        style={{ cursor: canManage ? 'text' : 'default', borderBottom: canManage ? '1px dashed transparent' : 'none', maxWidth: '38vw', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'middle' }}
                                        onMouseEnter={e => { if (canManage) e.currentTarget.style.borderBottomColor = 'var(--text-tertiary)'; }}
                                        onMouseLeave={e => { if (canManage) e.currentTarget.style.borderBottomColor = 'transparent'; }}
                                    >
                                        {agent.role_description ? `· ${agent.role_description}` : (canManage ? <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>· {t('agent.fields.role', 'Click to add a description...')}</span> : null)}
                                    </span>
                                )}
                                {(agent as any).is_expired && (
                                    <span style={{ background: 'var(--error)', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>Expired</span>
                                )}
                                {(agent as any).agent_type === 'openclaw' && (
                                    <span style={{
                                        fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
                                        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', fontWeight: 600,
                                        letterSpacing: '0.5px',
                                    }}>OpenClaw · Lab</span>
                                )}
                                {!(agent as any).is_expired && (agent as any).expires_at && (
                                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                        Expires: {new Date((agent as any).expires_at).toLocaleString()}
                                    </span>
                                )}
                                {isAdmin && (
                                    <button
                                        onClick={openExpiryModal}
                                        title="Edit expiry time"
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--text-tertiary)', padding: '1px 4px', borderRadius: '4px', lineHeight: 1 }}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                    >✏️ {t((agent as any).expires_at || (agent as any).is_expired ? 'agent.settings.expiry.renew' : 'agent.settings.expiry.setExpiry')}</button>
                                )}
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-primary" onClick={() => setActiveTab('chat')}>{t('agent.actions.chat')}</button>
                        {(agent as any)?.agent_type !== 'openclaw' && (
                            <>
                                {agent.status === 'stopped' ? (
                                    <button className="btn btn-secondary" onClick={async () => { await agentApi.start(id!); queryClient.invalidateQueries({ queryKey: ['agent', id] }); }}>{t('agent.actions.start')}</button>
                                ) : agent.status === 'running' ? (
                                    <button className="btn btn-secondary" onClick={async () => { await agentApi.stop(id!); queryClient.invalidateQueries({ queryKey: ['agent', id] }); }}>{t('agent.actions.stop')}</button>
                                ) : null}
                            </>
                        )}
                    </div>
                </div>

                {/* Tabs */}
                <div className="tabs">
                    {TABS.filter(tab => {
                        // 'use' access: hide settings and approvals tabs
                        if ((agent as any)?.access_level === 'use') {
                            if (tab === 'settings' || tab === 'approvals') return false;
                        }
                        // OpenClaw agents: only show status, chat, activityLog, settings
                        if ((agent as any)?.agent_type === 'openclaw') {
                            return ['status', 'relationships', 'chat', 'activityLog', 'settings'].includes(tab);
                        }
                        return true;
                    }).map((tab) => (
                        <div key={tab} className={`tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
                            {t(`agent.tabs.${tab}`)}
                        </div>
                    ))}
                </div>

                {/* ── Enhanced Status Tab ── */}
                {activeTab === 'status' && (
                    <AgentStatusSection
                        agent={agent}
                        llmModels={llmModels}
                        metrics={metrics}
                        activityLogs={activityLogs}
                        statusKey={statusKey}
                        onSelectTab={setActiveTab}
                    />
                )}

                {/* ── Aware Tab ── */}
                {activeTab === 'aware' && (
                    <AgentAwareSection
                        agentId={id!}
                        focusContent={focusFile?.content || ''}
                        awareTriggers={awareTriggers}
                        activityLogs={activityLogs}
                        reflectionSessions={reflectionSessions}
                        reflectionMessages={reflectionMessages}
                        expandedFocus={expandedFocus}
                        expandedReflection={expandedReflection}
                        showAllFocus={showAllFocus}
                        showCompletedFocus={showCompletedFocus}
                        showAllTriggers={showAllTriggers}
                        reflectionPage={reflectionPage}
                        onSetExpandedFocus={setExpandedFocus}
                        onSetExpandedReflection={setExpandedReflection}
                        onSetReflectionMessages={setReflectionMessages}
                        onSetShowAllFocus={setShowAllFocus}
                        onSetShowCompletedFocus={setShowCompletedFocus}
                        onSetShowAllTriggers={setShowAllTriggers}
                        onSetReflectionPage={setReflectionPage}
                        onRefetchTriggers={refetchTriggers}
                    />
                )}


                {/* ── Mind Tab (Soul + Memory + Heartbeat) ── */}
                {activeTab === 'mind' && <AgentMindSection agentId={id!} canEdit={(agent as any)?.access_level !== 'use'} />}

                {/* ── Tools Tab ── */}
                {
                    activeTab === 'tools' && (
                        <div>
                            <div style={{ marginBottom: '16px' }}>
                                <h3 style={{ marginBottom: '4px' }}>{t('agent.toolMgmt.title')}</h3>
                                <p style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>{t('agent.toolMgmt.description')}</p>
                            </div>
                            <ToolsManager agentId={id!} canManage={canManage} />
                        </div>
                    )
                }

                {/* ── Skills Tab ── */}
                {
                    activeTab === 'skills' && <AgentSkillsSection agentId={id!} />
                }

                {/* ── Relationships Tab ── */}
                {
                    activeTab === 'relationships' && (
                        <RelationshipEditor agentId={id!} readOnly={(agent as any)?.access_level === 'use'} />
                    )
                }

                {/* ── Workspace Tab ── */}
                {
                    activeTab === 'workspace' && <AgentWorkspaceSection agentId={id!} />
                }

                {
                    activeTab === 'chat' && (
                        <div style={{ display: 'flex', gap: '0', flex: 1, minHeight: 0, height: 'calc(100vh - 206px)' }}>
                            {/* ── Left: session sidebar ── */}
                            <div style={{ width: '220px', flexShrink: 0, borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                {/* Tab row */}
                                <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px 0', gap: '4px', borderBottom: '1px solid var(--border-subtle)' }}>
                                    <button onClick={() => setChatScope('mine')}
                                        style={{ flex: 1, padding: '5px 0', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: chatScope === 'mine' ? 600 : 400, color: chatScope === 'mine' ? 'var(--text-primary)' : 'var(--text-tertiary)', borderBottom: chatScope === 'mine' ? '2px solid var(--accent-primary)' : '2px solid transparent', paddingBottom: '8px' }}>
                                        {t('agent.chat.mySessions')}
                                    </button>
                                    {isAdmin && (
                                        <button onClick={() => { setChatScope('all'); fetchAllSessions(); }}
                                            style={{ flex: 1, padding: '5px 0', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: chatScope === 'all' ? 600 : 400, color: chatScope === 'all' ? 'var(--text-primary)' : 'var(--text-tertiary)', borderBottom: chatScope === 'all' ? '2px solid var(--accent-primary)' : '2px solid transparent', paddingBottom: '8px' }}>
                                            {t('agent.chat.allUsers')}
                                        </button>
                                    )}
                                </div>

                                {/* Actions row */}
                                {chatScope === 'mine' && (
                                    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                                        <button onClick={createNewSession}
                                            style={{ width: '100%', padding: '5px 8px', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '6px' }}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-secondary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
                                            + {t('agent.chat.newSession')}
                                        </button>
                                    </div>
                                )}

                                {/* Session list */}
                                <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                                    {chatScope === 'mine' ? (
                                        sessionsLoading ? (
                                            <div style={{ padding: '20px 12px', fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('common.loading')}</div>
                                        ) : sessions.length === 0 ? (
                                            <div style={{ padding: '20px 12px', fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('agent.chat.noSessionsYet')}<br />{t('agent.chat.clickToStart')}</div>
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
                                                <div key={s.id} onClick={() => selectSession(s)}
                                                    className="session-item"
                                                    style={{ padding: '8px 12px', cursor: 'pointer', borderLeft: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent', background: isActive ? 'var(--bg-secondary)' : 'transparent', marginBottom: '1px', position: 'relative' }}
                                                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-secondary)'; const btn = e.currentTarget.querySelector('.del-btn') as HTMLElement; if (btn) btn.style.opacity = '0.5'; }}
                                                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; const btn = e.currentTarget.querySelector('.del-btn') as HTMLElement; if (btn) btn.style.opacity = '0'; }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                                                        <div style={{ fontSize: '12px', fontWeight: isActive ? 600 : 400, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{s.title}</div>
                                                        {chLabel && <span style={{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px', background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', flexShrink: 0 }}>{chLabel}</span>}
                                                    </div>
                                                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        {isOwn && isActive && wsConnected && <span className="status-dot running" style={{ width: '5px', height: '5px', flexShrink: 0 }} />}
                                                        {s.last_message_at
                                                            ? new Date(s.last_message_at).toLocaleString(i18n.language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                                            : new Date(s.created_at).toLocaleString(i18n.language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })}
                                                        {s.message_count > 0 && <span style={{ marginLeft: 'auto' }}>{s.message_count}</span>}
                                                    </div>
                                                    <button className="del-btn" onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                                                        style={{ position: 'absolute', top: '4px', right: '4px', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', opacity: 0, fontSize: '14px', color: 'var(--text-tertiary)', lineHeight: 1, transition: 'opacity 0.15s' }}
                                                        onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--status-error)'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
                                                        title={t('chat.deleteSession', 'Delete session')}>×</button>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        /* All Users tab — user filter dropdown + flat list */
                                        <>
                                            {/* User filter dropdown */}
                                            <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
                                                <select
                                                    value={allUserFilter}
                                                    onChange={e => setAllUserFilter(e.target.value)}
                                                    style={{ width: '100%', padding: '4px 6px', fontSize: '11px', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '5px', color: 'var(--text-primary)', cursor: 'pointer' }}
                                                >
                                                    <option value="">All Users</option>
                                                    {Array.from(new Set(allSessions.map((s: any) => s.username || s.user_id))).filter(Boolean).map((u: any) => (
                                                        <option key={u} value={u}>{u}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            {/* Loading skeleton */}
                                            {allSessionsLoading ? (
                                                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    {[...Array(6)].map((_, i) => (
                                                        <div key={i} style={{ padding: '6px 0', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }}>
                                                            <div style={{ height: '12px', width: `${70 + (i % 3) * 10}%`, background: 'var(--bg-tertiary)', borderRadius: '4px', marginBottom: '6px' }} />
                                                            <div style={{ height: '10px', width: `${40 + (i % 4) * 8}%`, background: 'var(--bg-tertiary)', borderRadius: '3px', opacity: 0.6 }} />
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : allSessions.length === 0 ? (
                                                <div style={{ padding: '20px 12px', fontSize: '12px', color: 'var(--text-tertiary)', textAlign: 'center' }}>{t('agent.chat.noSessionsYet')}</div>
                                            ) : null}
                                            {/* Filtered session list */}
                                            {!allSessionsLoading && allSessions
                                                .filter((s: any) => !allUserFilter || (s.username || s.user_id) === allUserFilter)
                                                .map((s: any) => {
                                                    const isActive = activeSession?.id === s.id;
                                                    return (
                                                        <div key={s.id} onClick={() => selectSession(s)}
                                                            className="session-item"
                                                            style={{ padding: '6px 12px', cursor: 'pointer', borderLeft: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent', background: isActive ? 'var(--bg-secondary)' : 'transparent', position: 'relative' }}
                                                            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-secondary)'; const btn = e.currentTarget.querySelector('.del-btn') as HTMLElement; if (btn) btn.style.opacity = '0.5'; }}
                                                            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; const btn = e.currentTarget.querySelector('.del-btn') as HTMLElement; if (btn) btn.style.opacity = '0'; }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '1px' }}>
                                                                <div style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', flex: 1 }}>{s.title}</div>
                                                                {({
                                                                    feishu: t('common.channels.feishu'),
                                                                    discord: t('common.channels.discord'),
                                                                    slack: t('common.channels.slack'),
                                                                    dingtalk: t('common.channels.dingtalk'),
                                                                    wecom: t('common.channels.wecom'),
                                                                } as Record<string, string>)[s.source_channel] && (
                                                                        <span style={{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px', background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', flexShrink: 0 }}>
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
                                                            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', display: 'flex', gap: '4px' }}>
                                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{s.username || ''}</span>
                                                                <span style={{ flexShrink: 0 }}>{s.last_message_at ? new Date(s.last_message_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}{s.message_count > 0 ? ` · ${s.message_count}` : ''}</span>
                                                            </div>
                                                            <button className="del-btn" onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                                                                style={{ position: 'absolute', top: '4px', right: '4px', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', opacity: 0, fontSize: '14px', color: 'var(--text-tertiary)', lineHeight: 1, transition: 'opacity 0.15s' }}
                                                                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--status-error)'; }}
                                                                onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
                                                                title={t('chat.deleteSession', 'Delete session')}>×</button>
                                                        </div>
                                                    );
                                                })}
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* ── Right: chat/message area ── */}
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', minWidth: 0, overflow: 'hidden' }}>
                                {!activeSession ? (
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: '13px', flexDirection: 'column', gap: '8px' }}>
                                        <div>{t('agent.chat.noSessionSelected')}</div>
                                        <button className="btn btn-secondary" onClick={createNewSession} style={{ fontSize: '12px' }}>{t('agent.chat.startNewSession')}</button>
                                    </div>
                                ) : (activeSession.user_id && currentUser && activeSession.user_id !== String(currentUser.id)) || activeSession.source_channel === 'agent' || activeSession.participant_type === 'agent' ? (
                                    /* ── Read-only history view (other user's session or agent-to-agent) ── */
                                    <>
                                        <div ref={historyContainerRef} onScroll={handleHistoryScroll} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '12px', padding: '4px 8px', background: 'var(--bg-secondary)', borderRadius: '4px', display: 'inline-block' }}>
                                                {activeSession.source_channel === 'agent' ? `🤖 Agent Conversation · ${activeSession.username || 'Agents'}` : `Read-only · ${activeSession.username || 'User'}`}
                                            </div>
                                            {(() => {
                                                // For A2A sessions, determine which participant is "this agent" (left side)
                                                // Use agent.name matching against sender_name from messages
                                                const isA2A = activeSession.source_channel === 'agent' || activeSession.participant_type === 'agent';
                                                const thisAgentName = (agent as any)?.name;
                                                // Find this agent's participant_id from loaded messages
                                                const thisAgentPid = isA2A && thisAgentName
                                                    ? historyMsgs.find((m: any) => m.sender_name === thisAgentName)?.participant_id
                                                    : null;
                                                return historyMsgs.map((m: any, i: number) => {
                                                // Determine if this message is from "this agent" (left) or peer (right)
                                                // Actually, "this agent" should be on the RIGHT (like 'me'), and peer on the LEFT
                                                const isLeft = isA2A && thisAgentPid
                                                    ? m.participant_id !== thisAgentPid
                                                    : m.role === 'assistant';
                                            if (m.role === 'tool_call') {
                                                    const tName = m.toolName || (() => { try { return JSON.parse(m.content || '{}').name; } catch { return 'tool'; } })();
                                                    const tArgs = m.toolArgs || (() => { try { return JSON.parse(m.content || '{}').args; } catch { return {}; } })();
                                                    const tResult = m.toolResult ?? (() => { try { return JSON.parse(m.content || '{}').result; } catch { return ''; } })();
                                                    return (
                                                        <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', paddingLeft: '36px', minWidth: 0 }}>
                                                            <details style={{ flex: 1, minWidth: 0, borderRadius: '8px', background: 'var(--accent-subtle)', border: '1px solid var(--accent-subtle)', fontSize: '12px', overflow: 'hidden' }}>
                                                                <summary style={{ padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', userSelect: 'none', listStyle: 'none', overflow: 'hidden' }}>
                                                                    <span style={{ fontSize: '13px' }}>⚡</span>
                                                                    <span style={{ fontWeight: 600, color: 'var(--accent-text)' }}>{tName}</span>
                                                                    {tArgs && typeof tArgs === 'object' && Object.keys(tArgs).length > 0 && <span style={{ color: 'var(--text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{`(${Object.entries(tArgs).map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 30) : JSON.stringify(v)}`).join(', ')})`}</span>}
                                                                </summary>
                                                                {tResult && <div style={{ padding: '4px 10px 8px' }}><div style={{ color: 'var(--text-secondary)', fontSize: '11px', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '240px', overflow: 'auto', background: 'rgba(0,0,0,0.15)', borderRadius: '4px', padding: '4px 6px' }}>{tResult}</div></div>}
                                                            </details>
                                                        </div>
                                                    );
                                                }

                                                {/* Assistant message with no content: show inline thinking or skip */}
                                                if (m.role === 'assistant' && !m.content?.trim()) {
                                                    if (m.thinking) {
                                                        return (
                                                            <div key={i} style={{ paddingLeft: '36px', marginBottom: '6px' }}>
                                                                <details style={{
                                                                    fontSize: '12px',
                                                                    background: 'rgba(147, 130, 220, 0.08)', borderRadius: '6px',
                                                                    border: '1px solid rgba(147, 130, 220, 0.15)',
                                                                }}>
                                                                    <summary style={{
                                                                        padding: '6px 10px', cursor: 'pointer',
                                                                        color: 'rgba(147, 130, 220, 0.9)', fontWeight: 500,
                                                                        userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px',
                                                                    }}>Thinking</summary>
                                                                    <div style={{
                                                                        padding: '4px 10px 8px',
                                                                        fontSize: '12px', lineHeight: '1.6',
                                                                        color: 'var(--text-secondary)',
                                                                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                                                        maxHeight: '300px', overflow: 'auto',
                                                                    }}>{m.thinking}</div>
                                                                </details>
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                }
                                                return (
                                                    <ChatMessageItem key={i} msg={m} i={i} isLeft={isLeft} t={t} />
                                                );
                                            });
                                            })()}
                                        </div>
                                        {showHistoryScrollBtn && (
                                            <button onClick={scrollHistoryToBottom} style={{ position: 'absolute', bottom: '20px', right: '20px', width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', zIndex: 10 }} title="Scroll to bottom">↓</button>
                                        )}
                                    </>
                                ) : (
                                    /* ── Live WebSocket chat (own session) ── */
                                    <>
                                        <div ref={chatContainerRef} onScroll={handleChatScroll} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                                            {chatMessages.length === 0 && (
                                                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-tertiary)' }}>
                                                    <div style={{ fontSize: '13px', marginBottom: '4px' }}>{activeSession?.title || t('agent.chat.startChat')}</div>
                                                    <div style={{ fontSize: '12px' }}>{t('agent.chat.startConversation', { name: agent.name })}</div>
                                                    <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.7 }}>{t('agent.chat.fileSupport')}</div>
                                                </div>
                                            )}
                                            {chatMessages.map((msg, i) => {
                                                if (msg.role === 'tool_call') {
                                                    return (
                                                        <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', paddingLeft: '36px', minWidth: 0 }}>
                                                            <details style={{ flex: 1, minWidth: 0, borderRadius: '8px', background: 'var(--accent-subtle)', border: '1px solid var(--accent-subtle)', fontSize: '12px', overflow: 'hidden' }}>
                                                                <summary style={{ padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', userSelect: 'none', listStyle: 'none', overflow: 'hidden' }}>
                                                                    <span style={{ fontSize: '13px' }}>{msg.toolStatus === 'running' ? '⏳' : '⚡'}</span>
                                                                    <span style={{ fontWeight: 600, color: 'var(--accent-text)' }}>{msg.toolName}</span>
                                                                    {msg.toolArgs && Object.keys(msg.toolArgs).length > 0 && <span style={{ color: 'var(--text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{`(${Object.entries(msg.toolArgs).map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 30) : JSON.stringify(v)}`).join(', ')})`}</span>}
                                                                    {msg.toolStatus === 'running' && <span style={{ color: 'var(--text-tertiary)', fontSize: '11px', marginLeft: 'auto' }}>{t('common.loading')}</span>}
                                                                </summary>
                                                                {msg.toolResult && <div style={{ padding: '4px 10px 8px' }}><div style={{ color: 'var(--text-secondary)', fontSize: '11px', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '240px', overflow: 'auto', background: 'rgba(0,0,0,0.15)', borderRadius: '4px', padding: '4px 6px' }}>{msg.toolResult}</div></div>}
                                                            </details>
                                                        </div>
                                                    );
                                                }
                                                {/* Assistant message with no text content: show inline thinking or skip */}
                                                if (msg.role === 'assistant' && !msg.content?.trim()) {
                                                    if (msg.thinking) {
                                                        return (
                                                            <div key={i} style={{ paddingLeft: '36px', marginBottom: '6px' }}>
                                                                <details style={{
                                                                    fontSize: '12px',
                                                                    background: 'rgba(147, 130, 220, 0.08)', borderRadius: '6px',
                                                                    border: '1px solid rgba(147, 130, 220, 0.15)',
                                                                }}>
                                                                    <summary style={{
                                                                        padding: '6px 10px', cursor: 'pointer',
                                                                        color: 'rgba(147, 130, 220, 0.9)', fontWeight: 500,
                                                                        userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px',
                                                                    }}>Thinking</summary>
                                                                    <div style={{
                                                                        padding: '4px 10px 8px',
                                                                        fontSize: '12px', lineHeight: '1.6',
                                                                        color: 'var(--text-secondary)',
                                                                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                                                        maxHeight: '300px', overflow: 'auto',
                                                                    }}>{msg.thinking}</div>
                                                                </details>
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                }
                                                return (
                                                    <ChatMessageItem key={i} msg={msg} i={i} isLeft={msg.role === 'assistant'} t={t} />
                                                );
                                            })}
                                            {isWaiting && (
                                                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', animation: 'fadeIn .2s ease' }}>
                                                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', flexShrink: 0, color: 'var(--text-secondary)', fontWeight: 600 }}>A</div>
                                                    <div style={{ padding: '8px 12px', borderRadius: '12px', background: 'var(--bg-secondary)', fontSize: '13px' }}>
                                                        <div className="thinking-indicator">
                                                            <div className="thinking-dots">
                                                                <span /><span /><span />
                                                            </div>
                                                            <span style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>{t('agent.chat.thinking', 'Thinking...')}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                            <div ref={chatEndRef} />
                                        </div>
                                        {showScrollBtn && (
                                            <button onClick={scrollToBottom} style={{ position: 'absolute', bottom: '70px', right: '20px', width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', zIndex: 10 }} title="Scroll to bottom">↓</button>
                                        )}
                                        {agentExpired ? (
                                            <div style={{ padding: '7px 16px', borderTop: '1px solid rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.08)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'rgb(180,100,0)' }}>
                                                <span>u23f8</span>
                                                <span>This Agent has <strong>expired</strong> and is off duty. Contact your admin to extend its service.</span>
                                            </div>
                                        ) : !wsConnected && (!activeSession?.user_id || !currentUser || activeSession.user_id === String(currentUser?.id)) ? (
                                            <div style={{ padding: '3px 16px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                                <span style={{ display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%', background: 'var(--accent-primary)', opacity: 0.8, animation: 'pulse 1.2s ease-in-out infinite' }} />
                                                Connecting...
                                            </div>
                                        ) : null}
                                        {attachedFiles.length > 0 && (
                                            <div style={{ padding: '6px 16px', background: 'var(--bg-elevated)', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                {attachedFiles.map((file, idx) => (
                                                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', background: 'var(--bg-secondary)', padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--border-subtle)', maxWidth: '200px' }}>
                                                        {file.imageUrl ? (
                                                            <img src={file.imageUrl} alt={file.name} style={{ width: '20px', height: '20px', borderRadius: '4px', objectFit: 'cover' }} />
                                                        ) : (
                                                            <span>📎</span>
                                                        )}
                                                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                                                        <button onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: '14px', padding: '0 2px' }} title="Remove file">✕</button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', gap: '8px', padding: '6px 12px', borderTop: '1px solid var(--border-subtle)' }}>
                                            <input type="file" multiple ref={fileInputRef} onChange={handleChatFile} style={{ display: 'none' }} />
                                            <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={!wsConnected || uploading || isWaiting || isStreaming || attachedFiles.length >= 10} style={{ padding: '6px 10px', fontSize: '14px', minWidth: 'auto', ...( (!wsConnected || uploading || isWaiting || isStreaming) ? { cursor: 'not-allowed', opacity: 0.4 } : {}) }}>{uploading ? '⏳' : '⦹'}</button>
                                            {uploading && uploadProgress >= 0 && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 140px' }}>
                                                    {uploadProgress <= 100 ? (
                                                        /* Upload phase: show progress bar */
                                                        <>
                                                            <div style={{ flex: 1, height: '4px', borderRadius: '2px', background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                                                                <div style={{ height: '100%', borderRadius: '2px', background: 'var(--accent-primary)', width: `${uploadProgress}%`, transition: 'width 0.15s ease' }} />
                                                            </div>
                                                            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{uploadProgress}%</span>
                                                        </>
                                                    ) : (
                                                        /* Processing phase (progress = 101): server is parsing the file */
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <span style={{ display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%', background: 'var(--accent-primary)', animation: 'pulse 1.2s ease-in-out infinite' }} />
                                                            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>Processing...</span>
                                                        </div>
                                                    )}
                                                    <button onClick={() => { uploadAbortRef.current?.(); }} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: '12px', padding: '0 2px', lineHeight: 1 }} title="Cancel upload">✕</button>
                                                </div>
                                            )}
                                            <input ref={chatInputRef} className="chat-input" value={chatInput} onChange={e => setChatInput(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isWaiting && !isStreaming) { e.preventDefault(); sendChatMsg(); } }}
                                                onPaste={handlePaste}
                                                placeholder={!wsConnected && (!activeSession?.user_id || !currentUser || activeSession.user_id === String(currentUser?.id)) ? 'Connecting...' : attachedFiles.length > 0 ? t('agent.chat.askAboutFile', { name: attachedFiles.length === 1 ? attachedFiles[0].name : `${attachedFiles.length} files` }) : t('chat.placeholder')}
                                                disabled={!wsConnected} style={{ flex: 1 }} autoFocus />
                                            {(isStreaming || isWaiting) ? (
                                                <button className="btn btn-stop-generation" onClick={() => {
                                                    if (!id || !activeSession?.id) return;
                                                    const activeRuntimeKey = buildSessionRuntimeKey(id, String(activeSession.id));
                                                    const activeSocket = wsMapRef.current[activeRuntimeKey];
                                                    if (activeSocket?.readyState === WebSocket.OPEN) {
                                                        activeSocket.send(JSON.stringify({ type: 'abort' }));
                                                        setIsStreaming(false);
                                                        setIsWaiting(false);
                                                        setSessionUiState(activeRuntimeKey, { isWaiting: false, isStreaming: false });
                                                    }
                                                }} style={{ padding: '6px 16px' }} title={t('chat.stop', 'Stop')}>
                                                    <span className="stop-icon" />
                                                </button>
                                            ) : (
                                                <button className="btn btn-primary" onClick={sendChatMsg} disabled={!wsConnected || (!chatInput.trim() && attachedFiles.length === 0)} style={{ padding: '6px 16px' }}>{t('chat.send')}</button>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )
                }

                {
                    activeTab === 'activityLog' && (
                        <AgentActivityLogSection
                            agentType={(agent as any)?.agent_type}
                            activityLogs={activityLogs}
                            logFilter={logFilter}
                            expandedLogId={expandedLogId}
                            onFilterChange={setLogFilter}
                            onToggleExpandedLog={setExpandedLogId}
                        />
                    )
                }

                {/* ── Feishu Channel Tab ── */}

                {/* ── Approvals Tab ── */}
                {
                    activeTab === 'approvals' && <AgentApprovalsSection agentId={id!} />}

                {/* ── Settings Tab ── */}
                {
                    activeTab === 'settings' && (agent as any)?.agent_type === 'openclaw' && (
                        <OpenClawSettings agent={agent} agentId={id!} />
                    )
                }
                {
                    activeTab === 'settings' && (agent as any)?.agent_type !== 'openclaw' && (
                        <AgentSettingsSection
                            agentId={id!}
                            agent={agent}
                            llmModels={llmModels}
                            permData={permData}
                            canManage={canManage}
                            settingsForm={settingsForm}
                            onSettingsFormChange={setSettingsForm}
                            settingsSaving={settingsSaving}
                            settingsSaved={settingsSaved}
                            settingsError={settingsError}
                            onSetSettingsSaving={setSettingsSaving}
                            onSetSettingsSaved={setSettingsSaved}
                            onSetSettingsError={setSettingsError}
                            onResetSettingsInit={() => {
                                settingsInitRef.current = false;
                            }}
                            wmDraft={wmDraft}
                            wmSaved={wmSaved}
                            onSetWmDraft={setWmDraft}
                            onSetWmSaved={setWmSaved}
                            showDeleteConfirm={showDeleteConfirm}
                            onSetShowDeleteConfirm={setShowDeleteConfirm}
                        />
                    )
                }
            </div >

            <PromptModal
                open={!!promptModal}
                title={promptModal?.title || ''}
                placeholder={promptModal?.placeholder || ''}
                onCancel={() => setPromptModal(null)}
                onConfirm={async (value) => {
                    const action = promptModal?.action;
                    setPromptModal(null);
                    if (action === 'newFolder') {
                        await fileApi.write(id!, `${workspacePath}/${value}/.gitkeep`, '');
                        queryClient.invalidateQueries({ queryKey: ['files', id, workspacePath] });
                    } else if (action === 'newFile') {
                        await fileApi.write(id!, `${workspacePath}/${value}`, '');
                        queryClient.invalidateQueries({ queryKey: ['files', id, workspacePath] });
                        setViewingFile(`${workspacePath}/${value}`);
                        setFileEditing(true);
                        setFileDraft('');
                    } else if (action === 'newSkill') {
                        const template = `---\nname: ${value}\ndescription: Describe what this skill does\n---\n\n# ${value}\n\n## Overview\nDescribe the purpose and when to use this skill.\n\n## Process\n1. Step one\n2. Step two\n\n## Output Format\nDescribe the expected output format.\n`;
                        await fileApi.write(id!, `skills/${value}/SKILL.md`, template);
                        queryClient.invalidateQueries({ queryKey: ['files', id, 'skills'] });
                        setViewingFile(`skills/${value}/SKILL.md`);
                        setFileEditing(true);
                        setFileDraft(template);
                    }
                }}
            />

            <ConfirmModal
                open={!!deleteConfirm}
                title={t('common.delete')}
                message={`${t('common.delete')}: ${deleteConfirm?.name}?`}
                confirmLabel={t('common.delete')}
                danger
                onCancel={() => setDeleteConfirm(null)}
                onConfirm={async () => {
                    const path = deleteConfirm?.path;
                    setDeleteConfirm(null);
                    if (path) {
                        try {
                            await fileApi.delete(id!, path);
                            setViewingFile(null);
                            setFileEditing(false);
                            queryClient.invalidateQueries({ queryKey: ['files', id, workspacePath] });
                            showToast(t('common.delete'));
                        } catch (err: any) {
                            showToast(t('agent.upload.failed'), 'error');
                        }
                    }
                }}
            />

            {
                uploadToast && (
                    <div style={{
                        position: 'fixed', top: '20px', right: '20px', zIndex: 20000,
                        padding: '12px 20px', borderRadius: '8px',
                        background: uploadToast.type === 'success' ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)',
                        color: '#fff', fontSize: '14px', fontWeight: 500,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    }}>
                        {''}{uploadToast.message}
                    </div>
                )
            }

            {/* ── Expiry Editor Modal (admin only) ── */}
            {
                showExpiryModal && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onClick={() => setShowExpiryModal(false)}>
                        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '24px', width: '360px', maxWidth: '90vw' }}
                            onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>⏰ {t('agent.settings.expiry.title')}</h3>
                                <button onClick={() => setShowExpiryModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: '18px', lineHeight: 1 }}>×</button>
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
                                {(agent as any).is_expired
                                    ? <span style={{ color: 'var(--error)', fontWeight: 600 }}>⏰ {t('agent.settings.expiry.expired')}</span>
                                    : (agent as any).expires_at
                                        ? <>{t('agent.settings.expiry.currentExpiry')} <strong>{new Date((agent as any).expires_at).toLocaleString(i18n.language === 'zh' ? 'zh-CN' : 'en-US')}</strong></>
                                        : <span style={{ color: 'var(--success)' }}>{t('agent.settings.expiry.neverExpires')}</span>
                                }
                            </div>
                            <div style={{ marginBottom: '16px' }}>
                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>{t('agent.settings.expiry.quickRenew')}</div>
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                    {([
                                        ['+ 24h', 24],
                                        [`+ ${t('agent.settings.expiry.days', { count: 7 })}`, 168],
                                        [`+ ${t('agent.settings.expiry.days', { count: 30 })}`, 720],
                                        [`+ ${t('agent.settings.expiry.days', { count: 90 })}`, 2160],
                                    ] as [string, number][]).map(([label, h]) => (
                                        <button key={h} onClick={() => addHours(h)}
                                            style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border-subtle)', background: 'var(--bg-primary)', cursor: 'pointer', fontSize: '12px', color: 'var(--text-primary)' }}>
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div style={{ marginBottom: '20px' }}>
                                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>{t('agent.settings.expiry.customDeadline')}</div>
                                <input type="datetime-local" value={expiryValue} onChange={e => setExpiryValue(e.target.value)}
                                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box' }} />
                            </div>
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', alignItems: 'center' }}>
                                <button onClick={() => saveExpiry(true)} disabled={expirySaving}
                                    style={{ padding: '7px 12px', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    🔓 {t('agent.settings.expiry.neverExpires')}
                                </button>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button onClick={() => setShowExpiryModal(false)} disabled={expirySaving}
                                        style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--border-subtle)', background: 'none', cursor: 'pointer', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        {t('common.cancel')}
                                    </button>
                                    <button onClick={() => saveExpiry(false)} disabled={expirySaving || !expiryValue}
                                        className="btn btn-primary"
                                        style={{ opacity: !expiryValue ? 0.5 : 1 }}>
                                        {expirySaving ? t('agent.settings.expiry.saving') : t('common.save')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

        </>
    );
}

// Error boundary to catch unhandled React errors and prevent white screen
class AgentDetailErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }
    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('AgentDetail crash caught by error boundary:', error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '16px' }}>
                    <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>Something went wrong</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', maxWidth: '400px', textAlign: 'center' }}>
                        {this.state.error?.message || 'An unexpected error occurred while loading this page.'}
                    </div>
                    <button
                        className="btn btn-primary"
                        onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
                        style={{ marginTop: '8px' }}
                    >
                        Reload Page
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

// Wrap the AgentDetail component with error boundary
export default function AgentDetailWithErrorBoundary() {
    return (
        <AgentDetailErrorBoundary>
            <AgentDetailInner />
        </AgentDetailErrorBoundary>
    );
}
