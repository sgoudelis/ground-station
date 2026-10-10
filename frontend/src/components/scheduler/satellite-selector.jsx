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

import React, { useEffect, Fragment } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    ListSubheader,
    TextField,
    CircularProgress,
    Stack,
    Typography,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    Paper,
    Box,
} from '@mui/material';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderSharedOutlinedIcon from '@mui/icons-material/FolderSharedOutlined';
import Autocomplete from '@mui/material/Autocomplete';
import { useSocket } from '../common/socket.jsx';
import {
    setSatGroups,
    setGroupId,
    setGroupOfSats,
    setSatelliteId,
    setSearchOptions,
    setSearchLoading,
    setSelectedFromSearch,
    fetchNextPassesForScheduler,
    setSelectedPassId,
    fetchSatelliteWithTransmitters,
} from './scheduler-slice.jsx';
import { useTranslation } from 'react-i18next';

const SATELLITE_NUMBER_LIMIT = 150;

const getGroupOptionIcon = (groupType) => {
    const normalizedType = String(groupType || '').toLowerCase();
    if (normalizedType === 'user') {
        return <FolderSharedOutlinedIcon fontSize="small" sx={{ color: 'primary.main' }} />;
    }
    return <FolderOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />;
};

const SatelliteGroupDropdown = ({ onSatelliteSelect, disabled = false }) => {
    const { t } = useTranslation('common');
    const dispatch = useDispatch();
    const { socket } = useSocket();

    const { satGroups, groupId, selectedFromSearch } = useSelector((state) => state.scheduler?.satelliteSelection || {});

    useEffect(() => {
        if (socket) {
            socket.emit("api.call", {
  cmd: 'get-satellite-groups',
  data: null
}, response => {
  if (response.success) {
    dispatch(setSatGroups(response.data));
  }
});
        }
    }, [socket, dispatch]);

    const handleGroupChange = (e) => {
        const newGroupId = e.target.value;
        dispatch(setGroupId(newGroupId));
        dispatch(setSatelliteId(''));
        dispatch(setGroupOfSats([]));
        dispatch(setSelectedFromSearch(false));

        if (socket) {
            socket.emit("api.call", {
  cmd: 'get-satellites-for-group-id',
  data: newGroupId
}, response => {
  if (response.success) {
    dispatch(setGroupOfSats(response.data));
  }
});
        }
    };

    return (
        <FormControl fullWidth variant="outlined" size="small" disabled={disabled || selectedFromSearch}>
            <InputLabel>{t('satellite_selector.satellite_group', { defaultValue: 'Satellite Group' })}</InputLabel>
            <Select
                value={satGroups.length > 0 ? groupId : ''}
                onChange={handleGroupChange}
                label={t('satellite_selector.satellite_group', { defaultValue: 'Satellite Group' })}
            >
                <ListSubheader>{t('satellite_selector.user_groups', { defaultValue: 'User Groups' })}</ListSubheader>
                {satGroups.filter(group => group.type === 'user').length === 0 ? (
                    <MenuItem disabled value="">
                        {t('satellite_selector.none_created', { defaultValue: 'None created' })}
                    </MenuItem>
                ) : (
                    satGroups
                        .filter(group => group.type === 'user')
                        .map((group) => (
                            <MenuItem
                                key={group.id}
                                value={group.id}
                                disabled={group.satellite_ids.length > SATELLITE_NUMBER_LIMIT}
                            >
                                <Stack direction="row" spacing={1} alignItems="center">
                                    {getGroupOptionIcon(group.type)}
                                    <span>{group.name} ({group.satellite_ids.length})</span>
                                </Stack>
                            </MenuItem>
                        ))
                )}
                <ListSubheader>{t('satellite_selector.orbital_source_groups', { defaultValue: 'Orbital Source Groups' })}</ListSubheader>
                {satGroups
                    .filter(group => group.type === 'system')
                    .map((group) => (
                        <MenuItem
                            key={group.id}
                            value={group.id}
                            disabled={group.satellite_ids.length > SATELLITE_NUMBER_LIMIT}
                        >
                            <Stack direction="row" spacing={1} alignItems="center">
                                {getGroupOptionIcon(group.type)}
                                <span>{group.name} ({group.satellite_ids.length})</span>
                            </Stack>
                        </MenuItem>
                    ))}
            </Select>
        </FormControl>
    );
};

