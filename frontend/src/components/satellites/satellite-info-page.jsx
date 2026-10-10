/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import {Accordion, AccordionDetails, AccordionSummary, Box, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Tooltip, Typography} from "@mui/material";
import {
    betterStatusValue,
    getFrequencyBand,
    humanizeAltitude,
    humanizeLatitude,
    humanizeLongitude,
    humanizeVelocity,
    renderCountryFlagsCSV,
} from "../common/common.jsx";
import Button from "@mui/material/Button";
import * as React from "react";
import {useEffect, useState} from "react";
import Grid from "@mui/material/Grid";
import {shallowEqual, useDispatch, useSelector} from "react-redux";
import {
    setClickedSatellite,
    fetchSatellite,
    deleteSatellite
} from "./satellite-slice.jsx";
import {useSocket} from "../common/socket.jsx";
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import SatelliteMapContainer from "./satellite-map.jsx";
import TransmittersTable from "./transmitters-table.jsx";
import SatelliteEditDialog from "./satellite-edit-dialog.jsx";
import TransmittersDialog from "./transmitters-dialog.jsx";
import { useSatelliteTargetAction } from '../target/use-satellite-target-action.jsx';
import { useParams, useNavigate } from 'react-router';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import EditIcon from '@mui/icons-material/Edit';
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import { useTranslation } from 'react-i18next';
import { formatAlternativeSatelliteNames } from '../common/satellite-names.js';
import { formatDateTime } from '../../utils/date-time.js';
import { useSatelliteLiveOrbit } from '../../hooks/liveorbit.js';
import SatellitePasses from './satellite-passes.jsx';


// Fix for default markers in react-leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const SatelliteInfoField = ({ label, children, inline = false }) => (
    <Box sx={{
        minWidth: 0,
        ...(inline && {
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 46%) minmax(0, 1fr)',
            alignItems: 'baseline',
            columnGap: 1,
        }),
    }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: inline ? 0 : 0.25 }}>
            {String(label).replace(/[:：]\s*$/, '')}
        </Typography>
        <Typography component="div" variant="body2" sx={{ overflowWrap: 'anywhere', textAlign: inline ? 'right' : 'left' }}>
            {children || '—'}
        </Typography>
    </Box>
);

const getSatelliteBands = (transmitters, lowKey, highKey) => {
    const bands = new Set();
    for (const transmitter of transmitters) {
        for (const frequency of [transmitter[lowKey], transmitter[highKey]]) {
            const band = getFrequencyBand(frequency);
            if (band !== 'Unknown') bands.add(band);
        }
    }
    return [...bands].sort();
};

const SatelliteIdentityHeader = ({ satelliteData, trailingAction = null, inDialog = false }) => {
    const { t } = useTranslation('satellites');
    const [imageError, setImageError] = useState(false);
    const aliases = formatAlternativeSatelliteNames(satelliteData.alternative_name, satelliteData.name_other);

    // A reused dialog can switch satellites without unmounting its header.
    useEffect(() => {
        setImageError(false);
    }, [satelliteData.norad_id]);

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                ...(!inDialog && {
                    p: { xs: 1.5, sm: 2 },
                    mb: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2,
                    bgcolor: 'background.paper',
                }),
            }}
        >
            <Box
                sx={{
                    width: { xs: 64, sm: 80 },
                    height: { xs: 64, sm: 80 },
                    flexShrink: 0,
                    display: 'grid',
                    placeItems: 'center',
                    overflow: 'hidden',
                    borderRadius: 1.5,
                    bgcolor: 'background.elevated',
                }}
            >
                {imageError ? (
                    <SatelliteAltIcon sx={{ fontSize: 36, color: 'text.secondary' }} />
                ) : (
                    <Box
                        component="img"
                        src={'/satimages/full/' + satelliteData.norad_id + '.png'}
                        alt={satelliteData.name}
                        onError={() => setImageError(true)}
                        sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                )}
            </Box>
            <Stack spacing={0.75} sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap" useFlexGap>
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                        {satelliteData.name}
                    </Typography>
                    {betterStatusValue(satelliteData.status)}
                </Stack>
                <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap" useFlexGap>
                    <Chip size="small" variant="outlined" label={'NORAD ' + satelliteData.norad_id} />
                    {aliases && (
                        <Typography variant="body2" color="text.secondary">
                            {t('satellite_info.also_known_as', { names: aliases })}
                        </Typography>
                    )}
                </Stack>
            </Stack>
            {trailingAction}
        </Box>
    );
};


