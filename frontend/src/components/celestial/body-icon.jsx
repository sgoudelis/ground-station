import React from 'react';
import { Box, CircularProgress } from '@mui/material';
import { resolveBodyIconPath } from './icon-catalog.js';
import MoonPhaseOverlay from './moon-phase-overlay.jsx';

const isMoonBodyId = (bodyId) => {
    const normalized = String(bodyId || '')
        .trim()
        .toLowerCase()
        .replace(/^body:/, '')
        .replace(/[_\s]+/g, '-');
    return normalized === 'moon' || normalized === 'luna';
};

const BodyIcon = ({
    bodyId = '',
    size = 24,
    alt = 'body icon',
    sx = {},
    fallback = null,
    showMoonPhase = false,
}) => {
    const path = resolveBodyIconPath(bodyId, size);
    const numericSize = Number(size);
    const iconSize = Number.isFinite(numericSize) ? numericSize : (size || 24);
    const shouldShowMoonPhase = Boolean(showMoonPhase && isMoonBodyId(bodyId));
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
                    borderRadius: '50%',
                    objectFit: 'cover',
                    opacity: loaded ? 1 : 0,
                    transition: 'opacity 120ms linear',
                }}
            />
            <MoonPhaseOverlay enabled={shouldShowMoonPhase && loaded} />
        </Box>
    );
};

export default React.memo(BodyIcon);
