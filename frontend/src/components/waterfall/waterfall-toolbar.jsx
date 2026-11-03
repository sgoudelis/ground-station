import React from 'react';
import { Paper, Box, Stack, IconButton, Menu, MenuItem, ListItemIcon, Checkbox, ListItemText } from '@mui/material';
import StopIcon from '@mui/icons-material/Stop';
import CheckIcon from '@mui/icons-material/Check';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ErrorIcon from '@mui/icons-material/Error';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import LockIcon from '@mui/icons-material/Lock';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import SelectAllIcon from '@mui/icons-material/SelectAll';
import {
    VFO1Icon,
    VFO2Icon,
    VFO3Icon,
    VFO4Icon,
    ToggleLeftPanelIcon,
    ToggleRightPanelIcon,
    AutoDBIcon,
    AutoScaleOnceIcon,
    SignalPresetsIcon,
    ResetZoomIcon,
    RotatorLinesIcon
} from '../common/custom-icons.jsx';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import { useTranslation } from 'react-i18next';
import { shallowEqual, useSelector, useDispatch } from 'react-redux';
import {
    setRecordingBandSelectionEnabled,
    setShowNeighboringTransmitters,
    setShowBookmarkSource,
} from './waterfall-slice';
import { useTheme } from '@mui/material/styles';
import { BOOKMARK_SOURCE_KEYS, getBookmarkSourceStyle } from './bookmark-source-styles.js';

