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

import React from 'react';
import {
    Alert,
    Backdrop,
    Box,
    Button,
    Checkbox,
    CircularProgress,
    FormControlLabel,
    Stack,
    Step,
    StepLabel,
    Stepper,
    TextField,
    Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import Grid from '@mui/material/Grid';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';

import { toast } from '../../utils/toast-with-timestamp.jsx';
import { loginUser } from '../auth/auth-slice.jsx';
import { useSocket } from '../common/socket.jsx';
import { SettingsActionFooter, SettingsSection } from '../settings/shared/index.js';

const WIZARD_STEP_RESTORE = 0;
const WIZARD_STEP_IDENTITY = 1;
const WIZARD_STEP_COORDINATES = 2;
const WIZARD_STEP_REVIEW = 3;
const WIZARD_STEP_ADMIN = 4;
const WIZARD_STEP_FINALIZE = 5;

const CALL_STATUS_IDLE = 'idle';
const CALL_STATUS_PENDING = 'pending';
const CALL_STATUS_SUCCESS = 'success';
const CALL_STATUS_ERROR = 'error';

const createInitialCallChecklist = () => ({
    location: { status: CALL_STATUS_IDLE, detail: '' },
    soapy: { status: CALL_STATUS_IDLE, detail: '' },
    orbital: { status: CALL_STATUS_IDLE, detail: '' },
    admin: { status: CALL_STATUS_IDLE, detail: '' },
});

const createInitialSoapyRuntimeState = () => ({
    status: 'idle',
    detail: '',
    serverCount: null,
    sdrCount: null,
    lastUpdate: null,
});

const isSoapyTask = (task) => {
    const taskName = String(task?.name || '').toLowerCase();
    const taskCommand = String(task?.command || '').toLowerCase();
    return taskName.includes('soapysdr') || taskCommand.includes('soapysdr');
};

const normalizeChecklistStep = (stepValue) => {
    const status = String(stepValue?.status || CALL_STATUS_IDLE).toLowerCase();
    const normalizedStatus = [CALL_STATUS_IDLE, CALL_STATUS_PENDING, CALL_STATUS_SUCCESS, CALL_STATUS_ERROR]
        .includes(status)
        ? status
        : CALL_STATUS_IDLE;
    return {
        status: normalizedStatus,
        detail: String(stepValue?.detail || ''),
    };
};

const FULL_RESTORE_MAX_FILE_SIZE_BYTES = 300 * 1024 * 1024;
const FULL_RESTORE_MAX_FILE_SIZE_MB = FULL_RESTORE_MAX_FILE_SIZE_BYTES / (1024 * 1024);

const SetupWizard = ({
    wizardBackendReady = true,
    wizardRequireAdminSetup = false,
    hasLocation = false,
    hasPersistedLocation = false,
    canSave = false,
    isDifferentFromSaved = false,
    locationSaving = false,
    setupLocationPayload = null,
    onPersistLocation = null,
    onWizardCompleted = null,
    stationIdentitySection = null,
    stationCoordinatesSection = null,
    wizardMapSection = null,
    reviewData = {},
    sectionSx = {},
}) => {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('settings');
    const { syncState, synchronizing, error: syncError } = useSelector(
        (state) => state.syncSatellite
    );
    const { loadingAction: authLoadingAction, error: authError } = useSelector((state) => state.auth);

    const [wizardStep, setWizardStep] = React.useState(WIZARD_STEP_RESTORE);
    const [wizardRestoreFile, setWizardRestoreFile] = React.useState(null);
    const [wizardRestoreDropTables, setWizardRestoreDropTables] = React.useState(true);
    const [wizardRestoreLoading, setWizardRestoreLoading] = React.useState(false);
    const [wizardRestoreFileInputKey, setWizardRestoreFileInputKey] = React.useState(0);
    const [showRestoreReloadBackdrop, setShowRestoreReloadBackdrop] = React.useState(false);
    const [adminUsername, setAdminUsername] = React.useState('');
    const [adminPassword, setAdminPassword] = React.useState('');
    const [adminConfirmPassword, setAdminConfirmPassword] = React.useState('');
    const [adminLocalError, setAdminLocalError] = React.useState('');
    const [wizardSyncState, setWizardSyncState] = React.useState(syncState || null);
    const [wizardFinalizing, setWizardFinalizing] = React.useState(false);
    const [callChecklist, setCallChecklist] = React.useState(createInitialCallChecklist);
    const [soapyRuntimeState, setSoapyRuntimeState] = React.useState(createInitialSoapyRuntimeState);

    const showWizardAdminStep = Boolean(wizardRequireAdminSetup);
    const showWizardFinalizeStep = showWizardAdminStep;
    const wizardSaveStep = WIZARD_STEP_REVIEW;
    const stationName = String(reviewData.stationName || '');
    const stationCallsignLabel = String(reviewData.stationCallsignLabel || '');
    const stationType = String(reviewData.stationType || 'stationary');
    const stationHorizonMask = Number(reviewData.stationHorizonMask ?? 0);

    const wizardStepLabels = React.useMemo(
        () => ({
            [WIZARD_STEP_RESTORE]: t('location.wizard_step_restore', {
                defaultValue: 'Restore Backup (Optional)',
            }),
            [WIZARD_STEP_ADMIN]: t('location.wizard_step_admin', { defaultValue: 'Create Admin User' }),
            [WIZARD_STEP_IDENTITY]: t('location.wizard_step_identity', {
                defaultValue: 'Station Identity',
            }),
            [WIZARD_STEP_COORDINATES]: t('location.wizard_step_coordinates', {
                defaultValue: 'Location',
            }),
            [WIZARD_STEP_REVIEW]: t('location.wizard_step_review', { defaultValue: 'Review' }),
            [WIZARD_STEP_FINALIZE]: t('location.wizard_step_finalize', {
                defaultValue: 'Finalize Setup',
            }),
        }),
        [t]
    );
    const wizardStepOrder = React.useMemo(
        () =>
            showWizardAdminStep
                ? [
                      WIZARD_STEP_RESTORE,
                      WIZARD_STEP_ADMIN,
                      WIZARD_STEP_IDENTITY,
                      WIZARD_STEP_COORDINATES,
                      WIZARD_STEP_REVIEW,
                      WIZARD_STEP_FINALIZE,
                  ]
                : [
                      WIZARD_STEP_RESTORE,
                      WIZARD_STEP_IDENTITY,
                      WIZARD_STEP_COORDINATES,
                      WIZARD_STEP_REVIEW,
                  ],
        [showWizardAdminStep]
    );
    const wizardCurrentOrderIndex = Math.max(0, wizardStepOrder.indexOf(wizardStep));
    const isWizardLastStep = wizardCurrentOrderIndex === wizardStepOrder.length - 1;
    const isWizardSaveStep = wizardStep === wizardSaveStep;
    const isWizardFinalizeStep = showWizardFinalizeStep && wizardStep === WIZARD_STEP_FINALIZE;
    const canAdvanceWizard = wizardStep !== WIZARD_STEP_COORDINATES || hasLocation;
    const canSaveInReviewStep = showWizardAdminStep
        ? hasLocation && wizardBackendReady
        : canSave && isDifferentFromSaved && wizardBackendReady;

    const setChecklistStatus = React.useCallback((key, status, detail = '') => {
        setCallChecklist((previous) => ({
            ...previous,
            [key]: {
                status,
                detail,
            },
        }));
    }, []);

    const callApi = React.useCallback(
        async (cmd, data = null) => {
            if (!socket || !socket.connected) {
                return { success: false, error: 'Backend connection is not ready.' };
            }

            try {
                const reply = await socket.emitWithAck('api.call', { cmd, data });
                return reply || { success: false, error: 'No response from backend.' };
            } catch (error) {
                return {
                    success: false,
                    error: error?.message || String(error),
                };
            }
        },
        [socket]
    );

    const didSetupFinishAfterRestoreDisconnect = React.useCallback(async () => {
        try {
            const response = await fetch('/api/auth/status');
            if (!response.ok) return false;
            const payload = await response.json();
            return payload?.setup_required === false;
        } catch {
            return false;
        }
    }, []);

    const applySetupStatus = React.useCallback((statusPayload) => {
        if (!statusPayload || typeof statusPayload !== 'object') return;

        const steps = statusPayload?.steps && typeof statusPayload.steps === 'object'
            ? statusPayload.steps
            : {};
        setCallChecklist((previous) => ({
            ...previous,
            location: steps.location ? normalizeChecklistStep(steps.location) : previous.location,
            soapy: steps.soapy ? normalizeChecklistStep(steps.soapy) : previous.soapy,
            orbital: steps.orbital ? normalizeChecklistStep(steps.orbital) : previous.orbital,
            admin: steps.admin ? normalizeChecklistStep(steps.admin) : previous.admin,
        }));

        if (statusPayload?.sync_state && typeof statusPayload.sync_state === 'object') {
            setWizardSyncState(statusPayload.sync_state);
        }

        const state = String(statusPayload?.state || '').toLowerCase();
        if (state === 'running') {
            setWizardFinalizing(true);
            return;
        }

        if (state === 'completed') {
            setWizardFinalizing(false);
            setAdminLocalError('');
            return;
        }

        if (state === 'failed') {
            setWizardFinalizing(false);
            setAdminLocalError(String(statusPayload?.error || 'Setup finalization failed.'));
        }
    }, []);

    const pollSetupStatus = React.useCallback(async () => {
        const statusReply = await callApi('setup.status');
        if (!statusReply?.success) {
            return null;
        }

        const payload = statusReply?.data;
        if (payload && typeof payload === 'object') {
            applySetupStatus(payload);
            return payload;
        }
        return null;
    }, [applySetupStatus, callApi]);

    const effectiveSyncState = wizardSyncState || syncState;
    const syncLastUpdateText = React.useMemo(() => {
        if (!effectiveSyncState?.last_update) {
            return t('location.state_unavailable', { defaultValue: 'Unavailable' });
        }

        const timestamp = new Date(effectiveSyncState.last_update);
        if (Number.isNaN(timestamp.getTime())) {
            return String(effectiveSyncState.last_update);
        }

        return timestamp.toLocaleString();
    }, [effectiveSyncState?.last_update, t]);
    const orbitalSyncUiState = React.useMemo(() => {
        const rawStatus = String(effectiveSyncState?.status || '').toLowerCase();
        const normalizedStatus =
            rawStatus === 'in_progress' || rawStatus === 'inprogress' || rawStatus === 'started'
                ? 'inprogress'
                : rawStatus;
        const hasErrors =
            Array.isArray(effectiveSyncState?.errors) && effectiveSyncState.errors.length > 0;
        const primaryError = hasErrors ? effectiveSyncState.errors[0] : syncError || null;
        const startRequested = callChecklist.orbital.status === CALL_STATUS_PENDING;

        if (normalizedStatus === 'inprogress' || synchronizing || startRequested) {
            return {
                label: t('location.orbital_sync_in_progress', {
                    defaultValue: 'Synchronization in progress',
                }),
                color: 'info',
                loading: true,
                error: null,
            };
        }

        if (
            (normalizedStatus === 'complete' && effectiveSyncState?.success === false) ||
            hasErrors ||
            primaryError ||
            callChecklist.orbital.status === CALL_STATUS_ERROR
        ) {
            return {
                label: t('location.orbital_sync_failed', { defaultValue: 'Synchronization failed' }),
                color: 'error',
                loading: false,
                error: primaryError || t('location.state_unavailable', { defaultValue: 'Unavailable' }),
            };
        }

        if (normalizedStatus === 'complete' && effectiveSyncState?.success === true) {
            return {
                label: t('location.orbital_sync_ok', { defaultValue: 'Synchronization complete' }),
                color: 'success',
                loading: false,
                error: null,
            };
        }

        return {
            label: t('location.orbital_sync_idle', {
                defaultValue: 'Synchronization status unavailable',
            }),
            color: 'default',
            loading: false,
            error: null,
        };
    }, [
        callChecklist.orbital.status,
        effectiveSyncState?.errors,
        effectiveSyncState?.status,
        effectiveSyncState?.success,
        syncError,
        synchronizing,
        t,
    ]);

    React.useEffect(() => {
        if (
            wizardStep !== WIZARD_STEP_FINALIZE ||
            !showWizardAdminStep ||
            !socket ||
            !socket.connected
        ) {
            return;
        }

        let cancelled = false;
        let pollTimerId = null;

        const pollStatus = async () => {
            const statusPayload = await pollSetupStatus();
            if (cancelled) return;
            if (String(statusPayload?.state || '').toLowerCase() === 'running') {
                pollTimerId = window.setTimeout(() => {
                    void pollStatus();
                }, 1500);
            }
        };

        void pollStatus();

        return () => {
            cancelled = true;
            if (pollTimerId != null) {
                window.clearTimeout(pollTimerId);
            }
        };
    }, [
        pollSetupStatus,
        showWizardAdminStep,
        socket,
        wizardStep,
    ]);

    React.useEffect(() => {
        if (!socket) {
            return;
        }

        // Setup mode does not run the app-wide socket event hook, so listen locally.
        const handleSetupStatus = (data) => {
            applySetupStatus(data);
        };

        const handleSatSyncEvents = (data) => {
            if (data && typeof data === 'object') {
                setWizardSyncState(data);
            }
        };

        const handleSoapyDiscoveryStarted = () => {
            setSoapyRuntimeState((previous) => ({
                ...previous,
                status: 'inprogress',
                detail: 'Discovery running...',
            }));
        };

        const handleSoapyDiscoveryComplete = (data) => {
            setSoapyRuntimeState({
                status: 'complete',
                detail: 'Discovery complete.',
                serverCount: Number.isFinite(Number(data?.server_count))
                    ? Number(data.server_count)
                    : null,
                sdrCount: Number.isFinite(Number(data?.sdr_count))
                    ? Number(data.sdr_count)
                    : Number.isFinite(Number(data?.active_count))
                        ? Number(data.active_count)
                        : null,
                lastUpdate: Date.now(),
            });
        };

        const handleSoapyRefreshComplete = (data) => {
            setSoapyRuntimeState((previous) => ({
                ...previous,
                status: 'complete',
                detail: 'Discovery refresh complete.',
                sdrCount: Number.isFinite(Number(data?.sdr_count))
                    ? Number(data.sdr_count)
                    : Number.isFinite(Number(data?.active_count))
                        ? Number(data.active_count)
                        : previous.sdrCount,
                lastUpdate: Date.now(),
            }));
        };

        const handleSoapyDiscoveryError = (data) => {
            setSoapyRuntimeState((previous) => ({
                ...previous,
                status: 'error',
                detail: String(data?.error || 'Discovery failed.'),
                lastUpdate: Date.now(),
            }));
        };

        const handleBackgroundTaskStarted = (data) => {
            if (!isSoapyTask(data)) return;
            setSoapyRuntimeState((previous) => ({
                ...previous,
                status: 'inprogress',
                detail: 'Discovery task started.',
            }));
        };

        const handleBackgroundTaskCompleted = (data) => {
            if (!isSoapyTask(data)) return;
            if (String(data?.status || '').toLowerCase() === 'failed') {
                setSoapyRuntimeState((previous) => ({
                    ...previous,
                    status: 'error',
                    detail: 'Discovery task failed.',
                    lastUpdate: Date.now(),
                }));
                return;
            }
            setSoapyRuntimeState((previous) => ({
                ...previous,
                status: previous.status === 'complete' ? 'complete' : 'idle',
                lastUpdate: Date.now(),
            }));
        };

        const handleBackgroundTaskError = (data) => {
            if (!isSoapyTask(data)) return;
            setSoapyRuntimeState((previous) => ({
                ...previous,
                status: 'error',
                detail: String(data?.error || 'Discovery task failed.'),
                lastUpdate: Date.now(),
            }));
        };

        socket.on('setup:status', handleSetupStatus);
        socket.on('sat-sync-events', handleSatSyncEvents);
        socket.on('soapysdr:discovery_started', handleSoapyDiscoveryStarted);
        socket.on('soapysdr:discovery_complete', handleSoapyDiscoveryComplete);
        socket.on('soapysdr:refresh_complete', handleSoapyRefreshComplete);
        socket.on('soapysdr:discovery_error', handleSoapyDiscoveryError);
        socket.on('background_task:started', handleBackgroundTaskStarted);
        socket.on('background_task:completed', handleBackgroundTaskCompleted);
        socket.on('background_task:error', handleBackgroundTaskError);

        return () => {
            socket.off('setup:status', handleSetupStatus);
            socket.off('sat-sync-events', handleSatSyncEvents);
            socket.off('soapysdr:discovery_started', handleSoapyDiscoveryStarted);
            socket.off('soapysdr:discovery_complete', handleSoapyDiscoveryComplete);
            socket.off('soapysdr:refresh_complete', handleSoapyRefreshComplete);
            socket.off('soapysdr:discovery_error', handleSoapyDiscoveryError);
            socket.off('background_task:started', handleBackgroundTaskStarted);
            socket.off('background_task:completed', handleBackgroundTaskCompleted);
            socket.off('background_task:error', handleBackgroundTaskError);
        };
    }, [applySetupStatus, socket]);

    const validateAdminDraft = () => {
        const normalizedUsername = adminUsername.trim();
        if (!normalizedUsername) {
            setAdminLocalError('Username is required.');
            return false;
        }
        if (adminPassword.length < 8) {
            setAdminLocalError('Password must be at least 8 characters long.');
            return false;
        }
        if (adminPassword !== adminConfirmPassword) {
            setAdminLocalError('Passwords do not match.');
            return false;
        }
        setAdminLocalError('');
        return true;
    };

    const handleWizardNext = () => {
        if (isWizardLastStep || isWizardSaveStep || !canAdvanceWizard) return;

        if (wizardStep === WIZARD_STEP_ADMIN && !validateAdminDraft()) {
            return;
        }

        const nextStep = wizardStepOrder[wizardCurrentOrderIndex + 1];
        if (nextStep == null) return;
        setWizardStep(nextStep);
    };

    const handleWizardBack = () => {
        if (wizardStep === WIZARD_STEP_RESTORE) return;

        const previousStep = wizardStepOrder[wizardCurrentOrderIndex - 1];
        if (previousStep == null) return;
        setWizardStep(previousStep);
    };

    const handleWizardSave = async () => {
        if (!wizardBackendReady || !hasLocation) return;
        if (!showWizardAdminStep && typeof onPersistLocation !== 'function') return;

        if (!showWizardAdminStep) {
            if (isDifferentFromSaved || !hasPersistedLocation) {
                const saveSucceeded = await onPersistLocation();
                if (!saveSucceeded) {
                    return;
                }
            }
            if (typeof onWizardCompleted === 'function') {
                onWizardCompleted();
            }
            return;
        }

        if (!validateAdminDraft()) {
            return;
        }

        if (!setupLocationPayload || typeof setupLocationPayload !== 'object') {
            setAdminLocalError('Location payload is missing.');
            return;
        }

        const normalizedUsername = adminUsername.trim();

        setAdminLocalError('');
        setWizardFinalizing(true);
        setCallChecklist(createInitialCallChecklist());
        setSoapyRuntimeState(createInitialSoapyRuntimeState());
        setChecklistStatus('location', CALL_STATUS_PENDING, 'Submitting location...');
        setChecklistStatus('soapy', CALL_STATUS_PENDING, 'Starting SoapySDR discovery...');
        setChecklistStatus('orbital', CALL_STATUS_PENDING, 'Starting orbital synchronization...');
        setChecklistStatus('admin', CALL_STATUS_PENDING, 'Creating admin user...');

        const finalizeReply = await callApi('setup.finalize', {
            location: setupLocationPayload,
            admin: {
                username: normalizedUsername,
                password: adminPassword,
            },
        });
        if (!finalizeReply?.success) {
            const finalizeError = String(finalizeReply?.error || 'Failed to start setup finalization.');
            setChecklistStatus('admin', CALL_STATUS_ERROR, finalizeError);
            setWizardFinalizing(false);
            setAdminLocalError(finalizeError);
            return;
        }

        setWizardStep(WIZARD_STEP_FINALIZE);
        await pollSetupStatus();
    };

    const handleWizardFinalize = async () => {
        if (!showWizardAdminStep) {
            if (typeof onWizardCompleted === 'function') {
                onWizardCompleted();
            }
            return;
        }

        if (!validateAdminDraft()) {
            return;
        }

        const normalizedUsername = adminUsername.trim();

        try {
            await dispatch(
                loginUser({
                    username: normalizedUsername,
                    password: adminPassword,
                    keepSessionActive: false,
                })
            ).unwrap();
            setAdminLocalError('');
            if (typeof onWizardCompleted === 'function') {
                onWizardCompleted();
            }
        } catch (error) {
            setAdminLocalError(String(error || 'Failed to sign in.'));
        }
    };

    const handleWizardRestoreFileSelect = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.size > FULL_RESTORE_MAX_FILE_SIZE_BYTES) {
            toast.error(
                t('location.wizard_restore_file_too_large', {
                    defaultValue: `Selected file exceeds ${FULL_RESTORE_MAX_FILE_SIZE_MB} MB limit. Please choose a smaller backup file.`,
                })
            );
            setWizardRestoreFile(null);
            setWizardRestoreFileInputKey((current) => current + 1);
            return;
        }

        setWizardRestoreFile(file);
    };

    const handleWizardRestoreDatabase = async () => {
        if (!wizardBackendReady || !socket || !wizardRestoreFile) return;

        if (wizardRestoreFile.size > FULL_RESTORE_MAX_FILE_SIZE_BYTES) {
            toast.error(
                t('location.wizard_restore_file_too_large', {
                    defaultValue: `Selected file exceeds ${FULL_RESTORE_MAX_FILE_SIZE_MB} MB limit. Please choose a smaller backup file.`,
                })
            );
            return;
        }

        setWizardRestoreLoading(true);
        try {
            const sqlContent = await wizardRestoreFile.text();
            const response = await socket.emitWithAck('api.call', {
                cmd: 'setup.restore',
                data: {
                    sql: sqlContent,
                    drop_tables: wizardRestoreDropTables,
                },
            });

            if (response?.success) {
                toast.success(
                    t('location.wizard_restore_success', {
                        defaultValue: `Backup restored successfully. ${response.tables_created} tables created, ${response.rows_inserted} rows inserted.`,
                    })
                );
                setShowRestoreReloadBackdrop(true);
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
                return;
            }

            toast.error(
                t('location.wizard_restore_failed', {
                    defaultValue: `Failed to restore database: ${response?.error || 'Unknown error'}`,
                })
            );
        } catch (error) {
            const restoreError = error?.message || String(error);
            // Full restore can complete while the setup-mode socket reconnect path drops;
            // verify setup status before surfacing a hard failure.
            if (String(restoreError).toLowerCase().includes('socket has been disconnected')) {
                const setupFinished = await didSetupFinishAfterRestoreDisconnect();
                if (setupFinished) {
                    toast.success(
                        t('location.wizard_restore_success_recovered', {
                            defaultValue: 'Backup restore completed. Reloading application...',
                        })
                    );
                    setShowRestoreReloadBackdrop(true);
                    setTimeout(() => {
                        window.location.reload();
                    }, 1000);
                    return;
                }
            }
            toast.error(
                t('location.wizard_restore_error', {
                    defaultValue: `Error restoring database: ${restoreError}`,
                })
            );
        } finally {
            setWizardRestoreLoading(false);
        }
    };

    const wizardRestoreSection = (
        <SettingsSection
            title={t('location.wizard_restore_title', { defaultValue: 'Restore Existing Backup (Optional)' })}
            description={t('location.wizard_restore_help', {
                defaultValue: 'If you already have a Ground Station backup, restore it now before continuing setup.',
            })}
            sx={sectionSx}
        >
            <Stack spacing={2}>
                <Alert severity="warning">
                    {t('location.wizard_restore_warning', {
                        defaultValue: 'This replaces database content with the selected backup file.',
                    })}
                </Alert>
                <Alert severity="info">
                    {t('location.wizard_restore_file_requirements', {
                        defaultValue: `Use a full SQL backup that includes schema and data. Maximum size: ${FULL_RESTORE_MAX_FILE_SIZE_MB} MB.`,
                    })}
                </Alert>
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={wizardRestoreDropTables}
                            onChange={(event) => setWizardRestoreDropTables(event.target.checked)}
                            disabled={wizardRestoreLoading}
                        />
                    }
                    label={t('location.wizard_restore_drop_tables', {
                        defaultValue: 'Drop existing tables before restore (recommended)',
                    })}
                />
                <Button variant="outlined" component="label" disabled={wizardRestoreLoading} fullWidth>
                    {t('location.wizard_restore_select_file', { defaultValue: 'Select Full Backup SQL File' })}
                    <input
                        key={wizardRestoreFileInputKey}
                        type="file"
                        hidden
                        accept=".sql"
                        onChange={handleWizardRestoreFileSelect}
                    />
                </Button>
                {wizardRestoreFile && (
                    <Typography variant="body2" color="text.secondary">
                        {t('location.wizard_restore_selected_file', {
                            defaultValue: `Selected: ${wizardRestoreFile.name}`,
                        })}
                    </Typography>
                )}
                <Button
                    variant="contained"
                    color="warning"
                    onClick={handleWizardRestoreDatabase}
                    disabled={!wizardRestoreFile || wizardRestoreLoading || !wizardBackendReady}
                >
                    {wizardRestoreLoading ? (
                        <CircularProgress size={20} color="inherit" />
                    ) : (
                        t('location.wizard_restore_button', { defaultValue: 'Restore Backup and Reload' })
                    )}
                </Button>
            </Stack>
        </SettingsSection>
    );

    const soapyLastUpdateText = React.useMemo(() => {
        if (!soapyRuntimeState.lastUpdate) {
            return t('location.state_unavailable', { defaultValue: 'Unavailable' });
        }
        const timestamp = new Date(soapyRuntimeState.lastUpdate);
        return Number.isNaN(timestamp.getTime())
            ? t('location.state_unavailable', { defaultValue: 'Unavailable' })
            : timestamp.toLocaleString();
    }, [soapyRuntimeState.lastUpdate, t]);

    const soapyUiState = React.useMemo(() => {
        const runtimeStatus = String(soapyRuntimeState.status || '').toLowerCase();

        if (runtimeStatus === 'inprogress' || callChecklist.soapy.status === CALL_STATUS_PENDING) {
            return {
                label: t('location.soapy_discovery_in_progress', {
                    defaultValue: 'Discovery in progress',
                }),
                color: 'info',
                loading: true,
            };
        }

        if (runtimeStatus === 'complete') {
            return {
                label: t('location.soapy_discovery_complete', {
                    defaultValue: 'Discovery complete',
                }),
                color: 'success',
                loading: false,
            };
        }

        if (runtimeStatus === 'error' || callChecklist.soapy.status === CALL_STATUS_ERROR) {
            return {
                label: t('location.soapy_discovery_failed', {
                    defaultValue: 'Discovery failed',
                }),
                color: 'error',
                loading: false,
            };
        }

        if (callChecklist.soapy.status === CALL_STATUS_SUCCESS) {
            return {
                label: t('location.soapy_discovery_submitted', {
                    defaultValue: 'Discovery task submitted',
                }),
                color: 'success',
                loading: false,
            };
        }

        return {
            label: t('location.soapy_discovery_idle', {
                defaultValue: 'Discovery status unavailable',
            }),
            color: 'default',
            loading: false,
        };
    }, [callChecklist.soapy.status, soapyRuntimeState.status, t]);

    const soapySummaryText = React.useMemo(() => {
        const normalizedStatusLabel = String(soapyUiState.label || '')
            .trim()
            .replace(/[.!?]+$/, '')
            .toLowerCase();
        const normalizedDetail = String(soapyRuntimeState.detail || '')
            .trim()
            .replace(/[.!?]+$/, '')
            .toLowerCase();
        const parsedServerCount = (
            soapyRuntimeState.serverCount == null
                ? null
                : Number(soapyRuntimeState.serverCount)
        );
        const parsedSdrCount = (
            soapyRuntimeState.sdrCount == null
                ? null
                : Number(soapyRuntimeState.sdrCount)
        );
        const hasServerCount = parsedServerCount !== null && Number.isFinite(parsedServerCount);
        const hasSdrCount = parsedSdrCount !== null && Number.isFinite(parsedSdrCount);

        // Keep the Soapy card to two lines by merging optional runtime details into one compact summary row.
        const segments = [
            `${t('location.soapy_last_update', { defaultValue: 'Last update' })}: ${soapyLastUpdateText}`,
            hasServerCount
                ? `${t('location.soapy_servers_found', { defaultValue: 'Servers found' })}: ${parsedServerCount}`
                : null,
            hasSdrCount
                ? `${t('location.soapy_sdrs_found', { defaultValue: 'SDRs detected' })}: ${parsedSdrCount}`
                : null,
            normalizedDetail && normalizedDetail !== normalizedStatusLabel ? soapyRuntimeState.detail : null,
        ].filter(Boolean);

        return segments.join(' • ');
    }, [
        soapyLastUpdateText,
        soapyRuntimeState.detail,
        soapyRuntimeState.sdrCount,
        soapyRuntimeState.serverCount,
        soapyUiState.label,
        t,
    ]);

    const soapyAndOrbitalChecklist = React.useMemo(() => {
        const soapyStatus = callChecklist.soapy.status;
        const orbitalStatus = callChecklist.orbital.status;

        // Aggregate two backend task starters into one checklist row.
        let status = CALL_STATUS_IDLE;
        if (soapyStatus === CALL_STATUS_ERROR || orbitalStatus === CALL_STATUS_ERROR) {
            status = CALL_STATUS_ERROR;
        } else if (soapyStatus === CALL_STATUS_PENDING || orbitalStatus === CALL_STATUS_PENDING) {
            status = CALL_STATUS_PENDING;
        } else if (soapyStatus === CALL_STATUS_SUCCESS && orbitalStatus === CALL_STATUS_SUCCESS) {
            status = CALL_STATUS_SUCCESS;
        } else if (soapyStatus === CALL_STATUS_SUCCESS || orbitalStatus === CALL_STATUS_SUCCESS) {
            status = CALL_STATUS_PENDING;
        }

        const details = [];
        if (callChecklist.soapy.detail) details.push(`SoapySDR: ${callChecklist.soapy.detail}`);
        if (callChecklist.orbital.detail) details.push(`Orbital sync: ${callChecklist.orbital.detail}`);

        return {
            status,
            detail: details.join(' • '),
        };
    }, [
        callChecklist.orbital.detail,
        callChecklist.orbital.status,
        callChecklist.soapy.detail,
        callChecklist.soapy.status,
    ]);

    const checklistItems = React.useMemo(
        () => [
            {
                key: 'location',
                label: t('location.setup_call_identity_location', {
                    defaultValue: 'Identity and location setup',
                }),
                value: callChecklist.location,
            },
            {
                key: 'admin',
                label: t('location.setup_call_admin_created', {
                    defaultValue: 'Administrator account created',
                }),
                value: callChecklist.admin,
            },
            {
                key: 'runtime',
                label: t('location.setup_call_runtime_started', {
                    defaultValue: 'Soapy server discovery and orbital data sync started',
                }),
                value: soapyAndOrbitalChecklist,
            },
        ],
        [callChecklist.admin, callChecklist.location, soapyAndOrbitalChecklist, t]
    );

    const getChecklistStatusColor = (status) => {
        if (status === CALL_STATUS_SUCCESS) return 'success.main';
        if (status === CALL_STATUS_PENDING) return 'info.main';
        if (status === CALL_STATUS_ERROR) return 'error.main';
        return 'text.secondary';
    };

    const getChecklistStatusLabel = (status) => {
        if (status === CALL_STATUS_SUCCESS) {
            return t('location.state_done', { defaultValue: 'Done' });
        }
        if (status === CALL_STATUS_PENDING) {
            return t('location.state_in_progress', { defaultValue: 'In progress' });
        }
        if (status === CALL_STATUS_ERROR) {
            return t('location.state_failed', { defaultValue: 'Failed' });
        }
        return t('location.state_waiting', { defaultValue: 'Waiting' });
    };

    const wizardReviewSection = (
        <SettingsSection
            title={t('location.wizard_review_title', { defaultValue: 'Review Configuration' })}
            description={t('location.wizard_review_help', {
                defaultValue: 'Verify station identity and coordinates, then save to continue.',
            })}
            sx={sectionSx}
        >
            <Grid container spacing={2} columns={12}>
                <Grid size={{ xs: 12, sm: 6 }}>
                    <Typography variant="caption" color="text.secondary">
                        {t('location.station_name', { defaultValue: 'Station Name' })}
                    </Typography>
                    <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 600 }}>
                        {stationName || 'home'}
                    </Typography>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                    <Typography variant="caption" color="text.secondary">
                        {t('location.ham_callsign', { defaultValue: 'HAM Callsign' })}
                    </Typography>
                    <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 600 }}>
                        {stationCallsignLabel || t('location.state_unavailable', { defaultValue: 'Unavailable' })}
                    </Typography>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                    <Typography variant="caption" color="text.secondary">
                        {t('location.station_type', { defaultValue: 'Station Type' })}
                    </Typography>
                    <Typography
                        variant="body1"
                        sx={{ color: 'text.primary', fontWeight: 600, textTransform: 'capitalize' }}
                    >
                        {stationType}
                    </Typography>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                    <Typography variant="caption" color="text.secondary">
                        {t('location.horizon_mask', { defaultValue: 'Horizon Mask (°)' })}
                    </Typography>
                    <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 600 }}>
                        {`${stationHorizonMask}\u00b0`}
                    </Typography>
                </Grid>
            </Grid>
        </SettingsSection>
    );

    const wizardReviewContent = (
        <Grid container spacing={2} columns={12} alignItems="stretch">
            <Grid
                size={{ xs: 12, md: 5 }}
                sx={{
                    display: 'flex',
                    '& > *': {
                        width: '100%',
                        height: '100%',
                    },
                }}
            >
                {wizardReviewSection}
            </Grid>
            <Grid
                size={{ xs: 12, md: 7 }}
                sx={{
                    display: 'flex',
                    '& > *': {
                        width: '100%',
                        height: '100%',
                    },
                }}
            >
                {stationCoordinatesSection}
            </Grid>
        </Grid>
    );

    const wizardChecklistSection = (
        <SettingsSection
            title={t('location.setup_checklist_title', { defaultValue: 'Setup checklist' })}
            description={t('location.setup_checklist_help', {
                defaultValue: 'Calls that were executed when you pressed Save and Continue.',
            })}
            sx={sectionSx}
        >
            <Stack spacing={0.75}>
                {checklistItems.map((item) => (
                    <Box
                        key={item.key}
                        title={item.value.detail || undefined}
                        sx={{
                            px: 1,
                            py: 0.75,
                            borderRadius: 0.75,
                            border: '1px solid',
                            borderColor: 'divider',
                        }}
                    >
                        <Stack
                            direction="row"
                            spacing={0.5}
                            alignItems="center"
                            justifyContent="space-between"
                            sx={{ minWidth: 0 }}
                        >
                            <Typography
                                variant="body2"
                                noWrap
                                sx={{ fontWeight: 600, lineHeight: 1.2, minWidth: 0, flex: 1, pr: 0.75 }}
                            >
                                {item.label}
                            </Typography>
                            <Stack direction="row" spacing={0.35} alignItems="center" sx={{ flexShrink: 0 }}>
                                {item.value.status === CALL_STATUS_SUCCESS && (
                                    <CheckCircleOutlineIcon
                                        fontSize="small"
                                        sx={{ color: getChecklistStatusColor(item.value.status) }}
                                    />
                                )}
                                {item.value.status === CALL_STATUS_PENDING && (
                                    <HourglassEmptyIcon
                                        fontSize="small"
                                        sx={{ color: getChecklistStatusColor(item.value.status) }}
                                    />
                                )}
                                {item.value.status === CALL_STATUS_ERROR && (
                                    <ErrorOutlineIcon
                                        fontSize="small"
                                        sx={{ color: getChecklistStatusColor(item.value.status) }}
                                    />
                                )}
                                <Typography
                                    variant="caption"
                                    noWrap
                                    sx={{ color: getChecklistStatusColor(item.value.status), lineHeight: 1.1 }}
                                >
                                    {getChecklistStatusLabel(item.value.status)}
                                </Typography>
                            </Stack>
                        </Stack>
                    </Box>
                ))}
            </Stack>
        </SettingsSection>
    );

    const getStatusTone = (statusColor) => {
        if (statusColor === 'success') return { text: 'success.main', bg: 'success' };
        if (statusColor === 'info') return { text: 'info.main', bg: 'info' };
        if (statusColor === 'error') return { text: 'error.main', bg: 'error' };
        return { text: 'text.secondary', bg: 'grey' };
    };

    const wizardTaskStatusSection = (
        <SettingsSection
            title={t('location.setup_task_status_title', { defaultValue: 'Background Task Status' })}
            description={t('location.setup_task_status_help', {
                defaultValue: 'Live runtime status for orbital synchronization and SoapySDR discovery.',
            })}
            sx={sectionSx}
        >
            <Stack spacing={0.75}>
                <Box
                    sx={{
                        px: 1,
                        py: 0.85,
                        borderRadius: 0.75,
                        border: '1px solid',
                        borderColor: 'divider',
                    }}
                >
                    <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="space-between">
                        <Stack direction="row" spacing={0.7} alignItems="center" sx={{ minWidth: 0 }}>
                            {orbitalSyncUiState.loading && <CircularProgress size={13} thickness={5.5} />}
                            <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.15 }}>
                                {t('location.orbital_sync_title', { defaultValue: 'Orbital Data Sync' })}
                            </Typography>
                        </Stack>
                        <Box
                            sx={{
                                px: 0.7,
                                py: 0.2,
                                borderRadius: 5,
                                bgcolor: (theme) =>
                                    alpha(
                                        theme.palette[getStatusTone(orbitalSyncUiState.color).bg]?.main
                                            || theme.palette.grey[500],
                                        theme.palette.mode === 'dark' ? 0.18 : 0.12
                                    ),
                            }}
                        >
                            <Typography
                                variant="caption"
                                sx={{ color: getStatusTone(orbitalSyncUiState.color).text, lineHeight: 1.1 }}
                            >
                                {orbitalSyncUiState.label}
                            </Typography>
                        </Box>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.2 }}>
                        {t('location.orbital_sync_last_update', { defaultValue: 'Last update' })}: {syncLastUpdateText}
                    </Typography>
                    {orbitalSyncUiState.error && (
                        <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 0.2, lineHeight: 1.2 }}>
                            {orbitalSyncUiState.error}
                        </Typography>
                    )}
                </Box>

                <Box
                    sx={{
                        px: 1,
                        py: 0.85,
                        borderRadius: 0.75,
                        border: '1px solid',
                        borderColor: 'divider',
                    }}
                >
                    <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="space-between">
                        <Stack direction="row" spacing={0.7} alignItems="center" sx={{ minWidth: 0 }}>
                            {soapyUiState.loading && <CircularProgress size={13} thickness={5.5} />}
                            <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.15 }}>
                                {t('location.soapy_status_title', { defaultValue: 'SoapySDR Detection' })}
                            </Typography>
                        </Stack>
                        <Box
                            sx={{
                                px: 0.7,
                                py: 0.2,
                                borderRadius: 5,
                                bgcolor: (theme) =>
                                    alpha(
                                        theme.palette[getStatusTone(soapyUiState.color).bg]?.main
                                            || theme.palette.grey[500],
                                        theme.palette.mode === 'dark' ? 0.18 : 0.12
                                    ),
                            }}
                        >
                            <Typography
                                variant="caption"
                                sx={{ color: getStatusTone(soapyUiState.color).text, lineHeight: 1.1 }}
                            >
                                {soapyUiState.label}
                            </Typography>
                        </Box>
                    </Stack>
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        title={soapySummaryText}
                        sx={{ display: 'block', mt: 0.25, lineHeight: 1.2 }}
                    >
                        {soapySummaryText}
                    </Typography>
                </Box>
            </Stack>
        </SettingsSection>
    );

    const wizardFinalizeContent = (
        <Grid container spacing={2} columns={12} alignItems="stretch">
            <Grid
                size={{ xs: 12, md: 6 }}
                sx={{
                    display: 'flex',
                    '& > *': {
                        width: '100%',
                        height: '100%',
                    },
                }}
            >
                {wizardReviewSection}
            </Grid>
            <Grid
                size={{ xs: 12, md: 6 }}
                sx={{
                    display: 'flex',
                    '& > *': {
                        width: '100%',
                        height: '100%',
                    },
                }}
            >
                {stationCoordinatesSection}
            </Grid>
            <Grid
                size={{ xs: 12, md: 6 }}
                sx={{
                    display: 'flex',
                    '& > *': {
                        width: '100%',
                        height: '100%',
                    },
                }}
            >
                {wizardTaskStatusSection}
            </Grid>
            <Grid
                size={{ xs: 12, md: 6 }}
                sx={{
                    display: 'flex',
                    '& > *': {
                        width: '100%',
                        height: '100%',
                    },
                }}
            >
                {wizardChecklistSection}
            </Grid>
            {(adminLocalError || authError) && (
                <Grid size={{ xs: 12, md: 12 }}>
                    <Alert severity="error">{adminLocalError || authError}</Alert>
                </Grid>
            )}
        </Grid>
    );

    const wizardAdminSection = (
        <SettingsSection
            title={t('location.wizard_admin_title', { defaultValue: 'Create Administrator Account' })}
            description={t('location.wizard_admin_help', {
                defaultValue:
                    'Create the first admin account credentials. Account will be created when setup finishes.',
            })}
            sx={sectionSx}
        >
            <Stack spacing={2}>
                <Alert severity="info">
                    {t('location.wizard_admin_notice', {
                        defaultValue:
                            'This account will be the initial administrator for this Ground Station instance.',
                    })}
                </Alert>
                {(adminLocalError || authError) && (
                    <Alert severity="error">{adminLocalError || authError}</Alert>
                )}
                <TextField
                    label="Username"
                    value={adminUsername}
                    onChange={(event) => {
                        setAdminUsername(event.target.value);
                        if (adminLocalError) setAdminLocalError('');
                    }}
                    autoComplete="username"
                    required
                    fullWidth
                    disabled={authLoadingAction}
                />
                <TextField
                    label="Password"
                    type="password"
                    value={adminPassword}
                    onChange={(event) => {
                        setAdminPassword(event.target.value);
                        if (adminLocalError) setAdminLocalError('');
                    }}
                    autoComplete="new-password"
                    required
                    fullWidth
                    disabled={authLoadingAction}
                />
                <TextField
                    label="Confirm password"
                    type="password"
                    value={adminConfirmPassword}
                    onChange={(event) => {
                        setAdminConfirmPassword(event.target.value);
                        if (adminLocalError) setAdminLocalError('');
                    }}
                    autoComplete="new-password"
                    required
                    fullWidth
                    disabled={authLoadingAction}
                />
            </Stack>
        </SettingsSection>
    );

    const wizardStatusText = (() => {
        if (wizardStep === WIZARD_STEP_RESTORE) {
            return t('location.wizard_restore_skip_help', {
                defaultValue: 'You can skip this step and continue with a fresh setup.',
            });
        }
        if (isWizardFinalizeStep) {
            return t('location.setup_finalize_help', {
                defaultValue: 'Review task status and complete setup.',
            });
        }
        return '';
    })();

    const saveButtonLabel = 'finalize';

    return (
        <>
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <Box sx={{ px: { xs: 0, sm: 1 } }}>
                    <Box
                        sx={{
                            position: 'sticky',
                            top: 0,
                            zIndex: 3,
                            py: 0.75,
                            mb: '0.5em',
                            backgroundColor: (theme) =>
                                theme.palette.mode === 'dark'
                                    ? theme.palette.background.elevated
                                    : theme.palette.background.paper,
                        }}
                    >
                        <Stepper activeStep={wizardCurrentOrderIndex} alternativeLabel>
                            {wizardStepOrder.map((stepId, index) => (
                                <Step key={stepId} completed={index < wizardCurrentOrderIndex}>
                                    <StepLabel>{wizardStepLabels[stepId]}</StepLabel>
                                </Step>
                            ))}
                        </Stepper>
                    </Box>
                </Box>

                <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                    {wizardStep === WIZARD_STEP_RESTORE && <Stack spacing={2}>{wizardRestoreSection}</Stack>}

                    {wizardStep === WIZARD_STEP_IDENTITY && (
                        <Stack spacing={2}>{stationIdentitySection}</Stack>
                    )}

                    {wizardStep === WIZARD_STEP_COORDINATES && (
                        <Stack spacing={2}>{wizardMapSection}</Stack>
                    )}

                    {wizardStep === WIZARD_STEP_REVIEW && <Stack spacing={2}>{wizardReviewContent}</Stack>}

                    {wizardStep === WIZARD_STEP_ADMIN && <Stack spacing={2}>{wizardAdminSection}</Stack>}

                    {wizardStep === WIZARD_STEP_FINALIZE && <Stack spacing={2}>{wizardFinalizeContent}</Stack>}
                </Box>

                <SettingsActionFooter
                    statusText={wizardStatusText}
                    mobileInline
                    sx={{
                        mt: 'auto',
                        zIndex: 4,
                        backgroundColor: (theme) =>
                            theme.palette.mode === 'dark'
                                ? alpha(theme.palette.grey[700], 0.18)
                                : alpha(theme.palette.grey[100], 0.9),
                    }}
                >
                    <Button
                        variant="outlined"
                        onClick={handleWizardBack}
                        disabled={
                            wizardStep === WIZARD_STEP_RESTORE ||
                            locationSaving ||
                            wizardRestoreLoading ||
                            authLoadingAction ||
                            wizardFinalizing
                        }
                    >
                        {t('location.back', { defaultValue: 'Back' })}
                    </Button>
                    {isWizardSaveStep ? (
                        <Button
                            variant="contained"
                            disabled={!canSaveInReviewStep || wizardFinalizing || wizardRestoreLoading}
                            aria-label={t('location.save_location')}
                            onClick={handleWizardSave}
                        >
                            {wizardFinalizing
                                ? t('location.state_working', { defaultValue: 'Working...' })
                                : saveButtonLabel}
                        </Button>
                    ) : isWizardFinalizeStep ? (
                        <Button
                            variant="contained"
                            disabled={
                                authLoadingAction ||
                                wizardFinalizing ||
                                !wizardBackendReady ||
                                callChecklist.location.status !== CALL_STATUS_SUCCESS ||
                                callChecklist.admin.status !== CALL_STATUS_SUCCESS
                            }
                            aria-label={t('location.complete_setup', { defaultValue: 'Complete setup' })}
                            onClick={handleWizardFinalize}
                        >
                            {authLoadingAction
                                ? t('location.state_signing_in', {
                                      defaultValue: 'Signing in...',
                                  })
                                : t('location.complete_setup', { defaultValue: 'Complete setup' })}
                        </Button>
                    ) : (
                        <Button
                            variant="contained"
                            onClick={handleWizardNext}
                            disabled={!canAdvanceWizard || locationSaving || wizardRestoreLoading}
                        >
                            {t('location.next', { defaultValue: 'Next' })}
                        </Button>
                    )}
                </SettingsActionFooter>
            </Box>

            <Backdrop
                sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }}
                open={showRestoreReloadBackdrop}
            >
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <CircularProgress color="inherit" size={60} />
                    <Typography variant="h6" sx={{ mt: 2 }}>
                        {t('location.wizard_restore_reloading', { defaultValue: 'Reloading application...' })}
                    </Typography>
                </Box>
            </Backdrop>
        </>
    );
};

export default SetupWizard;
