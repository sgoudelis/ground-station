import React, {useMemo} from 'react';
import {Alert, Box, Typography} from '@mui/material';
import {DataGrid} from '@mui/x-data-grid';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';
import {useSocket} from '../common/socket.jsx';
import AircraftFlag from '../common/aircraft-flag.jsx';
import {decodedTableSx} from '../common/decoded-table-styles.js';
import DecodedTableFooter from '../common/decoded-table-footer.jsx';
import {getReceiverDistances, isValidMapPosition} from '../filebrowser/position-utils.js';
import {aircraftCountry} from '../../utils/aircraft-country.js';
import useAircraft from './use-aircraft.js';

function AircraftFooter({stats}) {
    const {t} = useTranslation('waterfall');
    const metrics = [
        {label: t('adsb.stats_aircraft_short', 'ac'), value: stats.aircraftCount,
            title: t('adsb.stats_aircraft', 'Tracked aircraft')},
        {label: t('adsb.stats_positions_short', 'pos'), value: stats.positionCount,
            title: t('adsb.stats_positions', 'Aircraft with a decoded position')},
        {label: t('adsb.stats_callsigns_short', 'calls'), value: stats.callsignCount,
            title: t('adsb.stats_callsigns', 'Aircraft with a callsign')},
        {label: t('adsb.stats_ground_short', 'gnd'), value: stats.groundCount,
            title: t('adsb.stats_ground', 'Aircraft reporting they are on the ground')},
        {label: t('adsb.stats_range_short', 'max'),
            value: stats.maxDistanceKm === null ? '—' : `${stats.maxDistanceKm.toFixed(1)} km`,
            title: t('adsb.stats_range', 'Farthest aircraft from your station')},
    ];
    return <DecodedTableFooter>
        <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, overflow: 'hidden',
            fontFamily: 'monospace', fontSize: '0.72rem', color: 'text.secondary',
            whiteSpace: 'nowrap',
        }}>
            <Typography variant="caption" sx={{fontWeight: 700, color: 'text.primary', fontSize: '0.68rem'}}>
                ADSB
            </Typography>
            {metrics.map(({label, value, title}) => <React.Fragment key={label}>
                <Box component="span" sx={{opacity: 0.55}}>•</Box>
                <Box component="span" title={title}>
                    {label}: <Box component="span" sx={{fontWeight: 700}}>{value}</Box>
                </Box>
            </React.Fragment>)}
        </Box>
    </DecodedTableFooter>;
}

export default function AircraftPanel() {
    const {socket} = useSocket();
    const {t} = useTranslation('waterfall');
    const {aircraft, error} = useAircraft(socket);
    const receiver = useSelector((state) => state.location?.location);
    const {rows, stats} = useMemo(() => {
        const stats = {aircraftCount: aircraft.length, positionCount: 0, callsignCount: 0,
            groundCount: 0, maxDistanceKm: null};
        // Gather footer metrics in the existing row pass; no extra timers or subscriptions.
        const rows = aircraft.map((record) => {
            const distance = getReceiverDistances(record, receiver)?.groundKm ?? null;
            if (isValidMapPosition(record.latitude, record.longitude)) stats.positionCount += 1;
            if (record.callsign?.trim()) stats.callsignCount += 1;
            if (record.on_ground === true) stats.groundCount += 1;
            if (distance !== null && (stats.maxDistanceKm === null || distance > stats.maxDistanceKm)) {
                stats.maxDistanceKm = distance;
            }
            return {...record, distance_km: distance};
        });
        return {rows, stats};
    }, [aircraft, receiver]);
    const columns = useMemo(() => [
        {field: 'country', headerName: t('adsb.country', 'Country'), width: 85,
            description: t('adsb.country_description', 'Registration country inferred from the ICAO address'),
            valueGetter: (_value, row) => aircraftCountry(row.icao)?.name ?? '',
            renderCell: ({row}) => <AircraftFlag icao={row.icao} />},
        {field: 'icao', headerName: 'ICAO', width: 95, valueFormatter: (value) => value?.toUpperCase()},
        {field: 'callsign', headerName: t('adsb.callsign', 'Callsign'), minWidth: 110, flex: 1.1,
            renderCell: ({value}) => <Typography variant="caption" noWrap sx={{color: 'primary.main', fontWeight: 600}}>
                {value}
            </Typography>},
        {field: 'distance_km', headerName: t('adsb.distance', 'Distance (km)'), minWidth: 130, flex: 1.3, type: 'number',
            description: t('adsb.distance_description', 'Ground distance from your configured station location'),
            valueFormatter: (value) => value == null ? '—' : value.toFixed(1),
            getSortComparator: (direction) => (left, right, leftCell, rightCell) => {
                // Keep unknown positions last in either direction and break ties by ICAO.
                if (left == null && right != null) return 1;
                if (right == null && left != null) return -1;
                const difference = (left ?? 0) - (right ?? 0);
                return (direction === 'desc' ? -difference : difference)
                    || String(leftCell.id).localeCompare(String(rightCell.id));
            }},
        {field: 'altitude_baro_m', headerName: t('adsb.altitude', 'Baro altitude (m)'), minWidth: 140, flex: 1.4, type: 'number', valueFormatter: (value) => value == null ? '—' : Math.round(value)},
        {field: 'groundspeed_mps', headerName: t('adsb.speed', 'Speed (m/s)'), minWidth: 120, flex: 1.2, type: 'number', valueFormatter: (value) => value == null ? '—' : value.toFixed(1)},
        {field: 'track_deg', headerName: t('adsb.track', 'Track (°)'), minWidth: 100, flex: 1, type: 'number'},
        {field: 'squawk', headerName: t('adsb.squawk', 'Squawk'), minWidth: 90, flex: 0.9},
        {field: 'emergency', headerName: t('adsb.emergency', 'Emergency'), minWidth: 160, flex: 1.6},
        {field: 'latitude', headerName: t('adsb.latitude', 'Latitude'), minWidth: 110, flex: 1.1, type: 'number'},
        {field: 'longitude', headerName: t('adsb.longitude', 'Longitude'), minWidth: 110, flex: 1.1, type: 'number'},
    ], [t]);
    return <Box sx={{height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'background.paper'}}>
        {error && <Alert severity="warning">{error}</Alert>}
        <DataGrid rows={rows} getRowId={(row) => row.icao} columns={columns} density="compact"
            disableRowSelectionOnClick pageSizeOptions={[25, 50, 100]}
            initialState={{pagination: {paginationModel: {pageSize: 25}},
                sorting: {sortModel: [{field: 'distance_km', sort: 'asc'}]}}}
            slots={{footer: AircraftFooter}}
            slotProps={{footer: {stats}}}
            localeText={{noRowsLabel: t('adsb.no_aircraft', 'No decoded aircraft yet')}}
            sx={{...decodedTableSx, flex: 1, minHeight: 0}} />
    </Box>;
}
