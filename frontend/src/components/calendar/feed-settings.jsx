import {useState} from 'react';
import {useSelector} from 'react-redux';
import {Box, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Tooltip, Typography} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import CloseIcon from '@mui/icons-material/Close';
import {useTranslation} from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';
import ExternalEvents from './external-events.jsx';
import FeedRow from './feed-row.jsx';
import {useSocket} from '../common/socket.jsx';

export default function FeedSettings({observationsEnabled, status, onChanged, open, onOpen, onClose}) {
    const {t} = useTranslation('calendar');
    const {socket} = useSocket();
    const isAdmin = useSelector(state => state.auth?.user?.role === 'admin');
    const [pending, setPending] = useState(null);
    const [error, setError] = useState(null);
    const busy = pending !== null;
    const save = async (feed, enabled) => {
        if (busy || !isAdmin || !status) return false;
        // All switches share one mutation at a time: each reply contains the
        // complete station selection and must not overwrite a concurrent save.
        setPending(feed);
        setError(null);
        try {
            const reply = await socket.timeout(15000).emitWithAck('api.call', {
                cmd: 'calendar.external.update',
                data: {feed_id: feed, enabled,
                    ...(feed !== 'observations' && enabled && !status.consented ? {terms_version: status.terms_version} : {})},
            });
            if (!reply?.success) throw new Error('Settings unavailable');
            onChanged(reply.data);
            return true;
        } catch {
            setError(feed);
            return false;
        } finally {
            setPending(null);
        }
    };
    const close = () => {if (!busy) {onClose(); setError(null);}};

    return <>
        <Tooltip title={t('feeds.title')}>
            <IconButton size="small" aria-label={t('feeds.title')} onClick={() => {setError(null); onOpen();}}>
                <SettingsIcon />
            </IconButton>
        </Tooltip>
        <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="calendar-feeds-title"
            aria-describedby="calendar-feeds-description" slotProps={{paper: {sx: {borderRadius: 2, m: {xs: 1.5, sm: 4},
                width: {xs: 'calc(100% - 24px)', sm: 'calc(100% - 64px)'}, maxWidth: 600,
                maxHeight: {xs: 'calc(100% - 24px)', sm: 'calc(100% - 64px)'}}}}}>
            <DialogTitle id="calendar-feeds-header" component="div" sx={{p: {xs: 2, sm: 3}, pr: {xs: 6, sm: 7}}}>
                <Typography id="calendar-feeds-title" component="h2" variant="h6" fontWeight={650}>{t('feeds.title')}</Typography>
                <Typography id="calendar-feeds-description" variant="body2" color="text.secondary" sx={{mt: 0.5}}>{t('feeds.station_wide')}</Typography>
                <IconButton aria-label={t('close')} onClick={close} disabled={busy}
                    sx={{position: 'absolute', right: 12, top: 14}}><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent dividers sx={{p: {xs: 2, sm: 3}}}>
                <Stack spacing={3}>
                    <Box component="section" aria-labelledby="calendar-station-feeds-title">
                        <Typography id="calendar-station-feeds-title" component="h3" variant="subtitle2" sx={{mb: 1.25}}>{t('feeds.station_data')}</Typography>
                        <Box sx={{border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden'}}>
                            <FeedRow event={{source: 'observations'}} label={t('sources.observations')}
                                description={t('feeds.observations_hint')} checked={observationsEnabled}
                                disabled={!isAdmin || !status || busy} busy={pending === 'observations'} error={error === 'observations'}
                                onChange={enabled => save('observations', enabled)} />
                        </Box>
                    </Box>
                    {/* Keep consent inside this modal's React tree so it opens
                        above settings and restores focus to the selected feed. */}
                    <ExternalEvents status={status} isAdmin={isAdmin} pending={pending} error={error}
                        onSave={save} onClearError={() => setError(null)} />
                </Stack>
            </DialogContent>
            <DialogActions sx={{px: {xs: 2, sm: 3}, py: 1.5, gap: 1.5}}>
                <Typography variant="caption" color="text.secondary" sx={{flex: 1}}>
                    {isAdmin ? t('feeds.autosave') : t('external.admin_only')}
                </Typography>
                <CapsButton variant="outlined" onClick={close} disabled={busy}>{t('close')}</CapsButton>
            </DialogActions>
        </Dialog>
    </>;
}