// Core satellite info content component
const SatelliteInfoContent = ({
    satelliteData,
    livePosition = null,
    asDialog = false,
    onClose = null,
    onSetAsTarget = null,
    isCurrentlyTargeted = false,
    onEditSatellite = null,
    onManageTransmitters = null,
    showDeleteButton = true,
    deleteButtonSlot = null,
    liveUpdatesEnabled = true,
}) => {
    const { t } = useTranslation('satellites');
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const navigate = useNavigate();
    const [currentTransmitters, setCurrentTransmitters] = useState(() => (
        Array.isArray(satelliteData?.transmitters) ? satelliteData.transmitters : []
    ));
    const [deleteSatelliteConfirmOpen, setDeleteSatelliteConfirmOpen] = useState(false);

    // Get timezone preference
    const timezone = useSelector((state) => {
        const tzPref = state.preferences?.preferences?.find(p => p.name === 'timezone');
        return tzPref?.value || 'UTC';
    });
    const observerLocation = useSelector((state) => ({
        lat: state.location?.location?.lat,
        lon: state.location?.location?.lon,
        alt: state.location?.altitude ?? state.location?.location?.alt ?? 0,
    }), shallowEqual);
    const liveOrbit = useSatelliteLiveOrbit(satelliteData, {
        enabled: liveUpdatesEnabled,
        observer: observerLocation,
    });

    useEffect(() => {
        setCurrentTransmitters(Array.isArray(satelliteData?.transmitters) ? satelliteData.transmitters : []);
    }, [satelliteData?.norad_id, satelliteData?.transmitters]);

    const uplinkBands = getSatelliteBands(currentTransmitters, 'uplink_low', 'uplink_high');
    const downlinkBands = getSatelliteBands(currentTransmitters, 'downlink_low', 'downlink_high');
    const hasTleElements = Boolean(satelliteData?.tle1 && satelliteData?.tle2);
    const isOmmOrbit = String(satelliteData?.orbit_model_kind || satelliteData?.orbit_format || '').toLowerCase() === 'omm';
    const orbitFormat = satelliteData?.orbit_model_kind || satelliteData?.orbit_format || (hasTleElements ? 'tle' : '');
    const formatSatelliteDate = (value) => value ? formatDateTime(value, { timezone }) || '—' : '—';
    const rawOmmData = isOmmOrbit && satelliteData?.orbit_payload
        ? (typeof satelliteData.orbit_payload === 'string'
            ? satelliteData.orbit_payload
            : JSON.stringify(satelliteData.orbit_payload, null, 2))
        : '';
    const tleLines = [satelliteData?.tle1, satelliteData?.tle2].filter(Boolean).join('\n');
    // The shared propagator owns ground position and station-relative angles.
    // Earth View may provide a newer observer angle sample, so apply it last.
    const position = {
        ...(satelliteData?.position || {}),
        ...(liveOrbit.position || {}),
        ...(livePosition || {}),
    };
    const hasPosition = ['lat', 'lon', 'alt', 'vel', 'az', 'el'].some((key) => Number.isFinite(position[key]));
    const hasCatalogDetails = Boolean(
        satelliteData?.sat_id || satelliteData?.added || satelliteData?.updated
        || satelliteData?.associated_satellites || satelliteData?.website || satelliteData?.citation
        || satelliteData?.orbit_source_object_id
        || typeof satelliteData?.is_frequency_violator === 'boolean'
    );
    const formatAngle = (value) => Number.isFinite(value) ? `${value.toFixed(1)}°` : null;
    const yesOrNo = (value) => t(`common:${value ? 'yes' : 'no'}`);

    const renderTextWithClickableLinks = (text) => {
        if (!text || text === '-') return '-';

        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const parts = text.split(urlRegex);

        return parts.map((part, index) => {
            if (urlRegex.test(part)) {
                return (
                    <a
                        key={index}
                        href={part}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{textDecoration: 'underline'}}
                    >
                        {part}
                    </a>
                );
            }
            return part;
        });
    };

    if (satelliteData?.norad_id == null) {
        return (
            <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography>{t('satellite_info.transmitters.no_data')}</Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {/* Delete button - render in slot if provided, otherwise show here */}
            {showDeleteButton && !deleteButtonSlot && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                    <Button
                        variant="contained"
                        color="error"
                        onClick={() => setDeleteSatelliteConfirmOpen(true)}
                    >
                        {t('satellite_info.delete_satellite')}
                    </Button>
                </Box>
            )}

            {/* Delete confirmation dialog */}
            <Dialog
                open={deleteSatelliteConfirmOpen}
                onClose={() => setDeleteSatelliteConfirmOpen(false)}
                maxWidth="sm"
                fullWidth
                PaperProps={{
                    sx: {
                        bgcolor: 'background.paper',
                        borderRadius: 2,
                    }
                }}
            >
                <DialogTitle
                    sx={{
                        bgcolor: 'error.main',
                        color: 'error.contrastText',
                        fontSize: '1.125rem',
                        fontWeight: 600,
                        py: 2,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                    }}
                >
                    <Box
                        component="span"
                        sx={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            bgcolor: 'error.contrastText',
                            color: 'error.main',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'bold',
                            fontSize: '1rem',
                        }}
                    >
                        !
                    </Box>
                    {t('satellite_info.delete_confirm_title')}
                </DialogTitle>
                <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                    <Typography variant="body1" sx={{ mt: 2, mb: 2, color: 'text.primary' }}>
                        {t('satellite_info.delete_confirm_message')}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
                        {t('satellite_info_page.satellite_to_be_deleted', { defaultValue: 'Satellite to be deleted:' })}
                    </Typography>
                    <Box sx={{
                        p: 2,
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                        borderRadius: 1,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                    }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
                            {satelliteData.name}
                        </Typography>
                        <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, columnGap: 2 }}>
                            <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                {t('satellite_info_page.norad_id', { defaultValue: 'NORAD ID:' })}
                            </Typography>
                            <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                {satelliteData.norad_id}
                            </Typography>

                            {satelliteData.status && (
                                <>
                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                        {t('satellite_info_page.status', { defaultValue: 'Status:' })}
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                        {betterStatusValue(satelliteData.status)}
                                    </Typography>
                                </>
                            )}

                            {satelliteData.countries && (
                                <>
                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                        {t('satellite_info_page.countries', { defaultValue: 'Countries:' })}
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                        {renderCountryFlagsCSV(satelliteData.countries)}
                                    </Typography>
                                </>
                            )}

                            {satelliteData.transmitters && satelliteData.transmitters.length > 0 && (
                                <>
                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                        {t('satellite_info_page.transmitters', { defaultValue: 'Transmitters:' })}
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'warning.main', fontWeight: 500 }}>
                                        {satelliteData.transmitters.length} {t('satellite_info_page.transmitter_s_will_also_be_deleted', { defaultValue: 'transmitter(s) will also be deleted' })}
                                    </Typography>
                                </>
                            )}
                        </Box>
                    </Box>
                </DialogContent>
                <DialogActions
                    sx={{
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                        borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                        px: 3,
                        py: 2,
                        gap: 1.5,
                    }}
                >
                    <Button
                        onClick={() => setDeleteSatelliteConfirmOpen(false)}
                        variant="outlined"
                        color="inherit"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 500,
                        }}
                    >
                        {t('satellite_info.transmitters.cancel')}
                    </Button>
                    <Button
                        variant="contained"
                        color="error"
                        onClick={async () => {
                            try {
                                await dispatch(deleteSatellite({
                                    socket,
                                    noradId: satelliteData.norad_id
                                })).unwrap();
                                if (!asDialog) {
                                    navigate('/admin/satellites/catalog');
                                } else if (onClose) {
                                    onClose();
                                }
                                toast.success(t('satellite_info.delete_success'));
                            } catch (error) {
                                console.error('Failed to delete satellite:', error);
                                toast.error(t('satellite_info.delete_failed', { error }));
                            }
                            setDeleteSatelliteConfirmOpen(false);
                        }}
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 600,
                        }}
                    >
                        {t('satellite_info.transmitters.delete')}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Render delete button in custom slot if provided */}
            {deleteButtonSlot && deleteButtonSlot(() => setDeleteSatelliteConfirmOpen(true))}

            {!asDialog && <SatelliteIdentityHeader satelliteData={satelliteData} />}

            {asDialog && (
                <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    gap={1}
                    flexWrap={{ sm: 'wrap' }}
                    useFlexGap
                    sx={{ mb: 2, alignItems: { xs: 'stretch', sm: 'center' } }}
                >
                    <Button
                        variant="contained"
                        color="primary"
                        startIcon={<SatelliteAltIcon />}
                        disabled={isCurrentlyTargeted}
                        onClick={onSetAsTarget}
                        sx={{ width: { xs: '100%', sm: 'auto' } }}
                    >
                        {isCurrentlyTargeted
                            ? t('earthview:satellite_info.currently_targeted')
                            : t('earthview:satellite_info.set_as_target')}
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<EditIcon />}
                        onClick={onEditSatellite}
                        sx={{ width: { xs: '100%', sm: 'auto' } }}
                    >
                        {t('edit_satellite')}
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<SettingsInputAntennaIcon />}
                        onClick={onManageTransmitters}
                        sx={{ width: { xs: '100%', sm: 'auto' } }}
                    >
                        {t('satellite_info.manage_transmitters')}
                    </Button>
                </Stack>
            )}

            <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid size={{ xs: 12, md: asDialog ? 6 : 8 }}>
                    <Box
                        sx={{
                            height: '100%',
                            overflow: 'hidden',
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 2,
                            bgcolor: 'background.paper',
                        }}
                    >
                        <Typography
                            variant="subtitle1"
                            sx={{
                                px: 1,
                                py: 0.5,
                                display: 'flex',
                                alignItems: 'center',
                                boxSizing: 'border-box',
                                fontWeight: 600,
                            }}
                        >
                            {t('satellite_info.coverage_map')}
                        </Typography>
                        <Box
                            data-testid="satellite-coverage-map-region"
                            sx={{ height: { xs: 290, sm: 340, md: 380 }, bgcolor: 'background.default' }}
                        >
                            {liveOrbit.available ? (
                                <SatelliteMapContainer satelliteData={satelliteData} liveOrbit={liveOrbit} />
                            ) : (
                                <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 3 }}>
                                    <Typography variant="body2" color="text.secondary" align="center">
                                        {t('satellite_info.map_orbit_unavailable', {
                                            defaultValue: 'No usable Earth orbit is available for this satellite.',
                                        })}
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    </Box>
                </Grid>
                <Grid size={{ xs: 12, md: asDialog ? 6 : 4 }}>
                    <Box
                        sx={{
                            height: '100%',
                            p: 2,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 2,
                            bgcolor: 'background.paper',
                        }}
                    >
                        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
                            {t('satellite_info.mission_and_orbit')}
                        </Typography>
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 1 }}>
                            <SatelliteInfoField inline label={t('satellite_info.fields.operator')}>
                                {satelliteData.operator}
                            </SatelliteInfoField>
                            <SatelliteInfoField inline label={t('satellite_info.fields.countries')}>
                                {satelliteData.countries && renderCountryFlagsCSV(satelliteData.countries)}
                            </SatelliteInfoField>
                            <SatelliteInfoField inline label={t('satellite_info.fields.launched')}>
                                {formatSatelliteDate(satelliteData.launched)}
                            </SatelliteInfoField>
                            {satelliteData.deployed && (
                                <SatelliteInfoField inline label={t('satellite_info.fields.deployed')}>
                                    {formatSatelliteDate(satelliteData.deployed)}
                                </SatelliteInfoField>
                            )}
                            {satelliteData.decayed && (
                                <SatelliteInfoField inline label={t('satellite_info.fields.decayed')}>
                                    {formatSatelliteDate(satelliteData.decayed)}
                                </SatelliteInfoField>
                            )}
                            <SatelliteInfoField inline label={t('satellite_database.source')}>
                                {satelliteData.source}
                            </SatelliteInfoField>
                            <SatelliteInfoField inline label={t('satellite_info.orbit_format')}>
                                {orbitFormat && String(orbitFormat).toUpperCase()}
                            </SatelliteInfoField>
                            {satelliteData.orbit_central_body && (
                                <SatelliteInfoField inline label={t('satellite_info.orbit_central_body')}>
                                    {satelliteData.orbit_central_body}
                                </SatelliteInfoField>
                            )}
                            {typeof satelliteData.is_geostationary === 'boolean' && (
                                <SatelliteInfoField inline label={t('satellite_info.geostationary')}>
                                    {yesOrNo(satelliteData.is_geostationary)}
                                </SatelliteInfoField>
                            )}
                            <SatelliteInfoField inline label={t('satellite_database.orbit_epoch_short')}>
                                {formatSatelliteDate(satelliteData.orbit_epoch)}
                            </SatelliteInfoField>
                            <SatelliteInfoField inline label={t('satellite_info.orbit_fetched')}>
                                {formatSatelliteDate(satelliteData.orbit_fetched_at)}
                            </SatelliteInfoField>
                            {satelliteData.orbit_changed_at && (
                                <SatelliteInfoField inline label={t('satellite_info.orbit_changed')}>
                                    {formatSatelliteDate(satelliteData.orbit_changed_at)}
                                </SatelliteInfoField>
                            )}
                            {satelliteData.orbit_first_seen_at && (
                                <SatelliteInfoField inline label={t('satellite_info.orbit_first_seen')}>
                                    {formatSatelliteDate(satelliteData.orbit_first_seen_at)}
                                </SatelliteInfoField>
                            )}
                            {satelliteData.orbit_source_updated_at && (
                                <SatelliteInfoField inline label={t('satellite_info.orbit_source_updated')}>
                                    {formatSatelliteDate(satelliteData.orbit_source_updated_at)}
                                </SatelliteInfoField>
                            )}
                        </Box>
                    </Box>
                </Grid>
            </Grid>

            {(hasPosition || hasCatalogDetails) && (
                <Grid container spacing={2} sx={{ mb: 2 }}>
                    {hasPosition && (
                        <Grid size={{ xs: 12, md: hasCatalogDetails ? 6 : 12 }}>
                            <Box sx={{
                                p: 1.5,
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 2,
                                bgcolor: 'background.paper',
                            }}>
                                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                                    {liveOrbit.available
                                        ? t('satellite_info.live_position', { defaultValue: 'Live position' })
                                        : t('satellite_info.position_snapshot')}
                                </Typography>
                                <Box sx={{ display: 'grid', gap: 0.75 }}>
                                    {Number.isFinite(position.lat) && (
                                        <SatelliteInfoField inline label={t('satellite_info.latitude')}>
                                            {humanizeLatitude(position.lat)}
                                        </SatelliteInfoField>
                                    )}
                                    {Number.isFinite(position.lon) && (
                                        <SatelliteInfoField inline label={t('satellite_info.longitude')}>
                                            {humanizeLongitude(position.lon)}
                                        </SatelliteInfoField>
                                    )}
                                    {Number.isFinite(position.alt) && (
                                        <SatelliteInfoField inline label={t('satellite_info.altitude')}>
                                            {humanizeAltitude(position.alt, 1, 'km', true)}
                                        </SatelliteInfoField>
                                    )}
                                    {Number.isFinite(position.vel) && (
                                        <SatelliteInfoField inline label={t('satellite_info.velocity')}>
                                            {humanizeVelocity(position.vel, 2, 'km/s', true)}
                                        </SatelliteInfoField>
                                    )}
                                    {Number.isFinite(position.az) && (
                                        <SatelliteInfoField inline label={t('satellite_info.azimuth')}>
                                            {formatAngle(position.az)}
                                        </SatelliteInfoField>
                                    )}
                                    {Number.isFinite(position.el) && (
                                        <>
                                            <SatelliteInfoField inline label={t('satellite_info.elevation')}>
                                                {formatAngle(position.el)}
                                            </SatelliteInfoField>
                                            <SatelliteInfoField inline label={t('satellite_info.visibility')}>
                                                {position.el > 0
                                                    ? t('satellite_info.visible')
                                                    : t('satellite_info.below_horizon')}
                                            </SatelliteInfoField>
                                        </>
                                    )}
                                </Box>
                            </Box>
                        </Grid>
                    )}
                    {hasCatalogDetails && (
                        <Grid size={{ xs: 12, md: hasPosition ? 6 : 12 }}>
                            <Box sx={{
                                p: 1.5,
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 2,
                                bgcolor: 'background.paper',
                            }}>
                                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                                    {t('satellite_info.catalog_details')}
                                </Typography>
                                <Box sx={{ display: 'grid', gap: 0.75 }}>
                                    {satelliteData.sat_id && (
                                        <SatelliteInfoField inline label={t('satellite_database.sat_id')}>
                                            {satelliteData.sat_id}
                                        </SatelliteInfoField>
                                    )}
                                    {satelliteData.orbit_source_object_id && (
                                        <SatelliteInfoField inline label={t('satellite_info.orbit_source_object_id')}>
                                            {satelliteData.orbit_source_object_id}
                                        </SatelliteInfoField>
                                    )}
                                    {typeof satelliteData.is_frequency_violator === 'boolean' && (
                                        <SatelliteInfoField inline label={t('satellite_database.is_frequency_violator')}>
                                            {yesOrNo(satelliteData.is_frequency_violator)}
                                        </SatelliteInfoField>
                                    )}
                                    {satelliteData.added && (
                                        <SatelliteInfoField inline label={t('satellite_info.added_to_catalog')}>
                                            {formatSatelliteDate(satelliteData.added)}
                                        </SatelliteInfoField>
                                    )}
                                    {satelliteData.updated && (
                                        <SatelliteInfoField inline label={t('satellite_info.fields.updated')}>
                                            {formatSatelliteDate(satelliteData.updated)}
                                        </SatelliteInfoField>
                                    )}
                                    {satelliteData.associated_satellites && (
                                        <SatelliteInfoField inline label={t('satellite_info.associated_satellites')}>
                                            {satelliteData.associated_satellites}
                                        </SatelliteInfoField>
                                    )}
                                    {satelliteData.website && (
                                        <SatelliteInfoField inline label={t('satellite_info.fields.website')}>
                                            <Tooltip title={satelliteData.website} arrow>
                                                <Box component="span" sx={{ display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {renderTextWithClickableLinks(satelliteData.website)}
                                                </Box>
                                            </Tooltip>
                                        </SatelliteInfoField>
                                    )}
                                    {satelliteData.citation && (
                                        <SatelliteInfoField inline label={t('satellite_info.fields.citation')}>
                                            {renderTextWithClickableLinks(satelliteData.citation)}
                                        </SatelliteInfoField>
                                    )}
                                </Box>
                            </Box>
                        </Grid>
                    )}
                </Grid>
            )}

            {asDialog && (
                <SatellitePasses
                    noradId={satelliteData.norad_id}
                    enabled={liveUpdatesEnabled}
                />
            )}

            {!asDialog && tleLines && (
                <Box sx={{ p: { xs: 1.5, sm: 2 }, mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                        {t('satellite_info.orbit_data')}
                    </Typography>
                    <Box component="pre" sx={{ m: 0, p: 1.5, overflowX: 'auto', borderRadius: 1, bgcolor: 'background.default', fontSize: '0.75rem' }}>
                        {tleLines}
                    </Box>
                </Box>
            )}

            {!asDialog && (
                <Box
                    sx={{
                        p: { xs: 1.5, sm: 2 },
                        mb: 2,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 2,
                        bgcolor: 'background.paper',
                    }}
                >
                    <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                            {t('satellite_info.transmitters.title')}
                        </Typography>
                        <Chip size="small" label={t('satellite_info.transmitter_count', { count: currentTransmitters.length })} />
                    </Stack>
                    {(uplinkBands.length > 0 || downlinkBands.length > 0) && (
                        <Stack direction="row" gap={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
                            {uplinkBands.map((band) => (
                                <Chip
                                    key={'uplink-' + band}
                                    size="small"
                                    variant="outlined"
                                    color="primary"
                                    label={t('satellite_info.uplink_band', { band })}
                                />
                            ))}
                            {downlinkBands.map((band) => (
                                <Chip
                                    key={'downlink-' + band}
                                    size="small"
                                    variant="outlined"
                                    color="secondary"
                                    label={t('satellite_info.downlink_band', { band })}
                                />
                            ))}
                        </Stack>
                    )}
                    <TransmittersTable
                        satelliteData={satelliteData}
                        showTitle={false}
                        onTransmittersChange={setCurrentTransmitters}
                    />
                </Box>
            )}

            {!asDialog && rawOmmData && (
                <Accordion
                    disableGutters
                    elevation={0}
                    sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '8px !important', overflow: 'hidden' }}
                >
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                            {t('satellite_info.omm_data')}
                        </Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 0 }}>
                        <Box component="pre" sx={{ m: 0, p: 1.5, maxHeight: 260, overflow: 'auto', borderRadius: 1, bgcolor: 'background.default', fontSize: '0.75rem' }}>
                            {rawOmmData}
                        </Box>
                    </AccordionDetails>
                </Accordion>
            )}
        </Box>
    );
};

