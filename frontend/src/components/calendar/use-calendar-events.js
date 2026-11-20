import {useCallback, useEffect, useRef, useState} from 'react';
import {useSocket} from '../common/socket.jsx';

export default function useCalendarEvents({start, end, timezone}) {
    const {socket} = useSocket();
    const [revision, setRevision] = useState(0);
    const loadRef = useRef(null);
    const [result, setResult] = useState({key: null, events: [], external: null, loading: true, error: false});
    const key = `${start}/${end}/${timezone}`;

    useEffect(() => {
        let disposed = false;
        let requestId = 0;
        let refreshTimer;
        let refreshingExternal = false;
        const load = async (refreshExternal = false) => {
            // Socket notifications can arrive during a remote refresh. Its
            // response already includes the latest observations and cache.
            if (refreshingExternal) return;
            refreshingExternal = refreshExternal;
            const currentRequest = ++requestId;
            setResult(previous => ({key, events: previous.key === key ? previous.events : [], external: previous.external, loading: true, error: false}));
            try {
                if (!socket) throw new Error('Socket unavailable');
                const reply = await socket.timeout(refreshExternal ? 60000 : 15000).emitWithAck('api.call', {
                    cmd: refreshExternal ? 'refresh-calendar-events' : 'get-calendar-events', data: {start, end, timezone},
                });
                if (!reply?.success || !Array.isArray(reply.data?.events)) throw new Error('Calendar unavailable');
                // A slower previous request must not overwrite a newer period,
                // status update, reconnect, or a component that has unmounted.
                if (!disposed && currentRequest === requestId) {
                    setResult({key, events: reply.data.events,
                        external: reply.data.sources?.find(source => source.id === 'gscontrol') || null,
                        loading: false, error: false});
                }
            } catch {
                if (!disposed && currentRequest === requestId) {
                    setResult(previous => ({key, events: [], external: previous.external, loading: false, error: true}));
                }
            } finally {
                if (currentRequest === requestId) refreshingExternal = false;
            }
        };
        const refresh = () => {
            // Generation can emit several changes together. Request one fresh
            // snapshot, including status/timing changes and deleted records.
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(load, 150);
        };
        loadRef.current = load;
        load();
        socket?.on('scheduled-observations-changed', refresh);
        socket?.on('observation-status-update', refresh);
        socket?.on('external-events-changed', refresh);
        socket?.on('connect', refresh);
        return () => {
            disposed = true;
            loadRef.current = null;
            clearTimeout(refreshTimer);
            socket?.off('scheduled-observations-changed', refresh);
            socket?.off('observation-status-update', refresh);
            socket?.off('external-events-changed', refresh);
            socket?.off('connect', refresh);
        };
    }, [socket, key, start, end, timezone, revision]);

    const refresh = useCallback(() => {loadRef.current?.(true);}, []);
    const updateExternal = useCallback(external => {
        // A successful global opt-out removes announcements immediately while
        // the next SQL snapshot catches up, including any open details dialog.
        setResult(previous => ({...previous, external,
            events: previous.events.filter(event => {
                const feed = event.source === 'observations' ? 'observations' : event.feed_id || 'announcements';
                return (external.feeds?.find(item => item.id === feed)?.enabled ?? (feed === 'observations' || external.enabled))
                    && (feed === 'observations' || external.consented !== false);
            })}));
        setRevision(value => value + 1);
    }, []);
    // Hide the previous range immediately, before the next effect starts.
    return result.key === key ? {...result, refresh, updateExternal}
        : {events: [], external: result.external, loading: true, error: false, refresh, updateExternal};
}
