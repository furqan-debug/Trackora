import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
    Clock, Users, FolderOpen, CircleDollarSign,
    Camera, Zap,
    BarChart3, Globe
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import { PageLayout, Card, KpiCard, EmptyState, LoadingState } from './ui';
import { 
    getEffectiveEnd,
    formatDuration,
    fetchAllActivitySamples,
    calculateStatsFromSamples
} from '../lib/dataUtils';

interface DashStats {
    todayMinutes: number;
    weekMinutes: number;
    weekCost: number;
    activeMembers: number;
    activeProjects: number;
    screenshotCount: number;
}

interface ProjectStat {
    id: string;
    name: string;
    minutes: number;
    color: string;
}

interface DayBar {
    day: string;
    minutes: number;
}

const PROJECT_COLORS = ['#4f46e5', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Shared utils are imported above

export function Dashboard() {
    const [stats, setStats] = useState<DashStats>({
        todayMinutes: 0, weekMinutes: 0, weekCost: 0,
        activeMembers: 0, activeProjects: 0, screenshotCount: 0,
    });
    const [projects, setProjects] = useState<ProjectStat[]>([]);
    const [weekBars, setWeekBars] = useState<DayBar[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => { fetchDashboard(); }, []);

    async function fetchDashboard() {
        try {
            setLoading(true);
            const now = new Date();
            const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);

            const [
                { data: rawSessions },
                { data: projectsData },
                { data: membersData },
                activityDataRaw,
                { count: ssCount },
            ] = await Promise.all([
                supabase.from('sessions').select('id, user_id, project_id, started_at, ended_at'),
                supabase.from('projects').select('id, name, color'),
                supabase.from('members').select('id, pay_rate, idle_limit'),
                fetchAllActivitySamples(supabase, weekStart.toISOString(), now.toISOString(), 'session_id, recorded_at, idle'),
                supabase.from('screenshots').select('id', { count: 'exact', head: true }).gte('recorded_at', weekStart.toISOString()),
            ]);

            // Map samples to sessions and projects
            const sessionToProjectMap: Record<string, string> = {};
            const sessionToUserMap: Record<string, string> = {};
            (rawSessions || []).forEach(s => {
                sessionToProjectMap[s.id] = s.project_id;
                sessionToUserMap[s.id] = s.user_id;
            });

            const memberRateMap: Record<string, number> = {};
            (membersData || []).forEach(m => { memberRateMap[m.id] = m.pay_rate ?? 0; });

            const uniqueMembers = new Set<string>();
            const uniqueProjects = new Set<string>();
            const projectMinMap: Record<string, number> = {};
            const dayMinMap: number[] = Array(7).fill(0);
            
            let weekMinsProductive = 0;
            let weekMinsTotal = 0;
            let weekCost = 0;
            let todayMinsProductive = 0;
            let todayMinsTotal = 0;
            
            const todayStr = now.toISOString().split('T')[0];

            // 1. Calculate Total Durations from Sessions (Start-Stop)
            (rawSessions || []).forEach(s => {
                const { endMs } = getEffectiveEnd(s.started_at, s.ended_at);
                const startMs = new Date(s.started_at).getTime();
                const durationMins = (endMs - startMs) / 60000;
                
                const userId = s.user_id;
                uniqueMembers.add(userId);
                
                const dateStr = s.started_at.split('T')[0];
                weekMinsTotal += durationMins;
                if (dateStr === todayStr) {
                    todayMinsTotal += durationMins;
                }

                // Temporary productive - will subtract idle later
                weekMinsProductive += durationMins;
                if (dateStr === todayStr) {
                    todayMinsProductive += durationMins;
                }
            });

            // 2. Subtract Idle Time and update Project/Day breakdowns
            const userIdleLimitMap: Record<string, number> = {};
            (membersData || []).forEach(m => { 
                memberRateMap[m.id] = m.pay_rate ?? 0; 
                userIdleLimitMap[m.id] = m.idle_limit ?? 10;
            });

            // Group samples by user to calculate their specific idle blocks
            const userSamplesMap = new Map<string, any[]>();
            (activityDataRaw || []).forEach(samp => {
                const userId = sessionToUserMap[samp.session_id];
                if (!userId) return;
                if (!userSamplesMap.has(userId)) userSamplesMap.set(userId, []);
                userSamplesMap.get(userId)!.push(samp);
            });

            userSamplesMap.forEach((userSamples, userId) => {
                const limit = userIdleLimitMap[userId] || 10;
                
                // Calculate week stats for this user
                const weekStats = calculateStatsFromSamples(userSamples, limit);
                weekMinsProductive -= weekStats.idleMinutes;

                // Calculate today stats for this user
                const todaySamples = userSamples.filter(s => s.recorded_at.split('T')[0] === todayStr);
                const todayStats = calculateStatsFromSamples(todaySamples, limit);
                todayMinsProductive -= todayStats.idleMinutes;

                // Update Project and Day breakdowns (Productive Only)
                // We need to know which specific samples were "kept" as productive
                // A sample is "kept productive" if it's NOT idle OR it's idle but part of a block < limit.
                
                // Re-calculate stats but this time we need the underlying "is this minute productive" flag
                // Let's add a helper or logic to identify productive minutes
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
                const productiveMinutes = new Set<string>(); // minute keys that are productive

                for (let i = 0; i < dedupedSorted.length; i++) {
                    const s = dedupedSorted[i];
                    const prev = i > 0 ? dedupedSorted[i-1] : null;
                    const gapMs = prev ? (new Date(s.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) : 0;
                    const isContiguous = prev && gapMs <= 125000;

                    if (s.idle && isContiguous) {
                        currentBlock.push(s);
                    } else if (s.idle && !prev) {
                        currentBlock = [s];
                    } else if (s.idle && !isContiguous) {
                        // End prev block
                        if (currentBlock.length < limit) {
                            currentBlock.forEach(b => productiveMinutes.add(b.recorded_at.substring(0, 16)));
                        }
                        currentBlock = [s];
                    } else {
                        // This sample is productive
                        productiveMinutes.add(s.recorded_at.substring(0, 16));
                        // End previous idle block
                        if (currentBlock.length < limit) {
                            currentBlock.forEach(b => productiveMinutes.add(b.recorded_at.substring(0, 16)));
                        }
                        currentBlock = [];
                    }
                }
                if (currentBlock.length < limit) {
                    currentBlock.forEach(b => productiveMinutes.add(b.recorded_at.substring(0, 16)));
                }

                // Final pass: Update charts with minutes that survived as productive
                dedupedSorted.forEach(s => {
                    if (productiveMinutes.has(s.recorded_at.substring(0, 16))) {
                        const recordedAt = new Date(s.recorded_at);
                        dayMinMap[recordedAt.getDay()] += 1;

                        const pId = sessionToProjectMap[s.session_id];
                        if (pId) {
                            uniqueProjects.add(pId);
                            projectMinMap[pId] = (projectMinMap[pId] || 0) + 1;
                        }
                    }
                });
            });

            // Ensure we don't go negative and update cost
            weekMinsProductive = Math.max(0, weekMinsProductive);
            todayMinsProductive = Math.max(0, todayMinsProductive);

            // Final total logic for display (User usually wants "Tracked" as the main total, or "Productive"?)
            // The user said "productive time is just minus idle time from the total time".
            // I'll keep weekMins as the Productive time for the KPI and add a "Total Tracked" label if needed,
            // or just use Productive for the main big number.
            // Recalculate cost based on productive time
            // Sum costs per session by applying member pay rates
            weekCost = 0;
            (rawSessions || []).forEach(sess => {
                const userId = sess.user_id;
                const rate = memberRateMap[userId] || 0;
                
                // Get duration for this session
                const { endMs } = getEffectiveEnd(sess.started_at, sess.ended_at);
                const startMs = new Date(sess.started_at).getTime();
                const totalMins = (endMs - startMs) / 60000;
                
                // Subtract idle samples for this session
                const sessionSamples = activityDataRaw.filter(samp => samp.session_id === sess.id);
                const idleMins = sessionSamples.filter(samp => samp.idle === true).length;
                
                const productiveMins = Math.max(0, totalMins - idleMins);
                weekCost += (productiveMins / 60) * rate;
            });

            const projectMap: Record<string, string> = {};
            const projectColorMap: Record<string, string> = {};
            (projectsData || []).forEach((p, i) => {
                projectMap[p.id] = p.name;
                projectColorMap[p.id] = p.color || PROJECT_COLORS[i % PROJECT_COLORS.length];
            });

            const projectStats = Object.entries(projectMinMap)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([id, minutes], i) => ({
                    id,
                    name: projectMap[id] || 'Unknown',
                    minutes,
                    color: projectColorMap[id] || PROJECT_COLORS[i % PROJECT_COLORS.length],
                }));

            const bars = DAYS_SHORT.map((day, i) => ({
                day,
                minutes: dayMinMap[i] || 0,
            }));

            setStats({
                todayMinutes: todayMinsProductive,
                weekMinutes: weekMinsProductive,
                weekCost: Math.round(weekCost * 100) / 100,
                activeMembers: uniqueMembers.size,
                activeProjects: uniqueProjects.size,
                screenshotCount: ssCount || 0,
            });

            setProjects(projectStats);
            setWeekBars(bars);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }

    const maxProjectMins = projects[0]?.minutes || 1;

    return (
        <PageLayout
            title="Dashboard" 
            description="View team performance, project distribution, and recent activity."
        >

            <div className="flex flex-col gap-10">
                {/* KPI Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-6">
                    <KpiCard icon={<Clock />} label="Today" value={loading ? '—' : formatDuration(stats.todayMinutes)} />
                    <KpiCard icon={<BarChart3 />} label="Weekly Total" value={loading ? '—' : formatDuration(stats.weekMinutes)} />
                    <KpiCard icon={<CircleDollarSign />} label="Weekly Cost" value={loading ? '—' : `$${stats.weekCost.toLocaleString()}`} />
                    <KpiCard icon={<Users />} label="Members" value={loading ? '—' : stats.activeMembers.toString()} />
                    <KpiCard icon={<Globe />} label="Projects" value={loading ? '—' : stats.activeProjects.toString()} />
                    <KpiCard icon={<Camera />} label="Screenshots" value={loading ? '—' : stats.screenshotCount.toString()} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                    {/* Activity Trends */}
                    <div className="lg:col-span-8">
                        <Card title="Activity Trends" subtitle="Work session distribution for the week">
                            <div className="h-[400px] w-full mt-6">
                                {loading ? (
                                    <LoadingState className="h-full" />
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={weekBars} barSize={40}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                                            <XAxis
                                                dataKey="day"
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fill: 'rgba(41,61,99,0.5)', fontSize: 11, fontWeight: 600 }}
                                                dy={10}
                                            />
                                            <YAxis hide />
                                            <Tooltip
                                                cursor={{ fill: 'rgba(80, 110, 248, 0.03)' }}
                                                content={({ active, payload }) => {
                                                    if (active && payload && payload.length) {
                                                        return (
                                                            <div className="bg-surface-solid border border-border rounded-xl px-4 py-3 shadow-lg">
                                                                <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2 border-b border-border pb-2 opacity-60">{payload[0].payload.day}</p>
                                                                <div className="flex items-baseline gap-2">
                                                                    <span className="text-xl font-bold text-text-primary tracking-tight">{formatDuration(payload[0].value as number)}</span>
                                                                    <span className="text-[9px] font-bold text-primary uppercase tracking-widest">Total</span>
                                                                </div>
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                }}
                                            />
                                            <Bar dataKey="minutes" fill="url(#dashGradient)" radius={[8, 8, 0, 0]} />
                                            <defs>
                                                <linearGradient id="dashGradient" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="#506ef8" />
                                                    <stop offset="100%" stopColor="#818cf8" />
                                                </linearGradient>
                                            </defs>
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                        </Card>
                    </div>

                    {/* Project Breakdown */}
                    <div className="lg:col-span-4">
                        <Card title="Project Allocation" subtitle="Distribution of time across projects">
                            <div className="mt-6 space-y-6">
                                {loading ? (
                                    <LoadingState className="h-[400px]" />
                                ) : projects.length === 0 ? (
                                    <EmptyState icon={<FolderOpen className="opacity-20" />} title="No data" description="No project activity yet" />
                                ) : (
                                    projects.map(p => (
                                        <div key={p.id} className="group">
                                            <div className="flex justify-between items-center mb-2">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                                                    <span className="text-sm font-semibold text-text-primary tracking-tight group-hover:text-primary transition-colors">{p.name}</span>
                                                </div>
                                                <span className="text-[10px] font-bold text-text-muted bg-surface-subtle px-2 py-1 rounded-lg border border-border">{formatDuration(p.minutes)}</span>
                                            </div>
                                            <div className="h-2 bg-surface-subtle rounded-full overflow-hidden border border-border p-[1px]">
                                                <div
                                                    className="h-full rounded-full transition-all duration-1000 ease-out"
                                                    style={{
                                                        width: `${(p.minutes / maxProjectMins) * 100}%`,
                                                        backgroundColor: p.color
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </Card>
                    </div>
                </div>

                {/* Recent Activity Table */}
                <Card title="Recent Activity" subtitle="Latest work sessions from your team" noPadding className="overflow-hidden">
                    <RecentSessionsRows />
                </Card>
            </div>

        </PageLayout>
    );
}

function RecentSessionsRows() {
    const [sessions, setSessions] = useState<any[]>([]);
    const [projectMap, setProjectMap] = useState<Record<string, any>>({});
    const [sessionMinsMap, setSessionMinsMap] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const now = new Date();
                const weekStart = new Date(now); 
                weekStart.setDate(now.getDate() - now.getDay()); 
                weekStart.setHours(0, 0, 0, 0);

                // Fetch all members to show complete team status
                const { data: mData, error: mErr } = await supabase.from('members').select('id, full_name, idle_limit, timezone');
                if (mErr) throw mErr;
                
                const memberIds = (mData || []).map(m => m.id);
                
                // Fetch recent sessions for all members
                const { data: sData, error: sErr } = await supabase.from('sessions')
                    .select('*')
                    .in('user_id', memberIds)
                    .order('started_at', { ascending: false });
                if (sErr) throw sErr;

                const [{ data: pData }, activityDataRaw] = await Promise.all([
                    supabase.from('projects').select('id, name, color'),
                    fetchAllActivitySamples(supabase, weekStart.toISOString(), now.toISOString(), 'session_id, recorded_at, idle'),
                ]);

                // Map samples to sessions to count idle minutes
                const idleMinsMap: Record<string, number> = {};
                const seenInSession = new Set<string>(); // "sessionId-minute"

                (activityDataRaw || []).forEach(samp => {
                    const minuteKey = `${samp.session_id}-${samp.recorded_at.substring(0, 16)}`;
                    if (seenInSession.has(minuteKey)) return;
                    seenInSession.add(minuteKey);
                    
                    if (samp.idle === true) {
                        idleMinsMap[samp.session_id] = (idleMinsMap[samp.session_id] || 0) + 1;
                    }
                });
                setSessionMinsMap(idleMinsMap); 

                const pMap: Record<string, any> = {};
                (pData || []).forEach(p => { pMap[p.id] = p; });
                setProjectMap(pMap);

                // Process: Key is memberId, value is their latest session
                const memberLatestSession = new Map<string, any>();
                (sData || []).forEach(s => {
                    if (!memberLatestSession.has(s.user_id)) {
                        memberLatestSession.set(s.user_id, s);
                    }
                });

                // Combine and sort according to requested priority
                const result = (mData || []).map(m => {
                    const session = memberLatestSession.get(m.id);
                    let status: 'active' | 'offline' = 'offline';
                    if (session) {
                        const { isLive } = getEffectiveEnd(session.started_at, session.ended_at);
                        if (isLive) status = 'active';
                    }
                    return { member: m, session, status };
                });

                result.sort((a, b) => {
                    // 1. Status: Active first
                    if (a.status === 'active' && b.status !== 'active') return -1;
                    if (a.status !== 'active' && b.status === 'active') return 1;

                    // 2. If both active: Sort by Name ascending (A-Z)
                    if (a.status === 'active' && b.status === 'active') {
                        return a.member.full_name.localeCompare(b.member.full_name);
                    }

                    // 3. Both offline: Most recent activity first
                    const aTime = a.session ? new Date(a.session.started_at).getTime() : 0;
                    const bTime = b.session ? new Date(b.session.started_at).getTime() : 0;
                    return bTime - aTime;
                });

                setSessions(result);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, []);

    if (loading) return <div className="p-32"><LoadingState /></div>;
    if (!sessions.length) return <div className="p-32"><EmptyState icon={<Zap />} title="No sessions" description="No activity recorded yet" /></div>;

    return (
        <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-surface-subtle/30 border-b border-border">
                        <th className="px-6 py-4 text-[10px] font-bold text-text-muted uppercase tracking-wider">Team Member</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-text-muted uppercase tracking-wider">Project</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-text-muted uppercase tracking-wider">Start Time</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-text-muted uppercase tracking-wider">End Time</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-text-muted uppercase tracking-wider">Duration</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-text-muted uppercase tracking-wider text-right">Status</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                    {sessions.map(item => {
                        const { member: m, session: s } = item;
                        if (!s) {
                             return (
                                <tr key={m.id} className="hover:bg-primary/[0.01] transition-colors group">
                                    <td className="px-6 py-5">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-text-primary font-bold text-[13px] group-hover:bg-primary group-hover:text-white transition-colors">
                                                {m.full_name.charAt(0).toUpperCase()}
                                            </div>
                                            <span className="font-semibold text-text-primary text-sm tracking-tight group-hover:text-primary transition-colors">{m.full_name}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5 text-center" colSpan={4}>
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted opacity-30 italic">No Recent Activity</span>
                                    </td>
                                    <td className="px-6 py-5 text-right">
                                         <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted opacity-30">Offline</span>
                                    </td>
                                </tr>
                             );
                        }

                        const { endMs, isLive, isStale } = getEffectiveEnd(s.started_at, s.ended_at);
                        const totalMins = (endMs - new Date(s.started_at).getTime()) / 60000;
                        const idleMins = sessionMinsMap[s.id] || 0;
                        const productiveMins = Math.max(0, totalMins - idleMins);
                        const proj = projectMap[s.project_id];

                        return (
                            <tr key={s.id} className="hover:bg-primary/[0.01] transition-colors group">
                                <td className="px-6 py-5">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-text-primary font-bold text-[13px] group-hover:bg-primary group-hover:text-white transition-colors">
                                            {m.full_name.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="font-semibold text-text-primary text-sm tracking-tight group-hover:text-primary transition-colors">{m.full_name}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-5">
                                    {proj ? (
                                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface-subtle border border-border rounded-lg">
                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: proj.color }} />
                                            <span className="text-text-primary font-bold text-[10px] uppercase tracking-tight">{proj.name}</span>
                                        </div>
                                    ) : (
                                        <span className="text-text-muted/40 text-[10px] uppercase font-bold tracking-widest">Unassigned</span>
                                    )}
                                </td>
                                <td className="px-6 py-5 text-text-primary font-semibold text-sm opacity-70 whitespace-nowrap">
                                    {new Date(s.started_at).toLocaleTimeString([], { 
                                        hour: '2-digit', 
                                        minute: '2-digit', 
                                        timeZone: m.timezone || undefined,
                                        timeZoneName: 'short'
                                    })}
                                </td>
                                <td className="px-6 py-5 text-text-primary font-semibold text-sm opacity-70 whitespace-nowrap">
                                    {isLive ? (
                                        <span className="italic text-primary opacity-60">Running</span>
                                    ) : (
                                        new Date(endMs).toLocaleTimeString([], { 
                                            hour: '2-digit', 
                                            minute: '2-digit', 
                                            timeZone: m.timezone || undefined,
                                            timeZoneName: 'short'
                                        })
                                    )}
                                </td>
                                <td className="px-6 py-5 font-semibold text-text-primary text-sm">
                                    {formatDuration(productiveMins)}
                                </td>
                                <td className="px-6 py-5 text-right">
                                    {isLive ? (
                                        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-500/10 border border-emerald-500/20">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                            Active
                                        </span>
                                    ) : isStale ? (
                                        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-500/10 border border-amber-500/20">
                                            Idle
                                        </span>
                                    ) : (
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted opacity-40">Completed</span>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
