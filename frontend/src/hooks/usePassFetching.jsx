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

import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from '../utils/toast-with-timestamp.jsx';
import { fetchNextPasses } from '../components/target/target-slice.jsx';

/**
 * Custom hook to manage satellite pass fetching
 * Fetches satellite passes every hour for the selected satellite
 * @param {Object} socket - Socket.IO connection instance
 * @param {boolean} enabled - whether periodic pass fetching is active
 */
export const usePassFetching = (socket, enabled = true) => {
    const dispatch = useDispatch();
    const { satelliteId, nextPassesHours } = useSelector((state) => state.targetSatTrack);

    useEffect(() => {
        if (!enabled || !socket) {
            return undefined;
        }

        const fetchPasses = () => {
            if (satelliteId) {
                dispatch(fetchNextPasses({socket, noradId: satelliteId, hours: nextPassesHours}))
                    .unwrap()
                    .then(data => {
                        // Handle success if needed
                    })
                    .catch(error => {
                        toast.error(`Failed fetching next passes for satellite ${satelliteId}: ${error.message}`, {
                            autoClose: 5000,
                        });
                    });
            }
        };

        fetchPasses();

        const interval = setInterval(fetchPasses, 60 * 60 * 1000); // Every hour

        return () => {
            clearInterval(interval);
        };
    }, [satelliteId, socket, enabled, dispatch, nextPassesHours]);
};
