/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useMemo} from 'react';
import {flushSync} from 'react-dom';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import GpsOffIcon from '@mui/icons-material/GpsOff';
import RouteIcon from '@mui/icons-material/Route';
import FirstPageIcon from '@mui/icons-material/FirstPage';
import LastPageIcon from '@mui/icons-material/LastPage';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import SummarizeOutlinedIcon from '@mui/icons-material/SummarizeOutlined';
import {useTranslation} from 'react-i18next';
import {toast} from 'react-toastify';
import {isValidMapPosition} from '../filebrowser/position-utils.js';
import {trackPositionAt} from './playback.js';
import {captureFile, captureItemId, copyTransmitterText, transmitterTrack} from './transmitter-actions.js';
import {typeLabel} from './transmitters.js';
import RowContextMenu from '../earthview/rowcontextmenu.jsx';

const emptyTrack = {points: [], times: [], samples: [], path: []};

export default function TransmitterContextMenu({transmitter, anchorPosition, positions, playbackTime, isLive,
    followedTransmitterId, onAction, onClose, onExited}) {
    const {t} = useTranslation('navigation');
    const label = (key, fallback, options = {}) => t(`packet_map.context.${key}`, {defaultValue: fallback, ...options});
    const track = useMemo(() => transmitter ? transmitterTrack(positions, transmitter.id) : emptyTrack,
        [positions, transmitter?.id]);
    const current = trackPositionAt(track, playbackTime)?.point;
    const hasPosition = isValidMapPosition(current?.latitude, current?.longitude);
    const following = transmitter && transmitter.id === followedTransmitterId;
    const close = onClose;
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
    const item = (key, fallback, icon, disabled = false) => ({key, label: label(key, fallback), icon, disabled,
        onClick: () => action(key)});
    const items = [
        item('center', 'Center on map', <CenterFocusStrongIcon />, !hasPosition),
        item(following ? 'stop' : 'follow', following ? 'Stop following' : 'Follow transmitter',
            following ? <GpsOffIcon /> : <GpsFixedIcon />, !following && !hasPosition),
        item('fit', 'Fit entire track', <RouteIcon />, !track.points.length),
        {type: 'divider', key: 'playback-divider'},
        item('first', 'Jump to first position', <FirstPageIcon />, isLive || !track.points.length),
        item('last', 'Jump to last position', <LastPageIcon />, isLive || !track.points.length),
        {type: 'divider', key: 'captures-divider'},
        {...item('captures', 'Open captures', <FolderOpenOutlinedIcon />, !captureItemId(transmitter) && !captureFile(transmitter)),
            opensDialog: true},
        {type: 'divider', key: 'copy-divider'},
        {key: 'identifier', label: label('copy_identifier', 'Copy identifier'), icon: <ContentCopyIcon />,
            onClick: () => copy(transmitter.source || transmitter.name || transmitter.id)},
        {key: 'coordinates', label: label('copy_coordinates', 'Copy latest coordinates'), icon: <PlaceOutlinedIcon />,
            disabled: !isValidMapPosition(transmitter?.latitude, transmitter?.longitude),
            onClick: () => copy(`${transmitter.latitude.toFixed(6)}, ${transmitter.longitude.toFixed(6)}`)},
        {key: 'json', label: label('copy_json', 'Copy details JSON'), icon: <SummarizeOutlinedIcon />,
            onClick: () => copy(JSON.stringify(transmitter, null, 2))},
    ];
    return <RowContextMenu open={Boolean(transmitter)} onClose={close}
        onSuppressNativeContextMenu={(event) => {event.preventDefault(); close();}}
        anchorPosition={anchorPosition} title={transmitter?.name || transmitter?.source || transmitter?.id}
        badgeLabel={typeLabel(transmitter?.kind)} menuLabel={label('title', 'Transmitter actions')}
        onExited={onExited} disableRestoreFocus keepMounted items={items} />;
}
