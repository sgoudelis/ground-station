/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Alert, Box, LinearProgress} from '@mui/material';
import {useDispatch, useSelector} from 'react-redux';
import {Responsive, useContainerWidth} from 'react-grid-layout';
import {absoluteStrategy} from 'react-grid-layout/core';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {StyledIslandParentNoScrollbar} from '../common/common.jsx';
import PageTabsLayout from '../common/page-tabs.jsx';
import {useSocket} from '../common/socket.jsx';
import PacketMap from './packet-map.jsx';
import DateRangeBar from './date-range-bar.jsx';
import usePacketPositions, {callLibrary} from './use-packet-positions.js';
import {gridLayoutStoreName, hiddenTypesStoreName, readStored, writeStored} from './storage.js';
import {columns, LAYOUT_SCHEMA_VERSION, loadLayouts} from './layouts.js';
import {transmitterRows} from './transmitters.js';
import TransmitterTable from './transmitter-table.jsx';
import TransmitterInfo from './transmitter-info.jsx';
import useAircraft from '../decoders/use-aircraft.js';
import {mergeAircraftHistory} from './aircraft.js';
import {setPacketMapRange} from './packet-map-slice.jsx';

export {gridLayoutStoreName} from './storage.js';

export default function PacketMapLayout() {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const gridEditable = useSelector((state) => Boolean(state.dashboard?.isEditing));
    const {width, containerRef, mounted} = useContainerWidth({measureBeforeMount: true});
    const [layouts, setLayouts] = useState(loadLayouts);
    const range = useSelector((state) => state.packetMap.range);
    const [playbackTime, setPlaybackTime] = useState(() => range.end === null ? null : Date.parse(range.end));
    const applyRange = (nextRange) => {
        dispatch(setPacketMapRange(nextRange));
        // Start at the latest fix whenever a new filesystem window is applied.
        setPlaybackTime(nextRange.end === null ? null : Date.parse(nextRange.end));
    };
    const {positions: savedPositions, transmitters: savedTransmitters, available_range, loading, error, refresh} = usePacketPositions(socket, range);
    const liveAircraft = useAircraft(socket, range.end === null);
    const {positions, transmitters} = useMemo(() => mergeAircraftHistory(savedPositions, savedTransmitters, liveAircraft, range),
        [savedPositions, savedTransmitters, liveAircraft, range]);
    const isLive = range.end === null;
    const [liveNow, setLiveNow] = useState(Date.now);
    useEffect(() => {
        if (!isLive) return;
        // Age silent transmitters even when no library updates arrive.
        setLiveNow(Date.now());
        const timer = window.setInterval(() => setLiveNow(Date.now()), 30000);
        return () => window.clearInterval(timer);
    }, [isLive]);
    const liveTime = useMemo(() => positions.reduce((latest, point) => {
        const capturedAt = Date.parse(point.captured_at);
        return capturedAt > latest ? capturedAt : latest;
    }, Math.max(liveNow, Date.now(), Date.parse(range.start))), [positions, range.start, liveNow]);
    // Live playback follows every transmitter's newest fix, including new IDs.
    const currentPlaybackTime = isLive ? liveTime : playbackTime;
    const rows = useMemo(() => transmitterRows(positions, transmitters), [positions, transmitters]);
    const [selectedTransmitterId, setSelectedTransmitterId] = useState(null);
    const [preserveViewRequest, setPreserveViewRequest] = useState(0);
    const applyPresetRange = (nextRange) => {
        applyRange(nextRange);
        setSelectedTransmitterId(null);
        // Freeze the current camera before the replacement results arrive,
        // including repeated presets and views that have never been panned.
        setPreserveViewRequest((value) => value + 1);
    };
    const selectedTransmitter = rows.find((row) => row.id === selectedTransmitterId) || null;
    const [hiddenTypes, setHiddenTypes] = useState(() => {
        const saved = readStored(hiddenTypesStoreName);
        return Array.isArray(saved) ? saved.filter((kind) => typeof kind === 'string') : [];
    });
    const visiblePositions = useMemo(() => positions.filter((point) => !hiddenTypes.includes(point.kind)), [positions, hiddenTypes]);
    const changeHiddenTypes = (next) => {
        setHiddenTypes(next);
        writeStored(hiddenTypesStoreName, next);
    };
    const selectTransmitter = (id) => {
        setSelectedTransmitterId(id);
        const kind = rows.find((row) => row.id === id)?.kind;
        // Selecting a hidden transmitter should reveal its marker and track.
        if (hiddenTypes.includes(kind)) changeHiddenTypes(hiddenTypes.filter((value) => value !== kind));
    };
    const [refreshError, setRefreshError] = useState('');
    const [reconciling, setReconciling] = useState(false);
    const reconcile = async () => {
        setReconciling(true);
        setRefreshError('');
        try {
            // Discover captures copied into storage outside the application too.
            await callLibrary(socket, 'filebrowser.reconcile', {});
            refresh();
        } catch (failure) {
            setRefreshError(failure.message);
        } finally {
            setReconciling(false);
        }
    };
    const updateLayout = useCallback((_current, all) => {
        setLayouts(all);
        writeStored(gridLayoutStoreName, {version: LAYOUT_SCHEMA_VERSION, layouts: all});
    }, []);

    return <PageTabsLayout sx={{bgcolor: 'transparent'}} tabs={<Box sx={{position: 'relative'}}>
        <DateRangeBar range={range} availableRange={available_range} positions={positions} onChange={applyRange}
            onPresetChange={applyPresetRange}
            playbackTime={currentPlaybackTime} onPlaybackTimeChange={setPlaybackTime}
            onRefresh={reconcile} loading={loading || reconciling} />
        {/* Overlay progress so loading never adds space above the grid. */}
        {(loading || reconciling) && <LinearProgress sx={{position: 'absolute', bottom: 0, left: 0, right: 0, height: 3}} />}
    </Box>}>
        {(error || refreshError) && <Alert severity="error" sx={{mx: 1}}>{error || refreshError}</Alert>}
        <div ref={containerRef}>
            {mounted && <Responsive width={width} positionStrategy={absoluteStrategy} className="layout"
                layouts={layouts} onLayoutChange={updateLayout} cols={columns} rowHeight={8}
                breakpoints={{lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0}}
                dragConfig={{enabled: gridEditable, handle: '.react-grid-draggable', cancel: 'button,input,.MuiSelect-root'}}
                resizeConfig={{enabled: gridEditable}}>
                <StyledIslandParentNoScrollbar key="packet-map">
                    <PacketMap positions={visiblePositions} transmitters={rows} playbackTime={currentPlaybackTime}
                        hasPositions={positions.length > 0} loading={loading} gridEditable={gridEditable}
                        preserveViewRequest={preserveViewRequest} selectedTransmitterId={selectedTransmitterId} onSelectTransmitter={selectTransmitter}
                        hiddenTypes={hiddenTypes} onHiddenTypesChange={changeHiddenTypes} onFitAll={() => setSelectedTransmitterId(null)} />
                </StyledIslandParentNoScrollbar>
                <StyledIslandParentNoScrollbar key="transmitter-info">
                    <TransmitterInfo transmitter={selectedTransmitter} selectedTransmitterId={selectedTransmitterId}
                        positions={positions} playbackTime={currentPlaybackTime} isLive={isLive}
                        loading={loading} gridEditable={gridEditable} onClearSelection={() => setSelectedTransmitterId(null)} />
                </StyledIslandParentNoScrollbar>
                <StyledIslandParentNoScrollbar key="transmitters">
                    <TransmitterTable rows={rows} loading={loading} hiddenTypes={hiddenTypes} gridEditable={gridEditable}
                        selectedTransmitterId={selectedTransmitterId} onSelectTransmitter={selectTransmitter}
                        playbackTime={currentPlaybackTime} />
                </StyledIslandParentNoScrollbar>
            </Responsive>}
        </div>
    </PageTabsLayout>;
}
