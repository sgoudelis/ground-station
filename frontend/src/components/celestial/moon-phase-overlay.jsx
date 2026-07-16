import React from 'react';
import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { buildMoonShadowPath, getMoonIllumination } from './moonphase.js';

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

const MoonPhaseOverlay = ({ enabled = false }) => {
    const { t } = useTranslation('celestial');
    const reactId = React.useId();
    const clipPathId = `moon-phase-${reactId.replace(/:/g, '')}`;
    const [illumination, setIllumination] = React.useState(() => getMoonIllumination(new Date(), t));

    React.useEffect(() => {
        if (!enabled) return undefined;

        const refresh = () => setIllumination(getMoonIllumination(new Date(), t));
        refresh();
        const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
        return () => window.clearInterval(interval);
    }, [enabled, t]);

    if (!enabled) return null;

    const shadowPath = buildMoonShadowPath(illumination.phase);

    return (
        <Box
            component="svg"
            viewBox="0 0 100 100"
            role="img"
            aria-label={illumination.description}
            title={illumination.description}
            sx={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                pointerEvents: 'none',
                overflow: 'hidden',
            }}
        >
            <defs>
                <clipPath id={clipPathId}>
                    <circle cx="50" cy="50" r="50" />
                </clipPath>
            </defs>
            {shadowPath ? (
                <path
                    d={shadowPath}
                    clipPath={`url(#${clipPathId})`}
                    fill="rgba(0, 0, 0, 0.68)"
                />
            ) : null}
            <circle
                cx="50"
                cy="50"
                r="49"
                fill="none"
                stroke="rgba(255, 255, 255, 0.2)"
                strokeWidth="1.5"
            />
        </Box>
    );
};

export default React.memo(MoonPhaseOverlay);