// Page wrapper component
const SatelliteInfoPage = () => {
    const { t } = useTranslation('satellites');
    const { noradId } = useParams();
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const {socket} = useSocket();

    // Get satellite list, clickedSatellite and loading state from Redux store
    const { satellites, clickedSatellite, loading, error } = useSelector(state => state.satellites);

    useEffect(() => {
        const noradIdInt = parseInt(noradId);

        // If we don't have the satellite data in Redux or it doesn't match the URL parameter
        if (!clickedSatellite || clickedSatellite.norad_id !== noradIdInt) {
            // First check if the satellite exists in the satellites list
            const satellite = satellites.find(sat => sat.norad_id === noradIdInt);
            if (satellite) {
                dispatch(setClickedSatellite(satellite));
            } else {
                // Try to fetch the specific satellite by NORAD ID
                dispatch(fetchSatellite({socket, noradId: noradIdInt}))
                    .unwrap()
                    .then((satelliteData) => {
                        // Successfully fetched the satellite
                        //console.info('Successfully fetched satellite:', satelliteData);
                    })
                    .catch((error) => {
                        console.error(`Failed to fetch satellite with NORAD ID ${noradId}:`, error);
                        toast.error(`Failed to load satellite data: ${error}`, {
                            autoClose: 5000,
                        });
                    });
            }
        }
    }, [noradId, satellites, clickedSatellite, dispatch, socket]);

    const handleBackClick = () => {
        navigate(-1);
    };

    // Show loading state while fetching satellite data
    if (loading && clickedSatellite.id === null) {
        return (
            <Box sx={{ p: 3 }}>
                <Box sx={{ mb: 2 }}>
                    <IconButton onClick={handleBackClick} sx={{ mr: 2 }}>
                        <ArrowBackIcon />
                    </IconButton>
                    <Typography variant="h6" display="inline">
                        {t('satellite_info.loading')}
                    </Typography>
                </Box>
            </Box>
        );
    }

    // Show error state if the satellite couldn't be found
    if (error && clickedSatellite.id === null) {
        return (
            <Box sx={{ p: 3 }}>
                <Box sx={{ mb: 2 }}>
                    <IconButton onClick={handleBackClick} sx={{ mr: 2 }}>
                        <ArrowBackIcon />
                    </IconButton>
                    <Typography variant="h6" display="inline">
                        {t('satellite_info.not_found')}
                    </Typography>
                </Box>
                <Typography variant="body1" sx={{ mt: 2 }}>
                    {t('satellite_info.not_found_message', { noradId })}
                </Typography>
                <Button
                    variant="contained"
                    onClick={() => navigate('/admin/satellites/catalog')}
                    sx={{ mt: 2 }}
                >
                    {t('satellite_info.go_to_list')}
                </Button>
            </Box>
        );
    }

    // Don't render anything if we don't have satellite data yet
    if (clickedSatellite.id === null) {
        return (
            <Box sx={{ p: 3 }}>
                <Box sx={{ mb: 2 }}>
                    <IconButton onClick={handleBackClick} sx={{ mr: 2 }}>
                        <ArrowBackIcon />
                    </IconButton>
                    <Typography variant="h6" display="inline">
                        {t('satellite_info.loading')}
                    </Typography>
                </Box>
            </Box>
        );
    }

    return (
        <Box
            className={"top-level-box"}
            sx={{
                display: 'flex',
                flexDirection: 'column',
                p: 3,
                backgroundColor: 'background.default',
            }}>
            <SatelliteInfoContent
                key={clickedSatellite.norad_id}
                satelliteData={clickedSatellite}
                asDialog={false}
                showDeleteButton={true}
                deleteButtonSlot={(onDeleteClick) => (
                    <Box sx={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2}}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <IconButton onClick={handleBackClick} sx={{mr: 2}}>
                                <ArrowBackIcon/>
                            </IconButton>
                            <Typography variant="h6">
                                {t('satellite_info.title')}
                            </Typography>
                        </Box>
                        <Button
                            variant="contained"
                            color="error"
                            onClick={onDeleteClick}
                        >
                            {t('satellite_info.delete_satellite')}
                        </Button>
                    </Box>
                )}
            />
        </Box>
    );
};

