/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {Divider, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem} from '@mui/material';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import GpsOffIcon from '@mui/icons-material/GpsOff';
import RouteIcon from '@mui/icons-material/Route';
import FirstPageIcon from '@mui/icons-material/FirstPage';
import LastPageIcon from '@mui/icons-material/LastPage';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import {useTranslation} from 'react-i18next';
import {toast} from 'react-toastify';
import {isValidMapPosition} from '../filebrowser/position-utils.js';
import {trackPositionAt} from './playback.js';
import {captureFile, captureItemId, copyTransmitterText, transmitterTrack} from './transmitter-actions.js';

const emptyTrack = {points: [], times: [], samples: [], path: []};

export default function TransmitterContextMenu({transmitter, anchorPosition, positions, playbackTime, isLive,
    followedTransmitterId, onAction, onClose, onExited}) {
    const {t} = useTranslation('navigation');
    const label = (key, fallback, options = {}) => t(`packet_map.context.${key}`, {defaultValue: fallback, ...options});
    const [copyMenu, setCopyMenu] = useState(false);
    const menuRef = useRef(null);
    useEffect(() => setCopyMenu(false), [transmitter?.id]);
    useEffect(() => {
        // Switching to Copy replaces the focused item; keep keyboard navigation
        // inside the new menu instead of leaving focus on the document body.
        if (transmitter) menuRef.current?.querySelector('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    }, [copyMenu, transmitter?.id]);
    const track = useMemo(() => transmitter ? transmitterTrack(positions, transmitter.id) : emptyTrack,
        [positions, transmitter?.id]);
    const current = trackPositionAt(track, playbackTime)?.point;
    const hasPosition = isValidMapPosition(current?.latitude, current?.longitude);
    const following = transmitter && transmitter.id === followedTransmitterId;
    const close = () => {setCopyMenu(false); onClose();};
    const action = (name) => {onAction(name, transmitter.id); close();};
    const copy = async (value) => {
        // Release the modal focus trap before the HTTP clipboard fallback
        // focuses its textarea, while still inside the user's copy gesture.
        flushSync(close);
        try {
            await copyTransmitterText(value);
            toast.success(label('copied', 'Copied to clipboard'));
        } catch {
            toast.error(label('copy_failed', 'Unable to copy to clipboard.'));
        }
    };
    const item = (key, fallback, icon, disabled = false) => <MenuItem key={key} disabled={disabled} onClick={() => action(key)}>
        <ListItemIcon>{icon}</ListItemIcon><ListItemText>{label(key, fallback)}</ListItemText>
    </MenuItem>;
    return <Menu open={Boolean(transmitter)} anchorReference="anchorPosition" anchorPosition={anchorPosition}
        onClose={close} disableRestoreFocus transitionDuration={0}
        slotProps={{paper: {sx: {minWidth: 240}, onContextMenu: (event) => {event.preventDefault(); close();}},
            list: {ref: menuRef, 'aria-label': label('title', 'Transmitter actions')}, transition: {onExited}}}>
        <ListSubheader disableSticky sx={{px: 2, py: 0.75, lineHeight: 1.5, maxWidth: 320, overflowWrap: 'anywhere'}}>
            {transmitter?.name || transmitter?.source || transmitter?.id}
        </ListSubheader>
        <Divider />
        {copyMenu ? [
            <MenuItem key="back" onClick={() => setCopyMenu(false)} onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') {event.preventDefault(); setCopyMenu(false);}
            }}><ListItemIcon><ChevronLeftIcon /></ListItemIcon>{label('back', 'Back')}</MenuItem>,
            <Divider key="divider" />,
            <MenuItem key="identifier" onClick={() => copy(transmitter.source || transmitter.name || transmitter.id)}>
                {label('copy_identifier', 'Copy identifier')}
            </MenuItem>,
            <MenuItem key="coordinates" disabled={!isValidMapPosition(transmitter?.latitude, transmitter?.longitude)}
                onClick={() => copy(`${transmitter.latitude.toFixed(6)}, ${transmitter.longitude.toFixed(6)}`)}>
                {label('copy_coordinates', 'Copy latest coordinates')}
            </MenuItem>,
            <MenuItem key="json" onClick={() => copy(JSON.stringify(transmitter, null, 2))}>
                {label('copy_json', 'Copy details JSON')}
            </MenuItem>,
        ] : [
            item('center', 'Center on map', <CenterFocusStrongIcon />, !hasPosition),
            item(following ? 'stop' : 'follow', following ? 'Stop following' : 'Follow transmitter',
                following ? <GpsOffIcon /> : <GpsFixedIcon />, !following && !hasPosition),
            item('fit', 'Fit entire track', <RouteIcon />, !track.points.length),
            <Divider key="playback-divider" />,
            item('first', 'Jump to first position', <FirstPageIcon />, isLive || !track.points.length),
            item('last', 'Jump to last position', <LastPageIcon />, isLive || !track.points.length),
            <Divider key="captures-divider" />,
            item('captures', 'Open captures', <FolderOpenOutlinedIcon />, !captureItemId(transmitter) && !captureFile(transmitter)),
            <MenuItem key="copy" onClick={() => setCopyMenu(true)} aria-haspopup="menu" onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {event.preventDefault(); setCopyMenu(true);}
            }}><ListItemIcon><ContentCopyIcon /></ListItemIcon><ListItemText>{label('copy', 'Copy')}</ListItemText>
                <ChevronRightIcon fontSize="small" />
            </MenuItem>,
        ]}
    </Menu>;
}
