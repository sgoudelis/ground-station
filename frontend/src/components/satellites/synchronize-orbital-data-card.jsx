import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Paper } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useSocket } from '../common/socket.jsx';
import {
    startSatelliteSync,
    fetchSyncState,
} from './synchronize-slice.jsx';
import SyncCardHeader from './synchronize-header.jsx';
import SyncProgressBar from './synchronize-progress.jsx';
import SyncTerminal from './synchronize-terminal.jsx';
import ErrorSection from './synchronize-error.jsx';
import SyncResultsTable from './synchronize-results.jsx';

const SynchronizeOrbitalDataCard = function () {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { syncState } = useSelector((state) => state.syncSatellite);
    const [showErrors, setShowErrors] = useState(false);

    const handleSynchronizeSatellites = async () => {
        dispatch(startSatelliteSync({ socket }));
    };

    useEffect(() => {
        dispatch(fetchSyncState({ socket }));
    }, []);

    const hasNewItems = syncState?.newly_added &&
        (syncState.newly_added.satellites?.length > 0 || syncState.newly_added.transmitters?.length > 0);

    const newSatellitesCount = syncState?.newly_added?.satellites?.length || 0;
    const newTransmittersCount = syncState?.newly_added?.transmitters?.length || 0;

    const hasRemovedItems = syncState?.removed &&
        (syncState.removed.satellites?.length > 0 || syncState.removed.transmitters?.length > 0);

    const removedSatellitesCount = syncState?.removed?.satellites?.length || 0;
    const removedTransmittersCount = syncState?.removed?.transmitters?.length || 0;

    const hasModifiedItems = syncState?.modified &&
        (syncState.modified.satellites?.length > 0 || syncState.modified.transmitters?.length > 0);

    const modifiedSatellitesCount = syncState?.modified?.satellites?.length || 0;
    const modifiedTransmittersCount = syncState?.modified?.transmitters?.length || 0;

    const hasErrors = syncState?.errors && syncState.errors.length > 0;
    const errorsCount = syncState?.errors?.length || 0;

    return (
        <Paper
            variant="outlined"
            sx={{
                mt: 0,
                borderRadius: 2,
                borderColor: 'divider',
                overflow: 'hidden',
            }}
        >
            <Box
                sx={{
                    px: { xs: 2, md: 2.5 },
                    py: 1.75,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    backgroundColor: (theme) =>
                        theme.palette.mode === 'dark'
                            ? alpha(theme.palette.primary.main, 0.07)
                            : alpha(theme.palette.primary.main, 0.04),
                }}
            >
                <SyncCardHeader
                    syncState={syncState}
                    onSynchronize={handleSynchronizeSatellites}
                />
            </Box>

            <Box sx={{ px: { xs: 2, md: 2.5 }, pt: 1.75, pb: 2 }}>
                <SyncProgressBar syncState={syncState} />

                <SyncTerminal syncState={syncState} />

                <ErrorSection
                    hasErrors={hasErrors}
                    errorsCount={errorsCount}
                    showErrors={showErrors}
                    setShowErrors={setShowErrors}
                    syncState={syncState}
                />

                <SyncResultsTable
                    hasNewItems={hasNewItems}
                    hasModifiedItems={hasModifiedItems}
                    hasRemovedItems={hasRemovedItems}
                    newSatellitesCount={newSatellitesCount}
                    newTransmittersCount={newTransmittersCount}
                    modifiedSatellitesCount={modifiedSatellitesCount}
                    modifiedTransmittersCount={modifiedTransmittersCount}
                    removedSatellitesCount={removedSatellitesCount}
                    removedTransmittersCount={removedTransmittersCount}
                    syncState={syncState}
                />
            </Box>
        </Paper>
    );
};

export default SynchronizeOrbitalDataCard;
