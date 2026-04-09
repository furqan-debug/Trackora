import { useMemo } from 'react';
import { getHubstaffBlocks, type HubstaffBlock } from '../../lib/dataUtils';

interface TimelineGridProps {
    samples: any[];
    targetTz?: string | null;
}

export function TimelineGrid({ samples, targetTz }: TimelineGridProps) {
    const blocks = useMemo(() => getHubstaffBlocks(samples, targetTz), [samples, targetTz]);

    const hourGroups = useMemo(() => {
        const groups: Map<number, HubstaffBlock[]> = new Map();
        blocks.forEach(block => {
            const hour = parseInt(block.startTime.split(':')[0]);
            if (!groups.has(hour)) groups.set(hour, []);
            groups.get(hour)!.push(block);
        });
        return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
    }, [blocks]);

    if (samples.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                <p className="text-sm font-medium italic opacity-60">No activity tracked for this period.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between px-2">
                <h4 className="text-[11px] font-bold text-text-muted uppercase tracking-widest">Daily Activity Timeline</h4>
                <div className="flex items-center gap-4">
                    <LegendItem color="bg-emerald-500" label="High" />
                    <LegendItem color="bg-amber-400" label="Med" />
                    <LegendItem color="bg-rose-500" label="Low" />
                    <LegendItem color="bg-slate-200 dark:bg-slate-800 border border-border" label="Idle" />
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {hourGroups.map(([hour, hourBlocks]) => (
                    <div key={hour} className="group relative">
                        <div className="flex items-center gap-4">
                            <div className="w-12 text-right">
                                <span className="text-[11px] font-bold text-text-primary tabular-nums">
                                    {hour.toString().padStart(2, '0')}:00
                                </span>
                            </div>
                            
                            <div className="flex-1 grid grid-cols-6 gap-1.5 h-12">
                                {[0, 1, 2, 3, 4, 5].map(index => {
                                    const blockStartMin = index * 10;
                                    const block = hourBlocks.find(b => parseInt(b.startTime.split(':')[1]) === blockStartMin);
                                    
                                    const label = block ? `${block.startTime}-${block.endTime}: ${block.minutesTracked}/10 mins, ${block.activityPercent}% activity` : '';

                                    return (
                                        <div 
                                            key={index}
                                            title={label}
                                            className={`
                                                relative rounded-lg transition-all duration-300 cursor-help group/block
                                                ${getBlockColor(block?.activityPercent ?? -1)}
                                                ${block ? 'hover:scale-[1.02] hover:shadow-lg hover:z-10 ring-1 ring-inset ring-black/5' : 'opacity-20 border border-dashed border-border'}
                                            `}
                                        >
                                            {block && (
                                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                    <span className="text-[9px] font-black text-white/40 group-hover/block:text-white/70 transition-colors">
                                                        {block.activityPercent}%
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function getBlockColor(percent: number): string {
    if (percent === -1) return 'bg-surface-subtle';
    if (percent === 0) return 'bg-slate-200 dark:bg-slate-800';
    if (percent < 30) return 'bg-rose-500 shadow-[0_0_15px_-5px_rgba(244,63,94,0.4)]';
    if (percent < 70) return 'bg-amber-400 shadow-[0_0_15px_-5px_rgba(251,191,36,0.4)]';
    return 'bg-emerald-500 shadow-[0_0_15px_-5px_rgba(16,185,129,0.4)]';
}

function LegendItem({ color, label }: { color: string, label: string }) {
    return (
        <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{label}</span>
        </div>
    );
}
