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

import React, { useEffect } from 'react';
import {
    Box,
    Button,
    ButtonGroup,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Fab,
    InputAdornment,
    MenuItem,
    Skeleton,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import Grid from '@mui/material/Grid';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import { useTranslation } from 'react-i18next';
import Map, { Layer, Marker, Source } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { useDispatch, useSelector } from 'react-redux';
import 'maplibre-gl/dist/maplibre-gl.css';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import { getMaidenhead } from '../common/common.jsx';
import { useSocket } from '../common/socket.jsx';
import { getMapLibreTileURL, getTileLayerById } from '../common/tile-layers.jsx';
import {
    SettingsActionFooter,
    SettingsSection,
    SettingsSurface,
    SettingsSurfaceHeader,
} from './shared/index.js';
import {
    setAltitude,
    setLocation,
    setLocationId,
    setLocationLoading,
    setPolylines,
    setQth,
    storeLocation,
} from './location-slice.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import SetupWizard from '../setup/setup.jsx';

const locationCardSx = {
    backgroundColor: (theme) => (
        theme.palette.mode === 'dark'
            ? alpha(theme.palette.grey[700], 0.18)
            : alpha(theme.palette.grey[100], 0.9)
    ),
};

const MAPLIBRE_LOCATION_MIN_ZOOM = 1;
const MAPLIBRE_LOCATION_MAX_ZOOM = 10;
const LOCATION_COVERAGE_RADIUS_METERS = 400000;
const LOCATION_COVERAGE_STEPS = 96;
const EARTH_RADIUS_METERS = 6371008.8;

const createEmptyFeatureCollection = () => ({
    type: 'FeatureCollection',
    features: [],
});

const latLonToLngLat = (point) => {
    if (!Array.isArray(point) || point.length < 2) return null;
    const lat = Number(point[0]);
    const lon = Number(point[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return [lon, lat];
};

const createCrosshairGeoJSON = (polylines) => {
    if (!Array.isArray(polylines) || polylines.length === 0) {
        return createEmptyFeatureCollection();
    }

    const features = polylines
        .map((line) => {
            const coordinates = (Array.isArray(line) ? line : [])
                .map(latLonToLngLat)
                .filter(Boolean);
            if (coordinates.length < 2) return null;
            return {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates },
            };
        })
        .filter(Boolean);

    return {
        type: 'FeatureCollection',
        features,
    };
};

const createCoverageGeoJSON = (location) => {
    if (!location) return null;

    const centerLat = Number(location.lat);
    const centerLon = Number(location.lon);
    if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon)) return null;

    const latRad = (centerLat * Math.PI) / 180;
    const lonRad = (centerLon * Math.PI) / 180;
    const angularDistance = LOCATION_COVERAGE_RADIUS_METERS / EARTH_RADIUS_METERS;
    const coordinates = [];

    for (let index = 0; index <= LOCATION_COVERAGE_STEPS; index += 1) {
        const bearing = (2 * Math.PI * index) / LOCATION_COVERAGE_STEPS;
        const pointLat = Math.asin(
            Math.sin(latRad) * Math.cos(angularDistance)
            + Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing)
        );
        const pointLon = lonRad + Math.atan2(
            Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
            Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(pointLat)
        );
        const normalizedLon = ((((pointLon * 180) / Math.PI) + 540) % 360) - 180;
        coordinates.push([normalizedLon, (pointLat * 180) / Math.PI]);
    }

    return {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [coordinates],
                },
            },
        ],
    };
};

const normalizeStationName = (value) => String(value || '').trim();
const normalizeCallsign = (value) => String(value || '').trim().toUpperCase();
const STATION_TYPE_STATIONARY = 'stationary';
const STATION_TYPE_MOBILE = 'mobile';
const normalizeStationType = (value) => (
    String(value || '').trim().toLowerCase() === STATION_TYPE_MOBILE
        ? STATION_TYPE_MOBILE
        : STATION_TYPE_STATIONARY
);
const normalizeHorizonMask = (value) => {
    const parsed = Number.parseFloat(String(value ?? 0));
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(90, parsed));
};

