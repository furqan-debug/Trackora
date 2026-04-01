import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { 
    ChevronLeft, ChevronRight, 
    Users, Activity, 
    Timer, BarChart3,
    CheckCircle2, AlertCircle,
    Clock, ChevronDown
} from 'lucide-react';
import { PageHeader, Card, KpiCard, LoadingState } from '../components/ui';
import clsx from 'clsx';
import { 
    formatDuration, 
    calculateActivityScore,
    getGroupingDateInTz,
    fetchAllActivitySamples
} from '../lib/dataUtils';

interface Session {
    id: string;
    user_id: string;
    started_at: string;
    ended_at: string | null;
}

interface DailyEntry {
    date: string;
    sessions: Session[];
    totalMinutes: number;
    activeMinutes: number;
    activityPercent: number;
}

interface MemberInfo {
    id: string;
    full_name: string;
    timezone?: string;
    keep_idle_mode?: string;
}

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Timesheets() {
    const [entries, setEntries] = useState<DailyEntry[]>([]);
    const [members, setMembers] = useState<MemberInfo[]>([]);
    const [selectedMember, setSelectedMember] = useState<string>('all');
    const [loading, setLoading] = useState(true);
    const [weekOffset, setWeekOffset] = useState(0);

    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay() + weekOffset * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    useEffect(() => { fetchMembers(); }, []);
    useEffect(() => { fetchTimesheets(); }, [weekOffset, selectedMember]);

    async function fetchMembers() {
        const { data } = await supabase.from('members').select('id, full_name, timezone, keep_idle_mode').order('full_name');
        setMembers(data as MemberInfo[] || []);
    }

    async function fetchTimesheets() {
        setLoading(true);
        try {
            let query = supabase.from('sessions')
                .select('id, user_id, started_at, ended_at')
                .lt('started_at', weekEnd.toISOString())
                .or(`ended_at.is.null,ended_at.gt.${weekStart.toISOString()}`)
                .order('started_at', { ascending: true });

            if (selectedMember !== 'all') {
                query = query.eq('user_id', selectedMember);
            }

            const { data: sessions, error: sessionErr } = await query;
            if (sessionErr) throw sessionErr;

            // Fetch all samples using the pagination helper
            const activityData = await fetchAllActivitySamples(
                supabase,
                weekStart.toISOString(),
                weekEnd.toISOString(),
                'session_id, recorded_at, idle, activity_percent'
            );

            // Map samples to sessions to find the last known activity and for score calculation
            const lastSampleMap: Record<string, string> = {};
            const sessionSamplesMap: Record<string, any[]> = {};
            
            (activityData || []).forEach(a => {
                if (!sessionSamplesMap[a.session_id]) sessionSamplesMap[a.session_id] = [];
                sessionSamplesMap[a.session_id].push(a);
                
                if (!lastSampleMap[a.session_id] || a.recorded_at > lastSampleMap[a.session_id]) {
                    lastSampleMap[a.session_id] = a.recorded_at;
                }
            });

            const sessionToUserId = new Map();
            (sessions || []).forEach(s => sessionToUserId.set(s.id, s.user_id));

            const memberTzMap: Record<string, string | undefined> = {};
            const memberKeepIdleModeMap: Record<string, string> = {};
            members.forEach(m => { 
                memberTzMap[m.id] = m.timezone; 
                memberKeepIdleModeMap[m.id] = m.keep_idle_mode || 'prompt';
            });

            const dailyMap: Record<string, DailyEntry> = {};
            const selectedTz = selectedMember !== 'all' ? members.find(m => m.id === selectedMember)?.timezone : undefined;

            for (let i = 0; i < 7; i++) {
                const d = new Date(weekStart);
                d.setDate(weekStart.getDate() + i);
                const key = getGroupingDateInTz(d, selectedTz);
                dailyMap[key] = { date: key, sessions: [], totalMinutes: 0, activeMinutes: 0, activityPercent: 0 };
            }

            // Group sessions by day
            (sessions || []).forEach(s => {
                const memberTz = memberTzMap[s.user_id];
                const dayKey = getGroupingDateInTz(s.started_at, memberTz || selectedTz);
                if (dailyMap[dayKey]) {
                    dailyMap[dayKey].sessions.push(s as Session);
                }
            });

            // Count Active Minutes per Day
            // Deduplicate Samples (1 per user per minute)
            const seen = new Set<string>();
            const dedupedSamples: any[] = [];
            
            // Sort to prefer high activity if duplicates exist
            const sortedSamples = [...(activityData || [])].sort((a, b) => (b.activity_percent ?? 0) - (a.activity_percent ?? 0));
            
            sortedSamples.forEach(s => {
                const uid = sessionToUserId.get(s.session_id);
                if (!uid) return;
                
                const minute = new Date(s.recorded_at).toISOString().substring(0, 16);
                const key = `${uid}_${minute}`;
                
                if (seen.has(key)) return;
                seen.add(key);
                dedupedSamples.push(s);
            });

            // Count Active Minutes per Day
            dedupedSamples.forEach(a => {
                const uid = sessionToUserId.get(a.session_id);
                if (!uid) return;
                
                const keepIdleMode = memberKeepIdleModeMap[uid];
                // Only filter if keepIdleMode is explicitly 'never' and activity is DEFINITELY 0
                if (keepIdleMode === 'never' && a.activity_percent === 0) return;

                const memberTz = memberTzMap[uid];
                const dateKey = getGroupingDateInTz(a.recorded_at, memberTz || selectedTz);
                if (dailyMap[dateKey]) {
                    dailyMap[dateKey].totalMinutes += 1;
                    dailyMap[dateKey].activeMinutes += 1;
                }
            });

            // Calculate Activity Score for each day
            const result = Object.values(dailyMap).map(d => {
                const daySamples = d.sessions.reduce((acc, s) => {
                    return acc.concat(sessionSamplesMap[s.id] || []);
                }, [] as any[]);

                return {
                    ...d,
                    activityPercent: calculateActivityScore(daySamples)
                };
            });

            setEntries(result);
        } catch (error) {
            console.error('Error fetching timesheets:', error);
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }

    const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    const totalMins = entries.reduce((a, e) => a + e.totalMinutes, 0);
    const avgActivity = entries.filter(e => e.totalMinutes > 0).length 
        ? Math.round(entries.reduce((a, e) => a + e.activityPercent, 0) / entries.filter(e => e.totalMinutes > 0).length) 
        : 0;

    return (
        <div className="min-h-screen bg-background pb-20">
            <PageHeader 
                title="Timesheets" 
                description={`Daily and weekly breakdown of team work sessions • ${weekLabel}`} 
                icon={<Clock className="w-8 h-8 text-primary" />}
            actions={
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <FilterSelect 
                        icon={<Users className="w-4 h-4" />}
                        value={selectedMember}
                        onChange={setSelectedMember}
                        options={[{ id: 'all', name: 'All Members' }, ...members.map(m => ({ id: m.id, name: m.full_name }))]}
                    />
                    
                    <div className="flex items-center gap-1 bg-surface-solid border border-border rounded-xl p-1 shadow-sm">
                        <button onClick={() => setWeekOffset(w => w - 1)} className="p-2 hover:bg-black/[0.03] rounded-lg transition-colors text-text-muted hover:text-primary">
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="px-4 flex items-center justify-center min-w-[180px]">
                            <span className="text-[10px] font-bold text-text-primary uppercase tracking-wider">
                                {weekLabel}
                            </span>
                        </div>
                        <button onClick={() => setWeekOffset(w => w + 1)} className="p-2 hover:bg-black/[0.03] rounded-lg transition-colors text-text-muted hover:text-primary">
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>

                    {weekOffset !== 0 && (
                        <button 
                            onClick={() => setWeekOffset(0)}
                            className="px-4 py-2.5 bg-surface-solid border border-border rounded-xl text-[10px] font-bold uppercase tracking-wider text-primary hover:bg-primary/5 transition-colors shadow-sm"
                        >
                            Go to Today
                        </button>
                    )}
                </div>
            } />
            <div className="px-10 space-y-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 animate-in fade-in duration-500">
                <KpiCard icon={<Timer className="w-5 h-5" />} label="Total Hours" value={loading ? '—' : formatDuration(totalMins)} />
                <KpiCard icon={<BarChart3 className="w-5 h-5" />} label="Avg Activity" value={loading ? '—' : `${avgActivity}%`} />
                <KpiCard icon={<CheckCircle2 className="w-5 h-5" />} label="Active Days" value={loading ? '—' : entries.filter(e => e.totalMinutes > 0).length + ' / 7 days'} />
                <KpiCard icon={<Activity className="w-5 h-5" />} label="Total Sessions" value={loading ? '—' : entries.reduce((a, e) => a + e.sessions.length, 0).toString()} />
            </div>

            <Card title="Weekly Summary" noPadding className="overflow-hidden shadow-sm">
                {loading ? (
                    <div className="py-40 flex items-center justify-center">
                        <LoadingState message="Loading timesheet data..." />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-7 divide-y md:divide-y-0 md:divide-x divide-border bg-surface-solid">
                        {entries.map((entry, i) => {
                            const d = new Date(entry.date + 'T12:00:00');
                            const isToday = d.toDateString() === today.toDateString();
                            const isFuture = d > today;
                            const hasData = entry.totalMinutes > 0;

                            return (
                                <div key={i} className={clsx(
                                    "p-8 flex flex-col min-h-[320px] transition-colors relative group",
                                    isToday ? "bg-primary/[0.02]" : "hover:bg-border/5"
                                )}>
                                    <div className="mb-8 relative z-10">
                                        <span className={clsx(
                                            "text-[10px] font-bold uppercase tracking-wider mb-2 block transition-colors",
                                            isToday ? "text-primary" : "text-text-muted"
                                        )}>
                                            {DAYS_SHORT[d.getDay()]}
                                        </span>
                                        <div className={clsx(
                                            "text-4xl font-bold tracking-tight transition-colors",
                                            isToday ? "text-text-primary" : "text-text-secondary group-hover:text-text-primary"
                                        )}>
                                            {d.getDate()}
                                        </div>
                                    </div>

                                    {isFuture ? (
                                        <div className="mt-auto opacity-30 flex flex-col gap-3">
                                            <div className="h-1 bg-border rounded-full w-20" />
                                            <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted">No sessions</span>
                                        </div>
                                    ) : !hasData ? (
                                        <div className="mt-auto opacity-40">
                                            <div className="flex items-center gap-2 mb-3">
                                                <AlertCircle className="w-4 h-4 text-text-muted" />
                                                <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted">No activity</span>
                                            </div>
                                            <div className="h-1 bg-border rounded-full w-full" />
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-2 flex-1 relative z-10">
                                            <div className="text-3xl font-bold text-text-primary tracking-tight mb-1 group-hover:text-primary transition-colors">
                                                {formatDuration(entry.totalMinutes)}
                                            </div>
                                            <div className="text-[9px] font-bold text-text-muted mb-6 uppercase tracking-wider opacity-70">
                                                {entry.sessions.length} Work Session{entry.sessions.length !== 1 ? 's' : ''}
                                            </div>
                                            
                                            <div className="mt-auto space-y-4">
                                                <div className="h-2 bg-surface-subtle rounded-full overflow-hidden border border-border p-[1px]">
                                                    <div
                                                        className="h-full rounded-full transition-all duration-1000 ease-out"
                                                        style={{
                                                            width: `${entry.activityPercent}%`,
                                                            backgroundColor: entry.activityPercent > 70 ? '#10b981' : entry.activityPercent > 40 ? '#f59e0b' : '#ef4444'
                                                        }}
                                                    />
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <Activity className={clsx(
                                                            "w-3.5 h-3.5",
                                                            entry.activityPercent > 70 ? "text-emerald-500" : entry.activityPercent > 40 ? "text-amber-500" : "text-rose-500"
                                                        )} />
                                                        <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider">Activity</span>
                                                    </div>
                                                    <span className="text-[10px] font-bold text-text-primary bg-surface-subtle px-2 py-1 rounded-md border border-border">{entry.activityPercent}%</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </Card>
        </div>
    </div>
    );
}

function FilterSelect({ icon, value, onChange, options }: { icon: React.ReactNode; value: string; onChange: (val: string) => void; options: { id: string; name: string }[] }) {
    const activeLabel = options.find(o => o.id === value)?.name || value;
    
    return (
        <div className="relative group/select">
            <div className="flex items-center gap-3 bg-surface-solid border border-border rounded-xl px-4 py-2.5 shadow-sm transition-all group-hover/select:border-primary/50 cursor-pointer">
                <div className="text-primary">{icon}</div>
                <span className="text-[10px] font-bold text-text-primary uppercase tracking-wider min-w-[140px]">{activeLabel}</span>
                <ChevronDown className="w-4 h-4 text-text-muted group-hover/select:text-text-primary transition-transform group-hover/select:rotate-180" />
            </div>
            
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            >
                {options.map(o => (
                    <option key={o.id} value={o.id} className="bg-white text-text-primary">{o.name}</option>
                ))}
            </select>
        </div>
    );
}
