/**
 * Shared data utilities for standardized session and duration calculations.
 */

export const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
export const MAX_LIVE_SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours (sanity cap for live sessions)

export interface TimeInterval {
    startMs: number;
    endMs: number;
    hasActivity: boolean;
}

/**
 * Calculates a "safe" end time for a session.
 * Handles "ghost" sessions (unended sessions from the past) by capping them.
 */
export function getEffectiveEnd(startedAt: string, endedAt: string | null, lastSampleAt?: string | null) {
    const startMs = new Date(startedAt).getTime();
    
    // 1. If explicit end exists, use it.
    if (endedAt) {
        return { 
            endMs: new Date(endedAt).getTime(), 
            isLive: false, 
            isStale: false 
        };
    }

    const now = Date.now();
    const elapsed = now - startMs;

    // 2. If session is recent (< threshold), treat it as live.
    if (elapsed < STALE_THRESHOLD_MS) {
        return { 
            endMs: now, 
            isLive: true, 
            isStale: false 
        };
    }

    // 3. If session is older but we have a recent activity sample, use that as the end point.
    if (lastSampleAt) {
        const lastSampleMs = new Date(lastSampleAt).getTime();
        // Only use the sample if it's after the start point
        if (lastSampleMs > startMs) {
            return { 
                endMs: lastSampleMs + (5 * 60000), // Add 5 mins buffer
                isLive: false, 
                isStale: true 
            };
        }
    }

    // 4. Sanity cap: If it's a very old session with no end and no samples, 
    // it was likely a crash or forgotten start. Cap it to 1 minute to avoid 
    // inflating totals with hundreds of "empty" hours.
    return { 
        endMs: startMs + 60000, 
        isLive: false, 
        isStale: true 
    };
}

/**
 * Splits intervals that cross midnight into separate entries.
 */
export function splitIntervalsAtMidnight(intervals: TimeInterval[]): TimeInterval[] {
    const result: TimeInterval[] = [];
    
    for (const interval of intervals) {
        let currentStart = interval.startMs;
        const finalEnd = interval.endMs;
        
        while (currentStart < finalEnd) {
            const startDay = new Date(currentStart);
            const endOfDay = new Date(startDay);
            endOfDay.setHours(23, 59, 59, 999);
            const endOfDayMs = endOfDay.getTime();
            
            const currentEnd = Math.min(finalEnd, endOfDayMs + 1); // +1 to push to midnight 00:00:00.000
            
            result.push({
                ...interval,
                startMs: currentStart,
                endMs: currentEnd
            });
            
            currentStart = currentEnd;
        }
    }
    
    return result;
}

/**
 * Merges overlapping time intervals for the same user to avoid double-counting.
 * Also filters out intervals with no activity if required.
 */
export function flattenTimeRanges(intervals: TimeInterval[]): number {
    const activeIntervals = intervals.filter(i => i.hasActivity);
    if (activeIntervals.length === 0) return 0;
    
    // 1. Split any intervals that cross midnight
    const splitIntervals = splitIntervalsAtMidnight(activeIntervals);
    
    // Sort intervals by start time
    splitIntervals.sort((a, b) => a.startMs - b.startMs);
    
    if (splitIntervals.length === 0) return 0;

    const merged: { start: number, end: number }[] = [];
    let current = { start: splitIntervals[0].startMs, end: splitIntervals[0].endMs };
    
    for (let i = 1; i < splitIntervals.length; i++) {
        const next = splitIntervals[i];
        if (next.startMs < current.end) {
            // Overlapping - extend the current interval
            current.end = Math.max(current.end, next.endMs);
        } else {
            // Non-overlapping - push the current and start a new one
            merged.push({ ...current });
            current = { start: next.startMs, end: next.endMs };
        }
    }
    merged.push(current);
    
    // Sum the durations of unique intervals
    // Use Math.min to ensure no single day block exceeds 24 hours (86400000 ms)
    // although split logic already handles most of this.
    const totalMs = merged.reduce((acc, m) => acc + (m.end - m.start), 0);
    return totalMs / 60000; // Total in decimal minutes
}

/**
 * Formats decimal minutes into "Xh Ym" string.
 */
export function formatDuration(minutes: number): string {
    const totalMinutes = Math.max(0, Math.round(minutes));
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    
    if (h > 0) {
        return `${h}h ${m < 10 ? '0' : ''}${m}m`;
    }
    return `${m}m`;
}

/**
 * Calculates activity percentage from samples.
 * If there are no samples, it returns 0.
 */
export function calculateActivityScore(samples: { idle?: boolean, activity_percent?: number }[]): number {
    if (!samples.length) return 0;
    
    // Method 1: Based on activity_percent field (more precise if available)
    const hasPercent = samples.some(s => s.activity_percent !== undefined);
    if (hasPercent) {
        const sum = samples.reduce((acc, s) => acc + (s.activity_percent || 0), 0);
        return Math.round(sum / samples.length);
    }
    
    // Method 2: Based on idle boolean
    const activeCount = samples.filter(s => !s.idle).length;
    return Math.round((activeCount / samples.length) * 100);
}

