import {Chip, Stack, SvgIcon, Typography} from '@mui/material';
import {FaSatelliteDish} from 'react-icons/fa6';
import ImageIcon from '@mui/icons-material/Image';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import RepeatIcon from '@mui/icons-material/Repeat';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import PodcastsIcon from '@mui/icons-material/Podcasts';
import RadioIcon from '@mui/icons-material/Radio';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import {useTranslation} from 'react-i18next';
import {activityLabels} from './activities.js';
import {observationStatuses} from './events.js';
import {eventAccent, isLocalObservation, observationStatusSx} from './presentation.js';

// Reuse activity icons in cards and details; feed-only footer labels use the
// matching category icon when there is no individual event kind.
const activityIcons = {
    sstv: ImageIcon,
    ssdv: PhotoLibraryIcon,
    voice: RecordVoiceOverIcon,
    voice_contact: RecordVoiceOverIcon,
    digipeater: RepeatIcon,
    transponder: SwapVertIcon,
    audio: GraphicEqIcon,
    broadcast: PodcastsIcon,
    other_radio: RadioIcon,
    telemetry: MonitorHeartIcon,
    space_weather: WbSunnyIcon,
    launch: RocketLaunchIcon,
};
const feedIcons = {space_weather: WbSunnyIcon, launches: RocketLaunchIcon};

function ObservationDishIcon(props) {
    return <SvgIcon component={FaSatelliteDish} inheritViewBox {...props} />;
}

export function EventIcon({event, ...props}) {
    const Icon = isLocalObservation(event) ? ObservationDishIcon
        : activityIcons[event.kind] || feedIcons[event.feed_id] || SatelliteAltIcon;
    return <Icon {...props} />;
}

export function SourceLabel({event, compact = false}) {
    const {t} = useTranslation('calendar');
    return <Stack component="span" direction="row" alignItems="center" gap={0.65} sx={{minWidth: 0}}>
        <EventIcon event={event} sx={theme => ({fontSize: compact ? 13 : 16, flexShrink: 0, color: eventAccent(event, theme)})} />
        <Typography component="span" variant="caption" noWrap sx={{fontSize: compact ? 10 : 12, color: 'text.secondary'}}>
            {isLocalObservation(event) ? t('source_types.local') : event.feed_id === 'space_weather' || event.kind === 'space_weather' ? t('feeds.space_weather') : event.feed_id === 'launches' || event.kind === 'launch' ? t('feeds.launches') : t('source_types.external')}
        </Typography>
    </Stack>;
}

export function ActivityBadge({event, compact = false}) {
    const {t} = useTranslation('calendar');
    // The source label already names this feed beside its rocket icon.
    if (event.kind === 'launch' || event.feed_id === 'launches') return null;
    const label = activityLabels(t)[event.kind] || event.kind;
    return label ? <Chip component="span" size="small" variant="outlined" label={label}
        sx={theme => ({height: compact ? 18 : 23, fontSize: compact ? 10 : 11,
            borderColor: eventAccent(event, theme), maxWidth: '100%',
            '& .MuiChip-label': {px: 0.75}})} /> : null;
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