const SatelliteDropdown = ({ onSatelliteSelect, disabled = false }) => {
    const { t } = useTranslation('common');
    const dispatch = useDispatch();
    const { groupOfSats, satelliteId, selectedFromSearch } = useSelector((state) => state.scheduler?.satelliteSelection || {});

    const handleSatelliteChange = (e) => {
        const noradId = e.target.value;
        dispatch(setSatelliteId(noradId));
        dispatch(setSelectedFromSearch(false));

        const satellite = groupOfSats.find(s => s.norad_id === noradId);
        if (satellite && onSatelliteSelect) {
            onSatelliteSelect(satellite);
        }
    };

    return (
        <FormControl fullWidth variant="outlined" size="small" disabled={disabled || selectedFromSearch}>
            <InputLabel>{t('satellite_selector.satellite', { defaultValue: 'Satellite' })}</InputLabel>
            <Select
                value={groupOfSats.length > 0 && groupOfSats.find(s => s.norad_id === satelliteId) ? satelliteId : ''}
                onChange={handleSatelliteChange}
                label={t('satellite_selector.satellite', { defaultValue: 'Satellite' })}
            >
                {groupOfSats.map((satellite) => (
                    <MenuItem key={satellite.norad_id} value={satellite.norad_id}>
                        #{satellite.norad_id} {satellite.name}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );
};

const SatelliteSearchAutocomplete = ({
    onSatelliteSelect,
    onTransmittersLoadingChange,
    disabled = false,
    initialSatellite = null,
}) => {
    const { t } = useTranslation('common');
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { searchOptions, searchLoading } = useSelector((state) => state.scheduler?.satelliteSelection || {});

    const [open, setOpen] = React.useState(false);
    const [value, setValue] = React.useState(null);
    const [hasInitialized, setHasInitialized] = React.useState(false);
    const transmitterRequestIdRef = React.useRef(0);

    // Set initial value when editing and trigger satellite ID selection (for pass fetching)
    React.useEffect(() => {
        if (initialSatellite && !hasInitialized && socket) {
            setValue(initialSatellite);
            const requestId = ++transmitterRequestIdRef.current;
            onTransmittersLoadingChange?.(true);

            // Fetch the satellite with transmitters using async thunk
            dispatch(fetchSatelliteWithTransmitters({
                socket,
                satelliteName: initialSatellite.name,
                noradId: initialSatellite.norad_id
            }))
                .unwrap()
                .then((satelliteWithTransmitters) => {
                    if (requestId !== transmitterRequestIdRef.current) return;

                    // Set the satellite ID to trigger pass fetching
                    dispatch(setSatelliteId(satelliteWithTransmitters.norad_id));
                    dispatch(setSelectedFromSearch(true));

                    // Put the satellite with transmitters in groupOfSats
                    dispatch(setGroupOfSats([satelliteWithTransmitters]));

                    // Set group ID if available
                    if (satelliteWithTransmitters.group_id || initialSatellite.group_id) {
                        dispatch(setGroupId(satelliteWithTransmitters.group_id || initialSatellite.group_id));
                    }

                    // Call the callback with full satellite data
                    if (onSatelliteSelect) {
                        onSatelliteSelect(satelliteWithTransmitters);
                    }
                })
                .catch(() => {
                    if (requestId !== transmitterRequestIdRef.current) return;

                    // Fallback: use initial satellite without transmitters
                    dispatch(setSatelliteId(initialSatellite.norad_id));
                    dispatch(setSelectedFromSearch(true));
                    dispatch(setGroupOfSats([initialSatellite]));

                    if (initialSatellite.group_id) {
                        dispatch(setGroupId(initialSatellite.group_id));
                    }

                    if (onSatelliteSelect) {
                        onSatelliteSelect(initialSatellite);
                    }
                })
                .finally(() => {
                    if (requestId === transmitterRequestIdRef.current) {
                        onTransmittersLoadingChange?.(false);
                    }
                });

            setHasInitialized(true);
        }
    }, [
        initialSatellite,
        hasInitialized,
        socket,
        dispatch,
        onSatelliteSelect,
        onTransmittersLoadingChange,
    ]);

    // Reset initialization when initialSatellite norad_id changes
    React.useEffect(() => {
        setHasInitialized(false);
    }, [initialSatellite?.norad_id]);

    const handleInputChange = (event, newInputValue) => {
        if (newInputValue.length > 2 && socket) {
            dispatch(setSearchLoading(true));
            socket.emit("api.call", {
  cmd: 'get-satellite-search',
  data: newInputValue
}, response => {
  if (response.success) {
    dispatch(setSearchOptions(response.data));
  } else {
    dispatch(setSearchOptions([]));
  }
  dispatch(setSearchLoading(false));
});
        }
    };

    const handleOptionSelect = (event, selectedSatellite) => {
        setValue(selectedSatellite);
        // Prevent an older initialization request from replacing the user's selection.
        ++transmitterRequestIdRef.current;
        onTransmittersLoadingChange?.(false);

        if (selectedSatellite) {
            const firstGroup = selectedSatellite.groups?.[0];
            const selectedSatelliteWithGroup = {
                ...selectedSatellite,
                group_id: firstGroup?.id || selectedSatellite.group_id || '',
            };

            // Search results already include the selected satellite's transmitters.
            // Keep only that result instead of loading every satellite in its group.
            if (firstGroup) {
                dispatch(setGroupId(firstGroup.id));
            }

            dispatch(setSelectedFromSearch(true));
            dispatch(setGroupOfSats([selectedSatelliteWithGroup]));
            dispatch(setSatelliteId(selectedSatellite.norad_id));
            onSatelliteSelect?.(selectedSatelliteWithGroup);
        } else {
            // Clear selection when autocomplete is cleared
            dispatch(setSelectedFromSearch(false));
        }
    };

    const handleClose = () => {
        setOpen(false);
        dispatch(setSearchOptions([]));
    };

    // Combine initial satellite with search options to ensure value is always in options
    const allOptions = React.useMemo(() => {
        if (value && !searchOptions.find(opt => opt.norad_id === value.norad_id)) {
            return [value, ...searchOptions];
        }
        return searchOptions;
    }, [value, searchOptions]);

    return (
        <Autocomplete
            size="small"
            fullWidth
            open={open}
            onOpen={() => setOpen(true)}
            onClose={handleClose}
            onInputChange={handleInputChange}
            onChange={handleOptionSelect}
            value={value}
            disabled={disabled}
            isOptionEqualToValue={(option, value) => option.norad_id === value.norad_id}
            getOptionLabel={(option) => `${option.norad_id} - ${option.name}`}
            options={allOptions}
            loading={searchLoading}
            renderInput={(params) => (
                <TextField
                    {...params}
                    label={t('satellite_selector.search_satellite', { defaultValue: 'Search Satellite' })}
                    variant="outlined"
                    size="small"
                    slotProps={{
                        input: {
                            ...params.InputProps,
                            endAdornment: (
                                <Fragment>
                                    {searchLoading ? <CircularProgress color="inherit" size={20} /> : null}
                                    {params.InputProps.endAdornment}
                                </Fragment>
                            ),
                        },
                    }}
                />
            )}
        />
    );
};

const PassSelector = ({ onPassSelect, initialPass, currentObservationId, disabled = false }) => {
    const { t } = useTranslation('common');
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { passes, passesLoading, satelliteId, selectedPassId } = useSelector(
        (state) => state.scheduler?.satelliteSelection || {}
    );
    const observations = useSelector((state) => state.scheduler?.observations || []);
    const timezone = useSelector((state) =>
        state.preferences?.preferences?.find(p => p.name === 'timezone')?.value || 'Europe/Athens'
    );
    const [hasSetInitialPass, setHasSetInitialPass] = React.useState(false);

    // Detect if we're waiting for the correct satellite's passes
    const hasWrongSatellitePasses = React.useMemo(() => {
        if (!initialPass || passes.length === 0) return false;

        // Check if any pass matches the initialPass timestamp
        const hasMatch = passes.some(p => {
            const passStartTime = new Date(p.event_start).getTime();
            const initialStartTime = new Date(initialPass.event_start).getTime();
            return Math.abs(passStartTime - initialStartTime) < 1000;
        });

        // If we have passes but no match, we have the wrong satellite's passes
        return !hasMatch;
    }, [passes, initialPass]);

    // Calculate the effective selected pass ID (either from Redux or matched by timestamp)
    const effectiveSelectedPassId = React.useMemo(() => {
        // First try to find by the stored ID
        let found = passes.find(p => p.id === selectedPassId);

        // If not found by ID but we have an initialPass, try matching by timestamp
        if (!found && initialPass && passes.length > 0) {
            found = passes.find(p => {
                const passStartTime = new Date(p.event_start).getTime();
                const initialStartTime = new Date(initialPass.event_start).getTime();
                return Math.abs(passStartTime - initialStartTime) < 1000;
            });
        }

        return found ? found.id : '';
    }, [passes, selectedPassId, initialPass]);

    // Fetch passes when satellite changes
    React.useEffect(() => {
        if (satelliteId && socket) {
            dispatch(fetchNextPassesForScheduler({ socket, noradId: satelliteId, hours: 24, minElevation: 0 }));
            setHasSetInitialPass(false);
        } else {
            // Clear passes if no satellite selected
            dispatch(setSelectedPassId(null));
        }
    }, [satelliteId, socket, dispatch]);

    // Set initial pass after passes are loaded
    React.useEffect(() => {
        if (initialPass && passes.length > 0 && !hasSetInitialPass && satelliteId) {
            // Try to find a matching pass by comparing start times (with tolerance for calculation differences)
            const matchingPass = passes.find(p => {
                const passStartTime = new Date(p.event_start).getTime();
                const initialStartTime = new Date(initialPass.event_start).getTime();
                const timeDiff = Math.abs(passStartTime - initialStartTime);
                // Allow 60 second tolerance for calculation differences
                return timeDiff < 60000;
            });

            if (matchingPass) {
                dispatch(setSelectedPassId(matchingPass.id));
                setHasSetInitialPass(true);
                // Also call the callback
                if (onPassSelect) {
                    onPassSelect(matchingPass);
                }
            }
        }
    }, [initialPass, passes, hasSetInitialPass, satelliteId, dispatch, onPassSelect]);

    const handlePassClick = (pass) => {
        const newPassId = pass ? pass.id : null;
        dispatch(setSelectedPassId(newPassId));
        if (onPassSelect) {
            onPassSelect(pass);
        }
    };

    // Check if a pass overlaps with any existing observation and return conflict info
    const getPassConflict = (pass) => {
        const passStart = new Date(pass.event_start);
        const passEnd = new Date(pass.event_end);

        const conflictingObs = observations.find(obs => {
            // Skip the observation we're currently editing
            if (currentObservationId && obs.id === currentObservationId) {
                return false;
            }

            if (!obs.pass) {
                return false;
            }

            // Use task_start/task_end if available (actual execution window),
            // otherwise fall back to event_start/event_end (full visibility window)
            const obsStart = obs.task_start ? new Date(obs.task_start) : new Date(obs.pass.event_start);
            const obsEnd = obs.task_end ? new Date(obs.task_end) : new Date(obs.pass.event_end);

            // Check for any overlap
            const hasOverlap = (passStart < obsEnd && passEnd > obsStart);

            return hasOverlap;
        });

        return conflictingObs || null;
    };

    // Check if a pass overlaps with any existing observation
    const isPassOverlapping = (pass) => {
        return getPassConflict(pass) !== null;
    };

    const humanizeTime = (isoString) => {
        const now = new Date();
        const target = new Date(isoString);
        const diffMs = target - now;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 0) {
            return 'passed';
        } else if (diffMins < 60) {
            return `in ${diffMins}min`;
        } else if (diffHours < 24) {
            const remainingMins = diffMins % 60;
            return `in ${diffHours}h ${remainingMins}min`;
        } else {
            const remainingHours = diffHours % 24;
            return `in ${diffDays}d ${remainingHours}h`;
        }
    };

    const formatPassInfo = (pass) => {
        const startDate = new Date(pass.event_start);
        const endDate = new Date(pass.event_end);
        const duration = Math.round((endDate - startDate) / 1000 / 60); // minutes
        const humanTime = humanizeTime(pass.event_start);

        // Map timezone to appropriate locale for date formatting
        // This ensures DD/MM/YYYY format for European timezones
        const getLocaleFromTimezone = (tz) => {
            if (tz.startsWith('Europe/') || tz.startsWith('Africa/')) {
                return 'en-GB'; // British English uses DD/MM/YYYY
            } else if (tz.startsWith('America/')) {
                return 'en-US'; // US uses MM/DD/YYYY
            } else if (tz.startsWith('Asia/')) {
                // Most Asian countries use DD/MM/YYYY
                return 'en-GB';
            }
            return 'en-GB'; // Default to European format
        };

        const locale = getLocaleFromTimezone(timezone);

        const formatter = new Intl.DateTimeFormat(locale, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        const dateTimeStr = formatter.format(startDate);

        return {
            primary: `${humanTime} - ${dateTimeStr}`,
            secondary: `Duration: ${duration}min | Max El: ${pass.peak_altitude?.toFixed(1)}°`
        };
    };

    if (!satelliteId) {
        return null; // Don't show pass selector if no satellite selected
    }

    // Show loading only if actually loading or no passes yet, but NOT if we have passes
    // Even if initialPass doesn't match, show the passes we have
    const isLoading = passesLoading || (satelliteId && passes.length === 0 && !passesLoading);

    return (
        <Box>
            {isLoading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 2 }}>
                    <CircularProgress size={20} />
                    <Typography variant="body2" color="text.secondary">
                        {hasWrongSatellitePasses
                            ? 'Loading passes for selected satellite...'
                            : passesLoading
                                ? 'Loading passes...'
                                : 'Fetching satellite passes...'}
                    </Typography>
                </Box>
            ) : passes.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                    {t('satellite_selector.no_passes_found_in_the_next_24_hours', { defaultValue: 'No passes found in the next 24 hours' })}
                </Typography>
            ) : (
                <Box>
                    <FormControl
                        fullWidth
                        size="small"
                        error={effectiveSelectedPassId && isPassOverlapping(passes.find(p => p.id === effectiveSelectedPassId))}
                        disabled={disabled}
                    >
                        <InputLabel>{t('satellite_selector.select_pass', { defaultValue: 'Select Pass' })}</InputLabel>
                        <Select
                            value={effectiveSelectedPassId || ''}
                            onChange={(e) => {
                                const passId = e.target.value;
                                const selectedPass = passes.find(p => p.id === passId);
                                handlePassClick(selectedPass);
                            }}
                            label={t('satellite_selector.select_pass', { defaultValue: 'Select Pass' })}
                        >
                            {/* Future passes */}
                            {passes.map((pass) => {
                                const info = formatPassInfo(pass);
                                const conflictingObs = getPassConflict(pass);
                                const isOverlapping = conflictingObs !== null;
                                return (
                                    <MenuItem
                                        key={pass.id}
                                        value={pass.id}
                                        disabled={isOverlapping}
                                        sx={isOverlapping ? {
                                            opacity: 0.6,
                                            bgcolor: (theme) => theme.palette.mode === 'dark'
                                                ? 'rgba(244, 67, 54, 0.15)'
                                                : 'rgba(244, 67, 54, 0.08)',
                                            borderLeft: (theme) => `3px solid ${theme.palette.error.main}`,
                                        } : {}}
                                    >
                                        <Box sx={{ width: '100%' }}>
                                            <Typography
                                                variant="body2"
                                                sx={isOverlapping ? {
                                                    color: 'text.disabled',
                                                    textDecoration: 'line-through'
                                                } : {}}
                                            >
                                                {info.primary}
                                            </Typography>
                                            <Typography
                                                variant="caption"
                                                sx={{
                                                    display: 'block',
                                                    color: isOverlapping ? 'error.main' : 'text.secondary'
                                                }}
                                            >
                                                {info.secondary}
                                            </Typography>
                                            {isOverlapping && conflictingObs && (
                                                <Typography
                                                    variant="caption"
                                                    sx={{
                                                        display: 'block',
                                                        color: 'error.main',
                                                        fontWeight: 'bold',
                                                        mt: 0.5,
                                                        fontSize: '0.7rem'
                                                    }}
                                                >
                                                    {t('satellite_selector.conflicts_with', { defaultValue: '⚠️ Conflicts with:' })} {conflictingObs.name || conflictingObs.satellite?.name || 'Unknown'}
                                                </Typography>
                                            )}
                                        </Box>
                                    </MenuItem>
                                );
                            })}
                        </Select>
                    </FormControl>
                </Box>
            )}
        </Box>
    );
};

export const SatelliteSelector = ({
    onSatelliteSelect,
    onTransmittersLoadingChange,
    onPassSelect,
    showPassSelector = true,
    initialSatellite = null,
    initialPass = null,
    currentObservationId = null,
    disabled = false,
}) => {
    const dispatch = useDispatch();
    const { socket } = useSocket();

    return (
        <Stack spacing={2}>
            <SatelliteSearchAutocomplete
                onSatelliteSelect={onSatelliteSelect}
                onTransmittersLoadingChange={onTransmittersLoadingChange}
                disabled={disabled}
                initialSatellite={initialSatellite}
            />
            {showPassSelector && <PassSelector onPassSelect={onPassSelect} initialPass={initialPass} currentObservationId={currentObservationId} disabled={disabled} />}
        </Stack>
    );
};
