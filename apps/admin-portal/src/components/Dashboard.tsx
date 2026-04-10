import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
    Clock, Users, FolderOpen, CircleDollarSign,
    Camera, TrendingUp, BarChart3, Globe
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import clsx from 'clsx';
import { PageLayout, Card, KpiCard, EmptyState, LoadingState } from './ui';
import { 
    getEffectiveEnd,
    formatDuration,
    fetchAllActivitySamples
} from '../lib/dataUtils';

// ============================================================================
// Types
// ============================================================================

interface DashStats {
    todayMinutes: number;
    weekMinutes: number;
    weekCost: number;
    activeMembers: number;
    activeProjects: number;
    screenshotCount: number;
    costTrend?: number;
    minutesTrend?: number;
}

interface ProjectStat {
    id: string;
    name: string;
    minutes: number;
    color: string;
    percentage: number;
}

interface DayBar {
    day: string;
    minutes: number;
}

interface TeamMemberStatus {
    member: any;
    session: any | null;
    status: 'active' | 'idle' | 'offline';
    productiveMinutes: number;
    idleMinutes: number;
    projectName?: string;
}

// ============================================================================
// Constants & Utilities
// ============================================================================

const PROJECT_COLORS = ['#4f46e5', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2', '#f59e0b', '#06b6d4'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const getDateRanges = (type: 'week' | 'prevWeek') => {
    const now = new Date();
    if (type === 'week') {
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        weekStart.setHours(0, 0, 0, 0);
        return { start: weekStart, end: now };
    } else {
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay() - 7);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 7);
        return { start: weekStart, end: weekEnd };
    }
};

// ============================================================================
// Main Dashboard Component
// ============================================================================

