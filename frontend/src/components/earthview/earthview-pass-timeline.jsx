import React, { useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSocket } from '../common/socket.jsx';
import {
    fetchNextPassesForGroup,
    setShowGeostationarySatellites,
} from './earthview-slice.jsx';
import PassTimeline from '../passes/timeline/pass-timeline.jsx';

const EarthViewPassTimeline = () => {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const passes = useSelector((state) => state.earthViewTrack.passes);
    const gridEditable = useSelector((state) => state.earthViewTrack.gridEditable);
    const nextPassesHours = useSelector((state) => state.earthViewTrack.nextPassesHours);
    const passesAreCached = useSelector((state) => state.earthViewTrack.passesAreCached);
    const passesLoading = useSelector((state) => state.earthViewTrack.passesLoading);
    const selectedSatGroupId = useSelector((state) => state.earthViewTrack.selectedSatGroupId);
    const selectedSatelliteId = useSelector((state) => state.earthViewTrack.selectedSatelliteId);
    const showGeostationarySatellites = useSelector((state) => state.earthViewTrack.showGeostationarySatellites);
    const passesRangeStart = useSelector((state) => state.earthViewTrack.passesRangeStart);
    const passesRangeEnd = useSelector((state) => state.earthViewTrack.passesRangeEnd);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const groundStationLocation = useSelector((state) => state.location.location);
    const timezone = useSelector(
        (state) => {
            const timezonePref = state.preferences.preferences.find((pref) => pref.name === 'timezone');
            return timezonePref ? timezonePref.value : 'UTC';
        },
        (prev, next) => prev === next,
    );
    const targetNumberByNorad = useMemo(() => {
        const mapping = {};

        // Keep slot assignment deterministic if multiple trackers temporarily point to the same satellite.
        trackerInstances.forEach((instance, index) => {
            const groupId = instance?.tracking_state?.group_id;
            if (selectedSatGroupId && groupId && String(groupId) !== String(selectedSatGroupId)) return;

            const noradId = instance?.tracking_state?.norad_id;
            if (noradId == null) return;

            const key = String(noradId);
            const targetNumber = Number(instance?.target_number || (index + 1));
            if (!Number.isFinite(targetNumber) || targetNumber <= 0) return;

            if (mapping[key] == null || targetNumber < mapping[key]) {
                mapping[key] = targetNumber;
            }
        });

        return mapping;
    }, [trackerInstances, selectedSatGroupId]);
    const passesWithTargetNumber = useMemo(() => {
        const sourcePasses = Array.isArray(passes) ? passes : [];
        return sourcePasses.map((pass) => {
            const existingTargetNumber = Number(pass?.targetNumber);
            if (Number.isFinite(existingTargetNumber) && existingTargetNumber > 0) {
                return pass;
            }

            const noradKey = String(pass?.norad_id ?? '').trim();
            const mappedTargetNumber = Number(targetNumberByNorad?.[noradKey]);
            if (!Number.isFinite(mappedTargetNumber) || mappedTargetNumber <= 0) {
                return pass;
            }

            return {
                ...pass,
                targetNumber: mappedTargetNumber,
            };
        });
    }, [passes, targetNumberByNorad]);

    const handleRefreshPasses = () => {
        if (selectedSatGroupId) {
            dispatch(fetchNextPassesForGroup({
                socket,
                selectedSatGroupId,
                hours: nextPassesHours,
                forceRecalculate: true,
            }));
        }
    };

    const handleToggleGeostationary = () => {
        dispatch(setShowGeostationarySatellites(!showGeostationarySatellites));
    };

    return (
        <PassTimeline
            timeWindowHours={nextPassesHours}
            satelliteName={null}
            passes={passesWithTargetNumber}
            activePass={null}
            gridEditable={gridEditable}
            cachedOverride={passesAreCached}
            labelType="name"
            labelVerticalOffset={110}
            loading={passesLoading}
            nextPassesHours={nextPassesHours}
            onRefresh={handleRefreshPasses}
            showHoverElevation={false}
            showGeoToggle={true}
            showGeostationarySatellites={showGeostationarySatellites}
            onToggleGeostationary={handleToggleGeostationary}
            highlightActivePasses={true}
            highlightSatelliteId={selectedSatelliteId}
            forceTimeWindowStart={passesRangeStart}
            forceTimeWindowEnd={passesRangeEnd}
            groundStationLocation={groundStationLocation}
            timezone={timezone}
        />
    );
};

export default React.memo(EarthViewPassTimeline);
