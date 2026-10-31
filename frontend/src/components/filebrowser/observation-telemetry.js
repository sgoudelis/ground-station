import { useEffect, useRef, useState } from 'react';

const CONCURRENT_REQUESTS = 3;
const FAILED_STATUSES = ['partial', 'malformed', 'error', 'unsupported'];

export function observationTelemetryStatus(telemetry) {
    const payload = telemetry?.payload;
    if (telemetry?.schema_version !== 1 || !payload) return 'unknown';

    const status = telemetry.payload_status || payload.status;
    const records = payload.records || [];
    let hasValues = false;
    if (payload.kind === 'telemetry') {
        hasValues = records.some((record) => record.status === 'decoded'
            && (record.groups || []).some((group) => Object.entries(group.values || {})
                .some(([key, value]) => value != null && !group.field_info?.[key]?.error)));
    } else if (payload.kind === 'aprs') {
        // Position/message fields also appear in APRS values. Only its explicit
        // telemetry channels or digital bits establish that telemetry is present.
        const readings = payload.aprs?.telemetry;
        hasValues = (readings?.channels || []).some((value) => typeof value === 'number' && Number.isFinite(value))
            || Boolean(readings?.digital_bits);
    }

    if (hasValues) {
        return FAILED_STATUSES.includes(status)
            || records.some((record) => FAILED_STATUSES.includes(record.status)) ? 'partial' : 'telemetry';
    }
    if (status === 'unsupported') return 'unsupported';
    if (status === 'malformed' || status === 'error') return 'error';
    if (status === 'non_telemetry'
        || (status === 'decoded' && ['aprs', 'text'].includes(payload.kind))) return 'other';
    return 'unknown';
}

async function readTelemetryStatus(socket, url) {
    try {
        const response = await new Promise((resolve, reject) => {
            socket.timeout(30000).emit('api.call', {
                cmd: 'filebrowser.view-telemetry', data: { url },
            }, (error, result) => error ? reject(error) : resolve(result));
        });
        const telemetry = response?.success && response.data?.telemetry;
        return { status: observationTelemetryStatus(telemetry), cacheable: telemetry?.schema_version === 1 };
    } catch {
        // Missing metadata and timeouts cannot establish absence of telemetry.
        // Leave these uncached so reopening retries them.
        return { status: 'unknown', cacheable: false };
    }
}

export function useObservationTelemetry({ open, folder, socket, revision = 0 }) {
    // Keep only the current observation's results. A detail refresh or explicit
    // reparse invalidates them, while reopening an unchanged folder reuses them.
    const key = JSON.stringify([folder?.foldername, folder?.modified, revision]);
    const cache = useRef({ key: null, statuses: {}, pending: {} });
    const [results, setResults] = useState({ key: null, statuses: {} });

    useEffect(() => {
        if (!open || !folder) return;
        if (cache.current.key !== key) cache.current = { key, statuses: {}, pending: {} };
        const currentCache = cache.current;
        setResults({ key, statuses: { ...currentCache.statuses } });
        if (!socket?.connected) return;

        const pending = (folder.artifacts || []).filter((artifact) => artifact.kind === 'decoded'
            && artifact.file_type === '.bin' && artifact.url && !artifact.recording_name
            && !currentCache.statuses[artifact.url]);
        let cancelled = false;
        let next = 0;
        const worker = async () => {
            while (!cancelled && socket.connected && next < pending.length) {
                const { url } = pending[next++];
                // Share in-flight reads across reopening and effect restarts,
                // including React Strict Mode's initial effect replay.
                if (!currentCache.pending[url]) {
                    currentCache.pending[url] = readTelemetryStatus(socket, url).then(({ status, cacheable }) => {
                        delete currentCache.pending[url];
                        if (cacheable) currentCache.statuses[url] = status;
                        return status;
                    });
                }
                const status = await currentCache.pending[url];
                // Closing or switching observations stops queued requests and
                // prevents a late response from updating another folder's rows.
                if (cancelled) return;
                setResults((current) => ({ key, statuses: { ...current.statuses, [url]: status } }));
            }
        };
        for (let index = 0; index < Math.min(CONCURRENT_REQUESTS, pending.length); index++) {
            worker();
        }
        return () => { cancelled = true; };
    }, [open, folder?.artifacts, key, socket, socket?.connected]);

    return results.key === key ? results.statuses : {};
}
