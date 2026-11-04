/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React from 'react';
import HomeIcon from '@mui/icons-material/Home';
import FilterCenterFocusIcon from '@mui/icons-material/FilterCenterFocus';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import PanToolIcon from '@mui/icons-material/PanTool';
import ZoomInMapIcon from '@mui/icons-material/ZoomInMap';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import HistoryIcon from '@mui/icons-material/History';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import {useTranslation} from 'react-i18next';
import ScrollableMapToolbar from '../common/map-toolbar.jsx';

export default function PacketMapToolbar({mapRef, home, onFitAll, settings, onToggleSetting,
    isFullscreen, onFullscreen, tooltipContainer}) {
    const {t} = useTranslation('earthview');
    const {t: navigationT} = useTranslation('navigation');
    const label = (key, fallback) => t(`map_controls.${key}`, {defaultValue: fallback});
    const buttons = [
        {key: 'home', label: label('go_home', 'Go home'), icon: <HomeIcon />, disabled: !home,
            onClick: () => mapRef.current?.jumpTo({center: [home[1], home[0]]})},
        {key: 'center', label: label('go_to_center', 'Go to center of map'), icon: <FilterCenterFocusIcon />,
            onClick: () => mapRef.current?.jumpTo({center: [0, 0]})},
        {key: 'fit', label: navigationT('packet_map.fit_all', {defaultValue: 'Fit all'}), icon: <CenterFocusStrongIcon />, onClick: onFitAll},
        {key: 'divider-1'},
        {key: 'pan', label: label('enable_panning', 'Enable map panning'), icon: <PanToolIcon />,
            pressed: settings.enableMapDragging, onClick: () => onToggleSetting('enableMapDragging')},
        {key: 'gesture-zoom', label: label('enable_gesture_zoom', 'Enable gesture zoom'), icon: <ZoomInMapIcon />,
            pressed: settings.enableMapZooming, onClick: () => onToggleSetting('enableMapZooming')},
        {key: 'zoom-out', label: label('zoom_out', 'Zoom out'), icon: <ZoomOutIcon />, onClick: () => mapRef.current?.zoomTo(mapRef.current.getZoom() - 0.25, {duration: 120})},
        {key: 'zoom-in', label: label('zoom_in', 'Zoom in'), icon: <ZoomInIcon />, onClick: () => mapRef.current?.zoomTo(mapRef.current.getZoom() + 0.25, {duration: 120})},
        {key: 'divider-2'},
        {key: 'tracks', label: navigationT('packet_map.show_tracks', {defaultValue: 'Show transmitter tracks'}), icon: <HistoryIcon />,
            pressed: settings.showTracks, onClick: () => onToggleSetting('showTracks')},
        {key: 'divider-3'},
        {key: 'fullscreen', label: isFullscreen ? label('exit_fullscreen', 'Exit fullscreen') : label('go_fullscreen', 'Go fullscreen'),
            icon: isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />, pressed: isFullscreen, onClick: onFullscreen},
    ];
    return <ScrollableMapToolbar buttons={buttons} label={navigationT('packet_map.map_controls', {defaultValue: 'Transmitter map controls'})}
        tooltipContainer={tooltipContainer} />;
}
