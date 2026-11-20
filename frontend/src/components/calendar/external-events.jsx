import {useState} from 'react';
import {useSelector} from 'react-redux';
import {Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
    Stack, Switch, Typography} from '@mui/material';
import {useTranslation} from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';
import {useSocket} from '../common/socket.jsx';

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

export default function ExternalEvents({status, onChanged, locale, timezone}) {
    const {t} = useTranslation('calendar');
    const {socket} = useSocket();
    const isAdmin = useSelector(state => state.auth?.user?.role === 'admin');
    const [open, setOpen] = useState(false);
    const [accepted, setAccepted] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const consented = Boolean(status?.consented);
    const [pendingFeed, setPendingFeed] = useState(null);
    const definitions = [
        ['announcements', 'external.label'], ['space_weather', 'feeds.space_weather'], ['launches', 'feeds.launches'],
    ];

    const save = async (feed, enabled, revoke = false) => {
        setBusy(true);
        setError(false);
        try {
            const reply = await socket.timeout(15000).emitWithAck('api.call', {
                cmd: 'calendar.external.update',
                data: revoke ? {revoke: true} : {feed_id: feed, enabled,
                    ...(enabled && !consented ? {terms_version: status.terms_version} : {})},
            });
            if (!reply?.success) throw new Error('Settings unavailable');
            onChanged(reply.data);
            setOpen(false);
            setAccepted(false);
        } catch {
            setError(true);
        } finally {
            setBusy(false);
        }
    };
    const close = () => {if (!busy) {setOpen(false); setAccepted(false); setError(false);}};

    return <>
        <Stack spacing={1} alignItems="flex-start">
            {definitions.map(([id, label]) => <FormControlLabel key={id} label={t(label)}
                control={<Switch size="small" checked={status?.feeds?.find(feed => feed.id === id)?.enabled ?? (id === 'announcements' && Boolean(status?.enabled))}
                    disabled={!isAdmin || !status || busy} slotProps={{input: {role: 'switch'}}}
                    onChange={(_, checked) => {
                        if (checked && !consented) {
                            setPendingFeed(id); setAccepted(false); setError(false); setOpen(true);
                        } else save(id, checked);
                    }} />} />)}
            <Typography variant="body2" color="text.secondary">{t('feeds.announcements_hint')}</Typography>
            <CapsButton size="small" onClick={() => {setPendingFeed(!consented ? definitions.find(([id]) => status?.feeds?.find(feed => feed.id === id)?.enabled)?.[0] || null : null); setAccepted(false); setError(false); setOpen(true);}}>
                {t('external.about')}
            </CapsButton>
            {!isAdmin && <Typography variant="caption" color="text.secondary">{t('external.admin_only')}</Typography>}
            <ExternalEventsStatus status={status} locale={locale} timezone={timezone} />
            {status?.enabled && status?.outside_coverage && <Typography variant="caption" color="text.secondary">
                {t('external.outside_coverage')}
            </Typography>}
            {isAdmin && consented && <CapsButton size="small" color="warning" disabled={busy} onClick={() => save(null, false, true)}>{t('feeds.withdraw')}</CapsButton>}
            {error && !open && <Typography variant="caption" color="error" role="alert">{t('external.save_error')}</Typography>}
        </Stack>
        <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="external-events-title">
            <DialogTitle id="external-events-title">{t('external.title')}</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2}>
                    <Typography variant="body2">{t('external.introduction')}</Typography>
                    <Typography variant="body2">{t('external.connection')}</Typography>
                    <Typography variant="body2">{t('external.cache')}</Typography>
                    <Typography variant="body2">{t('external.terms')}</Typography>
                    {isAdmin && !consented && status && pendingFeed && <FormControlLabel
                        control={<Checkbox checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={busy} />}
                        label={t('external.accept')} />}
                    {error && <Typography color="error" role="alert">{t('external.save_error')}</Typography>}
                </Stack>
            </DialogContent>
            <DialogActions>
                <CapsButton onClick={close} disabled={busy}>{t('close')}</CapsButton>
                {isAdmin && !consented && status && pendingFeed && <CapsButton variant="contained" disableElevation
                    disabled={!accepted || busy} onClick={() => save(pendingFeed, true)}>{t('external.enable')}</CapsButton>}
            </DialogActions>
        </Dialog>
    </>;
}
