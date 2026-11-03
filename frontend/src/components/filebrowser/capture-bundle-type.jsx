/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React from 'react';
import {Chip} from '@mui/material';
import FlightIcon from '@mui/icons-material/Flight';
import FolderIcon from '@mui/icons-material/Folder';
import {useTranslation} from 'react-i18next';
import {MeshtasticIcon, WeatherBalloonIcon} from '../common/custom-icons.jsx';

// Cards and table rows share one identity, including thumbnail overlays.
const BUNDLE_TYPES = {
    adsb: {label: 'Aircraft · ADS-B', color: 'info', Icon: FlightIcon},
    radiosonde: {label: 'Radiosonde', color: 'warning', Icon: WeatherBalloonIcon},
    meshtastic: {label: 'Meshtastic node', color: 'success', Icon: MeshtasticIcon},
};

export function getCaptureBundleType(item) {
    return item.type === 'decoded_folder' ? BUNDLE_TYPES[item.folder_kind] : null;
}

export const CaptureBundleIcon = React.forwardRef(function CaptureBundleIcon({item, sx, ...props}, ref) {
    const type = getCaptureBundleType(item);
    const Icon = type?.Icon || FolderIcon;
    return <Icon {...props} ref={ref} sx={{color: `${type?.color || 'warning'}.main`, ...sx}} />;
});

export function CaptureBundleBadge({item, sx}) {
    const {t} = useTranslation('filebrowser');
    const type = getCaptureBundleType(item);
    if (!type) return null;
    return <Chip
        icon={<type.Icon />}
        label={t(`bundle_types.${item.folder_kind}`, {defaultValue: type.label})}
        color={type.color}
        size="small"
        variant="outlined"
        sx={{
            maxWidth: '100%',
            height: '20px',
            fontSize: '0.65rem',
            '& .MuiChip-label': {px: 0.75},
            '& .MuiChip-icon': {fontSize: '0.85rem'},
            ...sx,
        }}
    />;
}
