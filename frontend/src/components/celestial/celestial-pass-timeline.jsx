import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import PassTimeline from '../passes/timeline/pass-timeline.jsx';
import {
    buildTargetKeyFromCelestialRow,
    buildTargetSlotNumberByTargetKey,
} from '../target/celestial-target-utils.js';

const CelestialPassTimeline = ({
    passes = [],
    loading = false,
    gridEditable = false,
    projectionFutureHours = 24,
    selectedTargetKey = '',
    onRefresh = null,
}) => {
    const { t } = useTranslation('celestial');
    const groundStationLocation = useSelector((state) => state.location.location);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const timezone = useSelector(
        (state) => {
            const timezonePref = state.preferences.preferences.find((pref) => pref.name === 'timezone');
            return timezonePref ? timezonePref.value : 'UTC';
        },
        (prev, next) => prev === next,
    );
    const targetNumberByTargetKey = useMemo(
        () => buildTargetSlotNumberByTargetKey(trackerInstances),
        [trackerInstances],
    );

    const normalizedPasses = useMemo(() => {
        const sourcePasses = Array.isArray(passes) ? passes : [];
        return sourcePasses
            .map((pass, index) => {
                const eventStart = String(pass?.event_start || '').trim();
                const eventEnd = String(pass?.event_end || '').trim();
                const startMs = new Date(eventStart).getTime();
                const endMs = new Date(eventEnd).getTime();
                if (!eventStart || !eventEnd || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
                    return null;
                }

                const peakElevation = Number(pass?.peak_elevation_deg);
                const peakAltitude = Number.isFinite(peakElevation) ? Math.max(0, peakElevation) : 0;
                // Backend rows can miss `target_key` for some sources; derive the canonical key locally.
                const targetKey = buildTargetKeyFromCelestialRow(pass);
                const mappedTargetNumber = Number(targetNumberByTargetKey?.[targetKey]);
                const defaultId = `${targetKey || 'celestial-target'}_${eventStart}_${index}`;

                return {
                    ...pass,
                    id: String(pass?.id || defaultId),
                    name: String(pass?.name || targetKey || t('passes.timeline_default_target_name')),
                    target_key: targetKey,
                    event_start: eventStart,
                    event_end: eventEnd,
                    peak_altitude: peakAltitude,
                    targetNumber: Number.isFinite(mappedTargetNumber) && mappedTargetNumber > 0
                        ? mappedTargetNumber
                        : null,
                    distance_at_peak: Number.isFinite(Number(pass?.distance_at_peak)) ? Number(pass.distance_at_peak) : 0,
                    elevation_curve: Array.isArray(pass?.elevation_curve) ? pass.elevation_curve : [],
                };
            })
            .filter(Boolean)
            .sort((left, right) => new Date(left.event_start).getTime() - new Date(right.event_start).getTime());
    }, [passes, targetNumberByTargetKey, t]);
    const normalizedSelectedTargetKey = useMemo(
        () => String(selectedTargetKey || '').trim(),
        [selectedTargetKey],
    );

    return (
        <PassTimeline
            timeWindowHours={projectionFutureHours}
            satelliteName={null}
            passes={normalizedPasses}
            activePass={null}
            gridEditable={gridEditable}
            labelType={false}
            loading={loading}
            nextPassesHours={projectionFutureHours}
            onRefresh={onRefresh}
            showHoverElevation={false}
            highlightActivePasses={true}
            highlightTargetKey={normalizedSelectedTargetKey}
            usePassAssignedColor={true}
            groundStationLocation={groundStationLocation}
            timezone={timezone}
        />
    );
};

export default React.memo(CelestialPassTimeline);
