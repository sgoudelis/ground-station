import {useId} from 'react';
import {Box, CircularProgress, Stack, Switch, Typography} from '@mui/material';
import {alpha} from '@mui/material/styles';
import {useTranslation} from 'react-i18next';
import {EventIcon} from './event-badges.jsx';
import {eventAccent} from './presentation.js';

export default function FeedRow({event, label, description, checked, disabled, busy, error, onChange}) {
    const {t} = useTranslation('calendar');
    const id = useId();
    return <Box sx={{display: 'grid', gridTemplateColumns: '38px minmax(0, 1fr) auto',
        alignItems: 'center', columnGap: {xs: 1.25, sm: 1.75}, rowGap: 0.75, p: {xs: 1.5, sm: 2}}}>
        <Box aria-hidden="true" sx={theme => ({display: 'grid', placeItems: 'center', width: 38, height: 38,
            borderRadius: 1.5, color: eventAccent(event, theme), bgcolor: alpha(eventAccent(event, theme), 0.1)})}>
            <EventIcon event={event} sx={{fontSize: 21}} />
        </Box>
        <Box component="label" htmlFor={id} sx={{minWidth: 0, cursor: disabled ? 'default' : 'pointer'}}>
            <Typography component="span" id={`${id}-label`} variant="body2" fontWeight={650} display="block">{label}</Typography>
            <Typography component="span" id={`${id}-description`} variant="caption" color="text.secondary"
                display="block" sx={{mt: 0.35, lineHeight: 1.5}}>{description}</Typography>
        </Box>
        <Stack direction="row" alignItems="center" gap={0.5}>
            {busy && <CircularProgress size={14} aria-label={t('feeds.saving')} />}
            <Switch size="small" checked={checked} disabled={disabled} onChange={(_, enabled) => onChange(enabled)}
                slotProps={{input: {id, role: 'switch', 'aria-labelledby': `${id}-label`,
                    'aria-describedby': `${id}-description${error ? ` ${id}-error` : ''}`, 'aria-busy': Boolean(busy)}}} />
        </Stack>
        {error && <Typography id={`${id}-error`} variant="caption" color="error" role="alert" sx={{gridColumn: '2 / -1'}}>
            {t('external.save_error')}
        </Typography>}
    </Box>;
}
