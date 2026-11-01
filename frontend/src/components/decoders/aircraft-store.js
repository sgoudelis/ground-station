/** ADS-B views share one subscription and publish at most once per second. */
const EMPTY = {aircraft: [], positions: [], error: ''};

export function createAircraftStore(socket) {
    let snapshot = EMPTY;
    let changed = false;
    let error = '';
    let generation = 0;
    let timer;
    const aircraft = new Map();
    const tracks = new Map();
    const listeners = new Set();
    const receive = (data) => {
        for (const record of data?.aircraft || []) {
            if (!/^[0-9a-f]{6}$/.test(record.icao) || !Number.isFinite(record.timestamp)) continue;
            if ((aircraft.get(record.icao)?.timestamp ?? -Infinity) > record.timestamp) continue;
            aircraft.set(record.icao, record);
            const points = tracks.get(record.icao) || [];
            const stamp = record.position_timestamp;
            if (Number.isFinite(stamp) && Number.isFinite(record.latitude) && Number.isFinite(record.longitude)
                && (!points.length || stamp > points.at(-1).position_timestamp + .15)) {
                points.push(record);
                tracks.set(record.icao, points.slice(-120));
            }
            changed = true;
        }
    };
    const flush = () => {
        const cutoff = Date.now() / 1000 - 60;
        for (const [address, record] of aircraft) {
            if (record.timestamp < cutoff) {
                aircraft.delete(address);
                tracks.delete(address);
                changed = true;
            }
        }
        if (aircraft.size > 1000) {
            const oldest = [...aircraft.values()].sort((a, b) => a.timestamp - b.timestamp);
            for (const record of oldest.slice(0, aircraft.size - 1000)) {
                aircraft.delete(record.icao);
                tracks.delete(record.icao);
            }
            changed = true;
        }
        if (!changed) return;
        snapshot = {aircraft: [...aircraft.values()], positions: [...tracks.values()].flat(), error};
        changed = false;
        listeners.forEach((listener) => listener());
    };
    const connect = () => {
        const requestGeneration = ++generation;
        socket.emit('api.call', {cmd: 'adsb.subscribe', data: {enabled: true}}, (reply) => {
            if (!listeners.size || requestGeneration !== generation) return;
            if (reply?.success) {
                error = '';
                receive(reply.data);
            } else error = reply?.error || 'Unable to load live aircraft';
            changed = true;
        });
    };
    const disconnect = () => {
        generation += 1;
        aircraft.clear();
        tracks.clear();
        error = 'Disconnected';
        changed = true;
        flush();
    };
    return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1 && socket) {
                socket.on('adsb.aircraft', receive);
                socket.on('connect', connect);
                socket.on('disconnect', disconnect);
                timer = setInterval(flush, 1000);
                if (socket.connected) connect();
            }
            return () => {
                listeners.delete(listener);
                if (listeners.size || !socket) return;
                generation += 1;
                clearInterval(timer);
                socket.off('adsb.aircraft', receive);
                socket.off('connect', connect);
                socket.off('disconnect', disconnect);
                if (socket.connected) socket.emit('api.call', {cmd: 'adsb.subscribe', data: {enabled: false}});
                aircraft.clear();
                tracks.clear();
                snapshot = EMPTY;
                changed = false;
            };
        },
    };
}