const WaterfallToolbar = ({
                              startStreamingLoading,
                              playButtonDisabled,
                              startStreaming,
                              stopStreaming,
                              isStreaming,
                              joinedSdrId,
                              showLeftSideWaterFallAccessories,
                              toggleLeftSideWaterFallAccessories,
                              showRightSideWaterFallAccessories,
                              toggleRightSideWaterFallAccessories,
                              autoDBRange,
                              toggleAutoDBRange,
                              autoScale,
                              toggleFullscreen,
                              isFullscreen,
                              handleZoomIn,
                              handleZoomOut,
                              handleZoomReset,
                              vfoColors,
                              vfoActive,
                              toggleVfo,
                              fftDataOverflow,
                              showRotatorDottedLines,
                              toggleRotatorDottedLines,
                              setAutoScalePreset,
                              takeSnapshot
                          }) => {
    const { t } = useTranslation('waterfall');
    const theme = useTheme();
    const dispatch = useDispatch();
    const showNeighboringTransmitters = useSelector((state) => state.waterfall.showNeighboringTransmitters);
    const { isRecording, recordingBandSelectionEnabled } = useSelector((state) => ({
        isRecording: state.waterfall.isRecording,
        recordingBandSelectionEnabled: state.waterfall.recordingBandSelectionEnabled,
    }), shallowEqual);
    const [menuAnchorEl, setMenuAnchorEl] = React.useState(null);
    const [experimentMenuAnchorEl, setExperimentMenuAnchorEl] = React.useState(null);
    const menuOpen = Boolean(menuAnchorEl);
    const experimentMenuOpen = Boolean(experimentMenuAnchorEl);
    const showBookmarkSources = useSelector((state) => state.waterfall.showBookmarkSources);
    const bookmarkSourceState = showBookmarkSources || {
        manual: true,
        satdump: true,
        satnogs: true,
        'gr-satellites': true,
        tinygs: true,
    };
    const visibleSourceCount = BOOKMARK_SOURCE_KEYS.filter((source) => bookmarkSourceState[source] !== false).length;
    const hasSourceFiltering = visibleSourceCount < BOOKMARK_SOURCE_KEYS.length;
    const bookmarkButtonTitle = hasSourceFiltering
        ? `${t('toolbar.bookmark_source_filters', 'Bookmark source filters')} (${visibleSourceCount}/${BOOKMARK_SOURCE_KEYS.length} enabled)`
        : t('toolbar.bookmark_source_filters', 'Bookmark source filters');
    const sourceMenuItems = [
        { key: 'manual', label: t('toolbar.bookmark_source_user_defined', 'User defined') },
        { key: 'satnogs', label: t('toolbar.bookmark_source_satnogs', 'SATNOGS') },
        { key: 'gr-satellites', label: t('toolbar.bookmark_source_gr_satellites', 'gr-satellites') },
        { key: 'satdump', label: t('toolbar.bookmark_source_satdump', 'Satdump') },
        { key: 'tinygs', label: t('toolbar.bookmark_source_tinygs', 'TinyGS') },
    ];
    const autoScalePreset = useSelector((state) => state.waterfall.autoScalePreset);
    const vfoLockedState = useSelector((state) => ({
        vfo1: state.vfo.vfoMarkers?.[1]?.lockedTransmitterId,
        vfo2: state.vfo.vfoMarkers?.[2]?.lockedTransmitterId,
        vfo3: state.vfo.vfoMarkers?.[3]?.lockedTransmitterId,
        vfo4: state.vfo.vfoMarkers?.[4]?.lockedTransmitterId,
    }), shallowEqual);

    const handleMenuClick = (event) => {
        setMenuAnchorEl(event.currentTarget);
    };

    const handleMenuClose = () => {
        setMenuAnchorEl(null);
    };

    const handleExperimentMenuClick = (event) => {
        setExperimentMenuAnchorEl(event.currentTarget);
    };

    const handleExperimentMenuClose = () => {
        setExperimentMenuAnchorEl(null);
    };

    const toggleBookmarkSource = (sourceKey) => {
        const currentValue = bookmarkSourceState[sourceKey] !== false;
        dispatch(setShowBookmarkSource({ source: sourceKey, value: !currentValue }));
    };

    const handleStrongSignals = () => {
        // Set auto-scale preset for strong signals
        setAutoScalePreset('strong');
        handleMenuClose();
    };

    const handleMediumSignals = () => {
        // Set auto-scale preset for medium signals
        setAutoScalePreset('medium');
        handleMenuClose();
    };

    const handleWeakSignals = () => {
        // Set auto-scale preset for weak signals
        setAutoScalePreset('weak');
        handleMenuClose();
    };

    return (
    <Paper elevation={1} sx={{
        p: 0,
        display: 'inline-block',
        width: '100%',
        borderBottom: '1px solid',
        borderColor: 'border.main',
        paddingBottom: '0px',
        borderRadius: 0,
    }}>
        <Box sx={{
            width: '100%',
            overflowX: 'auto',
            msOverflowStyle: 'none',
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' }
        }}>
            <Stack
                direction="row"
                spacing={0}
                sx={{
                    minWidth: 'min-content',
                    flexWrap: 'nowrap'
                }}
            >
                <IconButton
                    loading={startStreamingLoading}
                    disabled={playButtonDisabled}
                    onClick={startStreaming}
                    title={t('toolbar.start_streaming')}
                    sx={{
                        borderRadius: 0,
                        color: 'action.play',
                        '&:hover': {
                            backgroundColor: 'rgba(76, 175, 80, 0.08)',
                        },
                    }}
                >
                    <PlayArrowIcon/>
                </IconButton>

                <IconButton
                    disabled={!isStreaming}
                    onClick={stopStreaming}
                    title={joinedSdrId ? t('toolbar.leave_stream') : t('toolbar.stop_streaming')}
                    sx={{
                        borderRadius: 0,
                        color: 'action.stop',
                        '&:hover': {
                            backgroundColor: 'rgba(244, 67, 54, 0.08)',
                        },
                    }}
                >
                    <StopIcon/>
                </IconButton>


                <IconButton
                    color={showLeftSideWaterFallAccessories ? 'warning' : 'primary'}
                    onClick={toggleLeftSideWaterFallAccessories}
                    size="small"
                    title={t('toolbar.toggle_left_panel')}
                    sx={{
                        borderRadius: 0,
                        '&:hover': {
                        }
                    }}
                >
                    <ToggleLeftPanelIcon/>
                </IconButton>

                <IconButton
                    color={showRightSideWaterFallAccessories ? 'warning' : 'primary'}
                    onClick={toggleRightSideWaterFallAccessories}
                    size="small"
                    title={t('toolbar.toggle_right_panel')}
                    sx={{
                        borderRadius: 0,
                        '&:hover': {
                        }
                    }}
                >
                    <ToggleRightPanelIcon/>
                </IconButton>
                <IconButton
                    onClick={toggleAutoDBRange}
                    size="small"
                    color={autoDBRange ? 'warning' : 'primary'}
                    title={t('toolbar.toggle_auto_db')}
                    sx={{
                        borderRadius: 0,
                        '&:hover': {
                        }
                    }}
                >
                    <AutoDBIcon/>
                </IconButton>

                <IconButton
                    sx={{ borderRadius: 0 }}
                    onClick={autoScale}
                    size="small"
                    color="primary"
                    title={t('toolbar.auto_scale_once')}
                >
                    <AutoScaleOnceIcon/>
                </IconButton>

                <IconButton
                    sx={{ borderRadius: 0 }}
                    onClick={handleMenuClick}
                    size="small"
                    color="primary"
                    title={t('toolbar.signal_strength_presets')}
                >
                    <SignalPresetsIcon />
                </IconButton>

                <IconButton
                    sx={{ borderRadius: 0 }}
                    onClick={handleExperimentMenuClick}
                    size="small"
                    color={hasSourceFiltering ? 'warning' : 'primary'}
                    title={bookmarkButtonTitle}
                >
                    <BookmarkIcon />
                    {hasSourceFiltering ? (
                        <Box
                            sx={{
                                position: 'absolute',
                                top: 7,
                                right: 7,
                                width: 7,
                                height: 7,
                                borderRadius: '50%',
                                bgcolor: 'warning.main',
                                border: '1px solid',
                                borderColor: 'background.paper',
                            }}
                        />
                    ) : null}
                </IconButton>

                <IconButton
                    sx={{ borderRadius: 0 }}
                    onClick={toggleFullscreen}
                    color="primary"
                    title={t('toolbar.toggle_fullscreen')}
                >
                    {isFullscreen ? <FullscreenExitIcon/> : <FullscreenIcon/>}
                </IconButton>
                <IconButton
                    sx={{ borderRadius: 0 }}
                    onClick={handleZoomIn}
                    color="primary"
                    title={t('toolbar.zoom_in')}
                >
                    <ZoomInIcon/>
                </IconButton>

                <IconButton
                    sx={{ borderRadius: 0 }}
                    onClick={handleZoomOut}
                    color="primary"
                    title={t('toolbar.zoom_out')}
                >
                    <ZoomOutIcon/>
                </IconButton>

                <IconButton
                    sx={{ borderRadius: 0 }}
                    onClick={handleZoomReset}
                    color="primary"
                    title={t('toolbar.reset_zoom')}
                >
                    <ResetZoomIcon/>
                </IconButton>

                {/* New toggle button for rotator dotted lines */}
                <IconButton
                    onClick={() => {
                        console.info("before:", showRotatorDottedLines);
                        toggleRotatorDottedLines(!showRotatorDottedLines);
                    }}
                    size="small"
                    color={showRotatorDottedLines ? 'warning' : 'primary'}
                    title={t('toolbar.toggle_rotator_lines')}
                    sx={{
                        borderRadius: 0,
                        '&:hover': {
                        }
                    }}
                >
                    <RotatorLinesIcon/>
                </IconButton>

                {/* Toggle button for neighboring transmitters */}
                <IconButton
                    onClick={() => {
                        dispatch(setShowNeighboringTransmitters(!showNeighboringTransmitters));
                    }}
                    size="small"
                    color={showNeighboringTransmitters ? 'warning' : 'primary'}
                    title={t('toolbar.toggle_neighboring_transmitters')}
                    sx={{
                        borderRadius: 0,
                        '&:hover': {
                        }
                    }}
                >
                    <SatelliteAltIcon/>
                </IconButton>

                {/* Waterfall snapshot button */}
                <IconButton
                    sx={{ borderRadius: 0 }}
                    onClick={takeSnapshot}
                    color="primary"
                    title={t('toolbar.take_snapshot')}
                    disabled={!isStreaming}
                >
                    <CameraAltIcon/>
                </IconButton>

                <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                    <IconButton
                        sx={{
                            borderRadius: 0,
                            width: 40,
                            fontSize: '1.25rem',
                            fontFamily: 'Monospace',
                            fontWeight: 'bold',
                            color: vfoColors[0],
                            backgroundColor: vfoActive[1] ? 'action.selected' : 'transparent',
                            '&:hover': {
                                backgroundColor: vfoActive[1] ? 'action.hover' : undefined,
                            },
                        }}
                        onClick={() => toggleVfo(1)}
                        color={vfoActive[1] ? 'warning' : 'primary'}
                        title={t('toolbar.toggle_vfo', { number: 1 })}
                    >
                        <VFO1Icon/>
                    </IconButton>
                    {vfoLockedState.vfo1 && vfoLockedState.vfo1 !== 'none' && (
                        <LockIcon
                            sx={{
                                position: 'absolute',
                                top: 2,
                                right: 2,
                                fontSize: '0.75rem',
                                pointerEvents: 'none',
                                color: 'warning.main',
                            }}
                        />
                    )}
                </Box>

                <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                    <IconButton
                        sx={{
                            borderRadius: 0,
                            width: 40,
                            fontSize: '1.25rem',
                            fontFamily: 'Monospace',
                            fontWeight: 'bold',
                            color: vfoColors[1],
                            backgroundColor: vfoActive[2] ? 'action.selected' : 'transparent',
                            '&:hover': {
                                backgroundColor: vfoActive[2] ? 'action.hover' : undefined,
                            },
                        }}
                        onClick={() => toggleVfo(2)}
                        color={vfoActive[2] ? 'warning' : 'primary'}
                        title={t('toolbar.toggle_vfo', { number: 2 })}
                    >
                        <VFO2Icon/>
                    </IconButton>
                    {vfoLockedState.vfo2 && vfoLockedState.vfo2 !== 'none' && (
                        <LockIcon
                            sx={{
                                position: 'absolute',
                                top: 2,
                                right: 2,
                                fontSize: '0.75rem',
                                pointerEvents: 'none',
                                color: 'warning.main',
                            }}
                        />
                    )}
                </Box>

                <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                    <IconButton
                        sx={{
                            borderRadius: 0,
                            width: 40,
                            fontSize: '1.25rem',
                            fontFamily: 'Monospace',
                            fontWeight: 'bold',
                            color: vfoColors[2],
                            backgroundColor: vfoActive[3] ? 'action.selected' : 'transparent',
                            '&:hover': {
                                backgroundColor: vfoActive[3] ? 'action.hover' : undefined,
                            },
                        }}
                        onClick={() => toggleVfo(3)}
                        color={vfoActive[3] ? 'warning' : 'primary'}
                        title={t('toolbar.toggle_vfo', { number: 3 })}
                    >
                        <VFO3Icon/>
                    </IconButton>
                    {vfoLockedState.vfo3 && vfoLockedState.vfo3 !== 'none' && (
                        <LockIcon
                            sx={{
                                position: 'absolute',
                                top: 2,
                                right: 2,
                                fontSize: '0.75rem',
                                pointerEvents: 'none',
                                color: 'warning.main',
                            }}
                        />
                    )}
                </Box>

                <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                    <IconButton
                        sx={{
                            borderRadius: 0,
                            width: 40,
                            fontSize: '1.25rem',
                            fontFamily: 'Monospace',
                            fontWeight: 'bold',
                            color: vfoColors[3],
                            backgroundColor: vfoActive[4] ? 'action.selected' : 'transparent',
                            '&:hover': {
                                backgroundColor: vfoActive[4] ? 'action.hover' : undefined,
                            },
                        }}
                        onClick={() => toggleVfo(4)}
                        color={vfoActive[4] ? 'warning' : 'primary'}
                        title={t('toolbar.toggle_vfo', { number: 4 })}
                    >
                        <VFO4Icon/>
                    </IconButton>
                    {vfoLockedState.vfo4 && vfoLockedState.vfo4 !== 'none' && (
                        <LockIcon
                            sx={{
                                position: 'absolute',
                                top: 2,
                                right: 2,
                                fontSize: '0.75rem',
                                pointerEvents: 'none',
                                color: 'warning.main',
                            }}
                        />
                    )}
                </Box>

                {fftDataOverflow && (
                    <IconButton
                        sx={{
                            borderRadius: 0,
                            ml: 1,
                            backgroundColor: 'error.main',
                            opacity: 0.15,
                            '&:hover': {
                                backgroundColor: 'error.main',
                                opacity: 0.25,
                            }
                        }}
                        color="error"
                        title={t('toolbar.fft_overflow')}
                        disabled
                    >
                        <ErrorIcon />
                    </IconButton>
                )}

                <IconButton
                    sx={{ borderRadius: 0 }}
                    onClick={() => dispatch(setRecordingBandSelectionEnabled(!recordingBandSelectionEnabled))}
                    color={recordingBandSelectionEnabled ? 'warning' : 'primary'}
                    title={recordingBandSelectionEnabled
                        ? t('toolbar.disable_recording_band', 'Disable recording-band selection')
                        : t('toolbar.enable_recording_band', 'Enable recording-band selection')}
                    aria-pressed={recordingBandSelectionEnabled}
                    disabled={isRecording}
                >
                    <SelectAllIcon />
                </IconButton>
            </Stack>
        </Box>

        <Menu
            anchorEl={menuAnchorEl}
            open={menuOpen}
            onClose={handleMenuClose}
            anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'left',
            }}
            transformOrigin={{
                vertical: 'top',
                horizontal: 'left',
            }}
            PaperProps={{
                sx: {
                    minWidth: 180,
                    '& .MuiMenuItem-root': {
                        py: 0.25,
                        minHeight: 32,
                    },
                    '& .MuiListItemIcon-root': {
                        minWidth: 32,
                    },
                    '& .MuiCheckbox-root': {
                        p: 0.25,
                    },
                },
            }}
            MenuListProps={{
                dense: true,
                sx: {
                    py: 0.25,
                },
            }}
        >
            <MenuItem onClick={handleStrongSignals}>
                <ListItemIcon>
                    {autoScalePreset === 'strong' ? <CheckIcon fontSize="small" /> : <Box sx={{ width: 20 }} />}
                </ListItemIcon>
                {t('toolbar.preset_strong_signals')}
            </MenuItem>
            <MenuItem onClick={handleMediumSignals}>
                <ListItemIcon>
                    {autoScalePreset === 'medium' ? <CheckIcon fontSize="small" /> : <Box sx={{ width: 20 }} />}
                </ListItemIcon>
                {t('toolbar.preset_medium_signals')}
            </MenuItem>
            <MenuItem onClick={handleWeakSignals}>
                <ListItemIcon>
                    {autoScalePreset === 'weak' ? <CheckIcon fontSize="small" /> : <Box sx={{ width: 20 }} />}
                </ListItemIcon>
                {t('toolbar.preset_weak_signals')}
            </MenuItem>
        </Menu>

        <Menu
            anchorEl={experimentMenuAnchorEl}
            open={experimentMenuOpen}
            onClose={handleExperimentMenuClose}
            anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'left',
            }}
            transformOrigin={{
                vertical: 'top',
                horizontal: 'left',
            }}
            PaperProps={{
                sx: {
                    minWidth: 180,
                    '& .MuiMenuItem-root': {
                        py: 0.25,
                        minHeight: 32,
                    },
                    '& .MuiListItemIcon-root': {
                        minWidth: 32,
                    },
                    '& .MuiCheckbox-root': {
                        p: 0.25,
                    },
                },
            }}
            MenuListProps={{
                dense: true,
                sx: {
                    py: 0.25,
                },
            }}
        >
            {sourceMenuItems.map((sourceItem) => {
                const sourceStyle = getBookmarkSourceStyle(sourceItem.key, theme);
                return (
                    <MenuItem key={sourceItem.key} onClick={() => toggleBookmarkSource(sourceItem.key)}>
                        <ListItemIcon>
                            <Checkbox
                                edge="start"
                                checked={bookmarkSourceState[sourceItem.key] !== false}
                                tabIndex={-1}
                                disableRipple
                            />
                        </ListItemIcon>
                        <ListItemText
                            primary={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Box
                                        sx={{
                                            width: 9,
                                            height: 9,
                                            borderRadius: '50%',
                                            bgcolor: sourceStyle.accent,
                                            border: '1px solid',
                                            borderColor: 'divider',
                                            flexShrink: 0,
                                        }}
                                    />
                                    {sourceItem.label}
                                </Box>
                            }
                        />
                    </MenuItem>
                );
            })}
        </Menu>
    </Paper>
    );
};

export default React.memo(WaterfallToolbar);
