import {useEffect, useMemo, useState} from 'react';
import {
    Alert, Box, ButtonBase, ButtonGroup, Checkbox, Divider, IconButton, InputAdornment, LinearProgress, MenuItem, Paper, Stack,
    TextField, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import {alpha, useTheme} from '@mui/material/styles';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import SearchIcon from '@mui/icons-material/Search';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import RefreshIcon from '@mui/icons-material/Refresh';
import {useTranslation} from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';
import ObservationDataDialog from '../scheduler/observation-data-dialog.jsx';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {activityLabels} from './activities.js';
import {addDays, civilDate, dayKey, groupEventsByDay, hasCalendarDate, isCalendarDay, movePeriod, visibleDays} from './dates.js';
import {frequencyLabel, satelliteNames} from './events.js';
import useCalendarEvents from './use-calendar-events.js';
import EventCard from './event-card.jsx';
import FeedSettings from './feed-settings.jsx';
import {ExternalEventsStatus} from './external-events.jsx';
import EventDetails from './event-details.jsx';
import {SourceLabel} from './event-badges.jsx';
import {eventAccent, isLocalObservation} from './presentation.js';

function EmptyCalendar({onOpenFeeds}) {
    const {t} = useTranslation(['calendar', 'common']);
    // Keep the grid's height and leave date navigation usable beneath the overlay.
    return (
        <Box sx={{position: 'absolute', inset: 0, zIndex: 1, display: 'flex', alignItems: 'center',
            justifyContent: 'center', pointerEvents: 'none', p: 2}}>
            <Stack alignItems="center" spacing={1} sx={{py: 3, px: 4, borderRadius: 2,
                bgcolor: theme => alpha(theme.palette.background.paper, 0.95), color: 'text.secondary', textAlign: 'center'}}>
                <EventBusyIcon sx={{fontSize: 36, mb: 0.5, opacity: 0.6}} />
                <Typography color="text.primary" fontWeight={600}>{t('empty_title')}</Typography>
                <Typography variant="body2">{onOpenFeeds ? t('empty_feeds_hint') : t('empty_hint')}</Typography>
                {onOpenFeeds && <CapsButton size="small" onClick={onOpenFeeds} sx={{pointerEvents: 'auto'}}>
                    {t('feeds.open')}
                </CapsButton>}
            </Stack>
        </Box>
    );
}

export default function CalendarPage() {
    const {t, i18n} = useTranslation(['calendar', 'common']);
    const theme = useTheme();
    const smallScreen = useMediaQuery(theme.breakpoints.down('md'));
    const settings = useUserTimeSettings();
    const locale = settings.locale || i18n.resolvedLanguage || i18n.language;
    const [zoneChoice, setZoneChoice] = useState('UTC');
    const timezone = zoneChoice;
    const timezones = [...new Set(['UTC', settings.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone])];
    const [now, setNow] = useState(() => Date.now());
    const today = dayKey(now, timezone);
    const [anchor, setAnchor] = useState(() => dayKey(Date.now()));
    const [view, setView] = useState('month');
    const [search, setSearch] = useState('');
    const [satellite, setSatellite] = useState('all');
    const [hiddenKinds, setHiddenKinds] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [resultsObservation, setResultsObservation] = useState(null);
    const [feedsOpen, setFeedsOpen] = useState(false);
    const labels = useMemo(() => activityLabels(t), [t]);
    const views = {month: t('views.month'), week: t('views.week'), agenda: t('views.agenda')};
    // Compact screens use the same period and filters in an agenda layout.
    const agendaLayout = view === 'agenda' || smallScreen;
    const days = useMemo(() => visibleDays(anchor, view), [anchor, view]);
    const {events, external, loading, error, refresh, updateExternal} = useCalendarEvents({start: days[0], end: addDays(days.at(-1), 1), timezone});
    const observationsEnabled = external?.feeds?.find(feed => feed.id === 'observations')?.enabled ?? true;
    // An empty date range or a display filter is not a missing subscription.
    // Offer setup only when the station explicitly has every feed switched off.
    const noFeedsSelected = Array.isArray(external?.feeds) && !observationsEnabled
        && external.feeds.every(feed => !feed.enabled);
    const subscribedEvents = useMemo(() => events.filter(event => hasCalendarDate(event) && (observationsEnabled || !isLocalObservation(event))),
        [events, observationsEnabled]);
    // Exclusions default to showing new activity types after a refresh, too.
    const activityOptions = useMemo(() => ({...labels, ...Object.fromEntries(
        subscribedEvents.filter(event => !labels[event.kind]).map(event => [event.kind, event.kind]),
    )}), [labels, subscribedEvents]);
    const activityKinds = Object.keys(activityOptions);
    const visibleKinds = activityKinds.filter(kind => !hiddenKinds.includes(kind));
    const allActivitiesVisible = visibleKinds.length === activityKinds.length;
    const changeActivities = (event, option) => {
        if (option?.props.value === 'all') {
            setHiddenKinds(allActivitiesVisible ? activityKinds : []);
        } else {
            const values = typeof event.target.value === 'string' ? event.target.value.split(',') : event.target.value;
            setHiddenKinds(activityKinds.filter(kind => !values.includes(kind)));
        }
    };
    // Keep an open details dialog in sync when a job changes or its feed is hidden.
    const selected = subscribedEvents.find(event => event.id === selectedId) || null;
    const satellites = [...new Set(events.flatMap(satelliteNames))].sort();
    const filteredEvents = useMemo(() => {
        const query = search.trim().toLocaleLowerCase(locale);
        return subscribedEvents.filter(event => (satellite === 'all' || satelliteNames(event).includes(satellite))
            && !hiddenKinds.includes(event.kind)
            && (!query || `${event.title} ${satelliteNames(event).join(' ')} ${labels[event.kind] || event.kind} ${frequencyLabel(event, locale)}`.toLocaleLowerCase(locale).includes(query)));
    }, [subscribedEvents, satellite, hiddenKinds, search, locale, labels]);
    const dayEvents = useMemo(() => groupEventsByDay(filteredEvents, days, timezone), [filteredEvents, days, timezone]);
    // Adjacent month cells offer context, but do not leak into the month's agenda.
    const agendaDays = days.filter(day => (view === 'week' || day.slice(0, 7) === anchor.slice(0, 7)) && dayEvents.get(day).length);
    const eventCount = new Set((view === 'week' ? days : days.filter(day => day.slice(0, 7) === anchor.slice(0, 7)))
        .flatMap(day => dayEvents.get(day).map(event => event.id))).size;
    const dateLabel = (day, options) => civilDate(day).toLocaleDateString(locale, {timeZone: 'UTC', ...options});
    const periodLabel = view === 'week'
        ? `${dateLabel(days[0], {month: 'short', day: 'numeric'})} – ${dateLabel(days.at(-1), {year: 'numeric', month: 'short', day: 'numeric'})}`
        : dateLabel(anchor, {month: 'long', year: 'numeric'});

    useEffect(() => {
        // Refresh the today marker if the calendar stays open across midnight.
        const timer = setInterval(() => setNow(Date.now()), 60000);
        return () => clearInterval(timer);
    }, []);

    const openDay = day => {setAnchor(day); setView('week');};
    const card = (event, day, compact) => <EventCard key={event.id} event={event} day={day}
        timezone={timezone} locale={locale} onOpen={item => setSelectedId(item.id)} compact={compact} />;

    return (
        <Box sx={{width: '100%', minWidth: 0, p: {xs: 1.5, md: 2.5}}}>
            <Paper variant="outlined" sx={{borderRadius: 2, overflow: 'hidden'}}>
                <Stack direction="row" alignItems="center" gap={1} useFlexGap flexWrap="wrap" sx={{p: 2}}>
                    <CapsButton size="small" variant="outlined" onClick={() => setAnchor(today)}>{t('today')}</CapsButton>
                    <Tooltip title={t('previous')}><IconButton size="small" aria-label={t('previous')} onClick={() => setAnchor(movePeriod(anchor, -1, view))}><ChevronLeftIcon /></IconButton></Tooltip>
                    <Tooltip title={t('next')}><IconButton size="small" aria-label={t('next')} onClick={() => setAnchor(movePeriod(anchor, 1, view))}><ChevronRightIcon /></IconButton></Tooltip>
                    <Typography component="h2" variant="h6" aria-live="polite" sx={{flex: 1, minWidth: {xs: '100%', sm: 180}, order: {xs: -1, sm: 0}, fontSize: 18}}>{periodLabel}</Typography>
                    <CapsButton size="small" variant="outlined" startIcon={<RefreshIcon />} disabled={loading} onClick={refresh}>
                        {t('refresh')}
                    </CapsButton>
                    <TextField type="date" label={t('go_to_date')} size="small" value={anchor}
                        onChange={event => {if (isCalendarDay(event.target.value)) setAnchor(event.target.value);}}
                        slotProps={{inputLabel: {shrink: true}, htmlInput: {min: '1900-01-01', max: '9999-12-31'}}}
                        sx={{width: 162,
                            // Match the small toolbar buttons' text and height.
                            '& .MuiInputBase-root': {fontSize: theme.typography.pxToRem(13), height: 'calc(1.75em + 8px)'},
                            '& .MuiInputBase-input': {py: 0.5}}} />
                    <ButtonGroup size="small" aria-label={t('calendar_view')}>
                        {Object.entries(views).map(([value, label]) => <CapsButton key={value}
                            variant={view === value ? 'contained' : 'outlined'} disableElevation
                            aria-pressed={view === value} onClick={() => setView(value)}>{label}</CapsButton>)}
                    </ButtonGroup>
                    <FeedSettings observationsEnabled={observationsEnabled} status={external} onChanged={updateExternal}
                        open={feedsOpen} onOpen={() => setFeedsOpen(true)} onClose={() => setFeedsOpen(false)} />
                </Stack>
                <Divider />
                <Stack direction="row" gap={1.5} flexWrap="wrap" sx={{p: 2, bgcolor: 'action.hover'}}>
                    <TextField label={t('search')} value={search} onChange={event => setSearch(event.target.value)} size="small"
                        slotProps={{input: {startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>}}}
                        sx={{flex: '1 1 190px', minWidth: 160}} />
                    <TextField select label={t('satellite')} value={satellite} onChange={event => setSatellite(event.target.value)} size="small" sx={{flex: '1 1 150px'}}>
                        <MenuItem value="all">{t('all_satellites')}</MenuItem>
                        {satellites.map(name => <MenuItem key={name} value={name}>{name}</MenuItem>)}
                    </TextField>
                    <TextField select label={t('activity')} value={allActivitiesVisible ? ['all', ...visibleKinds] : visibleKinds}
                        onChange={changeActivities} size="small" sx={{flex: '1 1 180px', minWidth: 160,
                            '& .MuiSelect-select': {whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}}
                        slotProps={{inputLabel: {shrink: true}, select: {multiple: true, displayEmpty: true,
                            renderValue: () => allActivitiesVisible ? t('all_activities')
                                : visibleKinds.map(kind => activityOptions[kind]).join(', ') || t('no_activities')}}}>
                        <MenuItem value="all">
                            <Checkbox size="small" checked={allActivitiesVisible}
                                indeterminate={!allActivitiesVisible && visibleKinds.length > 0}
                                tabIndex={-1} disableRipple slotProps={{input: {'aria-hidden': true}}} />
                            {t('all_activities')}
                        </MenuItem>
                        {Object.entries(activityOptions).map(([value, label]) => <MenuItem key={value} value={value}>
                            <Checkbox size="small" checked={!hiddenKinds.includes(value)} tabIndex={-1} disableRipple
                                slotProps={{input: {'aria-hidden': true}}} />
                            <Box component="span" aria-hidden="true" sx={{width: 9, height: 9, mr: 1, borderRadius: '50%',
                                flexShrink: 0, bgcolor: eventAccent({kind: value}, theme)}} />
                            {label}
                        </MenuItem>)}
                    </TextField>
                    <TextField select label={t('timezone')} value={zoneChoice} onChange={event => setZoneChoice(event.target.value)} size="small" sx={{minWidth: 150}}>
                        {timezones.map(zone => <MenuItem key={zone} value={zone}>{zone}</MenuItem>)}
                    </TextField>
                </Stack>
                <Divider />

                <Box component="section" aria-label={t('events_calendar')} aria-busy={loading}
                    sx={{position: 'relative', minHeight: agendaLayout ? 240 : undefined}}>
                    {/* Overlay progress so refreshing never changes the calendar's height. */}
                    {loading && <LinearProgress aria-label={t('common:loading')}
                        sx={{position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1}} />}
                    {error && <Alert severity="error" sx={{m: 2}} action={<CapsButton color="inherit" size="small" disabled={loading} onClick={refresh}>{t('common:scheduler_tables.shared.retry')}</CapsButton>}>{t('load_error')}</Alert>}
                    {agendaLayout ? <>
                        {agendaDays.map(day => <Box key={day} sx={{display: 'grid', gridTemplateColumns: {xs: '1fr', sm: '155px 1fr'}, gap: 1.5, p: 2, borderBottom: 1, borderColor: 'divider'}}>
                            <Box sx={{pt: 0.5}}>
                                <Typography variant="body2" fontWeight={650} color={day === today ? 'primary.main' : 'text.primary'}>{dateLabel(day, {weekday: 'short', month: 'short', day: 'numeric'})}</Typography>
                                {day === today && <Typography variant="caption" color="primary.main">{t('today')}</Typography>}
                            </Box>
                            <Stack spacing={1} sx={{minWidth: 0}}>{dayEvents.get(day).map(event => card(event, day, false))}</Stack>
                        </Box>)}
                    </> : <>
                        <Box sx={{display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', bgcolor: 'action.hover'}}>
                            {days.slice(0, 7).map(day => <Typography key={day} variant="caption" color="text.secondary" sx={{px: 1.5, py: 1.25, fontWeight: 650}}>{dateLabel(day, {weekday: 'short'})}</Typography>)}
                        </Box>
                        <Box sx={{display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))'}}>
                            {days.map((day, index) => {
                                const items = dayEvents.get(day);
                                const isToday = day === today;
                                const outside = view === 'month' && day.slice(0, 7) !== anchor.slice(0, 7);
                                return <Box key={day} aria-label={dateLabel(day, {dateStyle: 'full'})}
                                    sx={{minWidth: 0, minHeight: view === 'week' ? 440 : 132, p: 0.75, borderTop: 1,
                                        borderRight: index % 7 === 6 ? 0 : 1, borderColor: 'divider',
                                        bgcolor: isToday ? alpha(theme.palette.primary.main, 0.045) : outside ? 'background.default' : 'transparent'}}>
                                    <Tooltip title={t('show_week')}><ButtonBase onClick={() => openDay(day)}
                                        aria-label={t('show_date', {date: dateLabel(day, {dateStyle: 'full'})})}
                                        aria-current={isToday ? 'date' : undefined}
                                        sx={{width: 27, height: 27, mb: 0.5, borderRadius: '50%', fontSize: 12, fontWeight: isToday ? 700 : 500,
                                            bgcolor: isToday ? 'primary.main' : 'transparent',
                                            color: isToday ? 'primary.contrastText' : outside ? 'text.disabled' : 'text.secondary',
                                            '&:hover': {outline: '1px solid', outlineColor: 'primary.main'},
                                            '&.Mui-focusVisible': {outline: '2px solid', outlineColor: 'primary.main'}}}>
                                        {dateLabel(day, {day: 'numeric'})}
                                    </ButtonBase></Tooltip>
                                    <Stack spacing={0.5}>{items.slice(0, view === 'week' ? items.length : 2).map(event => card(event, day, view !== 'week'))}</Stack>
                                    {view === 'month' && items.length > 2 && <CapsButton size="small" onClick={() => openDay(day)}
                                        sx={{fontSize: 10, p: 0.25, mt: 0.25, minWidth: 0}}>{t('more', {count: items.length - 2})}</CapsButton>}
                                </Box>;
                            })}
                        </Box>
                    </>}
                    {!loading && !error && (agendaLayout ? !agendaDays.length : !eventCount)
                        && <EmptyCalendar onOpenFeeds={noFeedsSelected ? () => setFeedsOpen(true) : undefined} />}
                </Box>
                <Stack component="footer" direction="row" gap={2} alignItems="center" useFlexGap flexWrap="wrap" sx={{px: 2, py: 1.5, borderTop: 1, borderColor: 'divider'}}>
                    {observationsEnabled && <SourceLabel event={{source: 'observations'}} />}
                    {external?.enabled && (external.feeds || [{id: 'announcements', enabled: true}]).filter(feed => feed.id !== 'observations' && feed.enabled).map(feed => <SourceLabel key={feed.id} event={{source: 'gscontrol', feed_id: feed.id}} />)}
                    <ExternalEventsStatus status={external} locale={locale} timezone={timezone} />
                    <Typography variant="caption" color="text.secondary" aria-live="polite" sx={{ml: 'auto'}}>{t('event_count', {count: eventCount})}</Typography>
                </Stack>
            </Paper>
            <EventDetails key={selected?.id || 'closed'} event={selected} onClose={() => setSelectedId(null)}
                onViewResults={setResultsObservation} timezone={timezone} locale={locale} />
            {resultsObservation && <ObservationDataDialog open observation={resultsObservation}
                onClose={() => setResultsObservation(null)} />}
        </Box>
    );
}
