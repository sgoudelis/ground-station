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
 *
 */



import {useDispatch, useSelector} from "react-redux";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import MapSettingsIsland from "../common/map-settings.jsx";
import React from "react";
import { useTranslation } from 'react-i18next';
import {
    setFutureOrbitLineColor,
    setLockOnTarget,
    setOrbitProjectionDuration,
    setPastOrbitLineColor,
    setSatelliteCoverageColor,
    setShowFutureOrbitPath,
    setShowMoonIcon,
    setShowPastOrbitPath,
    setShowSatelliteCoverage,
    setShowSunIcon,
    setShowTerminatorLine,
    setShowTooltip,
    setMapEngine,
    setTileLayerID,
    setOpenMapSettingsDialog,
    setShowGrid,
    setEnableMapDragging,
    setEnableMapZooming,
    setAutoSwitchPlanetariumByVisibility,
} from "./target-slice.jsx";
import {
    MAP_ENGINE_LEAFLET,
    MAP_ENGINE_MAPLIBRE,
    MAP_ENGINE_MAPLIBRE_GLOBE,
} from "../common/tile-layers.jsx";

const MAP_ENGINE_PLANETARIUM = 'planetarium';

const TARGET_MAP_ENGINE_OPTIONS = [
    {id: MAP_ENGINE_LEAFLET, name: 'Leaflet'},
    {id: MAP_ENGINE_MAPLIBRE, name: 'MapLibre'},
    {id: MAP_ENGINE_MAPLIBRE_GLOBE, name: 'MapLibre Globe'},
    {id: MAP_ENGINE_PLANETARIUM, name: 'Planetarium'},
];

const normalizeTargetMapEngine = (mapEngine) => {
    const normalizedMapEngine = String(mapEngine || '').trim().toLowerCase();
    if (
        normalizedMapEngine === MAP_ENGINE_LEAFLET
        || normalizedMapEngine === MAP_ENGINE_MAPLIBRE
        || normalizedMapEngine === MAP_ENGINE_MAPLIBRE_GLOBE
        || normalizedMapEngine === MAP_ENGINE_PLANETARIUM
    ) {
        return normalizedMapEngine;
    }
    return MAP_ENGINE_MAPLIBRE;
};

