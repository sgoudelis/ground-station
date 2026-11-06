import React from 'react';
import { Box, CircularProgress } from '@mui/material';
import {
    resolveSatelliteFallbackPath,
    resolveSatelliteIconPath,
} from './icon-catalog.js';

const SatelliteIcon = ({
    satelliteId = '',
    noradId = '',
    size = 24,
    alt = 'satellite icon',
    sx = {},
    fallback = null,
}) => {
    const resolvedId = satelliteId || noradId;
    const primaryPath = resolveSatelliteIconPath(resolvedId, size);
    const fallbackPath = resolveSatelliteFallbackPath(resolvedId);
    const numericSize = Number(size);
    const iconSize = Number.isFinite(numericSize) ? numericSize : (size || 24);
    const [resolvedPath, setResolvedPath] = React.useState('');
    const [failed, setFailed] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const showImage = Boolean(resolvedPath) && !failed;
    const spinnerSize = Number.isFinite(numericSize)
        ? Math.max(12, Math.min(24, Math.round(numericSize * 0.35)))
        : 18;

    React.useEffect(() => {
        let cancelled = false;
        const fallbackCandidate = fallbackPath && fallbackPath !== primaryPath ? fallbackPath : '';
        const candidates = [primaryPath, fallbackCandidate].filter(Boolean);

        if (candidates.length === 0) {
            setResolvedPath('');
            setFailed(false);
            setLoading(false);
            return () => {
                cancelled = true;
            };
        }

        setResolvedPath('');
        setFailed(false);
        setLoading(true);

        const tryLoadAt = (index) => {
            if (cancelled) return;
            if (index >= candidates.length) {
                setResolvedPath('');
                setFailed(true);
                setLoading(false);
                return;
            }

            const candidate = candidates[index];
            const img = new Image();
            img.onload = () => {
                if (cancelled) return;
                setResolvedPath(candidate);
                setFailed(false);
                setLoading(false);
            };
            img.onerror = () => {
                if (cancelled) return;
                tryLoadAt(index + 1);
            };
            img.src = candidate;
        };

        tryLoadAt(0);

        return () => {
            cancelled = true;
        };
    }, [primaryPath, fallbackPath]);

    if (!showImage && !loading) return fallback;

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
            {loading ? (
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
                src={resolvedPath}
                alt={alt}
                loading="lazy"
                onError={() => {
                    setResolvedPath('');
                    setFailed(true);
                    setLoading(false);
                }}
                sx={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    opacity: showImage ? 1 : 0,
                }}
            />
        </Box>
    );
};

export default React.memo(SatelliteIcon);
