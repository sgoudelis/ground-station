/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {useCallback, useEffect, useState} from 'react';

export function callLibrary(socket, cmd, data) {
    return new Promise((resolve, reject) => {
        if (!socket?.connected) {
            reject(new Error('Not connected to server'));
            return;
        }
        socket.timeout(30000).emit('api.call', {cmd, data}, (error, reply) => {
            if (error) reject(new Error('The library request timed out'));
            else if (!reply?.success) reject(new Error(reply?.error || 'Unable to load packet positions'));
            else resolve(reply.data);
        });
    });
}

export default function usePacketPositions(socket, range) {
    const [result, setResult] = useState({positions: [], available_range: null});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);
    const refresh = useCallback(() => setRevision((value) => value + 1), []);

    useEffect(() => {
        if (!socket) return;
        socket.on('connect', refresh);
        socket.on('disconnect', refresh);
        // Limit refreshes during save bursts without postponing them forever
        // when a decoder continuously produces packets.
        let timer;
        const changed = () => {
            if (timer !== undefined) return;
            timer = window.setTimeout(() => {
                timer = undefined;
                refresh();
            }, 750);
        };
        socket.on('library.changed', changed);
        return () => {
            window.clearTimeout(timer);
            socket.off('connect', refresh);
            socket.off('disconnect', refresh);
            socket.off('library.changed', changed);
        };
    }, [socket, refresh]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');
        // Clear the old interval while loading so it cannot be mistaken for
        // the requested dates. Late replies from previous ranges are ignored.
        setResult((previous) => ({...previous, positions: [], transmitters: undefined}));
        callLibrary(socket, 'filebrowser.positions', range)
            .then((data) => { if (active) setResult(data); })
            .catch((failure) => { if (active) setError(failure.message); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [socket, range, revision]);

    return {...result, loading, error, refresh};
}
