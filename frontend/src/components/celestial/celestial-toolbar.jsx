import React from 'react';
import { Box, CircularProgress, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import RefreshIcon from '@mui/icons-material/Refresh';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import PanToolIcon from '@mui/icons-material/PanTool';
import ZoomInMapIcon from '@mui/icons-material/ZoomInMap';
import { ResetZoomIcon } from '../common/custom-icons.jsx';

const CelestialToolbar = ({
    onRefresh,
    onFitAll,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onCenterSun,
    onToggleFullscreen,
    loading,
    loadingText = '',
    fullscreen = false,
    fullscreenLabel,
    exitFullscreenLabel,
    mapDraggingEnabled = true,
    mapZoomingEnabled = true,
    onToggleMapDragging,
    onToggleMapZooming,
    showZoomButtons = true,
    disabled = false,
}) => {
    const { t } = useTranslation('celestial');
    const effectiveFullscreenLabel = fullscreenLabel || t('toolbar.go_fullscreen');
    const effectiveExitFullscreenLabel = exitFullscreenLabel || t('toolbar.exit_fullscreen');

    return (
        <Paper
            elevation={1}
            sx={{
                p: 0,
                display: 'inline-block',
                width: '100%',
                borderBottom: '1px solid',
                borderColor: 'border.main',
                borderRadius: 0,
            }}
        >
            <Box
                sx={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    overflowX: 'auto',
                    msOverflowStyle: 'none',
                    scrollbarWidth: 'none',
                    '&::-webkit-scrollbar': { display: 'none' },
                }}
            >
                <Box sx={{ overflowX: 'auto', minWidth: 0, flex: 1 }}>
                    <Stack direction="row" spacing={0} sx={{ minWidth: 'min-content', flexWrap: 'nowrap' }}>
                        <Tooltip title={t('toolbar.fit_all')}>
                            <span>
                                <IconButton
                                    onClick={onFitAll}
                                    disabled={disabled}
                                    color="primary"
                                    sx={{ borderRadius: 0 }}
                                >
                                    <FitScreenIcon />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title={t('layout_options.options.enable_map_dragging.label')}>
                            <span>
                                <IconButton
                                    onClick={onToggleMapDragging}
                                    disabled={disabled || !onToggleMapDragging}
                                    color={mapDraggingEnabled ? 'warning' : 'primary'}
                                    sx={{ borderRadius: 0 }}
                                    aria-pressed={mapDraggingEnabled}
                                >
                                    <PanToolIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title={t('layout_options.options.enable_map_zooming.label')}>
                            <span>
                                <IconButton
                                    onClick={onToggleMapZooming}
                                    disabled={disabled || !onToggleMapZooming}
                                    color={mapZoomingEnabled ? 'warning' : 'primary'}
                                    sx={{ borderRadius: 0 }}
                                    aria-pressed={mapZoomingEnabled}
                                >
                                    <ZoomInMapIcon />
                                </IconButton>
                            </span>
                        </Tooltip>
                        {showZoomButtons ? (
                            <>
                                <Tooltip title={t('toolbar.zoom_in')}>
                                    <span>
                                        <IconButton
                                            onClick={onZoomIn}
                                            disabled={disabled}
                                            color="primary"
                                            sx={{ borderRadius: 0 }}
                                        >
                                            <ZoomInIcon />
                                        </IconButton>
                                    </span>
                                </Tooltip>
                                <Tooltip title={t('toolbar.zoom_out')}>
                                    <span>
                                        <IconButton
                                            onClick={onZoomOut}
                                            disabled={disabled}
                                            color="primary"
                                            sx={{ borderRadius: 0 }}
                                        >
                                            <ZoomOutIcon />
                                        </IconButton>
                                    </span>
                                </Tooltip>
                                <Tooltip title={t('toolbar.reset_zoom')}>
                                    <span>
                                        <IconButton
                                            onClick={onZoomReset}
                                            disabled={disabled}
                                            color="primary"
                                            sx={{ borderRadius: 0 }}
                                        >
                                            <ResetZoomIcon />
                                        </IconButton>
                                    </span>
                                </Tooltip>
                            </>
                        ) : null}
                        <Tooltip title={t('toolbar.center_on_sun')}>
                            <span>
                                <IconButton
                                    onClick={onCenterSun}
                                    disabled={disabled}
                                    color="primary"
                                    sx={{ borderRadius: 0 }}
                                >
                                    <WbSunnyIcon />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title={t('toolbar.refresh_scene')}>
                            <span>
                                <IconButton
                                    onClick={onRefresh}
                                    disabled={disabled || loading}
                                    color="primary"
                                    sx={{ borderRadius: 0 }}
                                >
                                    <RefreshIcon />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title={fullscreen ? effectiveExitFullscreenLabel : effectiveFullscreenLabel}>
                            <span>
                                <IconButton
                                    onClick={onToggleFullscreen}
                                    disabled={!onToggleFullscreen}
                                    color="primary"
                                    sx={{ borderRadius: 0 }}
                                    aria-label={fullscreen ? effectiveExitFullscreenLabel : effectiveFullscreenLabel}
                                >
                                    {fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Stack>
                </Box>
                <Box sx={{ px: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 32, gap: 0.75 }}>
                    {loading && loadingText ? (
                        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1 }}>
                            {loadingText}
                        </Typography>
                    ) : null}
                    {loading ? <CircularProgress size={16} /> : null}
                </Box>
            </Box>
        </Paper>
    );
};

export default React.memo(CelestialToolbar);
