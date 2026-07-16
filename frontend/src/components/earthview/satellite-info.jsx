import React, {useEffect, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigate} from 'react-router';
import {
    fetchSatelliteData
} from './earthview-slice.jsx';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import ExploreIcon from '@mui/icons-material/Explore';
import HeightIcon from '@mui/icons-material/Height';
import SpeedIcon from '@mui/icons-material/Speed';
import UpdateIcon from '@mui/icons-material/Update';
import SatelliteIcon from '@mui/icons-material/Satellite';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import EditIcon from '@mui/icons-material/Edit';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import { getModulationDisplay } from '../../constants/modulations';
import {
    Box,
    Typography,
    Chip,
    Button,
    CircularProgress,
    Divider,
    IconButton,
    Tooltip
} from '@mui/material';
import {
    betterDateTimes,
    betterStatusValue,
    getClassNamesBasedOnGridEditing,
    humanizeAltitude,
    humanizeDate,
    humanizeLatitude,
    humanizeLongitude,
    humanizeVelocity,
    renderCountryFlagsCSV,
    TitleBar,
    islandTitleBarSx,
    getFrequencyBand,
} from "../common/common.jsx";
import Grid from "@mui/material/Grid";
import {useSocket} from "../common/socket.jsx";
import { setRotator, setTrackerId, setTrackingStateInBackend } from "../target/target-slice.jsx";
import { toast } from '../../utils/toast-with-timestamp.jsx';
import SettingsInputAntennaIcon from "@mui/icons-material/SettingsInputAntenna";
import PublicIcon from "@mui/icons-material/Public";
import { useTranslation } from 'react-i18next';
import { SatelliteInfoDialog } from '../satellites/satellite-info-page.jsx';
import SatelliteEditDialog from "../satellites/satellite-edit-dialog.jsx";
import TransmittersDialog from "../satellites/transmitters-dialog.jsx";
import { useTargetRotatorSelectionDialog } from '../target/use-target-rotator-selection-dialog.jsx';
// ElevationDisplay removed per request; display raw value instead

