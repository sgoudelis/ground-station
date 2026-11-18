import {Box, ButtonBase, Stack, Typography} from '@mui/material';
import {alpha} from '@mui/material/styles';
import {useTranslation} from 'react-i18next';
import {activityLabels} from './activities.js';
import {dayKey} from './dates.js';
import {frequencyLabel, observationStatuses, satelliteNames} from './events.js';
import {ActivityBadge, ObservationBadges, SourceLabel} from './event-badges.jsx';
import {isLocalObservation, sourceAccent} from './presentation.js';

export default function EventCard({event, day, timezone, locale, onOpen, compact = false}) {
    const {t} = useTranslation(['calendar', 'common']);
    const local = isLocalObservation(event);
    const label = activityLabels(t)[event.kind] || event.kind;
    const title = event.title || satelliteNames(event).join(', ');
    const status = observationStatuses(t)[event.status];
    const source = local ? t('source_types.local') : t('source_types.external');
    const frequency = !compact ? frequencyLabel(event, locale) : null;
    const clock = value => new Date(value).toLocaleTimeString(locale, {
        timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    const dated = event.time_precision && event.time_precision !== 'instant';
    const time = dated ? t(event.time_precision === 'date' ? 'external.date_only' : 'external.time_unspecified')
        : dayKey(event.start, timezone) < day ? t('continues') : clock(event.start);
    const endsHere = dayKey(new Date(event.end).getTime() - 1, timezone) === day;
    const timeRange = dated || (time === t('continues') && !endsHere) ? time
        : `${time} – ${endsHere ? clock(event.end) : t('continues')}`;

    return (
        <ButtonBase
            onClick={() => onOpen(event)}
            aria-label={[title, source, label, status, time].filter(Boolean).join(' · ')}
            sx={theme => {
                const color = sourceAccent(event, theme);
                const inactive = event.enabled === false || event.status === 'cancelled';
                return {
                    display: 'block', width: '100%', minWidth: 0, textAlign: 'start',
                    borderLeft: `3px solid ${color}`, borderRadius: '4px', px: 1, py: compact ? 0.6 : 1.25,
                    bgcolor: alpha(color, inactive ? 0.045 : theme.palette.mode === 'dark' ? 0.12 : 0.07),
                    transition: 'background-color 120ms',
                    '&:hover': {bgcolor: alpha(color, theme.palette.mode === 'dark' ? 0.2 : 0.13)},
                    '&.Mui-focusVisible': {outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2},
                };
            }}
        >
            <Box component="span" sx={{display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: compact ? 'nowrap' : 'wrap'}}>
                <Typography component="span" sx={{fontSize: compact ? 11 : 13, fontVariantNumeric: 'tabular-nums', color: 'text.secondary', flexShrink: 0}}>
                    {compact ? time : timeRange}
                </Typography>
                <Typography component="span" noWrap sx={{fontSize: compact ? 12 : 14, fontWeight: 650}}>{title}</Typography>
            </Box>
            <Stack component="span" direction="row" alignItems="center" gap={0.65} useFlexGap flexWrap="wrap" sx={{mt: 0.65}}>
                <SourceLabel event={event} compact={compact} />
                {local ? <ObservationBadges event={event} compact={compact} /> : <ActivityBadge event={event} compact={compact} />}
            </Stack>
            {frequency && <Typography component="span" display="block" noWrap sx={{fontSize: 12, mt: 0.5, color: 'text.secondary'}}>
                {frequency}
            </Typography>}
        </ButtonBase>
    );
}
