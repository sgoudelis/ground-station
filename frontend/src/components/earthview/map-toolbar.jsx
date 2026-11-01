/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
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

import React from 'react';
import HomeIcon from '@mui/icons-material/Home';
import FilterCenterFocusIcon from '@mui/icons-material/FilterCenterFocus';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import PanToolIcon from '@mui/icons-material/PanTool';
import ZoomInMapIcon from '@mui/icons-material/ZoomInMap';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import HistoryIcon from '@mui/icons-material/History';
import RouteIcon from '@mui/icons-material/Route';
import RadarIcon from '@mui/icons-material/Radar';
import GridOnIcon from '@mui/icons-material/GridOn';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import ScrollableMapToolbar from '../common/map-toolbar.jsx';
import {useDispatch, useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import {useSocket} from '../common/socket.jsx';
import {
    setEarthViewMapSetting, setEnableMapDragging, setEnableMapZooming,
    setShowPastOrbitPath, setShowFutureOrbitPath, setShowSatelliteCoverage, setShowGrid,
} from './earthview-slice.jsx';

function MapToolbar({homeDisabled, followDisabled, following, onHome, onCenter, onFitEarth,
                     onToggleFollow, onZoomIn, onZoomOut, onFullscreen, isFullscreen, tooltipContainer}) {
    const {t} = useTranslation('earthview');
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const {enableMapDragging, enableMapZooming, showPastOrbitPath, showFutureOrbitPath,
        showSatelliteCoverage, showGrid} = useSelector((state) => state.earthViewTrack);
    const toggleSetting = (action, value) => {
        dispatch(action(!value));
        // Quick toggles persist through the same backend setting as the dialog.
        if (socket) dispatch(setEarthViewMapSetting({socket, key: 'earth-view-map-settings'}));
    };

    const buttons = [
        {key: 'home', label: t('map_controls.go_home'), icon: <HomeIcon />, onClick: onHome, disabled: homeDisabled},
        {key: 'center', label: t('map_controls.go_to_center'), icon: <FilterCenterFocusIcon />, onClick: onCenter},
        {key: 'fit', label: t('map_controls.fit_earth'), icon: <FitScreenIcon />, onClick: onFitEarth},
        {key: 'follow', label: t('map_controls.follow_selected'), icon: <TrackChangesIcon />, onClick: onToggleFollow, disabled: followDisabled, pressed: following},
        {key: 'divider-1'},
        {key: 'pan', label: t('map_controls.enable_panning'), icon: <PanToolIcon />, onClick: () => toggleSetting(setEnableMapDragging, enableMapDragging), pressed: enableMapDragging},
        {key: 'gesture-zoom', label: t('map_controls.enable_gesture_zoom'), icon: <ZoomInMapIcon />, onClick: () => toggleSetting(setEnableMapZooming, enableMapZooming), pressed: enableMapZooming},
        {key: 'zoom-out', label: t('map_controls.zoom_out'), icon: <ZoomOutIcon />, onClick: onZoomOut},
        {key: 'zoom-in', label: t('map_controls.zoom_in'), icon: <ZoomInIcon />, onClick: onZoomIn},
        {key: 'divider-2'},
        {key: 'past', label: t('map_controls.show_past_path'), icon: <HistoryIcon />, onClick: () => toggleSetting(setShowPastOrbitPath, showPastOrbitPath), pressed: showPastOrbitPath},
        {key: 'future', label: t('map_controls.show_future_path'), icon: <RouteIcon />, onClick: () => toggleSetting(setShowFutureOrbitPath, showFutureOrbitPath), pressed: showFutureOrbitPath},
        {key: 'coverage', label: t('map_controls.show_coverage'), icon: <RadarIcon />, onClick: () => toggleSetting(setShowSatelliteCoverage, showSatelliteCoverage), pressed: showSatelliteCoverage},
        {key: 'grid', label: t('map_controls.show_grid'), icon: <GridOnIcon />, onClick: () => toggleSetting(setShowGrid, showGrid), pressed: showGrid},
        {key: 'divider-3'},
        {key: 'fullscreen', label: t(isFullscreen ? 'map_controls.exit_fullscreen' : 'map_controls.go_fullscreen'), icon: isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />, onClick: onFullscreen, pressed: isFullscreen},
    ];

    return <ScrollableMapToolbar buttons={buttons} label={t('map_controls.toolbar')} tooltipContainer={tooltipContainer} />;
}

export default React.memo(MapToolbar);
