
import React, { useRef } from 'react';
import { Marker, useMap } from 'react-leaflet';
import {Box,IconButton} from '@mui/material';
import { ThemedLeafletTooltip } from "../common/common.jsx";
import { styled } from '@mui/material/styles';
import { Tooltip as LeafletTooltip } from 'react-leaflet';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import InfoIcon from '@mui/icons-material/Info';
import { useTranslation } from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';
import TargetNumberIcon from '../common/target-number-icon.jsx';
import { useTooltipOrientation } from '../common/tooltip-orientation.js';

// Styled tooltip specifically for tracked satellites
const TrackedSatelliteTooltip = styled(LeafletTooltip)(({ theme }) => ({
    color: theme.palette.text.primary,
    backgroundColor: theme.palette.error.dark,
    borderRadius: theme.shape.borderRadius,
    borderColor: theme.palette.error.main,
    whiteSpace: 'nowrap',
    zIndex: 1000,
    // Leaflet uses different triangle borders per direction class.
    '&.leaflet-tooltip-bottom::before': {
        borderBottomColor: `${theme.palette.error.main} !important`,
    },
    '&.leaflet-tooltip-top::before': {
        borderTopColor: `${theme.palette.error.main} !important`,
    },
    '&.leaflet-tooltip-left::before': {
        borderLeftColor: `${theme.palette.error.main} !important`,
    },
    '&.leaflet-tooltip-right::before': {
        borderRightColor: `${theme.palette.error.main} !important`,
    },
}));

const SatelliteMarker = ({
                             satellite,
                             position,
                             altitude,
                             velocity,
                             isVisible = false,
                             trackingSatelliteId,
                             trackingSatelliteIds = [],
                             targetNumberByNorad = {},
                             isSelected = false,
                             markerEventHandlers,
                             satelliteIcon,
                             opacity = 1,
                             handleSetTrackingOnBackend,
                             onOpenSatelliteInfo,
                         }) => {
    const { t } = useTranslation('earthview');

    const normalizedTrackingIds = Array.isArray(trackingSatelliteIds)
        ? trackingSatelliteIds.map((id) => String(id))
        : (trackingSatelliteId != null ? [String(trackingSatelliteId)] : []);
    const isTracking = normalizedTrackingIds.includes(String(satellite.norad_id));
    const targetNumber = targetNumberByNorad?.[String(satellite.norad_id)] ?? null;
    const map = useMap();
    const markerRef = useRef(null);
    const tooltipAnchorDistance = isTracking ? 15 : (isSelected ? 9 : 12);

    // Choose which tooltip component to use
    const TooltipComponent = isTracking ? TrackedSatelliteTooltip : ThemedLeafletTooltip;
    const {
        direction: tooltipDirection,
        offset: tooltipOffset,
    } = useTooltipOrientation({
        map,
        markerRef,
        position,
        anchorDistance: tooltipAnchorDistance,
        edgePadding: 10,
        // Only interactive tooltips need to avoid map edges dynamically.
        enabled: isTracking || isSelected,
    });

    const handleSetTarget = (e) => {
        e.stopPropagation();
        if (handleSetTrackingOnBackend) {
            handleSetTrackingOnBackend({
                noradId: satellite.norad_id,
                satelliteName: satellite.name,
            });
        }
    };

    const handleOpenSatelliteInfo = (e) => {
        e.stopPropagation();
        onOpenSatelliteInfo?.(satellite);
    };

    return (
        <Marker
            key={`marker-${satellite.norad_id}-${isTracking ? 'tracked' : 'idle'}`}
            position={position}
            icon={satelliteIcon}
            ref={markerRef}
            eventHandlers={markerEventHandlers}
            opacity={opacity}
        >
            <TooltipComponent
                key={`tooltip-${tooltipDirection}-${tooltipOffset[0]}-${tooltipOffset[1]}`}
                direction={tooltipDirection}
                offset={tooltipOffset}
                permanent={true}
                className={"tooltip-satellite"}
                interactive={true}
            >
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {isTracking ? (
                        <Box sx={{
                            display: 'inline-flex',
                            gap: 0.4,
                            alignItems: 'center',
                            maxWidth: 180,
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            lineHeight: 1.2,
                        }}>
                            <TargetNumberIcon
                                targetNumber={targetNumber}
                                prefix="T"
                                size={15}
                                sx={{ flexShrink: 0 }}
                            />
                            <Box
                                component="span"
                                title={satellite.name || '-'}
                                sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                            >
                                {satellite.name || '-'}
                            </Box>
                        </Box>
                    ) : (
                        <strong>
                            {satellite.name} - {parseInt(altitude) + " km, " + velocity.toFixed(2) + " km/s"}
                        </strong>
                    )}
                    {isSelected && !isTracking && (
                        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                            <CapsButton
                                size="small"
                                variant="contained"
                                color="primary"
                                startIcon={<TrackChangesIcon />}
                                onClick={handleSetTarget}
                                sx={{
                                    fontSize: '0.7rem',
                                    py: 0.3,
                                    px: 1,
                                    flex: 1,
                                }}
                            >
                                {t('map_target.set_target')}
                            </CapsButton>
                            <IconButton
                                onClick={handleOpenSatelliteInfo}
                                sx={{
                                    backgroundColor: 'action.hover',
                                    '&:hover': {
                                        backgroundColor: 'action.selected',
                                    },
                                    padding: '4px',
                                }}
                                size="small"
                                title={t('map_target.view_details')}
                            >
                                <InfoIcon fontSize="small" />
                            </IconButton>
                        </Box>
                    )}
                </Box>
            </TooltipComponent>
        </Marker>
    );
};

export default React.memo(SatelliteMarker);
