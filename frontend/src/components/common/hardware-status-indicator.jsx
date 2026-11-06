/** Copyright (c) 2026 Efstratios Goudelis, GPL-3.0-or-later */
import {Box, Tooltip} from '@mui/material';
import RadioOutlinedIcon from '@mui/icons-material/RadioOutlined';
import {SatelliteIcon} from 'hugeicons-react';
import {useTranslation} from 'react-i18next';
import {resolveHardwarePresentation} from './hardware-status-presentation.jsx';

export function HardwareDeviceIcon({kind, sx}) {
    return kind === 'rotator'
        ? <Box component={SatelliteIcon} aria-hidden="true" sx={{width: 18, height: 18, flexShrink: 0, ...sx}} />
        : <RadioOutlinedIcon aria-hidden="true" sx={{fontSize: 18, flexShrink: 0, ...sx}} />;
}

export default function HardwareStatusIndicator({kind, status, compact = false, showDevice = false, sx, ...props}) {
    const {t} = useTranslation('common');
    const {Icon, label, fullLabel, tone, bgColor, borderColor, iconColor, spinning} =
        resolveHardwarePresentation({source: kind, status, t});

    return <Tooltip title={fullLabel} describeChild enterTouchDelay={0}>
        <Box component="span" aria-label={fullLabel} data-hardware-kind={kind} data-status={status} data-tone={tone}
            {...props} sx={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 0.45,
                minWidth: compact ? 20 : 0, height: compact ? 20 : 23, px: compact ? 0.45 : 0.75,
                borderRadius: 1, border: '1px solid', borderColor, bgcolor: bgColor, color: iconColor,
                fontSize: '0.68rem', fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap', flexShrink: 0,
                ...sx,
            }}>
            {showDevice && <HardwareDeviceIcon kind={kind} sx={{width: 12, height: 12, fontSize: 12, opacity: 0.8}} />}
            <Icon sx={{fontSize: compact ? 13 : 15,
                animation: spinning ? 'hardware-status-spin 1s linear infinite' : 'none',
                '@keyframes hardware-status-spin': {to: {transform: 'rotate(360deg)'}},
                '@media (prefers-reduced-motion: reduce)': {animation: 'none'},
            }} />
            {!compact && label}
        </Box>
    </Tooltip>;
}
