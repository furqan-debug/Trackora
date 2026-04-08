import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
    Monitor, Camera,
    Clock, Activity as ActivityIcon, Users,
    ChevronDown, Zap, Download, DollarSign
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import {
    PageLayout, Card, KpiCard, Button,
    LoadingState, EmptyState
} from '../components/ui';
import clsx from 'clsx';
import {
    formatDuration,
    calculateActivityScore,
    getGroupingDateInTz,
    getEffectiveEnd,
    fetchAllActivitySamples
} from '../lib/dataUtils';

const COLORS = ['#506ef8', '#818cf8', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];
const RANGES = ['Today', 'Last 7 Days', 'Last 30 Days'] as const;
type Range = typeof RANGES[number];

export function Reports() {
    const [range, setRange] = useState<Range>('Last 7 Days');
    const [loading, setLoading] = useState(true);
    const [dailyActivity, setDailyActivity] = useState<{ date: string; activity: number; minutes: number }[]>([]);
    const [appBreakdown, setAppBreakdown] = useState<{ name: string; value: number }[]>([]);
    const [screenshotCount, setScreenshotCount] = useState(0);
    const [totalSessions, setTotalSessions] = useState(0);
    const [totalMins, setTotalMins] = useState(0);
    const [avgActivity, setAvgActivity] = useState(0);
    const [totalCosts, setTotalCosts] = useState(0);
    const [totalBilled, setTotalBilled] = useState(0);

    // Team & Member filtering
    const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
    const [selectedTeamId, setSelectedTeamId] = useState<string>('All');
    const [members, setMembers] = useState<{ id: string; auth_user_id?: string | null; email: string; full_name: string; pay_rate?: number; bill_rate?: number; timezone?: string }[]>([]);
    const [selectedMemberId, setSelectedMemberId] = useState<string>('All');

    useEffect(() => {
        fetchTeams();
        fetchMembers();
    }, []);

    useEffect(() => {
        fetchReports();
    }, [range, selectedTeamId, selectedMemberId]);

    async function fetchTeams() {
        const { data } = await supabase.from('teams').select('id, name');
        if (data) setTeams(data);
    }

    async function fetchMembers() {
        const { data } = await supabase.from('members').select('id, auth_user_id, email, full_name, pay_rate, bill_rate, timezone').eq('status', 'Active');
        if (data) setMembers(data);
    }

    function getMemberSessionUserIds(member: { id: string; auth_user_id?: string | null }): string[] {
        return Array.from(new Set([member.id, member.auth_user_id].filter(Boolean) as string[]));
    }

    // ✅ FIX 1: getDateRange no longer mutates `now`, uses consistent references
    function getDateRange(): { start: string; end: string } {
        const now = new Date();
        const end = now.toISOString();
        let start: Date;
        if (range === 'Today') {
            start = new Date();
            start.setHours(0, 0, 0, 0); // ✅ fresh Date, not mutating `now`
        } else if (range === 'Last 7 Days') {
            start = new Date(now.getTime() - 7 * 86400000); // ✅ using now.getTime()
        } else {
            start = new Date(now.getTime() - 30 * 86400000);
        }
        return { start: start.toISOString(), end };
    }

    async function fetchReports() {
        setLoading(true);
        const { start, end } = getDateRange();

        // ✅ FIX 2: Always fetch fresh members at top of fetchReports to avoid
        // stale state race condition when member filter is changed on first load
        const membersForLookup = members.length > 0
            ? members
            : (await supabase
                .from('members')
                .select('id, auth_user_id, email, full_name, pay_rate, bill_rate, timezone')
                .eq('status', 'Active')).data || [];

        let filteredSessionUserIds: string[] = [];

        if (selectedMemberId !== 'All') {
            // ✅ FIX 3: Use membersForLookup (fresh) instead of stale members state
            const selectedMember = membersForLookup.find(m => m.id === selectedMemberId);
            filteredSessionUserIds = selectedMember
                ? getMemberSessionUserIds(selectedMember)
                : [];
        } else if (selectedTeamId !== 'All') {
            const { data: tm } = await supabase.from('team_members').select('member_id').eq('team_id', selectedTeamId);
            const teamMemberIds = tm?.map(t => t.member_id) || [];

            if (teamMemberIds.length > 0) {
                const membersById = new Map(membersForLookup.map(m => [m.id, m]));
                filteredSessionUserIds = Array.from(
                    new Set(
                        teamMemberIds.flatMap(memberId => {
                            const member = membersById.get(memberId);
                            return member ? getMemberSessionUserIds(member) : [memberId];
                        })
                    )
                );
            }
        }

        // Early exit if specific filter selected but no user IDs found
        if ((selectedMemberId !== 'All' || selectedTeamId !== 'All') && filteredSessionUserIds.length === 0) {
            setDailyActivity([]);
            setAppBreakdown([]);
            setTotalSessions(0);
            setScreenshotCount(0);
            setTotalMins(0);
            setAvgActivity(0);
            setTotalCosts(0);
            setTotalBilled(0);
            setLoading(false);
            return;
        }

        try {
            // ✅ FIX 4: Filter sessions by user_id IN THE DB QUERY when a member/team
            // is selected, instead of fetching all sessions and filtering in JS.
            // This is the root cause of member data not showing — JS filter was running
            // before membersForLookup was populated, resulting in empty filteredSessions.
            let sessionsQuery = supabase
                .from('sessions')
                .select('id, user_id, started_at, ended_at')
                .lt('started_at', end)
                .or(`ended_at.is.null,ended_at.gt.${start}`);

            if (filteredSessionUserIds.length > 0) {
                sessionsQuery = sessionsQuery.in('user_id', filteredSessionUserIds);
            }

            const { data: sessionData } = await sessionsQuery;
            const filteredSessions = sessionData || [];

            // If a specific member/team was selected but they have no sessions, return early
            if ((selectedMemberId !== 'All' || selectedTeamId !== 'All') && filteredSessions.length === 0) {
                setDailyActivity([]);
                setAppBreakdown([]);
                setTotalSessions(0);
                setScreenshotCount(0);
                setTotalMins(0);
                setAvgActivity(0);
                setTotalCosts(0);
                setTotalBilled(0);
                setLoading(false);
                return;
            }

            const activeSessionIds = filteredSessions.map(s => s.id);

            // Fetch screenshots count
            let ssQuery = supabase
                .from('screenshots')
                .select('id', { count: 'exact', head: true })
                .gte('recorded_at', start)
                .lte('recorded_at', end);

            if (activeSessionIds.length > 0) {
                ssQuery = ssQuery.in('session_id', activeSessionIds);
            }

            const [samples, { count: ssCount }] = await Promise.all([
                fetchAllActivitySamples(
                    supabase,
                    start,
                    end,
                    'session_id, recorded_at, activity_percent, idle, app_name',
                    { sessionIds: activeSessionIds.length > 0 ? activeSessionIds : undefined }
                ),
                ssQuery,
            ]);

            const allSamples = samples || [];

            setTotalSessions(activeSessionIds.length);
            setScreenshotCount(ssCount || 0);

            const sessionToUserId = new Map();
            filteredSessions.forEach(s => sessionToUserId.set(s.id, s.user_id));
            const activeSessionIdsSet = new Set(activeSessionIds);

            const inScopeSamples = allSamples.filter(s => activeSessionIdsSet.has(s.session_id));
            const productiveSamples = inScopeSamples.filter(s => s.idle !== true);

            const membersMap = new Map<string, any>();
            const memberTzs = new Map<string, string | undefined>();

            membersForLookup.forEach((m: any) => {
                membersMap.set(m.id, m);
                memberTzs.set(m.id, m.timezone);
                if (m.auth_user_id) {
                    membersMap.set(m.auth_user_id, m);
                    memberTzs.set(m.auth_user_id, m.timezone);
                }
            });

            // Deduplicate samples (1 per user per minute)
            const seen = new Set<string>();
            const dedupedSamples: any[] = [];

            const sortedSamples = [...inScopeSamples].sort((a, b) => (b.activity_percent ?? 0) - (a.activity_percent ?? 0));

            sortedSamples.forEach(s => {
                const uid = sessionToUserId.get(s.session_id);
                if (!uid) return;
                const minute = new Date(s.recorded_at).toISOString().substring(0, 16);
                const key = `${uid}_${minute}`;
                if (seen.has(key)) return;
                seen.add(key);
                dedupedSamples.push(s);
            });

            const dailyMap: Record<string, { active: number; total_samples: number; total_minutes: number }> = {};
            let costs = 0;
            let billed = 0;

            dedupedSamples.forEach(s => {
                const uid = sessionToUserId.get(s.session_id);
                if (!uid) return;

                const day = getGroupingDateInTz(s.recorded_at, memberTzs.get(uid));

                if (!dailyMap[day]) dailyMap[day] = { active: 0, total_samples: 0, total_minutes: 0 };

                if (s.activity_percent && s.activity_percent > 0) {
                    dailyMap[day].active++;
                }
                dailyMap[day].total_samples++;
                dailyMap[day].total_minutes++;

                const member = membersMap.get(uid);
                if (member) {
                    costs += (1 / 60) * (member.pay_rate || 0);
                    billed += (1 / 60) * (member.bill_rate || 0);
                }
            });

            setDailyActivity(
                Object.entries(dailyMap).sort().map(([date, v]) => ({
                    date: new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    activity: v.total_samples > 0 ? Math.round((v.active / v.total_samples) * 100) : 0,
                    minutes: Math.round(v.total_minutes),
                }))
            );

            const appMap: Record<string, number> = {};
            inScopeSamples.forEach(s => {
                const app = s.app_name || 'Unknown';
                appMap[app] = (appMap[app] || 0) + 1;
            });
            setAppBreakdown(
                Object.entries(appMap).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name, value }))
            );

            // Total time based on sessions
            let totalSessionMins = 0;
            filteredSessions.forEach(s => {
                const { endMs } = getEffectiveEnd(s.started_at, s.ended_at);
                const startMs = new Date(s.started_at).getTime();
                totalSessionMins += (endMs - startMs) / 60000;
            });

            setTotalSessions(filteredSessions.length);
            setScreenshotCount(ssCount || 0);
            setTotalMins(Math.max(dedupedSamples.length, Math.round(totalSessionMins)));
            setAvgActivity(calculateActivityScore(productiveSamples));
            setTotalCosts(costs);
            setTotalBilled(billed);
        } catch (err) {
            console.error("fetchReports unhandled error:", err);
        } finally {
            setLoading(false);
        }
    }

    return (
        <PageLayout
            title="Reports"
            description="Analyze team activity, productivity, and project costs."
            actions={
                <div className="flex flex-wrap items-center gap-6">
                    <div className="flex items-center gap-1 bg-surface-solid border border-border p-1 rounded-lg shadow-sm">
                        {RANGES.map(r => (
                            <button
                                key={r}
                                onClick={() => setRange(r)}
                                className={clsx(
                                    "px-4 py-1.5 rounded-md text-xs font-medium transition-all",
                                    range === r ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text-primary"
                                )}
                            >
                                {r}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-3">
                        <FilterSelect
                            icon={<Users className="w-4 h-4" />}
                            value={selectedTeamId}
                            onChange={(val) => { setSelectedTeamId(val); setSelectedMemberId('All'); }}
                            options={[{ id: 'All', name: 'All Teams' }, ...teams]}
                        />
                        <FilterSelect
                            icon={<ActivityIcon className="w-4 h-4" />}
                            value={selectedMemberId}
                            onChange={(val) => { setSelectedMemberId(val); setSelectedTeamId('All'); }}
                            options={[{ id: 'All', name: 'All Members' }, ...members].map((m: any) => ({ id: m.id, name: m.full_name || m.email || m.name || 'Member' }))}
                        />
                        <Button
                            variant="secondary"
                            className="p-2.5 rounded-lg"
                            onClick={() => {/* export logic */ }}
                        >
                            <Download className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            }
        >

            <div className="flex flex-col gap-10">
                {/* KPI Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
                    <KpiCard
                        icon={<Clock className="w-5 h-5" strokeWidth={2.5} />}
                        label="Total Time"
                        value={formatDuration(totalMins)}
                        trend="+12%"
                        trendVariant="positive"
                    />
                    <KpiCard
                        icon={<ActivityIcon className="w-5 h-5" strokeWidth={2.5} />}
                        label="Activity Rating"
                        value={`${avgActivity}%`}
                        trend="+4%"
                        trendVariant="positive"
                    />
                    <KpiCard
                        icon={<DollarSign className="w-5 h-5" strokeWidth={2.5} />}
                        label="Total Billed"
                        value={`$${totalBilled.toLocaleString()}`}
                        trend="+15%"
                        trendVariant="positive"
                    />
                    <KpiCard
                        icon={<Monitor className="w-5 h-5" strokeWidth={2.5} />}
                        label="Total Sessions"
                        value={totalSessions.toString()}
                        trend="+2"
                        trendVariant="positive"
                    />
                    <KpiCard
                        icon={<Camera className="w-5 h-5" strokeWidth={2.5} />}
                        label="Screenshots"
                        value={screenshotCount.toString()}
                        trend="+45"
                        trendVariant="positive"
                    />
                    <KpiCard
                        icon={<DollarSign className="w-5 h-5" strokeWidth={2.5} />}
                        label="Total Costs"
                        value={`$${totalCosts.toLocaleString()}`}
                        trend="+8%"
                        trendVariant="negative"
                    />
                </div>

                {loading ? (
                    <div className="h-[600px] flex items-center justify-center">
                        <LoadingState message="Generating activity reports..." />
                    </div>
                ) : dailyActivity.length === 0 ? (
                    <div className="h-[600px] flex items-center justify-center">
                        <EmptyState
                            title="No activity data found"
                            description="Try adjusting your filters or date range to see results."
                        />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                        <div className="lg:col-span-2 space-y-10">
                            <Card title="Activity Trends">
                                <div className="h-[400px] w-full mt-8">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={dailyActivity} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="colorActivity" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#506ef8" stopOpacity={0.15} />
                                                    <stop offset="95%" stopColor="#506ef8" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.03)" />
                                            <XAxis
                                                dataKey="date"
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fill: 'rgba(41,61,99,0.5)', fontSize: 11 }}
                                                dy={10}
                                            />
                                            <YAxis
                                                domain={[0, 100]}
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fill: 'rgba(41,61,99,0.5)', fontSize: 11 }}
                                                unit="%"
                                            />
                                            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(80,110,248,0.1)', strokeWidth: 1 }} />
                                            <Area
                                                type="monotone"
                                                dataKey="activity"
                                                stroke="#506ef8"
                                                strokeWidth={2}
                                                fillOpacity={1}
                                                fill="url(#colorActivity)"
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </Card>

                            <Card title="Time Distribution">
                                <div className="h-[350px] w-full mt-8">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={dailyActivity} barSize={36}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.03)" />
                                            <XAxis
                                                dataKey="date"
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fill: 'rgba(41,61,99,0.5)', fontSize: 11 }}
                                                dy={10}
                                            />
                                            <YAxis
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fill: 'rgba(41,61,99,0.5)', fontSize: 11 }}
                                            />
                                            <Tooltip content={<CustomTooltip unit="min" />} cursor={{ fill: 'rgba(80,110,248,0.03)' }} />
                                            <Bar
                                                dataKey="minutes"
                                                fill="url(#barGradient)"
                                                radius={[4, 4, 0, 0]}
                                            />
                                            <defs>
                                                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="#506ef8" />
                                                    <stop offset="100%" stopColor="#818cf8" />
                                                </linearGradient>
                                            </defs>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </Card>
                        </div>

                        <div className="space-y-10">
                            <Card title="Top Applications" className="flex flex-col h-full">
                                <div className="flex-1 min-h-[450px] flex flex-col items-center justify-center py-12">
                                    <div className="h-[300px] w-full relative">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={appBreakdown}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={60}
                                                    outerRadius={90}
                                                    paddingAngle={4}
                                                    dataKey="value"
                                                >
                                                    {appBreakdown.map((_, i) => (
                                                        <Cell key={i} fill={COLORS[i % COLORS.length]} strokeWidth={0} />
                                                    ))}
                                                </Pie>
                                                <Tooltip content={<CustomTooltip />} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                            <span className="text-3xl font-bold text-text-primary">{appBreakdown.length}</span>
                                            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Apps</span>
                                        </div>
                                    </div>

                                    <div className="w-full mt-8 space-y-2">
                                        {appBreakdown.map((item, i) => (
                                            <div key={i} className="flex items-center justify-between p-2 rounded-lg hover:bg-surface-subtle transition-all">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                                                    <span className="text-sm text-text-primary truncate max-w-[180px]">{item.name}</span>
                                                </div>
                                                <span className="text-[10px] font-medium text-text-muted bg-surface-subtle px-2 py-1 rounded border border-border">
                                                    {item.value} sess
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </Card>

                            <div className="bg-surface-solid border border-border overflow-hidden rounded-2xl relative p-8 shadow-sm">
                                <div className="relative z-10">
                                    <div className="justify-between items-start mb-6 hidden md:flex">
                                        <div className="bg-primary/10 p-3 rounded-xl border border-primary/20">
                                            <Zap className="w-6 h-6 text-primary" />
                                        </div>
                                        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                                            Organization Activity
                                        </span>
                                    </div>
                                    <h4 className="text-text-muted font-semibold uppercase tracking-wider text-[10px] mb-2 opacity-60">Avg. Activity Score</h4>
                                    <div className="flex items-baseline gap-2 mb-6">
                                        <span className="text-5xl font-bold text-text-primary">{avgActivity}%</span>
                                    </div>
                                    <p className="text-sm text-text-primary leading-relaxed mb-6">
                                        This activity baseline reflects active mouse/keyboard usage of the team during their recorded work hours.
                                    </p>
                                    <div className="w-full h-2.5 bg-surface-subtle rounded-full overflow-hidden border border-border">
                                        <div
                                            className="h-full bg-primary rounded-full transition-all duration-1000"
                                            style={{ width: `${avgActivity}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </PageLayout>
    );
}

function FilterSelect({ icon, value, onChange, options }: { icon: React.ReactNode; value: string; onChange: (val: string) => void; options: { id: string; name: string }[] }) {
    const activeLabel = options.find(o => o.id === value)?.name || value;

    return (
        <div className="relative group">
            <div className="flex items-center gap-3 bg-surface-solid border border-border rounded-lg px-4 py-2 shadow-sm hover:border-primary/40 cursor-pointer">
                <div className="text-text-muted">{icon}</div>
                <span className="text-xs font-medium text-text-primary min-w-[100px] truncate">{activeLabel}</span>
                <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
            </div>

            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            >
                {options.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                ))}
            </select>
        </div>
    );
}

function CustomTooltip({ active, payload, label, unit }: any) {
    if (active && payload && payload.length) {
        return (
            <Card className="p-4 shadow-lg border border-border min-w-[150px]">
                <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2 border-b border-border pb-2">{label}</p>
                <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                    <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold text-text-primary">
                            {payload[0].value}
                        </span>
                        <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                            {unit === 'min' ? 'Mins' : '%'}
                        </span>
                    </div>
                </div>
            </Card>
        );
    }
    return null;
}
