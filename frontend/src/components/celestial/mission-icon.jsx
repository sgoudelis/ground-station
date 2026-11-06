import React from 'react';
import { Box, CircularProgress } from '@mui/material';
import { resolveMissionIconPath } from './icon-catalog.js';

const MissionIcon = ({
    missionKey = '',
    size = 24,
    alt = 'mission icon',
    sx = {},
    fallback = null,
}) => {
    const path = resolveMissionIconPath(missionKey, size);
    const numericSize = Number(size);
    const iconSize = Number.isFinite(numericSize) ? numericSize : (size || 24);
    const [failed, setFailed] = React.useState(false);
    const [loaded, setLoaded] = React.useState(false);
    const spinnerSize = Number.isFinite(numericSize)
        ? Math.max(12, Math.min(24, Math.round(numericSize * 0.35)))
        : 18;

    React.useEffect(() => {
        setFailed(false);
        setLoaded(false);
    }, [path]);

    if (!path || failed) return fallback;

    return (
        <Box
            sx={{
                width: iconSize,
                height: iconSize,
                flexShrink: 0,
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                ...sx,
            }}
        >
            {!loaded ? (
                <CircularProgress
                    size={spinnerSize}
                    thickness={5}
                    sx={{
                        color: 'text.secondary',
                        opacity: 0.7,
                        position: 'absolute',
                    }}
                />
            ) : null}
            <Box
                component="img"
                src={path}
                alt={alt}
                loading="lazy"
                onLoad={() => setLoaded(true)}
                onError={() => {
                    setLoaded(false);
                    setFailed(true);
                }}
                sx={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    borderRadius: 0,
                    objectFit: 'contain',
                    opacity: loaded ? 1 : 0,
                    transition: 'opacity 120ms linear',
                }}
            />
        </Box>
    );
};

export default React.memo(MissionIcon);
