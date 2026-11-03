import {formatDateTime} from '../../utils/date-time.js';

export const formatCaptureRunLabel = (run, settings, fallback = run.name) => {
    // Aircraft runs only expose the folder name; its timestamp is always UTC.
    const parts = run.name.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z(?:\.|$)/);
    const timestamp = run.started_at || (parts
        ? `${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6]}Z`
        : null);
    const date = formatDateTime(timestamp, {
        ...settings,
        options: {dateStyle: 'medium', timeStyle: 'medium'},
    });
    return date ? `${date} (${run.name})` : fallback;
};
