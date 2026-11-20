// Calendar navigation uses civil dates in UTC. Only event instants are converted
// to the selected timezone, so DST cannot skip or duplicate calendar cells.
export function dayKey(instant, timezone = 'UTC') {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(instant));
    const values = Object.fromEntries(parts.map(({type, value}) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
}

export const civilDate = day => new Date(`${day}T12:00:00Z`);

export function addDays(day, amount) {
    const date = civilDate(day);
    date.setUTCDate(date.getUTCDate() + amount);
    return dayKey(date);
}

export function visibleDays(anchor, view) {
    const date = civilDate(anchor);
    const first = view === 'week' ? anchor : `${anchor.slice(0, 7)}-01`;
    const start = view === 'agenda' ? first : addDays(first, -((civilDate(first).getUTCDay() + 6) % 7));
    const length = view === 'week' ? 7 : view === 'agenda'
        ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
        : 42;
    return Array.from({length}, (_, index) => addDays(start, index));
}

export function movePeriod(anchor, direction, view) {
    if (view === 'week') return addDays(anchor, direction * 7);
    // Move from the first to avoid January 31 overflowing into March.
    const date = civilDate(`${anchor.slice(0, 7)}-01`);
    date.setUTCMonth(date.getUTCMonth() + direction);
    return dayKey(date);
}

export function groupEventsByDay(events, days, timezone) {
    // End instants are exclusive: an event ending at midnight belongs to the
    // previous day, while a window crossing midnight appears on both days.
    const groups = new Map(days.map(day => [day, []]));
    const sorted = events.filter(hasCalendarDate).sort((a, b) => new Date(a.start) - new Date(b.start));
    for (const event of sorted) {
        // Convert each boundary once, rather than once for every calendar cell.
        // Date-only and unspecified-zone announcements stay on their source
        // civil dates; treating them as UTC would shift them in western zones.
        const dated = event.time_precision && event.time_precision !== 'instant';
        const first = dated ? event.start : dayKey(event.start, timezone);
        const last = dated ? addDays(event.end, -1) : dayKey(new Date(event.end).getTime() - 1, timezone);
        for (const day of days) {
            if (first <= day && last >= day) groups.get(day).push(event);
        }
    }
    return groups;
}

export function hasCalendarDate(event) {
    // A broad date-only launch estimate has no known day. Keep timed windows
    // and known-day launches, including those with no stated clock time.
    return event.kind !== 'launch' || Boolean(event.start && event.end && (
        (event.time_precision === 'instant' || (!event.time_precision && event.start.includes('T')))
        || event.end === addDays(event.start, 1)
    ));
}

export const eventsOnDay = (events, day, timezone) => groupEventsByDay(events, [day], timezone).get(day);

export function isCalendarDay(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
        && !Number.isNaN(civilDate(value).getTime()) && dayKey(civilDate(value)) === value;
}
