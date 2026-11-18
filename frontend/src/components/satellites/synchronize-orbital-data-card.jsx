import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {Box,Dialog,DialogActions,DialogContent,DialogTitle,Paper,Typography} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useSocket } from '../common/socket.jsx';
import {
    startSatelliteSync,
    fetchSyncState,
} from './synchronize-slice.jsx';
import { stopBackgroundTask } from '../tasks/tasks-slice.jsx';
import SyncCardHeader from './synchronize-header.jsx';
import SyncProgressBar from './synchronize-progress.jsx';
import SyncTerminal from './synchronize-terminal.jsx';
import ErrorSection from './synchronize-error.jsx';
import SyncResultsTable from './synchronize-results.jsx';
import { useTranslation } from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';

const SynchronizeOrbitalDataCard = function () {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { t } = useTranslation('satellites');
    const { syncState, syncTaskId } = useSelector((state) => state.syncSatellite);
    const { tasks, runningTaskIds } = useSelector((state) => state.backgroundTasks);
    const [showErrors, setShowErrors] = useState(false);
    const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
    const [cancelling, setCancelling] = useState(false);

    // The task event can arrive before the start-command acknowledgement. This fallback also
    // lets the card stop an in-progress orbital sync after the page is reopened.
    const runningOrbitalSyncTaskId = runningTaskIds.find((taskId) => {
        const task = tasks[taskId];
        const taskLabel = `${task?.name || ''} ${task?.command || ''}`.toLowerCase();
        return taskLabel.includes('orbital') && taskLabel.includes('sync');
    });
    const cancellableTaskId = syncTaskId || runningOrbitalSyncTaskId;

    const handleSynchronizeSatellites = async () => {
        dispatch(startSatelliteSync({ socket }));
    };

    const handleConfirmCancel = async () => {
        if (!cancellableTaskId || cancelling) return;

        setCancelling(true);
        try {
            await dispatch(stopBackgroundTask({ socket, task_id: cancellableTaskId })).unwrap();
            setCancelDialogOpen(false);
        } finally {
            setCancelling(false);
        }
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
                    onCancel={() => setCancelDialogOpen(true)}
                    canCancel={Boolean(cancellableTaskId) && !cancelling}
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

            <Dialog
                open={cancelDialogOpen}
                onClose={() => !cancelling && setCancelDialogOpen(false)}
                fullWidth
                maxWidth="xs"
            >
                <DialogTitle>{t('synchronize.cancel_dialog.title')}</DialogTitle>
                <DialogContent>
                    <Typography>{t('synchronize.cancel_dialog.message')}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                        {t('synchronize.cancel_dialog.impact')}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <CapsButton disabled={cancelling} onClick={() => setCancelDialogOpen(false)}>
                        {t('synchronize.cancel_dialog.keep_syncing')}
                    </CapsButton>
                    <CapsButton
                        color="error"
                        variant="contained"
                        disabled={cancelling || !cancellableTaskId}
                        onClick={handleConfirmCancel}
                    >
                        {t('synchronize.cancel_dialog.confirm')}
                    </CapsButton>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};

export default SynchronizeOrbitalDataCard;
