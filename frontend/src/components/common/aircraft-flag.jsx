/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React from 'react';
import {Box, Tooltip} from '@mui/material';
import {useTranslation} from 'react-i18next';
import {aircraftCountry} from '../../utils/aircraft-country.js';

export default function AircraftFlag({icao}) {
    const {t} = useTranslation('common');
    const country = aircraftCountry(icao);
    if (!country) return null;
    const description = t('aircraft.registration_country', 'ICAO registration country: {{country}}', {country: country.name});
    // Unicode flags work offline and never request a remote image per aircraft.
    return <Tooltip title={description}>
        <Box component="span" role="img" aria-label={description}
            sx={{display: 'inline-block', fontSize: '1rem', lineHeight: 1, flexShrink: 0}}>
            {country.flag}
        </Box>
    </Tooltip>;
}
