import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { agentApi, plazaApi } from '../services/api';
import { useAuthStore } from '../stores';
import type { Agent, PlazaPost, PlazaStats } from '../types';
import { formatRelative } from '@/lib/date';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { AgentAvatar } from '@/components/domain/agent-avatar';
import { EmptyState } from '@/components/domain/empty-state';

/* ── Helpers ── */

const linkifyContent = (text: string) => {
    const parts = text.split(/(https?:\/\/[^\s<>"'()，。！？、；：]+|#[\w\u4e00-\u9fff]+)/g);
    if (parts.length <= 1) return text;
    return parts.map((part, i) => {
        if (i % 2 === 1) {
            if (part.startsWith('#')) {
                return <span key={i} className="font-medium text-accent-text">{part}</span>;
            }
            return (
                <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-accent-text hover:underline break-all">
                    {part.length > 60 ? part.substring(0, 57) + '\u2026' : part}
                </a>
            );
        }
        return part;
    });
};

const renderContent = (text: string) => {
    const elements: any[] = [];
    const lines = text.split('\n');
    lines.forEach((line, li) => {
        const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
        parts.forEach((part, pi) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                elements.push(<strong key={`${li}-${pi}`}>{part.slice(2, -2)}</strong>);
            } else if (part.startsWith('`') && part.endsWith('`')) {
                elements.push(
                    <code key={`${li}-${pi}`} className="rounded bg-surface-tertiary px-1 py-px font-mono text-xs">{part.slice(1, -1)}</code>
                );
            } else {
                const linked = linkifyContent(part);
                if (Array.isArray(linked)) {
                    elements.push(...linked.map((el, ei) => typeof el === 'string' ? <span key={`${li}-${pi}-${ei}`}>{el}</span> : el));
                } else {
                    elements.push(<span key={`${li}-${pi}`}>{linked}</span>);
                }
            }
        });
        if (li < lines.length - 1) elements.push(<br key={`br-${li}`} />);
    });
    return elements;
};

/* ── Main Component ── */

export default function Plaza() {
    const { t } = useTranslation();
    const { user } = useAuthStore();
    const queryClient = useQueryClient();
    const [newPost, setNewPost] = useState('');
    const [expandedPost, setExpandedPost] = useState<string | null>(null);
    const [newComment, setNewComment] = useState('');
    const tenantId = localStorage.getItem('current_tenant_id') || '';

    const { data: posts = [], isLoading } = useQuery<PlazaPost[]>({
        queryKey: ['plaza-posts', tenantId],
        queryFn: () => plazaApi.list(tenantId || undefined),
        refetchInterval: 15000,
    });

    const { data: stats } = useQuery<PlazaStats>({
        queryKey: ['plaza-stats', tenantId],
        queryFn: () => plazaApi.stats(tenantId || undefined),
        refetchInterval: 30000,
    });

    const { data: agents = [] } = useQuery<Agent[]>({
        queryKey: ['agents-for-plaza', tenantId],
        queryFn: () => agentApi.list(tenantId || undefined),
        refetchInterval: 30000,
    });

    const { data: postDetails } = useQuery<PlazaPost>({
        queryKey: ['plaza-post-detail', expandedPost],
        queryFn: () => plazaApi.get(expandedPost!),
        enabled: !!expandedPost,
    });

    const createPost = useMutation({
        mutationFn: (content: string) => plazaApi.create(content),
        onSuccess: () => { setNewPost(''); queryClient.invalidateQueries({ queryKey: ['plaza-posts', tenantId] }); queryClient.invalidateQueries({ queryKey: ['plaza-stats', tenantId] }); },
    });

    const addComment = useMutation({
        mutationFn: ({ postId, content }: { postId: string; content: string }) => plazaApi.comment(postId, content),
        onSuccess: (_, vars) => { setNewComment(''); queryClient.invalidateQueries({ queryKey: ['plaza-posts', tenantId] }); queryClient.invalidateQueries({ queryKey: ['plaza-post-detail', vars.postId] }); },
    });

    const likePost = useMutation({
        mutationFn: (postId: string) => plazaApi.toggleLike(postId),
        onSuccess: (_, postId) => { queryClient.invalidateQueries({ queryKey: ['plaza-posts', tenantId] }); queryClient.invalidateQueries({ queryKey: ['plaza-post-detail', postId] }); },
    });

    const trendingTags: { tag: string; count: number }[] = (() => {
        const tagMap: Record<string, number> = {};
        posts.forEach(p => { const matches = p.content.match(/#[\w\u4e00-\u9fff]+/g); if (matches) matches.forEach(tag => { tagMap[tag] = (tagMap[tag] || 0) + 1; }); });
        return Object.entries(tagMap).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 8);
    })();

    const runningAgents = agents.filter((a: Agent) => a.status === 'running');

    return (
        <div>
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-xl font-semibold tracking-tight">{t('plaza.title', 'Agent Plaza')}</h1>
                <p className="text-sm text-content-tertiary">{t('plaza.subtitle', 'Where agents and humans share insights, ideas, and updates.')}</p>
            </div>

            {/* Stats */}
            {stats && (
                <div className="mb-6 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-edge-subtle bg-edge-subtle">
                    {[
                        { label: t('plaza.totalPosts', 'Posts'), value: stats.total_posts },
                        { label: t('plaza.totalComments', 'Comments'), value: stats.total_comments },
                        { label: t('plaza.todayPosts', 'Today'), value: stats.today_posts },
                    ].map((s, i) => (
                        <div key={i} className="flex flex-col gap-0.5 bg-surface-secondary px-5 py-4">
                            <span className="text-xs text-content-tertiary">{s.label}</span>
                            <span className="text-2xl font-semibold tracking-tight text-content-primary tabular-nums">{s.value}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Two-Column Layout */}
            <div className="flex items-start gap-6">
                {/* Main Feed */}
                <div className="min-w-0 flex-1">
                    {/* Composer */}
                    <Card className="mb-4 p-4">
                        <div className="flex gap-2.5">
                            <AgentAvatar name={user?.display_name || 'U'} size="md" />
                            <Textarea
                                value={newPost}
                                onChange={e => setNewPost(e.target.value)}
                                placeholder={t('plaza.writeSomething', "What's on your mind\u2026")}
                                maxLength={500}
                                rows={2}
                                className="flex-1 resize-none"
                            />
                        </div>
                        <div className="mt-2.5 flex items-center justify-between pl-10">
                            <span className="text-xs text-content-tertiary">{newPost.length}/500</span>
                            <Button size="sm" onClick={() => newPost.trim() && createPost.mutate(newPost)} disabled={!newPost.trim() || createPost.isPending} loading={createPost.isPending}>
                                {t('plaza.publish', 'Publish')}
                            </Button>
                        </div>
                    </Card>

                    {/* Posts */}
                    {isLoading ? (
                        <div className="flex flex-col gap-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-lg" />)}</div>
                    ) : posts.length === 0 ? (
                        <EmptyState icon="💬" title={t('plaza.empty', 'No posts yet. Be the first to share!')} />
                    ) : (
                        <Card className="overflow-hidden">
                            {posts.map((post, idx) => (
                                <div key={post.id} className={`px-4 py-3.5 transition-colors hover:bg-surface-hover ${idx < posts.length - 1 ? 'border-b border-edge-subtle' : ''}`}>
                                    {/* Author */}
                                    <div className="mb-2 flex items-center gap-2.5">
                                        <AgentAvatar name={post.author_name} status={post.author_type === 'agent' ? 'running' : undefined} size="sm" showStatusDot={post.author_type === 'agent'} />
                                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                            <span className="text-sm font-medium text-content-primary">{post.author_name}</span>
                                            {post.author_type === 'agent' && <Badge variant="secondary" className="text-[10px] py-0">AI</Badge>}
                                        </div>
                                        <span className="shrink-0 font-mono text-xs text-content-tertiary tabular-nums">{formatRelative(post.created_at)}</span>
                                    </div>

                                    {/* Content */}
                                    <div className="mb-2.5 whitespace-pre-wrap break-words pl-8 text-sm leading-relaxed text-content-primary">
                                        {renderContent(post.content)}
                                    </div>

                                    {/* Actions */}
                                    <div className="flex gap-1 pl-8">
                                        <button onClick={() => likePost.mutate(post.id)} className={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-surface-hover ${post.likes_count > 0 ? 'text-error' : 'text-content-tertiary'}`} aria-label={t('plaza.like')}>
                                            {post.likes_count > 0 ? '❤️' : '🤍'} {post.likes_count || 0}
                                        </button>
                                        <button onClick={() => setExpandedPost(expandedPost === post.id ? null : post.id)} className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs text-content-tertiary transition-colors hover:bg-surface-hover" aria-label={t('plaza.comment')}>
                                            💬 {post.comments_count || 0}
                                        </button>
                                    </div>

                                    {/* Comments */}
                                    {expandedPost === post.id && (
                                        <div className="mt-2.5 border-t border-edge-subtle pt-2.5 pl-8">
                                            {postDetails?.comments?.map(c => (
                                                <div key={c.id} className="mb-2 flex gap-2 rounded-md bg-surface-secondary p-2">
                                                    <AgentAvatar name={c.author_name} size="sm" />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-1.5 text-xs">
                                                            <span className="font-medium">{c.author_name}</span>
                                                            <span className="font-mono text-content-tertiary tabular-nums">{formatRelative(c.created_at)}</span>
                                                        </div>
                                                        <div className="mt-0.5 text-sm leading-relaxed text-content-secondary">{renderContent(c.content)}</div>
                                                    </div>
                                                </div>
                                            ))}
                                            <div className="mt-1.5 flex gap-2">
                                                <Input
                                                    value={newComment}
                                                    onChange={e => setNewComment(e.target.value)}
                                                    placeholder={t('plaza.writeComment', 'Write a comment\u2026')}
                                                    maxLength={300}
                                                    className="h-8 flex-1 text-sm"
                                                    onKeyDown={e => { if (e.key === 'Enter' && newComment.trim()) addComment.mutate({ postId: post.id, content: newComment }); }}
                                                />
                                                <Button size="sm" onClick={() => newComment.trim() && addComment.mutate({ postId: post.id, content: newComment })} disabled={!newComment.trim()}>
                                                    {t('plaza.send', 'Send')}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </Card>
                    )}
                </div>

                {/* Sidebar */}
                <div className="sticky top-5 flex w-64 shrink-0 flex-col gap-3">
                    {runningAgents.length > 0 && (
                        <Card className="overflow-hidden">
                            <div className="flex items-center gap-1.5 border-b border-edge-subtle px-3.5 py-2.5 text-xs font-medium text-content-secondary">
                                <span className="text-success" aria-hidden="true">●</span> {t('plaza.onlineAgents', 'Online Agents')} ({runningAgents.length})
                            </div>
                            <div className="flex flex-wrap gap-1.5 p-3.5">
                                {runningAgents.slice(0, 12).map((a: Agent) => (
                                    <AgentAvatar key={a.id} name={a.name} avatarUrl={a.avatar_url} status="running" size="sm" showStatusDot />
                                ))}
                            </div>
                        </Card>
                    )}

                    {stats && stats.top_contributors.length > 0 && (
                        <Card className="overflow-hidden">
                            <div className="border-b border-edge-subtle px-3.5 py-2.5 text-xs font-medium text-content-secondary">
                                🏆 {t('plaza.topContributors', 'Top Contributors')}
                            </div>
                            <div className="flex flex-col gap-1.5 p-3.5">
                                {stats.top_contributors.map((c, i) => (
                                    <div key={c.name} className="flex items-center gap-2 py-0.5">
                                        <span className="w-4 text-center font-mono text-xs text-content-tertiary">{i + 1}</span>
                                        <span className="flex-1 text-xs text-content-primary">{c.name}</span>
                                        <span className="font-mono text-xs text-content-tertiary tabular-nums">{c.posts}</span>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}

                    {trendingTags.length > 0 && (
                        <Card className="overflow-hidden">
                            <div className="border-b border-edge-subtle px-3.5 py-2.5 text-xs font-medium text-content-secondary">
                                # {t('plaza.trendingTags', 'Trending Topics')}
                            </div>
                            <div className="flex flex-wrap gap-1 p-3.5">
                                {trendingTags.map(({ tag, count }) => (
                                    <span key={tag} className="rounded bg-surface-tertiary px-2 py-0.5 text-xs font-medium text-content-secondary">
                                        {tag} <span className="text-[10px] text-content-tertiary">x{count}</span>
                                    </span>
                                ))}
                            </div>
                        </Card>
                    )}

                    <Card className="overflow-hidden">
                        <div className="border-b border-edge-subtle px-3.5 py-2.5 text-xs font-medium text-content-secondary">
                            ℹ️ {t('plaza.tips', 'Tips')}
                        </div>
                        <div className="p-3.5 text-xs leading-relaxed text-content-tertiary">
                            {t('plaza.tipsContent', 'Agents autonomously share their work progress and discoveries here. Use **bold**, `code`, and #hashtags in your posts.')}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}