const LocationPage = ({
    wizardMode = false,
    onWizardCompleted = null,
    wizardRequireAdminSetup = false,
    wizardBackendReady = true,
}) => {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('settings');
    const { locale } = useUserTimeSettings();

    const [nearestCity, setNearestCity] = React.useState(null);
    const [cityLoading, setCityLoading] = React.useState(false);
    const [elevationLoading, setElevationLoading] = React.useState(false);
    const [savedState, setSavedState] = React.useState(null);
    const [manualDialogOpen, setManualDialogOpen] = React.useState(false);
    const [manualLatInput, setManualLatInput] = React.useState('');
    const [manualLonInput, setManualLonInput] = React.useState('');
    const [manualInputError, setManualInputError] = React.useState('');
    const mapRef = React.useRef(null);

    const {
        locationLoading,
        locationSaving,
        location,
        locationId,
        qth,
        polylines,
        altitude,
    } = useSelector((state) => state.location);

    const hasLocation = location && location.lat != null && location.lon != null;
    const hasPersistedLocation = locationId != null;
    const stationName = location?.name || '';
    const stationCallsign = location?.callsign || '';
    const stationType = normalizeStationType(location?.station_type);
    const stationHorizonMask = normalizeHorizonMask(location?.horizon_mask);
    const stationLabel = normalizeStationName(stationName) || 'home';
    const stationCallsignLabel = normalizeCallsign(stationCallsign);
    const normalizedLocation = React.useMemo(() => {
        if (!hasLocation) return null;
        return { lat: Number(location.lat), lon: Number(location.lon) };
    }, [hasLocation, location?.lat, location?.lon]);
    const updateLocationState = React.useCallback((patch) => {
        dispatch(setLocation({ ...(location || {}), ...patch }));
    }, [dispatch, location]);

    const getNearestCity = async (lat, lon) => {
        try {
            const response = await fetch(
                `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
            );
            const data = await response.json();
            return data.city || data.locality || data.principalSubdivision || 'Unknown';
        } catch (error) {
            console.error('Error fetching city:', error);
            return null;
        }
    };

    const getElevation = async (lat, lon) => {
        const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lon}`);
        const data = await response.json();
        return data.results[0].elevation;
    };

    const reCenterMap = (lat, lon) => {
        const liveMap = mapRef.current?.getMap?.();
        if (liveMap) {
            liveMap.flyTo({
                center: [lon, lat],
                zoom: liveMap.getZoom(),
                essential: false,
            });
        }
    };

    useEffect(() => {
        if (!hasLocation) {
            setNearestCity(null);
            setCityLoading(false);
            return;
        }

        setCityLoading(true);
        getNearestCity(normalizedLocation.lat, normalizedLocation.lon)
            .then((city) => setNearestCity(city))
            .finally(() => setCityLoading(false));
    }, [hasLocation, normalizedLocation]);

    useEffect(() => {
        if (!hasLocation) {
            dispatch(setPolylines([]));
            return;
        }

        const horizontalLine = [[normalizedLocation.lat, -270], [normalizedLocation.lat, 270]];
        const verticalLine = [[-90, normalizedLocation.lon], [90, normalizedLocation.lon]];
        dispatch(setPolylines([horizontalLine, verticalLine]));
        dispatch(setQth(getMaidenhead(normalizedLocation.lat, normalizedLocation.lon)));
    }, [dispatch, hasLocation, normalizedLocation]);

    useEffect(() => {
        if (hasLocation) {
            const liveMap = mapRef.current?.getMap?.();
            liveMap?.resize?.();
            reCenterMap(normalizedLocation.lat, normalizedLocation.lon);
        }
    }, [hasLocation, normalizedLocation]);

    useEffect(() => {
        // Initialize the "saved baseline" only from backend-loaded locations.
        // When the user selects a new point on the map for the first time, it should remain unsaved.
        if (!savedState && hasLocation && locationId != null) {
            setSavedState({
                lat: Number(location.lat),
                lon: Number(location.lon),
                altitude: Number(altitude || 0),
                name: normalizeStationName(location.name || 'home'),
                callsign: normalizeCallsign(location.callsign || ''),
                stationType: normalizeStationType(location.station_type),
                horizonMask: normalizeHorizonMask(location.horizon_mask),
                locationId: locationId || null,
            });
        }
    }, [savedState, hasLocation, location, altitude, locationId]);

    const isDifferentFromSaved = React.useMemo(() => {
        if (!hasLocation) return false;
        if (!savedState) return true;

        const latChanged = Math.abs(Number(location.lat) - savedState.lat) > 1e-7;
        const lonChanged = Math.abs(Number(location.lon) - savedState.lon) > 1e-7;
        const altitudeChanged = Number(altitude || 0) !== Number(savedState.altitude || 0);
        const nameChanged = normalizeStationName(location.name || 'home') !== normalizeStationName(savedState.name || 'home');
        const callsignChanged = normalizeCallsign(location.callsign || '') !== normalizeCallsign(savedState.callsign || '');
        const stationTypeChanged = normalizeStationType(location.station_type) !== normalizeStationType(savedState.stationType);
        const horizonMaskChanged = normalizeHorizonMask(location.horizon_mask) !== normalizeHorizonMask(savedState.horizonMask);
        const locationIdChanged = (locationId || null) !== (savedState.locationId || null);

        return (
            latChanged
            || lonChanged
            || altitudeChanged
            || nameChanged
            || callsignChanged
            || stationTypeChanged
            || horizonMaskChanged
            || locationIdChanged
        );
    }, [hasLocation, savedState, location, altitude, locationId]);

    const canSave = hasLocation && !locationSaving;
    const canReset = Boolean(savedState) && isDifferentFromSaved && !locationSaving && !locationLoading;

    const statusLabel = (() => {
        if (!hasLocation) {
            return t('location.state_no_location', { defaultValue: 'No location selected' });
        }
        if (locationSaving) {
            return t('location.state_saving', { defaultValue: 'Saving...' });
        }
        if (locationLoading) {
            return t('location.state_locating', { defaultValue: 'Locating...' });
        }
        if (isDifferentFromSaved) {
            return t('location.state_unsaved', { defaultValue: 'Unsaved changes' });
        }
        return t('location.state_saved', { defaultValue: 'Saved' });
    })();

    const statusColor = (() => {
        if (!hasLocation) return 'warning';
        if (locationSaving || locationLoading) return 'info';
        if (isDifferentFromSaved) return 'warning';
        return 'success';
    })();

    const nearestCityText = cityLoading
        ? t('location.state_resolving', { defaultValue: 'Resolving...' })
        : (nearestCity || t('location.state_unavailable', { defaultValue: 'Unavailable' }));

    const elevationText = elevationLoading
        ? t('location.state_resolving', { defaultValue: 'Resolving...' })
        : (hasLocation
            ? t('location.altitude_asl', { altitude })
            : t('location.state_unavailable', { defaultValue: 'Unavailable' }));

    const timezoneName = Intl.DateTimeFormat().resolvedOptions().timeZone || t('location.state_unavailable', { defaultValue: 'Unavailable' });
    const tzOffsetHours = -new Date().getTimezoneOffset() / 60;
    const tzSign = tzOffsetHours >= 0 ? '+' : '-';
    const tzOffsetDisplay = `UTC${tzSign}${Math.abs(tzOffsetHours)}`;

    const mapCenter = hasLocation ? [normalizedLocation.lat, normalizedLocation.lon] : [20, 0];
    const mapZoom = hasLocation ? 5 : 2;
    const selectedTileLayer = React.useMemo(
        () => getTileLayerById('satellite', { mapEngine: 'maplibre' }),
        []
    );
    const selectedTileURL = React.useMemo(
        () => getMapLibreTileURL('satellite', { mapEngine: 'maplibre' }),
        []
    );
    const mapStyle = React.useMemo(() => ({
        version: 8,
        sources: {
            basemap: {
                type: 'raster',
                tiles: [selectedTileURL],
                tileSize: 256,
                attribution: selectedTileLayer.attribution,
            },
        },
        layers: [
            {
                id: 'location-basemap',
                type: 'raster',
                source: 'basemap',
            },
        ],
    }), [selectedTileLayer.attribution, selectedTileURL]);
    const crosshairGeoJSON = React.useMemo(
        () => createCrosshairGeoJSON(polylines),
        [polylines]
    );
    const coverageGeoJSON = React.useMemo(
        () => createCoverageGeoJSON(normalizedLocation),
        [normalizedLocation]
    );
    const coordinateNumberFormatter = React.useMemo(
        () => new Intl.NumberFormat(locale, {
            minimumFractionDigits: 6,
            maximumFractionDigits: 6,
            useGrouping: false,
        }),
        [locale]
    );
    const formatCoordinateDisplay = React.useCallback((value, axis) => {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return t('location.state_unavailable', { defaultValue: 'Unavailable' });
        }

        const absoluteValue = coordinateNumberFormatter.format(Math.abs(numericValue));
        const hemisphere = axis === 'lat'
            ? (numericValue >= 0 ? 'N' : 'S')
            : (numericValue >= 0 ? 'E' : 'W');
        return `${absoluteValue}° ${hemisphere}`;
    }, [coordinateNumberFormatter, t]);
    const formatCoordinateOverlay = React.useCallback((value, axis) => {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) return '---';

        const absoluteValue = coordinateNumberFormatter.format(Math.abs(numericValue));
        const hemisphere = axis === 'lat'
            ? (numericValue >= 0 ? 'N' : 'S')
            : (numericValue >= 0 ? 'E' : 'W');
        return `${absoluteValue}° ${hemisphere}`;
    }, [coordinateNumberFormatter]);

    const handleMapClick = async (event) => {
        const lngLat = event?.lngLat;
        if (!lngLat) return;

        const lat = Number(lngLat.lat);
        const lng = Number(lngLat.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        updateLocationState({ lat, lon: lng });
        dispatch(setQth(getMaidenhead(lat, lng)));
        reCenterMap(lat, lng);

        setCityLoading(true);
        const city = await getNearestCity(lat, lng);
        setNearestCity(city);
        setCityLoading(false);
    };

    const handleZoomIn = () => {
        const liveMap = mapRef.current?.getMap?.();
        if (!liveMap) return;
        liveMap.easeTo({
            zoom: Math.min(MAPLIBRE_LOCATION_MAX_ZOOM, liveMap.getZoom() + 0.25),
            duration: 120,
        });
    };

    const handleZoomOut = () => {
        const liveMap = mapRef.current?.getMap?.();
        if (!liveMap) return;
        liveMap.easeTo({
            zoom: Math.max(MAPLIBRE_LOCATION_MIN_ZOOM, liveMap.getZoom() - 0.25),
            duration: 120,
        });
    };

    const getCurrentLocation = async () => {
        dispatch(setLocationLoading(true));

        if (!navigator.geolocation) {
            toast.warning(t('location.geolocation_not_supported'));
            dispatch(setLocationLoading(false));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude, altitude: geoAltitude } = position.coords;

                updateLocationState({ lat: latitude, lon: longitude });

                if (geoAltitude != null) {
                    dispatch(setAltitude(geoAltitude));
                } else {
                    setElevationLoading(true);
                    getElevation(latitude, longitude)
                        .then((elevation) => {
                            dispatch(setAltitude(elevation));
                        })
                        .catch((error) => {
                            console.error('Error fetching elevation:', error);
                            toast.warning(t('location.state_elevation_unavailable', { defaultValue: 'Could not resolve elevation from external service.' }));
                        })
                        .finally(() => {
                            setElevationLoading(false);
                        });
                }

                dispatch(setQth(getMaidenhead(latitude, longitude)));
                reCenterMap(latitude, longitude);
                dispatch(setLocationLoading(false));
                toast.success(t('location.location_retrieved'));
            },
            () => {
                toast.error(t('location.failed_get_location'));
                dispatch(setLocationLoading(false));
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 60000,
            }
        );
    };

    const handleCopyCoordinates = async () => {
        if (!hasLocation) return;

        try {
            await navigator.clipboard.writeText(`${normalizedLocation.lat.toFixed(6)}, ${normalizedLocation.lon.toFixed(6)}`);
            toast.success(t('location.coordinates_copied'));
        } catch (error) {
            toast.error(t('location.failed_copy'));
        }
    };

    const handleOpenManualCoordinatesDialog = () => {
        if (hasLocation) {
            setManualLatInput(normalizedLocation.lat.toFixed(6));
            setManualLonInput(normalizedLocation.lon.toFixed(6));
        } else {
            setManualLatInput('');
            setManualLonInput('');
        }
        setManualInputError('');
        setManualDialogOpen(true);
    };

    const handleCloseManualCoordinatesDialog = () => {
        setManualInputError('');
        setManualDialogOpen(false);
    };

    const handleApplyManualCoordinates = async () => {
        const parsedLat = Number.parseFloat(manualLatInput.trim());
        const parsedLon = Number.parseFloat(manualLonInput.trim());

        // Validate user-entered decimal coordinates before hydrating map/location state.
        if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon)) {
            setManualInputError(t('location.manual_coordinates_invalid', {
                defaultValue: 'Enter valid numeric latitude and longitude values.',
            }));
            return;
        }

        if (parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
            setManualInputError(t('location.manual_coordinates_range_error', {
                defaultValue: 'Latitude must be between -90 and 90, and longitude between -180 and 180.',
            }));
            return;
        }

        updateLocationState({ lat: parsedLat, lon: parsedLon });
        dispatch(setQth(getMaidenhead(parsedLat, parsedLon)));
        reCenterMap(parsedLat, parsedLon);

        setManualLatInput(parsedLat.toFixed(6));
        setManualLonInput(parsedLon.toFixed(6));
        setManualInputError('');
        setManualDialogOpen(false);

        setCityLoading(true);
        const city = await getNearestCity(parsedLat, parsedLon);
        setNearestCity(city);
        setCityLoading(false);
    };

    const handleSetLocation = async () => {
        if (!canSave) return false;

        try {
            await dispatch(storeLocation({ socket, location, altitude, locationId })).unwrap();
            setSavedState({
                lat: Number(location.lat),
                lon: Number(location.lon),
                altitude: Number(altitude || 0),
                name: normalizeStationName(location.name || 'home'),
                callsign: normalizeCallsign(location.callsign || ''),
                stationType: normalizeStationType(location.station_type),
                horizonMask: normalizeHorizonMask(location.horizon_mask),
                locationId: locationId || null,
            });
            return true;
        } catch (error) {
            // Toast handled in slice
            return false;
        }
    };

    const handleResetLocation = () => {
        if (!savedState) return;

        dispatch(setLocation({
            ...(location || {}),
            lat: savedState.lat,
            lon: savedState.lon,
            name: savedState.name,
            callsign: savedState.callsign,
            station_type: normalizeStationType(savedState.stationType),
            horizon_mask: normalizeHorizonMask(savedState.horizonMask),
        }));
        dispatch(setAltitude(savedState.altitude));
        dispatch(setLocationId(savedState.locationId));
        dispatch(setQth(getMaidenhead(savedState.lat, savedState.lon)));
        reCenterMap(savedState.lat, savedState.lon);
    };

    const stationIdentitySection = (
        <SettingsSection
            title={t('location.group_station_identity', { defaultValue: 'Station Identity' })}
            description={t('location.group_station_identity_help', {
                defaultValue: 'Name, callsign, station type, and local horizon mask for this ground station.',
            })}
            sx={locationCardSx}
        >
            <Grid container spacing={2} columns={12}>
                <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                        label={t('location.station_name', { defaultValue: 'Station Name' })}
                        value={stationName}
                        onChange={(event) => {
                            updateLocationState({ name: event.target.value });
                        }}
                        disabled={locationSaving}
                        helperText={t('location.station_name_help', {
                            defaultValue: 'Friendly name for this ground station.',
                        })}
                        fullWidth
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                        label={t('location.ham_callsign', { defaultValue: 'HAM Callsign' })}
                        value={stationCallsign}
                        onChange={(event) => {
                            updateLocationState({ callsign: event.target.value.toUpperCase() });
                        }}
                        disabled={locationSaving}
                        helperText={t('location.ham_callsign_help', {
                            defaultValue: 'Optional HAM callsign for this station.',
                        })}
                        fullWidth
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                        label={t('location.station_type', { defaultValue: 'Station Type' })}
                        value={stationType}
                        select
                        fullWidth
                        disabled={locationSaving}
                        onChange={(event) => {
                            updateLocationState({
                                station_type: normalizeStationType(event.target.value),
                            });
                        }}
                        helperText={t('location.station_type_help', {
                            defaultValue: 'Use stationary for fixed installs, mobile for portable setups.',
                        })}
                    >
                        <MenuItem value={STATION_TYPE_STATIONARY}>
                            {t('location.station_type_stationary', { defaultValue: 'Stationary' })}
                        </MenuItem>
                        <MenuItem value={STATION_TYPE_MOBILE}>
                            {t('location.station_type_mobile', { defaultValue: 'Mobile' })}
                        </MenuItem>
                    </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                        label={t('location.horizon_mask', { defaultValue: 'Horizon Mask (°)' })}
                        value={stationHorizonMask}
                        onChange={(event) => {
                            updateLocationState({ horizon_mask: normalizeHorizonMask(event.target.value) });
                        }}
                        disabled={locationSaving}
                        fullWidth
                        type="number"
                        InputProps={{
                            endAdornment: <InputAdornment position="end">°</InputAdornment>,
                        }}
                        inputProps={{ min: 0, max: 90, step: 'any' }}
                        helperText={t('location.horizon_mask_help', {
                            defaultValue: 'Minimum elevation in degrees. 0 means full horizon.',
                        })}
                    />
                </Grid>
            </Grid>
        </SettingsSection>
    );

    const stationCoordinatesSection = (
        <SettingsSection
            title={t('location.group_station_coordinates', { defaultValue: 'Station Coordinates' })}
            description={t('location.group_station_details_help', {
                defaultValue: 'Coordinates and derived station metadata for the selected point.',
            })}
            sx={locationCardSx}
        >
            {locationLoading && !hasLocation ? (
                <Stack spacing={1}>
                    <Skeleton variant="rounded" height={22} />
                    <Skeleton variant="rounded" height={22} />
                    <Skeleton variant="rounded" height={22} />
                    <Skeleton variant="rounded" height={22} />
                    <Skeleton variant="rounded" height={22} />
                    <Skeleton variant="rounded" height={22} />
                </Stack>
            ) : (
                <Grid container spacing={2} columns={12}>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="caption" color="text.secondary">{t('location.latitude')}</Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'text.primary' }}>
                            {hasLocation
                                ? formatCoordinateDisplay(normalizedLocation.lat, 'lat')
                                : t('location.state_unavailable', { defaultValue: 'Unavailable' })}
                        </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="caption" color="text.secondary">{t('location.longitude')}</Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'text.primary' }}>
                            {hasLocation
                                ? formatCoordinateDisplay(normalizedLocation.lon, 'lon')
                                : t('location.state_unavailable', { defaultValue: 'Unavailable' })}
                        </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="caption" color="text.secondary">{t('location.qth_locator')}</Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'text.primary' }}>
                            {hasLocation ? (qth || 'N/A') : t('location.state_unavailable', { defaultValue: 'Unavailable' })}
                        </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="caption" color="text.secondary">{t('location.altitude')}</Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'text.primary' }}>
                            {elevationText}
                        </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="caption" color="text.secondary">{t('location.timezone')}</Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'text.primary' }}>
                            {`${timezoneName} (${tzOffsetDisplay})`}
                        </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="caption" color="text.secondary">{t('location.nearest_city')}</Typography>
                        <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'text.primary' }}>
                            {nearestCityText}
                        </Typography>
                    </Grid>
                </Grid>
            )}
        </SettingsSection>
    );

    const stationActionsSection = (
        <SettingsSection
            title={t('location.actions', { defaultValue: 'Actions' })}
            description={t('location.group_actions_help', {
                defaultValue: 'Quick tools for selecting and sharing station coordinates.',
            })}
            sx={locationCardSx}
        >
            <Stack spacing={1.2}>
                <Button
                    variant="contained"
                    color="secondary"
                    fullWidth
                    disabled={locationLoading || locationSaving}
                    aria-label={t('location.get_current_location')}
                    onClick={getCurrentLocation}
                >
                    {locationLoading
                        ? t('location.state_locating', { defaultValue: 'Locating...' })
                        : t('location.get_current_location')}
                </Button>

                <Button
                    variant="outlined"
                    color="primary"
                    fullWidth
                    disabled={locationLoading || locationSaving}
                    aria-label={t('location.enter_coordinates', { defaultValue: 'Enter Coordinates' })}
                    onClick={handleOpenManualCoordinatesDialog}
                >
                    {t('location.enter_coordinates', { defaultValue: 'Enter Coordinates' })}
                </Button>

                <Button
                    variant="outlined"
                    color="primary"
                    fullWidth
                    disabled={!hasLocation}
                    aria-label={t('location.copy_coordinates')}
                    onClick={handleCopyCoordinates}
                >
                    {t('location.copy_coordinates')}
                </Button>

                <Button
                    variant="outlined"
                    fullWidth
                    disabled={!hasLocation}
                    aria-label={t('location.map_recenter', { defaultValue: 'Recenter map' })}
                    onClick={() => {
                        if (hasLocation) reCenterMap(normalizedLocation.lat, normalizedLocation.lon);
                    }}
                >
                    {t('location.map_recenter', { defaultValue: 'Recenter' })}
                </Button>

                {!hasLocation && (
                    <Typography variant="caption" color="warning.main">
                        {t('location.map_empty_hint', { defaultValue: 'No location selected yet. Click the map or use current location.' })}
                    </Typography>
                )}
            </Stack>
        </SettingsSection>
    );

    const locationMap = (
        <Map
            ref={mapRef}
            mapLib={maplibregl}
            mapStyle={mapStyle}
            initialViewState={{
                latitude: mapCenter[0],
                longitude: mapCenter[1],
                zoom: mapZoom,
            }}
            minZoom={MAPLIBRE_LOCATION_MIN_ZOOM}
            maxZoom={MAPLIBRE_LOCATION_MAX_ZOOM}
            attributionControl={false}
            onClick={handleMapClick}
            style={{ height: '100%', width: '100%' }}
        >
            {crosshairGeoJSON.features.length > 0 && (
                <Source id="location-crosshair-source" type="geojson" data={crosshairGeoJSON}>
                    <Layer
                        id="location-crosshair-layer"
                        type="line"
                        paint={{
                            'line-color': '#ffffff',
                            'line-opacity': 0.8,
                            'line-width': 1,
                            'line-dasharray': [2, 2],
                        }}
                    />
                </Source>
            )}

            {coverageGeoJSON && (
                <Source id="location-coverage-source" type="geojson" data={coverageGeoJSON}>
                    <Layer
                        id="location-coverage-layer"
                        type="line"
                        paint={{
                            'line-color': '#ffffff',
                            'line-opacity': 0.8,
                            'line-width': 1,
                            'line-dasharray': [2, 2],
                        }}
                    />
                </Source>
            )}

            {hasLocation && (
                <Marker longitude={normalizedLocation.lon} latitude={normalizedLocation.lat} anchor="center">
                    <Box
                        sx={{
                            width: 16,
                            height: 16,
                            borderRadius: '50%',
                            border: '2px solid #fff',
                            backgroundColor: '#3388ff',
                            boxShadow: '0 0 0 2px rgba(0, 0, 0, 0.35)',
                        }}
                    />
                </Marker>
            )}
        </Map>
    );

    const mapZoomControls = (
        <Box
            sx={{
                '& > :not(style)': { m: 1 },
                display: 'flex',
                flexDirection: 'column',
                position: 'absolute',
                left: 5,
                top: 5,
                zIndex: 500,
            }}
        >
            <Fab size="small" color="primary" aria-label={t('map_controls.zoom_in', { defaultValue: 'Zoom in' })} onClick={handleZoomIn}>
                <ZoomInIcon />
            </Fab>
            <Fab size="small" color="primary" aria-label={t('map_controls.zoom_out', { defaultValue: 'Zoom out' })} onClick={handleZoomOut}>
                <ZoomOutIcon />
            </Fab>
        </Box>
    );

    const mapSection = (
        <SettingsSection
            title={t('location.map_section_title', { defaultValue: 'Map Selection' })}
            description={t('location.map_instruction', {
                defaultValue: 'Click anywhere on the map to set your station coordinates.',
            })}
            sx={locationCardSx}
        >
            <Box
                sx={{
                    width: '100%',
                    height: { xs: 380, sm: 420, md: 500 },
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    boxShadow: 1,
                    '& .maplibregl-ctrl-attrib, & .maplibregl-ctrl-bottom-right': {
                        display: 'none !important',
                    },
                }}
            >
                {locationMap}
                {mapZoomControls}
            </Box>

            {!hasLocation && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    {t('location.map_empty_state', { defaultValue: 'No marker selected yet.' })}
                </Typography>
            )}
        </SettingsSection>
    );

    const wizardMapSection = (
        <SettingsSection
            sx={locationCardSx}
        >
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('location.wizard_map_click_hint', {
                    defaultValue: 'Click on the map to set your ground station location.',
                })}
            </Typography>
            <Box
                sx={{
                    position: 'relative',
                    width: '100%',
                    height: { xs: 370, sm: 410, md: 470 },
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    boxShadow: 1,
                    overflow: 'hidden',
                    '& .maplibregl-ctrl-attrib, & .maplibregl-ctrl-bottom-right': {
                        display: 'none !important',
                    },
                }}
            >
                {locationMap}
                {mapZoomControls}

                <Box
                    sx={{
                        position: 'absolute',
                        top: 12,
                        right: 12,
                        zIndex: 500,
                        pointerEvents: 'none',
                        width: { xs: 'calc(100% - 24px)', sm: 320 },
                    }}
                >
                    <Box
                        sx={{
                            p: 1.25,
                            borderRadius: 1,
                            border: '1px solid',
                            borderColor: 'divider',
                            boxShadow: 3,
                            backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.86),
                            backdropFilter: 'blur(8px)',
                        }}
                    >
                        <Stack spacing={0.9}>
                            <Stack direction="row" alignItems="center">
                                <Typography variant="caption" color="text.secondary">
                                    {t('location.station_summary', { defaultValue: 'Station' })}
                                </Typography>
                            </Stack>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                                {stationCallsignLabel
                                    ? `${stationLabel} (${stationCallsignLabel})`
                                    : stationLabel}
                            </Typography>
                            <Grid container spacing={0.8} columns={12}>
                                <Grid size={6}>
                                    <Typography variant="caption" color="text.secondary">{t('location.latitude')}</Typography>
                                    <Typography variant="caption" sx={{ display: 'block', fontFamily: 'monospace', color: 'text.primary' }}>
                                        {hasLocation ? formatCoordinateOverlay(normalizedLocation.lat, 'lat') : '---'}
                                    </Typography>
                                </Grid>
                                <Grid size={6}>
                                    <Typography variant="caption" color="text.secondary">{t('location.longitude')}</Typography>
                                    <Typography variant="caption" sx={{ display: 'block', fontFamily: 'monospace', color: 'text.primary' }}>
                                        {hasLocation ? formatCoordinateOverlay(normalizedLocation.lon, 'lon') : '---'}
                                    </Typography>
                                </Grid>
                                <Grid size={6}>
                                    <Typography variant="caption" color="text.secondary">{t('location.qth_locator')}</Typography>
                                    <Typography variant="caption" sx={{ display: 'block', fontFamily: 'monospace', color: 'text.primary' }}>
                                        {hasLocation ? (qth || 'N/A') : '---'}
                                    </Typography>
                                </Grid>
                                <Grid size={6}>
                                    <Typography variant="caption" color="text.secondary">{t('location.altitude')}</Typography>
                                    <Typography variant="caption" sx={{ display: 'block', fontFamily: 'monospace', color: 'text.primary' }}>
                                        {hasLocation ? elevationText : '---'}
                                    </Typography>
                                </Grid>
                                <Grid size={12}>
                                    <Typography variant="caption" color="text.secondary">{t('location.nearest_city')}</Typography>
                                    <Typography variant="caption" sx={{ display: 'block', fontFamily: 'monospace', color: 'text.primary' }}>
                                        {nearestCityText}
                                    </Typography>
                                </Grid>
                            </Grid>
                        </Stack>
                    </Box>
                </Box>

                <Box
                    sx={{
                        position: 'absolute',
                        bottom: 12,
                        left: 12,
                        right: 12,
                        zIndex: 500,
                        pointerEvents: 'none',
                    }}
                >
                    <Stack spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                        <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1}
                            sx={{ pointerEvents: 'auto' }}
                        >
                            <ButtonGroup size="small" variant="contained" aria-label={t('location.actions', { defaultValue: 'Actions' })}>
                                <Button
                                    disabled={locationLoading || locationSaving}
                                    onClick={getCurrentLocation}
                                >
                                    {locationLoading
                                        ? t('location.state_locating', { defaultValue: 'Locating...' })
                                        : t('location.get_current_location')}
                                </Button>
                                <Button
                                    disabled={locationLoading || locationSaving}
                                    onClick={handleOpenManualCoordinatesDialog}
                                >
                                    {t('location.enter_coordinates', { defaultValue: 'Enter Coordinates' })}
                                </Button>
                            </ButtonGroup>
                            <ButtonGroup size="small" variant="outlined" aria-label={t('location.actions', { defaultValue: 'Actions' })}>
                                <Button disabled={!hasLocation} onClick={handleCopyCoordinates}>
                                    {t('location.copy_coordinates')}
                                </Button>
                                <Button
                                    disabled={!hasLocation}
                                    onClick={() => {
                                        if (hasLocation) reCenterMap(normalizedLocation.lat, normalizedLocation.lon);
                                    }}
                                >
                                    {t('location.map_recenter', { defaultValue: 'Recenter' })}
                                </Button>
                            </ButtonGroup>
                        </Stack>
                        {!hasLocation && (
                            <Typography
                                variant="caption"
                                sx={{
                                    px: 1.25,
                                    py: 0.5,
                                    borderRadius: 1,
                                    color: 'warning.dark',
                                    backgroundColor: (theme) => alpha(theme.palette.warning.light, 0.85),
                                    pointerEvents: 'none',
                                }}
                            >
                                {t('location.map_empty_hint', { defaultValue: 'No location selected yet. Click the map or use current location.' })}
                            </Typography>
                        )}
                    </Stack>
                </Box>
            </Box>
        </SettingsSection>
    );

    const defaultLocationContent = (
        <>
            <Grid container spacing={2} columns={{ xs: 1, sm: 1, md: 1, lg: 2 }}>
                <Grid size={{ xs: 1, md: 1 }}>
                    <Stack spacing={2}>
                        {stationIdentitySection}
                        {stationCoordinatesSection}
                        {stationActionsSection}
                    </Stack>
                </Grid>
                <Grid size={{ xs: 1, md: 1 }}>
                    {mapSection}
                </Grid>
            </Grid>

            <SettingsActionFooter
                statusText={statusLabel}
                sticky
                mobileInline
                sx={{
                    backgroundColor: (theme) => (
                        theme.palette.mode === 'dark'
                            ? alpha(theme.palette.grey[700], 0.18)
                            : alpha(theme.palette.grey[100], 0.9)
                    ),
                }}
            >
                <Button
                    variant="outlined"
                    disabled={!canReset}
                    onClick={handleResetLocation}
                >
                    {t('location.reset', { defaultValue: 'Reset' })}
                </Button>
                <Button
                    variant="contained"
                    disabled={!canSave || !isDifferentFromSaved}
                    aria-label={t('location.save_location')}
                    onClick={handleSetLocation}
                >
                    {locationSaving
                        ? t('location.state_saving', { defaultValue: 'Saving...' })
                        : t('location.save_location', { defaultValue: 'Save location' })}
                </Button>
            </SettingsActionFooter>
        </>
    );
    const wizardReviewData = React.useMemo(
        () => ({
            stationName: normalizeStationName(stationName) || 'home',
            stationCallsignLabel,
            stationType,
            stationHorizonMask,
        }),
        [stationCallsignLabel, stationHorizonMask, stationName, stationType]
    );

    return (
        <SettingsSurface
            elevation={wizardMode ? 0 : 3}
            sx={wizardMode
                ? {
                    p: 0,
                    bgcolor: 'transparent',
                    boxShadow: 'none',
                    height: '100%',
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                }
                : undefined}
        >
            <Stack spacing={2} sx={wizardMode ? { height: '100%', minHeight: 0 } : undefined}>
                {!wizardMode && (
                    <SettingsSurfaceHeader
                        title={t('location.ground_station_location', { defaultValue: 'Ground Station Location' })}
                        subtitle={t('location.subtitle', {
                            defaultValue: 'Set station coordinates by map selection or geolocation, then save to backend.',
                        })}
                        status={{ label: statusLabel, color: statusColor }}
                    />
                )}

                {wizardMode ? (
                    <SetupWizard
                        wizardBackendReady={wizardBackendReady}
                        wizardRequireAdminSetup={wizardRequireAdminSetup}
                        hasLocation={hasLocation}
                        hasPersistedLocation={hasPersistedLocation}
                        canSave={canSave}
                        isDifferentFromSaved={isDifferentFromSaved}
                        locationSaving={locationSaving}
                        onPersistLocation={handleSetLocation}
                        onWizardCompleted={onWizardCompleted}
                        stationIdentitySection={stationIdentitySection}
                        stationCoordinatesSection={stationCoordinatesSection}
                        wizardMapSection={wizardMapSection}
                        reviewData={wizardReviewData}
                        sectionSx={locationCardSx}
                    />
                ) : (
                    defaultLocationContent
                )}
            </Stack>

            <Dialog
                open={manualDialogOpen}
                onClose={handleCloseManualCoordinatesDialog}
                fullWidth
                maxWidth="xs"
                PaperProps={{
                    component: 'form',
                    onSubmit: (event) => {
                        event.preventDefault();
                        handleApplyManualCoordinates();
                    },
                }}
            >
                <DialogTitle>
                    {t('location.manual_coordinates_title', { defaultValue: 'Set Coordinates Manually' })}
                </DialogTitle>
                <DialogContent sx={{ pt: '20px !important' }}>
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <TextField
                            label={t('location.latitude')}
                            type="number"
                            value={manualLatInput}
                            onChange={(event) => {
                                setManualLatInput(event.target.value);
                                if (manualInputError) {
                                    setManualInputError('');
                                }
                            }}
                            inputProps={{ min: -90, max: 90, step: 'any' }}
                            autoFocus
                            fullWidth
                        />
                        <TextField
                            label={t('location.longitude')}
                            type="number"
                            value={manualLonInput}
                            onChange={(event) => {
                                setManualLonInput(event.target.value);
                                if (manualInputError) {
                                    setManualInputError('');
                                }
                            }}
                            inputProps={{ min: -180, max: 180, step: 'any' }}
                            fullWidth
                        />
                        <Typography variant="caption" color={manualInputError ? 'error.main' : 'text.secondary'}>
                            {manualInputError || t('location.manual_coordinates_hint', {
                                defaultValue: 'Use decimal degrees. Example: 37.9838, 23.7275',
                            })}
                        </Typography>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseManualCoordinatesDialog}>
                        {t('location.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button type="submit" variant="contained">
                        {t('location.apply_coordinates', { defaultValue: 'Apply Coordinates' })}
                    </Button>
                </DialogActions>
            </Dialog>
        </SettingsSurface>
    );
};

export default LocationPage;
