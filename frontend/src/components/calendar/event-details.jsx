import {useEffect, useRef, useState} from 'react';
import {useDispatch} from 'react-redux';
import {
    Alert, Box, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
    Divider, IconButton, Link, Stack, Typography,
} from '@mui/material';
import {alpha} from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import {useTranslation} from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';
import {useSocket} from '../common/socket.jsx';
import {setDialogOpen, setSelectedObservation} from '../scheduler/scheduler-slice.jsx';
import {addDays, civilDate} from './dates.js';
import {frequencyLabel, satelliteNames} from './events.js';
import {ActivityBadge, ObservationBadges, SourceLabel} from './event-badges.jsx';
import {isLocalObservation, sourceAccent, sourceLink, windowDuration} from './presentation.js';

function DetailFields({fields}) {
    return <Box component="dl" sx={{display: 'grid', gridTemplateColumns: {xs: '1fr', sm: '145px minmax(0, 1fr)'},
        columnGap: 2, rowGap: {xs: 0.5, sm: 1.25}, m: 0}}>
        {fields.filter(([, value]) => value != null && value !== '').map(([label, value]) => <Box key={label} sx={{display: 'contents'}}>
            <Typography component="dt" variant="body2" color="text.secondary">{label}</Typography>
            <Typography component="dd" variant="body2" sx={{m: 0, mb: {xs: 1, sm: 0}, overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums'}}>
                {value}
            </Typography>
        </Box>)}
    </Box>;
}

function DetailSection({title, children}) {
    return <Box component="section" aria-label={title} sx={{minWidth: 0}}>
        <Typography component="h3" variant="subtitle2" fontWeight={650} sx={{mb: 1.5}}>{title}</Typography>
        {children}
    </Box>;
}

function TimeWindow({event, timezone, locale, format}) {
    const {t} = useTranslation('calendar');
    const local = isLocalObservation(event);
    const dated = event.time_precision && event.time_precision !== 'instant';
    const formatDate = value => civilDate(value).toLocaleDateString(locale, {timeZone: 'UTC', dateStyle: 'medium'});
    const duration = windowDuration(event, locale);
    return <Box component="section" aria-label={local ? t('details.scheduled_task') : t('details.activity_window')}
        sx={theme => ({p: 2, borderRadius: 1.5, bgcolor: alpha(sourceAccent(event, theme), theme.palette.mode === 'dark' ? 0.1 : 0.055),
            border: '1px solid', borderColor: alpha(sourceAccent(event, theme), 0.22)})}>
        <Typography component="h3" variant="subtitle2" fontWeight={650} sx={{mb: 1.5}}>
            {local ? t('details.scheduled_task') : t('details.activity_window')}
        </Typography>
        <Box component="dl" sx={{display: 'grid', gridTemplateColumns: {xs: '1fr', sm: '1fr 1fr'}, gap: 2, m: 0}}>
            {[[t('starts'), dated ? formatDate(event.start) : format(event.start)],
                // Feed boundaries are exclusive, while an announcement's date
                // range is presented with an inclusive final civil date.
                [t('ends'), dated ? formatDate(addDays(event.end, -1)) : format(event.end)]]
                .map(([label, value]) => <Box key={label}>
                    <Typography component="dt" variant="caption" color="text.secondary" sx={{mb: 0.5}}>{label}</Typography>
                    <Typography component="dd" variant="body1" fontWeight={650} sx={{m: 0, fontVariantNumeric: 'tabular-nums'}}>{value}</Typography>
                </Box>)}
        </Box>
        <Stack direction="row" gap={2} useFlexGap flexWrap="wrap" sx={{mt: 1.5}}>
            <Typography variant="caption" color="text.secondary">
                {dated ? t(event.time_precision === 'date' ? 'external.date_only' : 'external.time_unspecified') : timezone}
            </Typography>
            {duration && <Typography variant="caption" color="text.secondary">{t('details.duration', {duration})}</Typography>}
        </Stack>
        {!local && <>
            {event.timing_note && <Typography variant="body2" sx={{mt: 1.5, whiteSpace: 'pre-line', overflowWrap: 'anywhere'}}>
                {event.timing_note}
            </Typography>}
            <Typography variant="caption" color="text.secondary" display="block" sx={{mt: 1.5}}>{t('details.window_note')}</Typography>
        </>}
    </Box>;
}

export default function EventDetails({event, onClose, timezone, locale}) {
    const {t} = useTranslation(['calendar', 'common']);
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const [opening, setOpening] = useState(false);
    const [openError, setOpenError] = useState(false);
    const pendingRequest = useRef(0);
    // The parent keys details by event ID. A late reply must not reopen an
    // observation after its details were closed or another event was selected.
    useEffect(() => () => {pendingRequest.current += 1;}, []);

    if (!event) return null;
    const local = isLocalObservation(event);
    const satellites = satelliteNames(event).join(', ');
    const title = local ? satellites || event.title : event.title || satellites;
    const subtitle = local ? event.title !== title ? event.title : null : satellites !== title ? satellites : null;
    const frequency = frequencyLabel(event, locale);
    const source = sourceLink(event);
    const format = value => value ? new Date(value).toLocaleString(locale, {
        timeZone: timezone, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }) : null;

    const openObservation = async () => {
        const request = ++pendingRequest.current;
        setOpening(true);
        setOpenError(false);
        try {
            // The calendar is a summary. Fetch the complete, current record
            // before handing it to the existing observation management form.
            const reply = await socket.timeout(15000).emitWithAck('api.call', {
                cmd: 'get-scheduled-observations', data: {observation_id: event.source_id},
            });
            if (request !== pendingRequest.current) return;
            if (!reply?.success || !reply.data || String(reply.data.id) !== String(event.source_id)) {
                throw new Error('Observation unavailable');
            }
            dispatch(setSelectedObservation(reply.data));
            dispatch(setDialogOpen(true));
            onClose();
        } catch {
            if (request === pendingRequest.current) setOpenError(true);
        } finally {
            if (request === pendingRequest.current) setOpening(false);
        }
    };

    return <Dialog open onClose={onClose} fullWidth maxWidth={false} aria-labelledby="calendar-event-title"
        slotProps={{paper: {sx: theme => ({width: 640, maxWidth: 'calc(100% - 32px)', m: 2,
            borderTop: `4px solid ${sourceAccent(event, theme)}`})}}}>
        <DialogTitle id="calendar-event-header" component="div" sx={{p: {xs: 2, sm: 3}, pr: {xs: 6, sm: 7}}}>
            <Stack direction="row" gap={1} alignItems="center" useFlexGap flexWrap="wrap" sx={{mb: 1.25}}>
                <SourceLabel event={event} />
                {local ? <ObservationBadges event={event} /> : <ActivityBadge event={event} />}
            </Stack>
            <Typography id="calendar-event-title" component="h2" variant="h6" fontWeight={650} sx={{lineHeight: 1.4, overflowWrap: 'anywhere'}}>{title}</Typography>
            {subtitle && <Typography variant="body2" color="text.secondary" sx={{mt: 0.75, overflowWrap: 'anywhere'}}>{subtitle}</Typography>}
            <IconButton aria-label={t('close')} onClick={onClose} sx={{position: 'absolute', top: 14, right: 12}}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{p: {xs: 2, sm: 3}}}>
            <Stack spacing={2.5}>
                <TimeWindow event={event} timezone={timezone} locale={locale} format={format} />
                {event.description && <DetailSection title={t('details.description')}>
                    <Typography variant="body2" sx={{whiteSpace: 'pre-line', overflowWrap: 'anywhere', lineHeight: 1.75}}>{event.description}</Typography>
                </DetailSection>}
                {frequency && <DetailSection title={t('details.reception')}>
                    <DetailFields fields={[[t('frequency'), frequency]]} />
                </DetailSection>}
                {local ? <>
                    {event.observation && <DetailSection title={t('details.satellite_pass')}>
                        <DetailFields fields={[
                            [t('pass_starts'), format(event.observation.pass_start)],
                            [t('pass_ends'), format(event.observation.pass_end)],
                            [t('peak_elevation'), event.observation.peak_altitude == null ? null
                                : `${event.observation.peak_altitude.toLocaleString(locale, {maximumFractionDigits: 1})}°`],
                        ]} />
                    </DetailSection>}
                    <Divider />
                    <DetailSection title={t('origin')}>
                        <Typography variant="body2" color="text.secondary">
                            {event.observation?.monitored_satellite_id ? t('generated') : t('manual')}
                        </Typography>
                    </DetailSection>
                </> : <>
                    <Divider />
                    <DetailSection title={t('source')}>
                        <DetailFields fields={[
                            [t('details.provider'), event.source === 'gscontrol' ? t('sources.gscontrol') : event.source],
                            [t('external.source_link'), source ? <Link href={source.href} target="_blank" rel="noopener noreferrer">{source.hostname}</Link> : null],
                        ]} />
                    </DetailSection>
                </>}
                {openError && <Alert severity="error">{t('details.open_error')}</Alert>}
            </Stack>
        </DialogContent>
        <DialogActions sx={{px: {xs: 2, sm: 3}, py: 1.75, gap: 1, flexWrap: 'wrap'}}>
            <CapsButton onClick={onClose}>{t('close')}</CapsButton>
            {local && event.source_id && <CapsButton variant="contained" disableElevation onClick={openObservation}
                disabled={opening || !socket} endIcon={opening ? <CircularProgress size={16} color="inherit" /> : <ArrowForwardIcon />}>
                {t('details.open_observation')}
            </CapsButton>}
            {!local && source && <CapsButton component="a" href={source.href} target="_blank" rel="noopener noreferrer"
                variant="contained" disableElevation endIcon={<OpenInNewIcon />}>
                {t('details.open_source')}
            </CapsButton>}
        </DialogActions>
    </Dialog>;
}
