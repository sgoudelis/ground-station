/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useId} from 'react';
import {Box, Link, Typography} from '@mui/material';
import {useTranslation} from 'react-i18next';
import {AIRCRAFT_FIELDS, aircraftLabel, aircraftValue} from '../../utils/aircraft-metadata.js';

export function AircraftAttribution({database}) {
    const {t} = useTranslation('common');
    if (!database) return null;
    return <Typography component="div" variant="caption" sx={{color: 'text.secondary', p: 1, fontSize: '0.65rem'}}>
        {t('aircraft.attribution_prefix', 'Contains information from the')}{' '}
        <Link href="https://github.com/Mictronics/aircraft-database" target="_blank" rel="noopener noreferrer">
            Mictronics Aircraft Database
        </Link>{' '}
        {t('aircraft.attribution_license', 'available under the')}{' '}
        <Link href="https://opendatacommons.org/licenses/by/1-0/" target="_blank" rel="noopener noreferrer">
            ODC Attribution License
        </Link>.
        {database.version != null && <> {t('aircraft.database_version', 'Version')}: {database.version}.</>}
        {database.date && <> {t('aircraft.snapshot', 'Snapshot')}: {database.date}.</>}
    </Typography>;
}

export default function AircraftDetails({aircraft}) {
    const {t} = useTranslation('common');
    const titleId = useId();
    if (!aircraft) return null;
    return <Box component="section" aria-labelledby={titleId} sx={{my: 1.5}}>
        <Typography id={titleId} variant="overline" sx={{fontSize: '0.7rem', color: 'secondary.main'}}>
            {t('aircraft.details', 'Aircraft details')}
        </Typography>
        <Box component="dl" sx={{display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25, m: 0}}>
            {Object.keys(AIRCRAFT_FIELDS).map((key) => <Box key={key} sx={{minWidth: 0}}>
                <Typography component="dt" variant="caption" color="text.secondary">{aircraftLabel(key, t)}</Typography>
                <Typography component="dd" variant="body2" sx={{m: 0, overflowWrap: 'anywhere'}}>
                    {aircraftValue(aircraft, key, t)}
                </Typography>
            </Box>)}
        </Box>
        <Typography variant="caption" color="text.secondary" component="p" sx={{mb: 0}}>
            {t('aircraft.classification_note', 'Military markings come from database flags or ICAO address ranges. Unclassified does not establish civilian or recreational use.')}
            {' '}{t('aircraft.operator_note', 'Operator details are inferred from the broadcast callsign prefix and do not establish aircraft ownership.')}
        </Typography>
        <AircraftAttribution database={aircraft.database} />
    </Box>;
}
