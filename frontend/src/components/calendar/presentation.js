import {darken, lighten} from '@mui/material/styles';
import {ACTIVITY_COLORS} from './activities.js';

export const isLocalObservation = event => event.source === 'observations';

export function eventAccent(event, theme) {
    // Keep an activity's color consistent across cards, icons and details,
    // independently of execution status or changes to its scheduled time.
    const kind = isLocalObservation(event) ? 'observation' : event.kind;
    const feedKind = {space_weather: 'space_weather', launches: 'launch'}[event.feed_id];
    const color = ACTIVITY_COLORS[kind] || ACTIVITY_COLORS[feedKind] || ACTIVITY_COLORS.other_radio;
    return theme.palette.mode === 'dark' ? lighten(color, 0.18) : darken(color, 0.12);
}

export function observationStatusSx(status, theme) {
    const role = {
        scheduled: 'busy', running: 'active', completed: 'inactive',
        failed: 'fault', missed: 'attention', cancelled: 'inactive',
    }[status] || 'inactive';
    const color = theme.palette.operational?.[role];
    return color ? {color: color.main, bgcolor: color.background, borderColor: color.border}
        : {color: 'text.secondary', bgcolor: 'action.hover', borderColor: 'divider'};
}

export function sourceLink(event) {
    try {
        const url = new URL(event.source_url);
        return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch {
        return null;
    }
}

export function windowDuration(event, locale) {
    // Civil-date announcements carry no duration precise enough to express in
    // hours. Their inclusive date range is displayed separately.
    if (event.time_precision && event.time_precision !== 'instant') return null;
    const seconds = Math.round((new Date(event.end) - new Date(event.start)) / 1000);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const format = (value, unit) => new Intl.NumberFormat(locale, {
        style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 0,
    }).format(value);
    if (seconds < 60) return format(seconds, 'second');
    const minutes = Math.round(seconds / 60);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor(minutes / 60) % 24;
    const remaining = minutes % 60;
    return [days && format(days, 'day'), hours && format(hours, 'hour'), remaining && format(remaining, 'minute')]
        .filter(Boolean).join(' ');
}
