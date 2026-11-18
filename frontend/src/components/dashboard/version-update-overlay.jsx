
import NewReleasesIcon from '@mui/icons-material/NewReleases';
import { keyframes } from '@emotion/react';
import { Backdrop, Box, Typography, Button, useTheme } from "@mui/material";
import { useSelector, useDispatch } from "react-redux";
import { clearVersionChangeFlag } from './version-slice.jsx';
import { setInitialDataLoading } from './dashboard-slice.jsx';
import { useEffect, useState } from "react";
import { useTranslation } from 'react-i18next';
import { alpha } from '@mui/material/styles';
import CapsButton from '../common/capsbutton.jsx';

// Minimal animations
const fadeIn = keyframes`
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
`;


const COUNTDOWN_DURATION = 5; // 5 seconds

function VersionUpdateOverlay() {
    const dispatch = useDispatch();
    const { t } = useTranslation('dashboard');
    const theme = useTheme();
    const { hasVersionChanged, data } = useSelector((state) => state.version);
    const [countdown, setCountdown] = useState(COUNTDOWN_DURATION);
    const [intervalId, setIntervalId] = useState(null);

    useEffect(() => {
        if (hasVersionChanged) {
            console.log('Version has changed!', data?.version);

            // Start the countdown interval
            const interval = setInterval(() => {
                setCountdown((prev) => {
                    if (prev <= 1) {
                        clearInterval(interval);
                        window.location.reload();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);

            setIntervalId(interval);

            // Cleanup on unmount
            return () => {
                clearInterval(interval);
            };
        }
    }, [hasVersionChanged, data]);

    const handleRefresh = () => {
        // Clear timer
        if (intervalId) clearInterval(intervalId);

        // Reload the page to get the new version
        window.location.reload();
    };

    const handleDismiss = () => {
        // Clear timer
        if (intervalId) clearInterval(intervalId);

        // Keep the page behind the loading overlay until its deferred sync finishes.
        dispatch(setInitialDataLoading(true));
        dispatch(clearVersionChangeFlag());
    };

    // Calculate progress for circular progress (100% at start, 0% at end)
    const progress = countdown <= 0 ? 0 : Math.max(0, (countdown / COUNTDOWN_DURATION) * 100);

    const statusTone = countdown > 2 ? 'success' : countdown > 1 ? 'warning' : 'error';
    const statusColor = theme.palette[statusTone].main;

    return (
        <Backdrop
            open={true}
            sx={{
                zIndex: (theme) => theme.zIndex.drawer + 1,
                backgroundColor: theme.palette.surface.scrim,
                backdropFilter: 'blur(4px)'
            }}
        >
            <Box
                sx={{
                    animation: `${fadeIn} 0.2s ease-out`,
                    backgroundColor: theme.palette.statusSurface[statusTone],
                    border: `1px solid ${alpha(statusColor, theme.palette.mode === 'dark' ? 0.6 : 0.45)}`,
                    borderRadius: 1,
                    padding: 3,
                    minWidth: 320,
                    maxWidth: 370,
                    boxShadow: theme.palette.mode === 'dark'
                        ? '0 8px 24px rgba(0, 0, 0, 0.45)'
                        : '0 8px 24px rgba(15, 23, 42, 0.16)',
                }}
            >
                {/* Header */}
                <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    mb: 2,
                }}>
                    <NewReleasesIcon sx={{ fontSize: 24, color: statusColor }} />
                    <Box sx={{ flex: 1 }}>
                        <Typography
                            variant="subtitle1"
                            sx={{
                                color: 'text.primary',
                                fontWeight: 500,
                                mb: 0.5,
                                fontSize: '1rem'
                            }}
                        >
                            {t('version_update.new_version_available')}
                        </Typography>
                        <Typography
                            variant="body2"
                            sx={{
                                color: 'text.secondary',
                                fontSize: '0.875rem'
                            }}
                        >
                            {t('version_update.version', { version: data?.version })}
                        </Typography>
                    </Box>
                </Box>

                {/* Progress indicator with countdown */}
                <Box
                    sx={{
                        mb: 2,
                    }}
                >
                    <Box
                        sx={{
                            width: '100%',
                            height: 2,
                            backgroundColor: (theme) => theme.palette.state.disabledBg,
                            borderRadius: 1,
                            overflow: 'hidden',
                            position: 'relative',
                            mb: 1.5
                        }}
                    >
                        <Box
                            sx={{
                                height: '100%',
                                width: `${progress}%`,
                                backgroundColor: statusColor,
                                borderRadius: progress > 0 ? 1 : 0,
                                transition: 'background-color 0.3s ease',
                            }}
                        />
                    </Box>

                    <Typography
                        variant="body2"
                        sx={{
                            color: statusColor,
                            fontSize: '0.875rem',
                            textAlign: 'center'
                        }}
                    >
                        {countdown > 0 ? t('version_update.refreshing_in', { seconds: countdown }) : t('version_update.refreshing_now')}
                    </Typography>
                </Box>

                {/* Action buttons */}
                <Box sx={{
                    display: 'flex',
                    gap: 1.5,
                    justifyContent: 'stretch'
                }}>
                    <CapsButton
                        variant="outlined"
                        onClick={handleDismiss}
                        disabled={countdown === 0}
                        fullWidth
                        size="small"
                        sx={{
                            color: 'text.secondary',
                            borderColor: 'border.main',
                            '&:hover': {
                                borderColor: 'border.dark',
                                backgroundColor: (theme) => theme.palette.state.hover,
                            },
                            '&:disabled': {
                                borderColor: 'border.main',
                                color: (theme) => theme.palette.state.disabled,
                            },

                            fontWeight: 500,
                            fontSize: '0.8rem',
                            py: 0.5
                        }}
                    >
                        {t('version_update.cancel')}
                    </CapsButton>
                    <CapsButton
                        variant="contained"
                        onClick={handleRefresh}
                        disabled={countdown === 0}
                        fullWidth
                        size="small"
                        sx={{
                            backgroundColor: statusColor,
                            color: theme.palette.getContrastText(statusColor),
                            '&:hover': {
                                backgroundColor: theme.palette[statusTone].dark,
                                filter: 'brightness(0.9)'
                            },
                            '&:disabled': {
                                backgroundColor: (theme) => theme.palette.state.disabled,
                                color: theme.palette.mode === 'dark' ? '#0f172a' : '#ffffff',
                            },

                            fontWeight: 500,
                            fontSize: '0.8rem',
                            py: 0.5
                        }}
                    >
                        {t('version_update.refresh_now')}
                    </CapsButton>
                </Box>

                {/* Status text */}
                <Typography
                    variant="caption"
                    sx={{
                        color: 'text.secondary',
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        display: 'block',
                        textAlign: 'center',
                        mt: 1.5,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                    }}
                >
                    {/*AUTO-REFRESH*/}
                </Typography>
            </Box>
        </Backdrop>
    );
}

export default VersionUpdateOverlay;