function TargetMapSettingsDialog({updateBackend}) {
    const dispatch = useDispatch();
    const { t } = useTranslation('target');
    const {
        showPastOrbitPath,
        showFutureOrbitPath,
        showSatelliteCoverage,
        showSunIcon,
        showMoonIcon,
        showTerminatorLine,
        showTooltip,
        lockOnTarget,
        pastOrbitLineColor,
        futureOrbitLineColor,
        satelliteCoverageColor,
        orbitProjectionDuration,
        tileLayerID,
        mapEngine,
        openMapSettingsDialog,
        showGrid,
        enableMapDragging,
        enableMapZooming,
        autoSwitchPlanetariumByVisibility,
    } = useSelector(state => state.targetSatTrack);

    const handleCloseDialog = () => {
        dispatch(setOpenMapSettingsDialog(false));
    };

    return (
        <>
            <Dialog
                open={openMapSettingsDialog}
                onClose={handleCloseDialog}
                fullWidth
                maxWidth="sm"
                PaperProps={{
                    sx: {
                        bgcolor: 'background.paper',
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                        borderRadius: 2,
                    },
                }}
            >
                <DialogTitle
                    sx={{
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                        fontSize: '1.125rem',
                        fontWeight: 'bold',
                        py: 2.2,
                    }}
                >
                    {t('map_settings.title')}
                </DialogTitle>
                <DialogContent
                    sx={{
                        p: 0,
                        height: '72vh',
                        maxHeight: '72vh',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                    }}
                >
                    <MapSettingsIsland
                        open={openMapSettingsDialog}
                        initialLockOnTarget={lockOnTarget}
                        initialShowPastOrbitPath={showPastOrbitPath}
                        initialShowFutureOrbitPath={showFutureOrbitPath}
                        initialShowSatelliteCoverage={showSatelliteCoverage}
                        initialShowSunIcon={showSunIcon}
                        initialShowMoonIcon={showMoonIcon}
                        initialPastOrbitLineColor={pastOrbitLineColor}
                        initialFutureOrbitLineColor={futureOrbitLineColor}
                        initialSatelliteCoverageColor={satelliteCoverageColor}
                        initialOrbitProjectionDuration={orbitProjectionDuration}
                        initialTileLayerID={tileLayerID}
                        initialMapEngine={mapEngine}
                        initialShowTooltip={showTooltip}
                        initialShowGrid={showGrid}
                        initialEnableMapDragging={enableMapDragging}
                        initialEnableMapZooming={enableMapZooming}
                        initialAutoSwitchPlanetariumByVisibility={autoSwitchPlanetariumByVisibility}
                        initialShowTerminatorLine={showTerminatorLine}
                        mapEngineOptions={TARGET_MAP_ENGINE_OPTIONS}
                        normalizeMapEngineValue={normalizeTargetMapEngine}
                        defaultSettings={{
                            lockOnTarget: true,
                            enableMapDragging: false,
                            enableMapZooming: false,
                            autoSwitchPlanetariumByVisibility: false,
                            showPastOrbitPath: true,
                            showFutureOrbitPath: true,
                            showSatelliteCoverage: true,
                            showSunIcon: true,
                            showMoonIcon: true,
                            showTerminatorLine: true,
                            showTooltip: true,
                            showGrid: true,
                            pastOrbitLineColor: '#33C833',
                            futureOrbitLineColor: '#E4971E',
                            satelliteCoverageColor: '#112EED',
                            orbitProjectionDuration: 60 * 24,
                            tileLayerID: 'satellite',
                            mapEngine: MAP_ENGINE_MAPLIBRE,
                        }}
                        handleLockOnTarget={(value)=>{dispatch(setLockOnTarget(value))}}
                        handleShowPastOrbitPath={(value)=>{dispatch(setShowPastOrbitPath(value))}}
                        handleShowFutureOrbitPath={(value)=>{dispatch(setShowFutureOrbitPath(value))}}
                        handleShowSatelliteCoverage={(value)=>{dispatch(setShowSatelliteCoverage(value))}}
                        handleSetShowSunIcon={(value)=>{dispatch(setShowSunIcon(value))}}
                        handleSetShowMoonIcon={(value)=>{dispatch(setShowMoonIcon(value))}}
                        handleShowTerminatorLine={(value)=>{dispatch(setShowTerminatorLine(value))}}
                        handlePastOrbitLineColor={(value)=>{dispatch(setPastOrbitLineColor(value))}}
                        handleFutureOrbitLineColor={(value)=>{dispatch(setFutureOrbitLineColor(value))}}
                        handleSatelliteCoverageColor={(value)=>{dispatch(setSatelliteCoverageColor(value))}}
                        handleOrbitProjectionDuration={(value)=>{dispatch(setOrbitProjectionDuration(value))}}
                        handleShowTooltip={(value)=>{dispatch(setShowTooltip(value))}}
                        handleMapEngine={(value)=>{dispatch(setMapEngine(value))}}
                        handleTileLayerID={(value)=>{dispatch(setTileLayerID(value))}}
                        handleShowGrid={(value)=>{dispatch(setShowGrid(value))}}
                        handleEnableMapDragging={(value)=>{dispatch(setEnableMapDragging(value))}}
                        handleEnableMapZooming={(value)=>{dispatch(setEnableMapZooming(value))}}
                        handleAutoSwitchPlanetariumByVisibility={(value)=>{dispatch(setAutoSwitchPlanetariumByVisibility(value))}}
                        onCancel={handleCloseDialog}
                        updateBackend={updateBackend}
                    />
                </DialogContent>
            </Dialog>
        </>
    );
}

export default TargetMapSettingsDialog;
