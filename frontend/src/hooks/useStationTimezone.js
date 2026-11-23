import { useEffect, useState } from 'react';

export const useStationTimezone = ({ socket, latitude, longitude, enabled = true }) => {
    const [selection, setSelection] = useState(null);
    const [lookup, setLookup] = useState(null);
    const hasCoordinates = latitude != null && longitude != null;
    const lookupKey = hasCoordinates ? `${latitude}:${longitude}` : null;

    useEffect(() => {
        if (!enabled || !socket || !hasCoordinates) return undefined;
        let cancelled = false;

        const resolveTimezone = async () => {
            try {
                const reply = await socket.timeout(10000).emitWithAck('api.call', {
                    cmd: 'get-location-timezone',
                    data: { lat: latitude, lon: longitude },
                });
                if (!reply?.success || !reply.data?.timezone) {
                    throw new Error('Could not detect timezone.');
                }
                if (!cancelled) {
                    setLookup({ key: lookupKey, timezone: reply.data.timezone, error: false });
                }
            } catch {
                if (!cancelled) {
                    setLookup({ key: lookupKey, timezone: null, error: true });
                }
            }
        };

        // Debounce map clicks and ignore replies for coordinates that were replaced.
        const timeout = setTimeout(resolveTimezone, 200);
        return () => {
            cancelled = true;
            clearTimeout(timeout);
        };
    }, [enabled, socket, socket?.connected, hasCoordinates, latitude, longitude, lookupKey]);

    // A new coordinate pair must not briefly submit the previous location's zone.
    const currentLookup = lookup?.key === lookupKey ? lookup : null;
    const detectedTimezone = currentLookup?.timezone || null;
    return {
        timezone: selection || detectedTimezone,
        automatic: !selection,
        detectedTimezone,
        loading: enabled && hasCoordinates && !currentLookup,
        error: Boolean(currentLookup?.error),
        // Keep an explicit choice when coordinates change; clearing resumes detection.
        setTimezone: setSelection,
    };
};
