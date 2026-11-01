import React, {useMemo} from 'react';
import {Alert, Box, Typography} from '@mui/material';
import {DataGrid, GridFooterContainer, GridPagination} from '@mui/x-data-grid';
import {useTranslation} from 'react-i18next';
import {useSocket} from '../common/socket.jsx';
import AircraftFlag from '../common/aircraft-flag.jsx';
import {aircraftCountry} from '../../utils/aircraft-country.js';
import useAircraft from './use-aircraft.js';

function AircraftFooter({aircraftCount}) {
    const {t} = useTranslation('waterfall');
    return <GridFooterContainer sx={{flexWrap: 'wrap', gap: 1}}>
        <Typography variant="caption" sx={{px: 1, py: 0.5}}>
            {t('adsb.live_summary', '{{count}} aircraft · Updates once per second · 1090 MHz', {count: aircraftCount})}
        </Typography>
        <GridPagination sx={{ml: 'auto'}} />
    </GridFooterContainer>;
}

export default function AircraftPanel() {
    const {socket} = useSocket();
    const {t} = useTranslation('waterfall');
    const {aircraft, error} = useAircraft(socket);
    const columns = useMemo(() => [
        {field: 'country', headerName: t('adsb.country', 'Country'), width: 85,
            description: t('adsb.country_description', 'Registration country inferred from the ICAO address'),
            valueGetter: (_value, row) => aircraftCountry(row.icao)?.name ?? '',
            renderCell: ({row}) => <AircraftFlag icao={row.icao} />},
        {field: 'icao', headerName: 'ICAO', width: 95, valueFormatter: (value) => value?.toUpperCase()},
        {field: 'callsign', headerName: t('adsb.callsign', 'Callsign'), width: 110},
        {field: 'altitude_baro_m', headerName: t('adsb.altitude', 'Baro altitude (m)'), width: 140, type: 'number', valueFormatter: (value) => value == null ? '—' : Math.round(value)},
        {field: 'groundspeed_mps', headerName: t('adsb.speed', 'Speed (m/s)'), width: 120, type: 'number', valueFormatter: (value) => value == null ? '—' : value.toFixed(1)},
        {field: 'track_deg', headerName: t('adsb.track', 'Track (°)'), width: 100, type: 'number'},
        {field: 'squawk', headerName: t('adsb.squawk', 'Squawk'), width: 90},
        {field: 'emergency', headerName: t('adsb.emergency', 'Emergency'), width: 160},
        {field: 'latitude', headerName: t('adsb.latitude', 'Latitude'), width: 110, type: 'number'},
        {field: 'longitude', headerName: t('adsb.longitude', 'Longitude'), width: 110, type: 'number'},
    ], [t]);
    return <Box sx={{height: '100%', minHeight: 160, display: 'flex', flexDirection: 'column'}}>
        {error && <Alert severity="warning">{error}</Alert>}
        <DataGrid rows={aircraft} getRowId={(row) => row.icao} columns={columns} density="compact"
            disableRowSelectionOnClick pageSizeOptions={[25, 50, 100]}
            initialState={{pagination: {paginationModel: {pageSize: 25}}}}
            slots={{footer: AircraftFooter}}
            slotProps={{footer: {aircraftCount: aircraft.length}}}
            sx={{flex: 1, minHeight: 0, border: 0}} />
    </Box>;
}
