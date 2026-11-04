/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {useCallback, useEffect, useRef, useState} from 'react';
import {callLibrary} from '../packetmap/use-packet-positions.js';

export default function useFlightPaths(socket, id, run) {
    const scope = JSON.stringify([id, run]);
    const [state, setState] = useState({scope, data: null, loading: true, error: ''});
    const reload = useRef(null);
    const refresh = useCallback(() => {void reload.current?.();}, []);

    useEffect(() => {
        let active = true;
        let inFlight = false;
        let pending = false;
        let timer;
        const load = async () => {
            if (!active) return;
            if (inFlight) {pending = true; return;}
            inFlight = true;
            setState(previous => ({scope, data: previous.scope === scope ? previous.data : null, loading: true, error: ''}));
            try {
                const data = await callLibrary(socket, 'filebrowser.flightpaths', {id, ...(run && {run})});
                if (active) setState({scope, data, loading: false, error: ''});
            } catch (failure) {
                if (active) setState(previous => ({...previous, loading: false, error: failure.message}));
            } finally {
                inFlight = false;
                // Queue one refresh when storage changes during a slow request.
                if (active && pending) {pending = false; void load();}
            }
        };
        const changed = event => {
            if (!event?.changes?.some(change => change.id === id || change.id === '*') || timer !== undefined) return;
            timer = window.setTimeout(() => {timer = undefined; void load();}, 750);
        };
        const reconnect = () => {void load();};
        reload.current = load;
        socket?.on('library.changed', changed);
        socket?.on('connect', reconnect);
        socket?.on('disconnect', reconnect);
        void load();
        return () => {
            // A late response must never repaint another selected flight.
            active = false;
            reload.current = null;
            window.clearTimeout(timer);
            socket?.off('library.changed', changed);
            socket?.off('connect', reconnect);
            socket?.off('disconnect', reconnect);
        };
    }, [socket, id, run, scope]);

    return {...(state.scope === scope ? state : {data: null, loading: true, error: ''}), refresh};
}
