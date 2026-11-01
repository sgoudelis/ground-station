/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {useCallback, useEffect, useRef, useState} from 'react';

const LEGACY_DATE_ERROR = 'start and end must be timezone-aware ISO dates or epoch seconds';

export function callLibrary(socket, cmd, data) {
    return new Promise((resolve, reject) => {
        if (!socket?.connected) {
            reject(new Error('Not connected to server'));
            return;
        }
        socket.timeout(30000).emit('api.call', {cmd, data}, (error, reply) => {
            if (error) reject(new Error('The library request timed out'));
            else if (!reply?.success) {
                // Older backends expose their date parser's internal message.
                const legacyDateError = reply?.error === LEGACY_DATE_ERROR;
                const failure = new Error(legacyDateError ? 'Choose a valid date range.'
                    : reply?.error || 'Unable to load packet positions');
                if (legacyDateError) failure.code = 'LEGACY_DATE_RANGE';
                reject(failure);
            }
            else resolve(reply.data);
        });
    });
}

export default function usePacketPositions(socket, range) {
    const [result, setResult] = useState({positions: [], available_range: null});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const reloadRef = useRef(null);
    const refresh = useCallback(() => {void reloadRef.current?.();}, []);

    useEffect(() => {
        let active = true;
        let inFlight = false;
        let pending = false;
        let liveEndRequired = false;
        const query = async () => {
            const requestRange = range.end === null && liveEndRequired
                ? {...range, end: new Date().toISOString()} : range;
            try {
                return await callLibrary(socket, 'filebrowser.positions', requestRange);
            } catch (failure) {
                if (!active || range.end !== null || liveEndRequired || failure.code !== 'LEGACY_DATE_RANGE') throw failure;
                // Older running servers require an end date. Retry with a fresh
                // snapshot and advance that date on every subsequent LIVE update.
                liveEndRequired = true;
                return callLibrary(socket, 'filebrowser.positions', {...range, end: new Date().toISOString()});
            }
        };
        // Clear only when the query changes. Background updates retain the map,
        // table selection and details until the replacement snapshot arrives.
        setResult((previous) => ({...previous, positions: [], transmitters: undefined}));
        const load = async () => {
            if (!active) return;
            // Queue one follow-up instead of cancelling slow replies under
            // continuous decoder traffic or issuing overlapping requests.
            if (inFlight) {
                pending = true;
                return;
            }
            inFlight = true;
            setLoading(true);
            setError('');
            try {
                const data = await query();
                if (active) setResult(data);
            } catch (failure) {
                if (active) setError(failure.message);
            } finally {
                inFlight = false;
                if (active) {
                    if (pending) {
                        pending = false;
                        void load();
                    } else setLoading(false);
                }
            }
        };
        reloadRef.current = load;
        const reload = () => {void load();};
        socket?.on('connect', reload);
        socket?.on('disconnect', reload);
        // Limit refreshes during save bursts without postponing them forever
        // when a decoder continuously produces packets.
        let timer;
        const changed = () => {
            if (timer !== undefined) return;
            timer = window.setTimeout(() => {
                timer = undefined;
                void load();
            }, 750);
        };
        socket?.on('library.changed', changed);
        void load();
        return () => {
            // Late responses and queued work must not overwrite another range.
            active = false;
            reloadRef.current = null;
            window.clearTimeout(timer);
            socket?.off('connect', reload);
            socket?.off('disconnect', reload);
            socket?.off('library.changed', changed);
        };
    }, [socket, range]);

    return {...result, loading, error, refresh};
}