// Dialog wrapper component for use in other parts of the app
export const SatelliteInfoDialog = ({ open, onClose, satelliteData, livePosition = null, onUpdated = null, targetGroupId = null }) => {
    const { t } = useTranslation('satellites');
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const [activeEditor, setActiveEditor] = useState(null);
    const [refreshedSatellite, setRefreshedSatellite] = useState(null);
    const refreshSequence = React.useRef(0);
    const noradId = satelliteData?.norad_id;
    const currentSatellite = refreshedSatellite && refreshedSatellite.noradId === noradId
        ? refreshedSatellite.data
        : satelliteData;
    const {
        setAsTarget,
        isCurrentlyTargeted,
        dialog: targetSelectionDialog,
    } = useSatelliteTargetAction({ satellite: currentSatellite, groupId: targetGroupId });

    useEffect(() => {
        // Ignore in-flight refreshes when the information dialog closes or switches satellites.
        refreshSequence.current += 1;
        setRefreshedSatellite(null);
        setActiveEditor(null);
    }, [open, noradId]);

    const refreshSatellite = async () => {
        if (!socket || noradId == null) return;
        const sequence = ++refreshSequence.current;
        try {
            const response = await dispatch(fetchSatellite({ socket, noradId: Number(noradId) })).unwrap();
            if (sequence !== refreshSequence.current) return;
            if (Number(response?.details?.norad_id) !== Number(noradId)) {
                throw new Error('Satellite details unavailable');
            }
            setRefreshedSatellite({
                noradId,
                data: {
                    ...response.details,
                    position: response.position || null,
                    transmitters: response.transmitters || [],
                },
            });
            onUpdated?.(response);
        } catch (error) {
            if (sequence === refreshSequence.current) {
                console.error('Failed to refresh satellite information:', error);
                toast.error(t('satellite_database.failed_load'));
            }
        }
    };

    const handleEditorClose = () => {
        setActiveEditor(null);
    };

    const handleTransmittersClose = () => {
        setActiveEditor(null);
        void refreshSatellite();
    };

    return (
        <>
            <Dialog
                open={open}
                onClose={onClose}
                maxWidth="lg"
                fullWidth
                PaperProps={{
                    sx: {
                        minHeight: { xs: '100dvh', sm: '80vh' },
                        maxHeight: { xs: '100dvh', sm: '90vh' },
                        m: { xs: 0, sm: 2 },
                        width: { xs: '100%', sm: 'calc(100% - 32px)' },
                    }
                }}
            >
                <DialogTitle
                    component="div"
                    aria-label={currentSatellite?.name || t('satellite_info.title')}
                    sx={{ px: { xs: 1.5, sm: 2.5 }, py: 1.5 }}
                >
                    {currentSatellite?.norad_id != null ? (
                        <SatelliteIdentityHeader
                            satelliteData={currentSatellite}
                            inDialog
                            trailingAction={(
                                <IconButton onClick={onClose} size="small" aria-label={t('common:close')} sx={{ alignSelf: 'flex-start' }}>
                                    <CloseIcon />
                                </IconButton>
                            )}
                        />
                    ) : (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="h6" component="h2">{t('satellite_info.title')}</Typography>
                            <IconButton onClick={onClose} size="small" aria-label={t('common:close')}>
                                <CloseIcon />
                            </IconButton>
                        </Box>
                    )}
                </DialogTitle>
                <DialogContent dividers sx={{ p: { xs: 1.5, sm: 2.5 } }}>
                    <SatelliteInfoContent
                        key={currentSatellite?.norad_id}
                        satelliteData={currentSatellite}
                        livePosition={livePosition}
                        asDialog={true}
                        onClose={onClose}
                        onSetAsTarget={setAsTarget}
                        isCurrentlyTargeted={isCurrentlyTargeted}
                        onEditSatellite={() => setActiveEditor('satellite')}
                        onManageTransmitters={() => setActiveEditor('transmitters')}
                        showDeleteButton={false}
                        liveUpdatesEnabled={open}
                    />
                </DialogContent>
            </Dialog>
            <SatelliteEditDialog
                open={open && activeEditor === 'satellite'}
                onClose={handleEditorClose}
                satelliteData={currentSatellite}
                onSaved={() => { void refreshSatellite(); }}
            />
            <TransmittersDialog
                open={open && activeEditor === 'transmitters'}
                onClose={handleTransmittersClose}
                title={t('satellite_database.edit_transmitters_title', {
                    name: currentSatellite?.name || noradId || '',
                })}
                satelliteData={currentSatellite}
                variant="paper"
            />
            {targetSelectionDialog}
        </>
    );
};

export default SatelliteInfoPage;
