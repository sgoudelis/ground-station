/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import { store } from '../components/common/store.jsx';
import { fetchVersionInfo } from "../components/dashboard/version-slice.jsx";
import { fetchPreferences, fetchSystemPreferences } from '../components/settings/preferences-slice.jsx';
import { fetchLocationForUserId } from '../components/settings/location-slice.jsx';
import { fetchRigs } from '../components/hardware/rig-slice.jsx';
import { fetchRotators } from '../components/hardware/rotator-slice.jsx';
import { fetchSDRs } from '../components/hardware/sdr-slice.jsx';
import { fetchOrbitalSources } from '../components/satellites/sources-slice.jsx';
import { fetchSatelliteGroups } from '../components/satellites/groups-slice.jsx';
import { getTrackingStateFromBackend, getTargetMapSettings } from '../components/target/target-slice.jsx';
import { fetchTrackerInstances } from '../components/target/tracker-instances-slice.jsx';
import { getEarthViewMapSettings } from '../components/earthview/earthview-slice.jsx';
import { fetchScheduledObservations, fetchMonitoredSatellites } from '../components/scheduler/scheduler-slice.jsx';
import {
    setInitialDataLoading,
    setInitialDataProgress,
    setShowLocationSetupDialog,
} from '../components/dashboard/dashboard-slice.jsx';

/**
 * Initialize all application data from backend when connection is established
 * @param {Object} socket - Socket.IO connection instance
 */
export async function initializeAppData(socket) {
    const tasks = [
        {
            name: 'preferences',
            run: () => store.dispatch(fetchPreferences({ socket })),
        },
        {
            name: 'system_preferences',
            run: () => store.dispatch(fetchSystemPreferences({ socket })),
        },
        {
            name: 'version',
            run: () => store.dispatch(fetchVersionInfo()),
        },
        {
            name: 'location',
            run: async () => {
                try {
                    const location = await store.dispatch(fetchLocationForUserId({ socket })).unwrap();
                    console.log('Location fetched from backend:', location);
                    if (!location) {
                        console.log('Location is not set - showing dialog');
                        store.dispatch(setShowLocationSetupDialog(true));
                    } else {
                        console.log('Location is set:', location);
                    }
                } catch (error) {
                    console.error('Failed to fetch location:', error);
                }
            },
        },
        { name: 'rigs', run: () => store.dispatch(fetchRigs({ socket })) },
        { name: 'rotators', run: () => store.dispatch(fetchRotators({ socket })) },
        { name: 'sdrs', run: () => store.dispatch(fetchSDRs({ socket })) },
        { name: 'orbital_sources', run: () => store.dispatch(fetchOrbitalSources({ socket })) },
        { name: 'satellite_groups', run: () => store.dispatch(fetchSatelliteGroups({ socket })) },
        {
            name: 'tracker_instances',
            run: async () => {
                const payload = await store.dispatch(fetchTrackerInstances({ socket })).unwrap();
                const instances = Array.isArray(payload?.instances) ? payload.instances : [];
                const trackerIds = instances
                    .map((instance) => instance?.tracker_id)
                    .filter((trackerId) => typeof trackerId === 'string' && trackerId.trim().length > 0);

                await Promise.allSettled(
                    trackerIds.map((trackerId) =>
                        store.dispatch(getTrackingStateFromBackend({ socket, trackerId }))
                    )
                );
            },
        },
        { name: 'earth_view_map', run: () => store.dispatch(getEarthViewMapSettings({ socket })) },
        { name: 'target_map', run: () => store.dispatch(getTargetMapSettings({ socket })) },
        { name: 'scheduled_observations', run: () => store.dispatch(fetchScheduledObservations({ socket })) },
        { name: 'monitored_satellites', run: () => store.dispatch(fetchMonitoredSatellites({ socket })) },
    ];

    let completed = 0;
    const total = tasks.length;
    store.dispatch(setInitialDataLoading(true));
    store.dispatch(setInitialDataProgress({ completed, total }));

    const incrementProgress = () => {
        completed += 1;
        store.dispatch(setInitialDataProgress({ completed, total }));
    };

    const runTask = async (task) => {
        try {
            await task.run();
        } catch (error) {
            console.error(`Failed to fetch initial app data: ${task.name}`, error);
        } finally {
            incrementProgress();
        }
    };

    // Load preferences first so UI/notifications are aligned before other requests.
    const [preferencesTask, ...remainingTasks] = tasks;
    await runTask(preferencesTask);

    await Promise.allSettled(remainingTasks.map((task) => runTask(task)));

    store.dispatch(setInitialDataLoading(false));
}
