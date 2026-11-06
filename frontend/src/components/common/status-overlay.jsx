/** Copyright (c) 2026 Efstratios Goudelis, GPL-3.0-or-later */
import {Box, CircularProgress, Tooltip} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import {useTranslation} from 'react-i18next';

const OVERLAYS = {
    spinner: {tone: 'busy', label: 'Loading', spinning: true},
    sync: {tone: 'busy', Icon: SyncIcon, label: 'Synchronizing', spinning: true},
    play: {tone: 'active', Icon: PlayArrowIcon, label: 'Running'},
    recording: {tone: 'active', Icon: RadioButtonCheckedIcon, label: 'Recording'},
    new: {tone: 'busy', Icon: FiberManualRecordIcon, label: 'New files'},
    error: {tone: 'fault', Icon: ErrorOutlineIcon, label: 'Error'},
};

export default function StatusOverlay({type, side = 'right'}) {
    const {t} = useTranslation('common');
    const state = OVERLAYS[type];
    if (!state) return null;
    const {tone, Icon, spinning} = state;
    const label = t(`status_overlay.${type}`, {defaultValue: state.label});
    return <Tooltip title={label} describeChild enterTouchDelay={0}>
        <Box component="span" aria-label={label} data-overlay={type} data-tone={tone} sx={{
            position: 'absolute', top: -5, [side]: -6, width: 16, height: 16, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1,
            bgcolor: 'background.paper', color: `operational.${tone}.main`,
            border: '1px solid', borderColor: `operational.${tone}.border`,
        }}>
            {Icon ? <Icon sx={{fontSize: 12,
                animation: spinning ? 'status-overlay-spin 1s linear infinite' : 'none',
                '@keyframes status-overlay-spin': {to: {transform: 'rotate(360deg)'}},
                '@media (prefers-reduced-motion: reduce)': {animation: 'none'},
            }} /> : <CircularProgress size={10} thickness={5} color="inherit"
                sx={{'@media (prefers-reduced-motion: reduce)': {animation: 'none', '& circle': {animation: 'none'}}}} />}
        </Box>
    </Tooltip>;
}
