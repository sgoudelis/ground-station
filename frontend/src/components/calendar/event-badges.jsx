import {Chip, Stack, Typography} from '@mui/material';
import CellTowerIcon from '@mui/icons-material/CellTower';
import PublicIcon from '@mui/icons-material/Public';
import {useTranslation} from 'react-i18next';
import {ACTIVITY_COLORS, activityLabels} from './activities.js';
import {observationStatuses} from './events.js';
import {isLocalObservation, observationStatusSx, sourceAccent} from './presentation.js';

export function SourceLabel({event, compact = false}) {
    const {t} = useTranslation('calendar');
    const Icon = isLocalObservation(event) ? CellTowerIcon : PublicIcon;
    return <Stack component="span" direction="row" alignItems="center" gap={0.65} sx={{minWidth: 0}}>
        <Icon sx={theme => ({fontSize: compact ? 13 : 16, flexShrink: 0, color: sourceAccent(event, theme)})} />
        <Typography component="span" variant="caption" noWrap sx={{fontSize: compact ? 10 : 12, color: 'text.secondary'}}>
            {isLocalObservation(event) ? t('source_types.local') : t('source_types.external')}
        </Typography>
    </Stack>;
}

export function ActivityBadge({event, compact = false}) {
    const {t} = useTranslation('calendar');
    const label = activityLabels(t)[event.kind] || event.kind;
    return label ? <Chip component="span" size="small" variant="outlined" label={label}
        sx={{height: compact ? 18 : 23, fontSize: compact ? 10 : 11,
            borderColor: ACTIVITY_COLORS[event.kind] || 'divider', maxWidth: '100%',
            '& .MuiChip-label': {px: 0.75}}} /> : null;
}

export function ObservationBadges({event, compact = false}) {
    const {t} = useTranslation(['calendar', 'common']);
    const label = observationStatuses(t)[event.status];
    const sizing = {height: compact ? 18 : 23, fontSize: compact ? 10 : 11, '& .MuiChip-label': {px: 0.75}};
    return <>
        {label && <Chip component="span" size="small" variant="outlined" label={label}
            sx={theme => ({...sizing, ...observationStatusSx(event.status, theme)})} />}
        {event.enabled === false && <Chip component="span" size="small" variant="outlined"
            label={t('disabled')} sx={theme => ({...sizing, ...observationStatusSx('cancelled', theme)})} />}
    </>;
}
