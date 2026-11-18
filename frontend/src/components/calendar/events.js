export const satelliteNames = event => (event.satellites || []).map(satellite => satellite.name || String(satellite.norad_id));

export function frequencyLabel(event, locale) {
    return (event.frequencies || []).map(channel => {
        const mhz = (channel.hz / 1000000).toLocaleString(locale, {maximumFractionDigits: 6});
        return `${mhz} MHz${channel.mode ? ` · ${channel.mode}` : ''}`;
    }).join(' / ');
}

export function observationStatuses(t) {
    return {
        scheduled: t('common:scheduler_tables.shared.statuses.scheduled'),
        running: t('common:scheduler_tables.shared.statuses.running'),
        completed: t('common:scheduler_tables.shared.statuses.completed'),
        failed: t('common:scheduler_tables.shared.statuses.failed'),
        cancelled: t('common:scheduler_tables.shared.statuses.cancelled'),
        missed: t('common:scheduler_tables.shared.statuses.missed'),
    };
}
