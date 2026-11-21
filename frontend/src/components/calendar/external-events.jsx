import {useState} from 'react';
import {Box, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel,
    IconButton, Link, Stack, Typography} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import {useTranslation} from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';
import FeedRow from './feed-row.jsx';
import CalendarFeedSources from './feed-sources.jsx';

export function ExternalEventsStatus({status, locale, timezone}) {
    const {t} = useTranslation('calendar');
    const enabled = Boolean(status?.enabled);
    const format = value => new Date(value).toLocaleString(locale, {timeZone: timezone});
    // Failures that prevent syncing take priority over the last successful timestamp.
    const label = status?.storage_error ? t('external.storage_error')
        : status?.needs_consent_review ? t('external.review_terms')
            : enabled && status?.error ? t('external.sync_error')
                : enabled && status?.stale ? t('external.stale')
                    : enabled && status.last_success_at ? t('external.updated', {date: format(status.last_success_at)})
                        : enabled ? t('external.waiting') : '';
    if (!label) return null;
    return <Typography variant="caption" role="status"
        color={status?.error || status?.stale || status?.storage_error || status?.needs_consent_review ? 'warning.main' : 'text.secondary'}>
        {label}
    </Typography>;
}

export default function ExternalEvents({status, isAdmin, pending, error, onSave, onClearError}) {
    const {t} = useTranslation('calendar');
    const [open, setOpen] = useState(false);
    const [accepted, setAccepted] = useState(false);
    const [pendingFeed, setPendingFeed] = useState(null);
    const consented = Boolean(status?.consented);
    const busy = pending !== null;
    const definitions = [
        {id: 'announcements', label: t('external.label'), description: t('feeds.announcements_description')},
        {id: 'space_weather', label: t('feeds.space_weather'), description: t('feeds.weather_description')},
        {id: 'launches', label: t('feeds.launches'), description: t('feeds.launches_description')},
    ];
    const sections = [
        [t('external.service_heading'), t('external.introduction')],
        [t('external.privacy_heading'), t('external.connection')],
        [t('external.controls_heading'), t('external.cache')],
        [t('external.terms_heading'), t('external.terms')],
    ];

    const save = async (feed, enabled) => {
        if (await onSave(feed, enabled)) {
            setOpen(false);
            setAccepted(false);
            setPendingFeed(null);
        }
    };
    const openDisclosure = (feed = null) => {
        setPendingFeed(feed);
        setAccepted(false);
        onClearError();
        setOpen(true);
    };
    const close = () => {
        if (!busy) {setOpen(false); setAccepted(false); setPendingFeed(null); onClearError();}
    };

    return <>
        <Box component="section" aria-labelledby="calendar-external-feeds-title">
            <Typography id="calendar-external-feeds-title" component="h3" variant="subtitle2">{t('feeds.external_feeds')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{mt: 0.5, mb: 1.5, lineHeight: 1.6}}>{t('feeds.announcements_hint')}</Typography>
            <Stack divider={<Divider />} sx={{border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden'}}>
                {definitions.map(({id, label, description}) => <FeedRow key={id}
                    event={{source: 'gscontrol', feed_id: id}} label={label} description={description}
                    checked={status?.feeds?.find(feed => feed.id === id)?.enabled ?? (id === 'announcements' && Boolean(status?.enabled))}
                    disabled={!isAdmin || !status || busy} busy={pending === id} error={error === id && !open}
                    onChange={enabled => {
                        if (enabled && !consented) openDisclosure(id);
                        else save(id, enabled);
                    }} />)}
            </Stack>
            <Box sx={{mt: 1.5}}>
                <Link component="button" type="button" variant="caption" underline="hover" disabled={busy}
                    onClick={() => openDisclosure(!consented ? definitions.find(({id}) => status?.feeds?.find(feed => feed.id === id)?.enabled)?.id || null : null)}
                    sx={{textAlign: 'start', '&:disabled': {color: 'text.disabled', cursor: 'default'}}}>
                    {t('external.about')}
                </Link>
            </Box>
        </Box>
        <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="external-events-title"
            slotProps={{paper: {sx: {borderRadius: 2, m: {xs: 1.5, sm: 4}, maxWidth: 600,
                width: {xs: 'calc(100% - 24px)', sm: 'calc(100% - 64px)'},
                maxHeight: {xs: 'calc(100% - 24px)', sm: 'calc(100% - 64px)'}}}}}>
            <DialogTitle id="external-events-header" component="div" sx={{p: {xs: 2, sm: 3}, pr: {xs: 6, sm: 7}}}>
                <Typography id="external-events-title" component="h2" variant="h6" fontWeight={650}>{t('external.title')}</Typography>
                <IconButton aria-label={t('close')} onClick={close} disabled={busy}
                    sx={{position: 'absolute', right: 12, top: 14}}><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent dividers sx={{p: {xs: 2, sm: 3}}}>
                <Stack spacing={2.5}>
                    {sections.map(([heading, body]) => <Box component="section" aria-label={heading} key={heading}>
                        <Typography component="h3" variant="subtitle2" sx={{mb: 0.75}}>{heading}</Typography>
                        <Typography variant="body2" sx={{lineHeight: 1.75}}>{body}</Typography>
                    </Box>)}
                    <CalendarFeedSources />
                    {isAdmin && !consented && status && pendingFeed && <Box sx={{p: 1.5, border: '1px solid',
                        borderColor: 'divider', borderRadius: 1.5, bgcolor: 'action.hover'}}>
                        <FormControlLabel sx={{m: 0, alignItems: 'flex-start', '& .MuiFormControlLabel-label': {pt: 0.5}}}
                            control={<Checkbox checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={busy} sx={{p: 0.5, mr: 1}} />}
                            label={<Typography variant="body2" sx={{lineHeight: 1.6}}>{t('external.accept')}</Typography>} />
                    </Box>}
                    {error && <Typography color="error" role="alert">{t('external.save_error')}</Typography>}
                </Stack>
            </DialogContent>
            <DialogActions sx={{px: {xs: 2, sm: 3}, py: 1.5, flexWrap: 'wrap', gap: 1}}>
                <CapsButton onClick={close} disabled={busy}>{t('close')}</CapsButton>
                {isAdmin && !consented && status && pendingFeed && <CapsButton variant="contained" disableElevation
                    loading={pending === pendingFeed} disabled={!accepted || busy} onClick={() => save(pendingFeed, true)}>{t('external.enable')}</CapsButton>}
            </DialogActions>
        </Dialog>
    </>;
}
