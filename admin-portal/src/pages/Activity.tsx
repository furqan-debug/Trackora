import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Mouse, Keyboard, Activity as ActivityIcon, Zap, Users, Calendar, Diamond, ChevronDown, Monitor } from 'lucide-react';
import { PageLayout, KpiCard, FilterSelect, Card, LoadingState } from '../components/ui';

import { AppUsageList } from '../components/activity/AppUsageList';
import { ScreenshotGallery } from '../components/activity/ScreenshotGallery';
import { ScreenshotLightbox } from '../components/activity/ScreenshotLightbox';
import { TimelineGrid } from '../components/activity/TimelineGrid';
import { calculateActivityScore, calculateProductiveMinutes } from '../lib/dataUtils';

interface ActivitySample {
    id: number;
    session_id: string;
    recorded_at: string;
    mouse_clicks: number;
    key_presses: number;
    app_name: string;
    window_title: string;
    idle: boolean;
    activity_percent: number;
}

interface Screenshot {
    id: number;
    session_id: string;
    recorded_at: string;
    file_url: string;
}

interface MemberInfo {
    id: string;
    auth_user_id?: string | null;
    full_name: string;
    timezone?: string;
    keep_idle?: boolean;
}

function formatLocalDate(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function Activity() {
    const [samples, setSamples] = useState<ActivitySample[]>([]);
    const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedDate, setSelectedDate] = useState(formatLocalDate(new Date()));
    const [enlarged, setEnlarged] = useState<Screenshot | null>(null);
    const [members, setMembers] = useState<MemberInfo[]>([]);
    const [selectedMemberId, setSelectedMemberId] = useState<string>('all');
    const [sessionMinutes, setSessionMinutes] = useState(0);
    const dateInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        supabase.from('members').select('id, auth_user_id, full_name, timezone, keep_idle').eq('status', 'Active').then(({ data }) => {
            if (data) setMembers(data);
        });
    }, []);

    // Wait for members to be available before fetching (avoids race condition with timezone)
    useEffect(() => {
        // If a specific member is selected, we need members list to get their timezone.
        // If members haven't loaded yet, skip — the effect will re-run once members load.
        if (selectedMemberId !== 'all' && members.length === 0) return;
        fetchData();
    }, [selectedDate, selectedMemberId, members]);

    async function fetchData() {
        setLoading(true);

        const selectedMember = members.find(m => m.id === selectedMemberId);
        // For all members, use browser timezone; for specific member, use their timezone.
        const tz = (
            selectedMemberId.toLowerCase() !== 'all'
                ? selectedMember?.timezone
                : Intl.DateTimeFormat().resolvedOptions().timeZone
        ) || 'UTC';

        // Calculate the UTC window that corresponds to the selected date in the member's timezone.
        const getUtcOffsetMinutes = (timezone: string, date: Date): number => {
            try {
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone: timezone,
                    timeZoneName: 'longOffset'
                }).formatToParts(date);
                const offsetStr = parts.find(p => p.type === 'timeZoneName')?.value ?? '';
                const match = offsetStr.match(/GMT([+-])(\d{2}):(\d{2})/);
                if (match) {
                    const [, sign, hours, mins] = match;
                    const total = parseInt(hours) * 60 + parseInt(mins);
                    return sign === '+' ? total : -total;
                }
            } catch { /* */ }
            return 0;
        };

        // Use a reference point mid-day to get a stable offset for the selected date
        const refPoint = new Date(`${selectedDate}T12:00:00Z`);
        const offsetMinutes = getUtcOffsetMinutes(tz, refPoint);

        // UTC time = local midnight - offset
        // e.g. PKT is UTC+5 → local midnight = UTC 19:00 previous day
        const startUtcMs = new Date(`${selectedDate}T00:00:00`).getTime() - offsetMinutes * 60000;
        const endUtcMs = new Date(`${selectedDate}T23:59:59`).getTime() - offsetMinutes * 60000;

        const start = new Date(startUtcMs).toISOString();
        const end = new Date(endUtcMs).toISOString();

        const memberUserIds = selectedMemberId.toLowerCase() !== 'all'
            ? Array.from(new Set([selectedMember?.id, selectedMember?.auth_user_id].filter(Boolean) as string[]))
            : [];

        if (selectedMemberId.toLowerCase() !== 'all' && memberUserIds.length === 0) {
            setSamples([]);
            setScreenshots([]);
            setSessionMinutes(0);
            setLoading(false);
            return;
        }

        let sessionsQuery = supabase
            .from('sessions')
            .select('id, user_id, started_at, ended_at')
            .lt('started_at', end)
            .or(`ended_at.is.null,ended_at.gt.${start}`);

        if (memberUserIds.length > 0) {
            sessionsQuery = sessionsQuery.in('user_id', memberUserIds);
        }

        const { data: sessionRows } = await sessionsQuery;
        const sessions = sessionRows || [];
        const sessionIds = sessions.map(s => s.id);

        if (sessionIds.length === 0) {
            setSamples([]);
            setScreenshots([]);
            setSessionMinutes(0);
            setLoading(false);
            return;
        }

        let actQuery = supabase
            .from('activity_samples')
            .select('*')
            .in('session_id', sessionIds)
            .gte('recorded_at', start)
            .lte('recorded_at', end)
            .order('recorded_at', { ascending: true });

        let ssQuery = supabase
            .from('screenshots')
            .select('*')
            .in('session_id', sessionIds)
            .gte('recorded_at', start)
            .lte('recorded_at', end)
            .order('recorded_at', { ascending: false })
            .limit(200);

        const [{ data: actData }, { data: ssData }] = await Promise.all([actQuery, ssQuery]);

        const startMs = new Date(start).getTime();
        const endMs = new Date(end).getTime();
        const mins = sessions.reduce((acc, s) => {
            const sStart = new Date(s.started_at).getTime();
            const sEnd = s.ended_at ? new Date(s.ended_at).getTime() : Date.now();
            const overlap = Math.max(0, Math.min(sEnd, endMs) - Math.max(sStart, startMs));
            return acc + overlap / 60000;
        }, 0);

        setSamples(actData || []);
        setScreenshots(ssData || []);
        setSessionMinutes(mins);
        setLoading(false);
    }

    // Deduplicate samples by minute to avoid double-counting in KPIs if sessions overlap
    const uniqueMinMap = new Map<string, ActivitySample>();
    samples.forEach((s: ActivitySample) => {
        const minKey = s.recorded_at.substring(0, 16); // YYYY-MM-DDTHH:mm
        if (!uniqueMinMap.has(minKey)) {
            uniqueMinMap.set(minKey, s);
        } else {
            // If overlap, take the one with more activity
            const existing = uniqueMinMap.get(minKey)!;
            if ((s.mouse_clicks + s.key_presses) > (existing.mouse_clicks + existing.key_presses)) {
                uniqueMinMap.set(minKey, s);
            }
        }
    });

    const uniqueSamples = Array.from(uniqueMinMap.values());

    const selectedMember = members.find(m => m.id === selectedMemberId);

    const totalClicks = uniqueSamples.reduce((a, b) => a + b.mouse_clicks, 0);
    const totalKeys = uniqueSamples.reduce((a, b) => a + b.key_presses, 0);
    const avgActivity = calculateActivityScore(uniqueSamples);

    // NEW FORMULA: Productive = Total Tracked - Idle (idle=true samples excluded)
    const productiveMinutes = uniqueSamples.length > 0
        ? calculateProductiveMinutes(uniqueSamples)
        : Math.max(0, Math.round(sessionMinutes));

    const isToday = selectedDate === formatLocalDate(new Date());
    const dateLabel = isToday ? 'Live Timeline' : new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    return (
        <PageLayout
            title="Screen Captures"
            description={`${dateLabel} • Review work session screenshots and input activity.`}
            maxWidth="full"
            actions={
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <FilterSelect
                        icon={<Users className="w-5 h-5 text-primary" />}
                        value={selectedMemberId}
                        onChange={setSelectedMemberId}
                        options={[{ id: 'all', name: 'All Members' }, ...members.map(m => ({ id: m.id, name: m.full_name }))]}
                    />
                    <div
                        className="relative group/date"
                        onClick={() => dateInputRef.current?.showPicker()}
                    >
                        <div className="flex items-center gap-3 bg-surface-solid border border-border rounded-xl px-5 py-2.5 shadow-sm hover:border-primary transition-all cursor-pointer">
                            <Calendar className="w-5 h-5 text-primary" />
                            <span className="text-[10px] font-bold text-text-primary tracking-wider min-w-[100px] text-center">{selectedDate}</span>
                            <ChevronDown className="w-4 h-4 text-text-muted opacity-40 group-hover/date:translate-y-0.5 transition-transform" />
                        </div>
                        <input
                            ref={dateInputRef}
                            type="date"
                            value={selectedDate}
                            onChange={e => setSelectedDate(e.target.value)}
                            className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
                        />
                    </div>
                </div>
            }
        >
            {loading ? (
                <div className="py-40 flex items-center justify-center">
                    <LoadingState message="Retrieving activity details and screenshots..." />
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12 animate-in fade-in duration-500">
                        <KpiCard icon={<Mouse className="w-6 h-6" />} label="Mouse Clicks" value={totalClicks.toLocaleString()} />
                        <KpiCard icon={<Keyboard className="w-6 h-6" />} label="Keyboard Usage" value={totalKeys.toLocaleString()} />
                        <KpiCard icon={<ActivityIcon className="w-6 h-6" />} label="Billable Time" value={`${productiveMinutes} min`} />
                        <KpiCard icon={<Zap className="w-6 h-6" />} label="Avg Activity" value={`${avgActivity}%`} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
                        <Card className="lg:col-span-2 p-0 border-border bg-surface-solid shadow-sm rounded-2xl overflow-hidden">
                            <div className="px-8 py-5 border-b border-border bg-surface-subtle flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-surface-solid border border-border flex items-center justify-center text-primary shadow-sm">
                                        <ActivityIcon className="w-5 h-5" />
                                    </div>
                                    <h3 className="text-sm font-bold text-text-primary tracking-tight">Activity Over Time</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Live Updates</span>
                                </div>
                            </div>
                            <div className="p-8">
                                <TimelineGrid samples={uniqueSamples} targetTz={selectedMember?.timezone} />
                            </div>
                        </Card>

                        <Card className="lg:col-span-1 p-0 border-border bg-surface-solid shadow-sm rounded-2xl overflow-hidden">
                            <div className="px-8 py-5 border-b border-border bg-surface-subtle flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-surface-solid border border-border flex items-center justify-center text-primary shadow-sm">
                                    <Diamond className="w-5 h-5" />
                                </div>
                                <h3 className="text-sm font-bold text-text-primary tracking-tight">Usage Breakdown</h3>
                            </div>
                            <div className="p-0">
                                <AppUsageList samples={samples} />
                            </div>
                        </Card>
                    </div>

                    <div className="mt-12">
                        <div className="flex items-center gap-4 mb-8 px-4">
                            <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-white shadow-lg">
                                <Monitor className="w-6 h-6" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-bold text-text-primary tracking-tight">Screenshot Gallery</h2>
                                <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Visual history of work sessions</p>
                            </div>
                        </div>

                        <ScreenshotGallery screenshots={screenshots} onSelectImage={setEnlarged} />
                    </div>
                </>
            )}

            <ScreenshotLightbox enlarged={enlarged} setEnlarged={setEnlarged} />
        </PageLayout>
    );
}
