import {useState} from 'react';
import {Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel,
    IconButton, Stack, Switch, Tooltip, Typography} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import {useTranslation} from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';
import ExternalEvents from './external-events.jsx';

export default function FeedSettings({observationsEnabled, onObservationsChanged, status, onChanged, locale, timezone}) {
    const {t} = useTranslation('calendar');
    const [open, setOpen] = useState(false);

    return <>
        <Tooltip title={t('feeds.title')}>
            <IconButton size="small" aria-label={t('feeds.title')} onClick={() => setOpen(true)}>
                <SettingsIcon />
            </IconButton>
        </Tooltip>
        <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm" aria-labelledby="calendar-feeds-title">
            <DialogTitle id="calendar-feeds-title">{t('feeds.title')}</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2}>
                    <Stack spacing={0.5}>
                        <FormControlLabel label={t('sources.observations')}
                            control={<Switch size="small" checked={observationsEnabled}
                                slotProps={{input: {role: 'switch'}}}
                                onChange={(_, checked) => onObservationsChanged(checked)} />} />
                        <Typography variant="body2" color="text.secondary">{t('feeds.observations_hint')}</Typography>
                    </Stack>
                    <Divider />
                    {/* Keep the consent dialog inside this modal's React tree
                        so it opens above settings and restores focus here. */}
                    <ExternalEvents status={status} onChanged={onChanged} locale={locale} timezone={timezone} />
                </Stack>
            </DialogContent>
            <DialogActions>
                <CapsButton onClick={() => setOpen(false)}>{t('close')}</CapsButton>
            </DialogActions>
        </Dialog>
    </>;
}
