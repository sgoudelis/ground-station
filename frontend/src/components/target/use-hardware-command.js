import {useEffect, useMemo, useState} from 'react';
import {isCommandActionPending, isCommandOutstanding, selectTrackerCommand} from './tracker-command-state.js';

export function isHardwareReady(view, connected, now = Date.now()) {
    return connected && Boolean(view?.hardwareObservedAt) && now - view.hardwareReceivedAt < 15000;
}

export function useHardwareCommand({socket, view, commands, trackerId, scope, deviceId}) {
    const [connected, setConnected] = useState(Boolean(socket?.connected));
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        setConnected(Boolean(socket?.connected));
        if (!socket) return;
        const update = () => setConnected(Boolean(socket.connected));
        socket.on('connect', update);
        socket.on('disconnect', update);
        return () => {
            socket.off('connect', update);
            socket.off('disconnect', update);
        };
    }, [socket]);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    // Clock ticks expire recent command feedback as well as hardware freshness.
    const command = useMemo(() => selectTrackerCommand(commands, trackerId, scope, deviceId, now),
        [commands, trackerId, scope, deviceId, now]);
    return {
        command,
        busy: isCommandOutstanding(command),
        isPending: state => isCommandActionPending(command, scope, state),
        connected,
        now,
        ready: isHardwareReady(view, connected, now),
        lastUpdateAge: Math.max(0, Math.floor((now - (view?.hardwareReceivedAt || now)) / 1000)),
    };
}