export function Dashboard() {
    const [stats, setStats] = useState<DashStats>({
        todayMinutes: 0,
        weekMinutes: 0,
        weekCost: 0,
        activeMembers: 0,
        activeProjects: 0,
        screenshotCount: 0,
    });
    const [projects, setProjects] = useState<ProjectStat[]>([]);
    const [weekBars, setWeekBars] = useState<DayBar[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchDashboard = useCallback(async () => {
        try {
            setLoading(true);
            const { start: weekStart, end: now } = getDateRanges('week');
            const { start: prevWeekStart, end: prevWeekEnd } = getDateRanges('prevWeek');

            const [
                { data: rawSessions },
                { data: projectsData },
                { data: membersData },
                activityDataRaw,
                { count: ssCount },
                { data: prevWeekSessions },
                prevWeekActivityRaw,
            ] = await Promise.all([
                supabase.from('sessions').select('id, user_id, project_id, started_at, ended_at'),
                supabase.from('projects').select('id, name, color'),
                supabase.from('members').select('id, pay_rate, idle_limit'),
                fetchAllActivitySamples(supabase, weekStart.toISOString(), now.toISOString(), 'session_id, recorded_at, idle'),
                supabase.from('screenshots').select('id', { count: 'exact', head: true }).gte('recorded_at', weekStart.toISOString()),
                supabase.from('sessions').select('id, user_id, project_id, started_at, ended_at').gte('started_at', prevWeekStart.toISOString()).lt('started_at', prevWeekEnd.toISOString()),
                fetchAllActivitySamples(supabase, prevWeekStart.toISOString(), prevWeekEnd.toISOString(), 'session_id, recorded_at, idle'),
            ]);

            const sessionToProjectMap: Record<string, string> = {};
            const sessionToUserMap: Record<string, string> = {};
            (rawSessions || []).forEach(s => {
                sessionToProjectMap[s.id] = s.project_id;
                sessionToUserMap[s.id] = s.user_id;
            });

            const userIdleLimitMap: Record<string, number> = {};
            const memberRateMap: Record<string, number> = {};
            (membersData || []).forEach(m => {
                userIdleLimitMap[m.id] = m.idle_limit ?? 10;
                memberRateMap[m.id] = m.pay_rate ?? 0;
            });

            const { stats: weekStats, projectMap: projectMinMap, dayMap } = calculateWeekStats(
                rawSessions || [],
                activityDataRaw || [],
                sessionToProjectMap,
                sessionToUserMap,
                userIdleLimitMap,
                now,
                memberRateMap
            );

            const { stats: prevStats } = calculateWeekStats(
                prevWeekSessions || [],
                prevWeekActivityRaw || [],
                {},
                {},
                userIdleLimitMap,
                prevWeekEnd,
                memberRateMap
            );

            const minutesTrend = prevStats.weekMinsProductive > 0 
                ? ((weekStats.weekMinsProductive - prevStats.weekMinsProductive) / prevStats.weekMinsProductive) * 100 
                : 0;
            
            const costTrend = prevStats.weekCost > 0 
                ? ((weekStats.weekCost - prevStats.weekCost) / prevStats.weekCost) * 100 
                : 0;

            const projectMap: Record<string, string> = {};
            const projectColorMap: Record<string, string> = {};
            (projectsData || []).forEach((p, i) => {
                projectMap[p.id] = p.name;
                projectColorMap[p.id] = p.color || PROJECT_COLORS[i % PROJECT_COLORS.length];
            });

            const totalProjectMinutes = Object.values(projectMinMap).reduce((a, b) => a + b, 0) || 1;
            const projectStats = Object.entries(projectMinMap)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([id, minutes], i) => ({
                    id,
                    name: projectMap[id] || 'Unknown',
                    minutes: minutes as number,
                    color: projectColorMap[id] || PROJECT_COLORS[i % PROJECT_COLORS.length],
                    percentage: ((minutes as number) / totalProjectMinutes) * 100,
                }));

            const bars = DAYS_SHORT.map((day, i) => ({
                day,
                minutes: dayMap[i] || 0,
            }));

            setStats({
                todayMinutes: weekStats.todayMinsProductive,
                weekMinutes: weekStats.weekMinsProductive,
                weekCost: Math.round(weekStats.weekCost * 100) / 100,
                activeMembers: weekStats.uniqueMembers.size,
                activeProjects: weekStats.uniqueProjects.size,
                screenshotCount: ssCount || 0,
                minutesTrend: Math.round(minutesTrend * 10) / 10,
                costTrend: Math.round(costTrend * 10) / 10,
            });

            setProjects(projectStats);
            setWeekBars(bars);
        } catch (error) {
            console.error('Dashboard fetch error:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDashboard();
    }, [fetchDashboard]);

    return (
        <PageLayout
            title="Dashboard"
            description="Team performance, productivity metrics, and project distribution."
        >
            <div className="flex flex-col gap-10">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-5">
                    <KpiCard icon={<Clock />} label="Today" value={loading ? '—' : formatDuration(stats.todayMinutes)} trend={stats.minutesTrend} />
                    <KpiCard icon={<BarChart3 />} label="Weekly Total" value={loading ? '—' : formatDuration(stats.weekMinutes)} trend={stats.minutesTrend} />
                    <KpiCard icon={<CircleDollarSign />} label="Weekly Cost" value={loading ? '—' : `$${stats.weekCost.toLocaleString()}`} trend={stats.costTrend} />
                    <KpiCard icon={<Users />} label="Active Members" value={loading ? '—' : stats.activeMembers.toString()} />
                    <KpiCard icon={<Globe />} label="Projects" value={loading ? '—' : stats.activeProjects.toString()} />
                    <KpiCard icon={<Camera />} label="Screenshots" value={loading ? '—' : stats.screenshotCount.toString()} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                    <div className="lg:col-span-2">
                        <Card title="Activity Trends" subtitle="Productive hours tracked this week">
                            <div className="h-[360px] w-full mt-8">
                                {loading ? (
                                    <LoadingState className="h-full" />
                                ) : weekBars.length === 0 ? (
                                    <EmptyState icon={<TrendingUp className="opacity-20" />} title="No data" description="No activity tracked" />
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={weekBars} barSize={48}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border-tertiary)" opacity={0.5} />
                                            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 500 }} dy={12} />
                                            <YAxis hide />
                                            <Tooltip contentStyle={{ backgroundColor: 'var(--color-background-secondary)', border: '1px solid var(--color-border-tertiary)', borderRadius: '8px' }} formatter={(v: any) => [formatDuration(v), 'Productive Time']} />
                                            <Bar dataKey="minutes" fill="var(--color-info)" radius={[8, 8, 0, 0]} animationDuration={600} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                        </Card>
                    </div>

                    <div className="lg:col-span-1">
                        <Card title="Top Projects" subtitle="Time distribution">
                            <div className="mt-8 space-y-5">
                                {loading ? (
                                    <LoadingState className="h-[340px]" />
                                ) : projects.length === 0 ? (
                                    <EmptyState icon={<FolderOpen className="opacity-20" />} title="No projects" description="No activity yet" />
                                ) : (
                                    projects.map(p => (
                                        <div key={p.id} className="group space-y-2">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="w-3 h-3 rounded-full flex-shrink-0 shadow-sm" style={{ backgroundColor: p.color }} />
                                                    <span className="text-sm font-semibold text-slate-800 truncate transition-colors group-hover:text-primary">{p.name}</span>
                                                </div>
                                                <span className="text-xs font-bold text-slate-500 ml-2">{p.percentage.toFixed(0)}%</span>
                                            </div>
                                            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                                                <div className="h-full rounded-full transition-all duration-700 ease-out relative" style={{ width: `${p.percentage}%`, backgroundImage: `linear-gradient(90deg, ${p.color}dd, ${p.color})` }}>
                                                    <div className="absolute inset-0 bg-white/20" />
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </Card>
                    </div>
                </div>

                <Card title="Team Activity" subtitle="Current status and session details" noPadding className="overflow-hidden border-0 shadow-lg rounded-[1.5rem]">
                    <TeamActivityTable />
                </Card>
            </div>
        </PageLayout>
    );
}

// ============================================================================
// Helpers
// ============================================================================

function calculateWeekStats(
    rawSessions: any[],
    activityDataRaw: any[],
    sessionToProjectMap: Record<string, string>,
    sessionToUserMap: Record<string, string>,
    userIdleLimitMap: Record<string, number>,
    now: Date,
    memberRateMap: Record<string, number>
) {
    const uniqueMembers = new Set<string>();
    const uniqueProjects = new Set<string>();
    const projectMinMap: Record<string, number> = {};
    const dayMinMap: number[] = Array(7).fill(0);
    let weekMinsProductive = 0;
    let weekCost = 0;
    let todayMinsProductive = 0;
    const todayStr = now.toISOString().split('T')[0];

    (rawSessions || []).forEach(s => uniqueMembers.add(s.user_id));

    const userSamplesMap = new Map<string, any[]>();
    (activityDataRaw || []).forEach(samp => {
        const userId = sessionToUserMap[samp.session_id];
        if (!userId) return;
        if (!userSamplesMap.has(userId)) userSamplesMap.set(userId, []);
        userSamplesMap.get(userId)!.push(samp);
    });

    userSamplesMap.forEach((userSamples, userId) => {
        const limit = userIdleLimitMap[userId] || 10;
        const rate = memberRateMap[userId] || 0;
        
        const minuteMap = new Map<string, any>();
        userSamples.forEach(s => {
            const minute = s.recorded_at.substring(0, 16);
            if (!minuteMap.has(minute) || (minuteMap.get(minute).idle && !s.idle)) {
                minuteMap.set(minute, s);
            }
        });

        const dedupedSorted = Array.from(minuteMap.values()).sort((a, b) =>
            new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
        );

        let currentBlock: any[] = [];
        const productiveMinutes = new Set<string>();

        for (let i = 0; i < dedupedSorted.length; i++) {
            const s = dedupedSorted[i];
            const prev = i > 0 ? dedupedSorted[i - 1] : null;
            const gapMs = prev ? (new Date(s.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) : 0;
            const isContiguous = prev && gapMs <= 125000;

            if (s.idle && isContiguous) {
                currentBlock.push(s);
            } else if (s.idle && !prev) {
                currentBlock = [s];
            } else if (s.idle && !isContiguous) {
                if (currentBlock.length < limit) currentBlock.forEach(b => productiveMinutes.add(b.recorded_at.substring(0, 16)));
                currentBlock = [s];
            } else {
                productiveMinutes.add(s.recorded_at.substring(0, 16));
                if (currentBlock.length < limit) currentBlock.forEach(b => productiveMinutes.add(b.recorded_at.substring(0, 16)));
                currentBlock = [];
            }
        }
        if (currentBlock.length < limit) currentBlock.forEach(b => productiveMinutes.add(b.recorded_at.substring(0, 16)));

        dedupedSorted.forEach(s => {
            if (productiveMinutes.has(s.recorded_at.substring(0, 16))) {
                const recordedAt = new Date(s.recorded_at);
                dayMinMap[recordedAt.getDay()] += 1;
                weekMinsProductive += 1;
                weekCost += (1 / 60) * rate;
                if (s.recorded_at.split('T')[0] === todayStr) todayMinsProductive += 1;
                const pId = sessionToProjectMap[s.session_id];
                if (pId) {
                    uniqueProjects.add(pId);
                    projectMinMap[pId] = (projectMinMap[pId] || 0) + 1;
                }
            }
        });
    });

    return {
        stats: {
            weekMinsProductive,
            todayMinsProductive,
            weekCost,
            uniqueMembers,
            uniqueProjects,
        },
        projectMap: projectMinMap,
        dayMap: dayMinMap,
    };
}

function TeamActivityTable() {
    const [teamMembers, setTeamMembers] = useState<TeamMemberStatus[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchTeamActivity = useCallback(async () => {
        try {
            setLoading(true);
            const now = new Date();
            const weekStart = new Date(now);
            weekStart.setDate(now.getDate() - now.getDay());
            weekStart.setHours(0, 0, 0, 0);

            const [
                { data: mData },
                { data: sData },
                { data: pData },
                activityDataRaw,
            ] = await Promise.all([
                supabase.from('members').select('id, full_name, idle_limit, timezone'),
                supabase.from('sessions').select('*').order('started_at', { ascending: false }),
                supabase.from('projects').select('id, name, color'),
                fetchAllActivitySamples(supabase, weekStart.toISOString(), now.toISOString(), 'session_id, recorded_at, idle'),
            ]);

            const memberLatestSession = new Map<string, any>();
            const idleMinsMap: Record<string, number> = {};
            const seenInSession = new Set<string>();

            (sData || []).forEach(s => {
                if (!memberLatestSession.has(s.user_id)) memberLatestSession.set(s.user_id, s);
            });

            (activityDataRaw || []).forEach(samp => {
                const minuteKey = `${samp.session_id}-${samp.recorded_at.substring(0, 16)}`;
                if (seenInSession.has(minuteKey)) return;
                seenInSession.add(minuteKey);
                if (samp.idle === true) idleMinsMap[samp.session_id] = (idleMinsMap[samp.session_id] || 0) + 1;
            });

            const projectMap: Record<string, any> = {};
            (pData || []).forEach(p => { projectMap[p.id] = p; });

            const result = (mData || []).map(m => {
                const session = memberLatestSession.get(m.id);
                let status: 'active' | 'idle' | 'offline' = 'offline';
                let productiveMins = 0;
                let idleMins = 0;

                if (session) {
                    const { isLive, isStale } = getEffectiveEnd(session.started_at, session.ended_at);
                    const totalMins = (new Date(session.ended_at || new Date()).getTime() - new Date(session.started_at).getTime()) / 60000;
                    idleMins = idleMinsMap[session.id] || 0;
                    productiveMins = Math.max(0, totalMins - idleMins);
                    status = isLive ? 'active' : isStale ? 'idle' : 'offline';
                }

                return {
                    member: m, session, status,
                    productiveMinutes: productiveMins,
                    idleMinutes: idleMins,
                    projectName: session && projectMap[session.project_id]?.name,
                };
            });

            result.sort((a, b) => {
                const statusOrder = { active: 0, idle: 1, offline: 2 };
                if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
                return a.member.full_name.localeCompare(b.member.full_name);
            });

            setTeamMembers(result);
        } catch (err) {
            console.error('Team activity error:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchTeamActivity(); }, [fetchTeamActivity]);

    if (loading) return <div className="p-32"><LoadingState /></div>;
    if (!teamMembers.length) return <div className="p-32"><EmptyState icon={<Users />} title="No team members" description="Add members to see activity" /></div>;

    return (
        <div className="w-full overflow-x-auto bg-white rounded-b-[1.5rem]">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-slate-50/80 border-y border-slate-100">
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Member</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Project</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Productive</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Idle</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Status</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100/50">
                    {teamMembers.map(item => {
                        const { member: m, status } = item;
                        
                        // Explicit Tailwind classes to prevent PurgeCSS compilation issues
                        const statusConfig = {
                            active: {
                                label: 'Active',
                                bg: 'bg-emerald-500/10',
                                border: 'border-emerald-500/20',
                                text: 'text-emerald-700',
                                dot: 'bg-emerald-500'
                            },
                            idle: {
                                label: 'Idle',
                                bg: 'bg-amber-500/10',
                                border: 'border-amber-500/20',
                                text: 'text-amber-700',
                                dot: 'bg-amber-500'
                            },
                            offline: {
                                label: 'Offline',
                                bg: 'bg-slate-500/10',
                                border: 'border-slate-500/20',
                                text: 'text-slate-600',
                                dot: 'bg-slate-400'
                            },
                        };

                        const config = statusConfig[status];

                        return (
                            <tr key={m.id} className="hover:bg-slate-50/50 transition-colors group">
                                <td className="px-6 py-5">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0 transition-transform duration-300 group-hover:scale-105">
                                            {m.full_name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-semibold text-slate-800 truncate">{m.full_name}</div>
                                            <div className="text-[11px] font-medium text-slate-400 mt-0.5">{m.timezone || 'UTC'}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-5">
                                    {item.projectName ? (
                                        <span className="inline-block px-3 py-1.5 bg-slate-50 border border-slate-200/60 rounded-lg text-xs font-semibold text-slate-700 shadow-sm">
                                            {item.projectName}
                                        </span>
                                    ) : (
                                        <span className="text-xs font-medium text-slate-400 italic opacity-60">—</span>
                                    )}
                                </td>
                                <td className="px-6 py-5 text-right font-bold text-slate-700">{formatDuration(item.productiveMinutes)}</td>
                                <td className="px-6 py-5 text-right font-medium text-slate-500">{formatDuration(item.idleMinutes)}</td>
                                <td className="px-6 py-5 text-right">
                                    <span className={clsx('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border tracking-wide uppercase shadow-sm transition-transform duration-300 group-hover:scale-105', config.bg, config.text, config.border)}>
                                        <span className={clsx('w-1.5 h-1.5 rounded-full shadow-sm', config.dot)} />
                                        {config.label}
                                    </span>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
