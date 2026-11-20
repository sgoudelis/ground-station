import {useState} from 'react';
import {useSelector} from 'react-redux';
import {Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel,
    IconButton, Stack, Switch, Tooltip, Typography} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import {useTranslation} from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';
import ExternalEvents from './external-events.jsx';
import {useSocket} from '../common/socket.jsx';

export default function FeedSettings({observationsEnabled, status, onChanged, locale, timezone}) {
    const {t} = useTranslation('calendar');
    const [open, setOpen] = useState(false);
    const {socket} = useSocket();
    const isAdmin = useSelector(state => state.auth?.user?.role === 'admin');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const saveObservations = async enabled => {
        setBusy(true); setError(false);
        try {
            const reply = await socket.timeout(15000).emitWithAck('api.call', {
                cmd: 'calendar.external.update', data: {feed_id: 'observations', enabled},
            });
            if (!reply?.success) throw new Error('Settings unavailable');
            onChanged(reply.data);
        } catch {setError(true);}
        finally {setBusy(false);}
    };

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
                            control={<Switch size="small" checked={observationsEnabled} disabled={!isAdmin || !status || busy}
                                slotProps={{input: {role: 'switch'}}}
                                onChange={(_, checked) => saveObservations(checked)} />} />
                        <Typography variant="body2" color="text.secondary">{t('feeds.observations_hint')}</Typography>
                        {error && <Typography color="error" role="alert">{t('external.save_error')}</Typography>}
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
