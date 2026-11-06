/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import RotateRightIcon from '@mui/icons-material/RotateRight';
import PauseIcon from '@mui/icons-material/Pause';
import StopIcon from '@mui/icons-material/Stop';
import LocalParkingIcon from '@mui/icons-material/LocalParking';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import BlockIcon from '@mui/icons-material/Block';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import AutorenewIcon from '@mui/icons-material/Autorenew';

// One vocabulary for all hardware surfaces. Colors describe operational meaning;
// glyphs distinguish states that share that meaning (e.g. connected/tracking).
const STATES = {
    none: {tone: 'inactive', Icon: RadioButtonUncheckedIcon, label: 'No device'},
    disconnected: {tone: 'inactive', Icon: LinkOffIcon, label: 'Disconnected'},
    connected: {tone: 'active', Icon: LinkIcon, label: 'Connected'},
    tracking: {tone: 'active', Icon: GpsFixedIcon, label: 'Tracking'},
    slewing: {tone: 'busy', Icon: RotateRightIcon, label: 'Slewing'},
    parking: {tone: 'busy', Icon: AutorenewIcon, label: 'Parking…', spinning: true},
    loading: {tone: 'busy', Icon: AutorenewIcon, label: 'Loading…', spinning: true},
    stopped: {tone: 'inactive', Icon: StopIcon, label: 'Stopped'},
    paused: {tone: 'inactive', Icon: PauseIcon, label: 'Paused'},
    idle: {tone: 'inactive', Icon: RadioButtonUncheckedIcon, label: 'Idle'},
    parked: {tone: 'inactive', Icon: LocalParkingIcon, label: 'Parked'},
    outofbounds: {tone: 'attention', Icon: BlockIcon, label: 'Tracking inhibited'},
    minelevation: {tone: 'attention', Icon: ArrowDownwardIcon, label: 'Below minimum elevation'},
    motion_unconfirmed: {tone: 'attention', Icon: WarningAmberIcon, label: 'Motion unconfirmed'},
    unknown: {tone: 'attention', Icon: HelpOutlineIcon, label: 'Status unavailable'},
    unavailable: {tone: 'attention', Icon: HelpOutlineIcon, label: 'Status unavailable'},
    error: {tone: 'fault', Icon: ErrorOutlineIcon, label: 'Device fault'},
};

export const resolveHardwarePresentation = ({source, status, t}) => {
    const effectiveStatus = source === 'rig' && status === 'stopped' ? 'paused' : status;
    const state = STATES[effectiveStatus] || STATES.unknown;
    const label = t('hardware_status.states.' + effectiveStatus, {ns: 'common', defaultValue: state.label});
    const sourceLabel = t('hardware_status.' + source, {
        ns: 'common', defaultValue: source === 'rotator' ? 'Rotator' : 'Rig',
    });
    return {
        ...state, label, fullLabel: `${sourceLabel}: ${label}`,
        bgColor: `operational.${state.tone}.background`,
        borderColor: `operational.${state.tone}.border`,
        iconColor: `operational.${state.tone}.main`,
    };
};

// Retain the source-qualified labels used by navigation summaries.
export const resolveTabLedPresentation = (options) => {
    const presentation = resolveHardwarePresentation(options);
    return {...presentation, label: presentation.fullLabel};
};

export const operationalButtonSx = (tone) => (theme) => ({
    bgcolor: `operational.${tone}.main`,
    color: theme.palette.getContrastText(theme.palette.operational[tone].main),
    '&:hover': {bgcolor: `operational.${tone}.main`, filter: 'brightness(0.9)'},
    '&.Mui-disabled': {bgcolor: 'action.disabledBackground', color: 'action.disabled'},
});

// Match compact popover actions and keep icon+label buttons inside narrow islands.
export const hardwareControlActionsSx = {
    '& .MuiButton-root': {fontSize: '0.75rem', px: 1},
    '& .MuiButton-startIcon': {mr: 0.5, ml: 0},
    '& .MuiButton-startIcon > *': {fontSize: 18},
};