const EarthViewSatelliteInfoCard = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const {socket} = useSocket();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [satelliteEditDialogOpen, setSatelliteEditDialogOpen] = useState(false);
    const [transmittersDialogOpen, setTransmittersDialogOpen] = useState(false);
    const { t } = useTranslation('earthview');
    const { t: tSat } = useTranslation('satellites');
    const {
        satelliteData,
        selectedSatelliteId,
        loading,
        error,
        gridEditable,
        selectedSatGroupId,
        selectedSatellitePositions
    } = useSelector((state) => state.earthViewTrack);
    const {
        trackingState,
        satelliteId: trackingSatelliteId,
        trackerViews,
    } = useSelector(state => state.targetSatTrack);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const { requestRotatorForTarget, dialog: rotatorSelectionDialog } = useTargetRotatorSelectionDialog();
    const selectedNoradId = satelliteData?.details?.norad_id || selectedSatelliteId || null;
    const selectedSatelliteName = satelliteData?.details?.name || '';
    const transmitters = satelliteData?.transmitters || [];
    const satelliteDialogData = {
        ...(satelliteData?.details || {}),
        norad_id: selectedNoradId,
        name: selectedSatelliteName,
        transmitters,
    };

    // Get timezone preference
    const timezone = useSelector((state) => {
        const tzPref = state.preferences?.preferences?.find(p => p.name === 'timezone');
        return tzPref?.value || 'UTC';
    });

    useEffect(() => {
        if (selectedSatelliteId) {
            dispatch(fetchSatelliteData({socket: socket, noradId: selectedSatelliteId}));
        }
    }, [selectedSatelliteId, dispatch]);

    const handleSetTrackingOnBackend = async () => {
        const selectedAssignment = await requestRotatorForTarget(satelliteData?.details?.name);
        if (!selectedAssignment) {
            return;
        }
        const assignmentAction = String(selectedAssignment?.action || 'retarget_current_slot');
        const isCreateNewSlot = assignmentAction === 'create_new_slot';
        const trackerId = String(selectedAssignment?.trackerId || '');
        const rotatorId = String(selectedAssignment?.rotatorId || 'none');
        const assignmentRigId = String(selectedAssignment?.rigId || 'none');
        if (!trackerId) {
            return;
        }

        const selectedTrackerInstance = trackerInstances.find(
            (instance) => String(instance?.tracker_id || '') === trackerId
        );
        const selectedTrackerView = trackerViews?.[trackerId] || {};
        const selectedTrackerState = selectedTrackerView?.trackingState || selectedTrackerInstance?.tracking_state || {};
        const nextRigId = isCreateNewSlot
            ? assignmentRigId
            : String(
                selectedTrackerView?.selectedRadioRig
                ?? selectedTrackerState?.rig_id
                ?? assignmentRigId
                ?? 'none'
            );
        const nextRotatorId = isCreateNewSlot ? 'none' : rotatorId;
        const nextTransmitterId = isCreateNewSlot
            ? 'none'
            : String(selectedTrackerState?.transmitter_id || 'none');
        const nextGroupId = selectedSatGroupId || selectedTrackerState?.group_id || trackingState?.group_id || '';

        dispatch(setTrackerId(trackerId));
        dispatch(setRotator({ value: nextRotatorId, trackerId }));

        // Always overwrite target identity fields when retargeting to a satellite slot.
        const normalizedTargetName = String(
            satelliteData?.details?.name
            || selectedSatelliteId
            || ''
        ).trim();
        const satelliteTargetPatch = {
            target_type: 'satellite',
            target_name: normalizedTargetName || String(selectedSatelliteId || '').trim(),
            command: null,
            body_id: null,
        };

        const newTrackingState = isCreateNewSlot
            ? {
                tracker_id: trackerId,
                norad_id: selectedSatelliteId,
                group_id: nextGroupId,
                ...satelliteTargetPatch,
                rig_id: nextRigId,
                rotator_id: nextRotatorId,
                transmitter_id: 'none',
                rig_state: 'disconnected',
                rotator_state: 'disconnected',
                rig_vfo: 'none',
                vfo1: 'uplink',
                vfo2: 'downlink',
            }
            : {
                ...selectedTrackerState,
                tracker_id: trackerId,
                norad_id: selectedSatelliteId,
                group_id: nextGroupId,
                ...satelliteTargetPatch,
                rig_id: nextRigId,
                rotator_id: nextRotatorId,
                transmitter_id: nextTransmitterId,
            };

        dispatch(setTrackingStateInBackend({socket: socket, data: newTrackingState}))
            .unwrap()
            .then((response) => {
                // Success handling
            })
            .catch((error) => {
                toast.error(
                    t('satellite_info.failed_tracking')
                    + `: ${error?.message || error?.error || 'Unknown error'}`
                );
            });
    };

    const handleSatelliteSaved = () => {
        if (!selectedNoradId) {
            return;
        }
        dispatch(fetchSatelliteData({ socket, noradId: selectedNoradId }));
    };

    const upDownDetails = satelliteData && satelliteData['transmitters']
        ? Object.entries(
            satelliteData['transmitters'].reduce((acc, transmitter) => {
                const upBand = transmitter['uplink_low'] != null
                    ? getFrequencyBand(transmitter['uplink_low'])
                    : null;
                const downBand = transmitter['downlink_low'] != null
                    ? getFrequencyBand(transmitter['downlink_low'])
                    : null;

                let signature = t('passes_table.no_data');
                if (upBand && downBand) {
                    signature = upBand === downBand ? `${upBand}↕` : `${upBand}↑/${downBand}↓`;
                } else if (upBand) {
                    signature = `${upBand}↑`;
                } else if (downBand) {
                    signature = `${downBand}↓`;
                }

                if (!acc[signature]) {
                    acc[signature] = {
                        count: 0,
                        isSplitBand: Boolean(upBand && downBand && upBand !== downBand),
                        upBand,
                        downBand,
                    };
                }

                acc[signature].count += 1;
                return acc;
            }, {})
        )
            .map(([signature, details]) => ({
                signature,
                count: details.count,
                isSplitBand: details.isSplitBand,
                upBand: details.upBand,
                downBand: details.downBand,
            }))
            .sort((a, b) => {
                if (a.isSplitBand !== b.isSplitBand) {
                    return a.isSplitBand ? -1 : 1;
                }
                return a.signature.localeCompare(b.signature);
            })
        : [];

    const modulations = satelliteData && satelliteData['transmitters']
        ? Array.from(new Set(
            satelliteData['transmitters'].flatMap(t => {
                const keywords = ['FSK', 'GMSK', 'GFSK', 'BPSK', 'SSTV', 'AFSK', 'LORA', 'CW', 'DOKA', 'FM', 'FMN', 'AM', 'LSB', 'USB'];
                const found = [];
                const mode = (t['mode'] || '').toUpperCase();
                const description = (t['description'] || '').toUpperCase();

                keywords.forEach(keyword => {
                    if (mode.includes(keyword) || description.includes(keyword)) {
                        // Use proper display name for modulation
                        found.push(getModulationDisplay(keyword));
                    }
                });

                return found;
            })
        ))
        : [];

    const getModulationColor = (modulation) => {
        const mod = String(modulation || '').toUpperCase();

        // Analog voice/narrowband family.
        if (['AM', 'FM', 'FMN', 'SSB', 'USB', 'LSB', 'CW'].includes(mod)) return '#1565C0';

        // LoRa and spread-spectrum style.
        if (['LORA'].includes(mod)) return '#6A1B9A';

        // Common digital packet/PSK/FSK family.
        if (['AFSK', 'FSK', 'GFSK', 'GMSK', 'BPSK', 'QPSK', 'MSK', 'DOKA', 'OOK'].includes(mod)) return '#2E7D32';

        // Fallback for unknown/rare modes.
        return '#455A64';
    };

    const txLinkPalette = ['#0B7285', '#2B8A3E', '#1C7ED6', '#5F3DC4', '#087F5B', '#364FC7'];
    const getTxLinkColor = (signature) => {
        let hash = 0;
        for (let i = 0; i < signature.length; i += 1) {
            hash = ((hash << 5) - hash) + signature.charCodeAt(i);
            hash |= 0;
        }
        return txLinkPalette[Math.abs(hash) % txLinkPalette.length];
    };

    const DataPoint = ({ icon: Icon, label, value, color = 'text.primary', unit = '' }) => (
        <Box sx={{ mb: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                <Icon sx={{ fontSize: 14, mr: 0.5, color: color }} />
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'medium' }}>
                    {label}
                </Typography>
            </Box>
            <Typography variant="body1" sx={{ fontWeight: 'bold', color: color }}>
                {value} {unit && <span style={{ fontSize: '0.8em', color: 'text.secondary' }}>{unit}</span>}
            </Typography>
        </Box>
    );

    const Section = ({ title, icon: Icon, children }) => (
        <Box sx={{ mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Icon sx={{ fontSize: 16, mr: 1, color: 'secondary.main' }} />
                <Typography variant="overline" sx={{
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    color: 'secondary.main',
                    letterSpacing: '0.5px'
                }}>
                    {title}
                </Typography>
            </Box>
            {children}
        </Box>
    );

    return (
        <>
        {rotatorSelectionDialog}
        <Box sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: "background.paper",
            backdropFilter: 'blur(10px)'
        }}>
            {/* Header */}
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
                sx={islandTitleBarSx}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                    <Box sx={{display: 'flex', alignItems: 'center'}}>
                        <Typography variant="subtitle2" sx={{fontWeight: 'bold'}}>
                            {t('satellite_info.title')}
                        </Typography>
                    </Box>
                    <Typography variant="caption" sx={{color: 'text.secondary'}}>
                        ID: {!loading && satelliteData && satelliteData['details'] ? satelliteData['details']['norad_id'] : ''}
                    </Typography>
                </Box>
            </TitleBar>

            {!selectedSatelliteId ? (
                <Box sx={{
                    flex: 1,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    px: '20px',
                }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic', textAlign: 'center' }}>
                        {t('satellite_info.no_satellite_selected')}
                    </Typography>
                </Box>
            ) : loading ? (
                <Box sx={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                }}>
                    <CircularProgress color="secondary" />
                    <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
                        {t('satellite_info.loading')}
                    </Typography>
                </Box>
            ) : (
                <>
                    {/* Satellite Name & Status */}
                    <Box sx={{
                        p: 1,
                        background: satelliteData && satelliteData['details'] ?
                            (() => {
                                const status = satelliteData['details']['status'];
                                switch(status) {
                                    case 'alive': return (theme) => `linear-gradient(135deg, ${theme.palette.success.main}26 0%, ${theme.palette.success.main}0D 100%)`;
                                    case 'dead': return (theme) => `linear-gradient(135deg, ${theme.palette.error.main}26 0%, ${theme.palette.error.main}0D 100%)`;
                                    case 're-entered': return (theme) => `linear-gradient(135deg, ${theme.palette.warning.main}26 0%, ${theme.palette.warning.main}0D 100%)`;
                                    default: return 'overlay.light';
                                }
                            })() : 'overlay.light',
                        borderBottom: "1px solid",
                        borderColor: "divider"
                    }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                            <Box sx={{
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                mr: 1.5,
                                bgcolor: satelliteData && satelliteData['details'] ? 
                                    (() => {
                                        const status = satelliteData['details']['status'];
                                        switch(status) {
                                            case 'alive': return 'success.main';
                                            case 'dead': return 'error.main';
                                            case 're-entered': return 'warning.main';
                                            default: return 'info.main';
                                        }
                                    })() : 'info.main',
                                boxShadow: satelliteData && satelliteData['details'] ?
                                    (() => {
                                        const status = satelliteData['details']['status'];
                                        switch(status) {
                                            case 'alive': return (theme) => `0 0 8px ${theme.palette.success.main}40`;
                                            case 'dead': return (theme) => `0 0 8px ${theme.palette.error.main}40`;
                                            case 're-entered': return (theme) => `0 0 8px ${theme.palette.warning.main}40`;
                                            default: return (theme) => `0 0 8px ${theme.palette.info.main}40`;
                                        }
                                    })() : (theme) => `0 0 8px ${theme.palette.info.main}40`
                            }}/>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                                    <Typography variant="subtitle1" noWrap sx={{ fontWeight: 'bold', minWidth: 0 }}>
                                        {satelliteData && satelliteData['details'] ? satelliteData['details']['name'] : "- - - - - - - - - - -"}
                                    </Typography>
                                    <Tooltip title="Edit Details">
                                        <span>
                                            <IconButton
                                                size="small"
                                                onClick={() => setSatelliteEditDialogOpen(true)}
                                                disabled={!selectedNoradId}
                                            >
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                    <Tooltip title="Edit Transmitters">
                                        <span>
                                            <IconButton
                                                size="small"
                                                onClick={() => setTransmittersDialogOpen(true)}
                                                disabled={!selectedNoradId}
                                            >
                                                <RadioButtonCheckedIcon fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                </Box>
                                {satelliteData && satelliteData['details'] && satelliteData['details']['name_other'] && (
                                    <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.65rem', display: 'block', mt: -0.5 }}>
                                        {satelliteData['details']['name_other']}
                                    </Typography>
                                )}
                            </Box>
                            {satelliteData && satelliteData['details'] && betterStatusValue(satelliteData['details']['status'])}
                        </Box>

                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center' }}>
                                <RocketLaunchIcon sx={{ fontSize: 12, mr: 0.5 }} />
                                NORAD: {satelliteData && satelliteData['details'] ? satelliteData['details']['norad_id'] : ''}
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center' }}>
                                <UpdateIcon sx={{ fontSize: 12, mr: 0.5 }} />
                                {satelliteData && satelliteData['details'] ? humanizeDate(satelliteData['details']['updated']) : ''}
                            </Typography>
                        </Box>
                    </Box>

                    {/* Main Content */}
                    <Box sx={{ pr: 2, pl: 2, pt: 1, flex: 1, overflow: 'auto' }}>

                        {/* Position Data */}
                        <Section title={t('satellite_info.position_data')} icon={ExploreIcon}>
                            <Grid container spacing={1}>
                                <Grid size={6}>
                                    <DataPoint
                                        icon={({ sx }) => <Box sx={{ ...sx, width: 6, height: 6, borderRadius: '50%', bgcolor: 'info.light' }} />}
                                        label={t('satellite_info.latitude')}
                                        value={satelliteData && satelliteData['position'] ? humanizeLatitude(satelliteData['position']['lat']) : 'N/A'}
                                        color="info.light"
                                    />
                                </Grid>
                                <Grid size={6}>
                                    <DataPoint
                                        icon={({ sx }) => <Box sx={{ ...sx, width: 6, height: 6, borderRadius: '50%', bgcolor: 'success.light' }} />}
                                        label={t('satellite_info.longitude')}
                                        value={satelliteData && satelliteData['position'] ? humanizeLongitude(satelliteData['position']['lon']) : 'N/A'}
                                        color="success.light"
                                    />
                                </Grid>
                                <Grid size={6}>
                                    <DataPoint
                                        icon={MyLocationIcon}
                                        label={t('satellite_info.azimuth')}
                                        value={satelliteData && satelliteData['position'] && satelliteData['position']['az'] ? `${satelliteData['position']['az'].toFixed(1)}°` : 'N/A'}
                                        color="warning.light"
                                    />
                                </Grid>
                                <Grid size={6}>
                                    <Box sx={{ mb: 0 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                                            <HeightIcon sx={{ fontSize: 14, mr: 0.5, color: 'error.light' }} />
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'medium' }}>
                                                {t('satellite_info.elevation')}
                                            </Typography>
                                        </Box>
                                        <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                                            {selectedSatelliteId && selectedSatellitePositions?.[selectedSatelliteId]?.el !== undefined && selectedSatellitePositions?.[selectedSatelliteId]?.el !== null
                                                ? `${selectedSatellitePositions[selectedSatelliteId].el.toFixed(1)}°`
                                                : 'N/A'}
                                        </Typography>
                                    </Box>
                                </Grid>
                            </Grid>
                        </Section>

                        <Divider sx={{ my: 0, mb: 1 }} />

                        {/* Orbital Data */}
                        <Section title={t('satellite_info.orbital_data')} icon={SpeedIcon}>
                            <Grid container spacing={1}>
                                <Grid size={6}>
                                    <Box sx={{ mb: 0 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                                            <HeightIcon sx={{ fontSize: 14, mr: 0.5, color: 'secondary.light' }} />
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'medium' }}>
                                                {t('satellite_info.altitude')}
                                            </Typography>
                                        </Box>
                                        <Typography variant="body1" sx={{ fontWeight: 'bold', color: 'secondary.light' }}>
                                            {satelliteData && satelliteData['position'] ? humanizeAltitude(satelliteData['position']['alt'], 0) : 'N/A'}
                                            {satelliteData && satelliteData['position'] && <Typography component="span" sx={{ ml: 0.5, fontSize: '0.8em', color: 'text.secondary' }}>km</Typography>}
                                        </Typography>
                                    </Box>
                                </Grid>
                                <Grid size={6}>
                                    <Box sx={{ mb: 0 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                                            <SpeedIcon sx={{ fontSize: 14, mr: 0.5, color: 'primary.light' }} />
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'medium' }}>
                                                {t('satellite_info.velocity')}
                                            </Typography>
                                        </Box>
                                        <Typography variant="body1" sx={{ fontWeight: 'bold', color: 'primary.light' }}>
                                            {satelliteData && satelliteData['position'] ? humanizeVelocity(satelliteData['position']['vel']) : 'N/A'}
                                            {satelliteData && satelliteData['position'] && <Typography component="span" sx={{ ml: 0.5, fontSize: '0.8em', color: 'text.secondary' }}>km/s</Typography>}
                                        </Typography>
                                    </Box>
                                </Grid>
                            </Grid>
                        </Section>

                        <Divider sx={{ my: 0, mb: 1 }} />

                        {/* Communication Data */}
                        <Section title={t('satellite_info.communication')} icon={SettingsInputAntennaIcon}>
                            <Box sx={{ mb: 1 }}>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'medium', mb: 1, display: 'block' }}>
                                    {t('satellite_info.frequency_bands')}
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {upDownDetails.map((item) => {
                                        const paletteColor = getTxLinkColor(item.signature);
                                        return (
                                        <Chip
                                            key={item.signature}
                                            label={
                                                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.35 }}>
                                                    {item.count > 1 && <Box component="span">{item.count} ×</Box>}
                                                    {item.upBand && (
                                                        <>
                                                            <Box component="span">{item.upBand}</Box>
                                                            <ArrowUpwardRoundedIcon sx={{ fontSize: '0.85rem' }} />
                                                        </>
                                                    )}
                                                    {item.upBand && item.downBand && item.upBand !== item.downBand && (
                                                        <Box component="span">/</Box>
                                                    )}
                                                    {item.downBand && (
                                                        <>
                                                            <Box component="span">{item.downBand}</Box>
                                                            <ArrowDownwardRoundedIcon sx={{ fontSize: '0.85rem' }} />
                                                        </>
                                                    )}
                                                    {!item.upBand && !item.downBand && (
                                                        <Box component="span">{item.signature}</Box>
                                                    )}
                                                </Box>
                                            }
                                            size="small"
                                            sx={{
                                                backgroundColor: item.isSplitBand ? '#E67700' : `${paletteColor}CC`,
                                                color: 'common.white',
                                                fontSize: '0.7rem',
                                                fontWeight: 700,
                                                height: 24,
                                                border: '1px solid',
                                                borderColor: item.isSplitBand ? '#D9480F' : `${paletteColor}B3`,
                                                '& .MuiChip-label': {
                                                    px: 1
                                                }
                                            }}
                                        />
                                    )})}
                                </Box>
                            </Box>
                            <Box sx={{ mb: 0 }}>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'medium', mb: 1, display: 'block' }}>
                                    {t('satellite_info.modulations')}
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {modulations.length > 0 ? (
                                        modulations.map((modulation, index) => (
                                            <Chip
                                                key={index}
                                                label={modulation}
                                                size="small"
                                                sx={{
                                                    backgroundColor: getModulationColor(modulation),
                                                    color: 'common.white',
                                                    fontSize: '0.7rem',
                                                    height: 24
                                                }}
                                            />
                                        ))
                                    ) : (
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                                            {t('satellite_info.no_modulations')}
                                        </Typography>
                                    )}
                                </Box>
                            </Box>
                        </Section>

                        <Divider sx={{ my: 0, mb: 1 }} />

                        {/* Metadata */}
                        <Section title={t('satellite_info.metadata')} icon={PublicIcon}>
                            <Grid container spacing={2}>
                                <Grid size={6}>
                                    <Box sx={{ mb: 0 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'medium', mb: 0.5, display: 'block' }}>
                                            {t('satellite_info.countries')}
                                        </Typography>
                                        <Box>
                                            {satelliteData && satelliteData['details'] ? (renderCountryFlagsCSV(satelliteData['details']['countries']) || t('satellite_info.unknown')) : t('satellite_info.unknown')}
                                        </Box>
                                    </Box>
                                </Grid>
                                <Grid size={6}>
                                    <Box sx={{ mb: 0 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'medium', mb: 0.5, display: 'block' }}>
                                            {t('satellite_info.last_update')}
                                        </Typography>
                                        <Typography variant="body2" sx={{ color: 'warning.light' }}>
                                            {satelliteData && satelliteData['details'] ? betterDateTimes(satelliteData['details']['updated'], timezone) : 'N/A'}
                                        </Typography>
                                    </Box>
                                </Grid>
                            </Grid>
                        </Section>
                    </Box>

                    {/* Footer */}
                    <Box sx={{
                        p: 2,
                        borderTop: "1px solid",
                        borderColor: "divider",
                        bgcolor: 'background.default'
                    }}>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button
                                disabled={!selectedSatelliteId || trackingSatelliteId === selectedSatelliteId}
                                variant="contained"
                                color="primary"
                                onClick={handleSetTrackingOnBackend}
                                sx={{
                                    flex: 1,
                                    py: 1.5,
                                    fontWeight: 'bold',
                                    borderRadius: 2
                                }}
                            >
                                {trackingSatelliteId === selectedSatelliteId ? t('satellite_info.currently_targeted') : t('satellite_info.set_as_target')}
                            </Button>
                            <IconButton
                                disabled={!selectedSatelliteId}
                                onClick={() => setDialogOpen(true)}
                                sx={{
                                    borderRadius: 2,
                                    bgcolor: 'action.hover',
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    '&:hover': {
                                        bgcolor: 'action.selected',
                                    },
                                    '&:disabled': {
                                        opacity: 0.3,
                                    }
                                }}
                            >
                                <InfoOutlinedIcon />
                            </IconButton>
                        </Box>
                    </Box>
                </>
            )}

            {/* Satellite Info Dialog */}
            {satelliteData && satelliteData['details'] && (
                <SatelliteInfoDialog
                    open={dialogOpen}
                    onClose={() => setDialogOpen(false)}
                    satelliteData={{
                        ...satelliteData['details'],
                        transmitters: satelliteData['transmitters'] || []
                    }}
                />
            )}
            <SatelliteEditDialog
                open={satelliteEditDialogOpen}
                onClose={() => setSatelliteEditDialogOpen(false)}
                satelliteData={satelliteDialogData}
                onSaved={handleSatelliteSaved}
            />
            <TransmittersDialog
                open={transmittersDialogOpen}
                onClose={() => setTransmittersDialogOpen(false)}
                title={tSat('satellite_database.edit_transmitters_title', {
                    name: selectedSatelliteName || selectedNoradId || '',
                })}
                satelliteData={satelliteDialogData}
                variant="paper"
                widthOffsetPx={20}
            />
        </Box>
        </>
    );
};

export default EarthViewSatelliteInfoCard;
