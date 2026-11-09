/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
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
import TransmitterList from './transmitter-list.jsx';
import TransmitterInfo from './transmitter-info.jsx';
import TransmitterCapturesDialog from './transmitter-captures-dialog.jsx';
import {transmitterTrack} from './transmitter-actions.js';
import useAircraft from '../decoders/use-aircraft.js';
import {createAircraftHistory} from './aircraft.js';
import {aircraftReceptionAt} from './reception.js';
import {setPacketMapRange} from './packet-map-slice.jsx';
import {liveRangeAt} from './live.js';

export {gridLayoutStoreName} from './storage.js';

export default function PacketMapLayout() {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const gridEditable = useSelector((state) => Boolean(state.dashboard?.isEditing));
    const {width, containerRef, mounted} = useContainerWidth({measureBeforeMount: true});
    const [layouts, setLayouts] = useState(loadLayouts);
    const range = useSelector((state) => state.packetMap.range);
    const excludedTypes = useSelector((state) => state.packetMap.transmitterList?.excludedTypes);
    const [playbackTime, setPlaybackTime] = useState(() => range.end === null ? null : Date.parse(range.end));
    const applyRange = (nextRange) => {
        dispatch(setPacketMapRange(nextRange));
        // Start at the latest fix whenever a new filesystem window is applied.
        setPlaybackTime(nextRange.end === null ? null : Date.parse(nextRange.end));
    };
    const {positions: savedPositions, transmitters: savedTransmitters, loading, error, refresh} = usePacketPositions(socket, range);
    const liveAircraft = useAircraft(socket, range.end === null);
    const isLive = range.end === null;
    const [liveNow, setLiveNow] = useState(Date.now);
    const [selectedTransmitterId, setSelectedTransmitterId] = useState(null);
    const [followedTransmitterId, setFollowedTransmitterId] = useState(null);
    const [navigationRequest, setNavigationRequest] = useState(null);
    const [capturesTransmitter, setCapturesTransmitter] = useState(null);
    const mergeHistory = useMemo(() => createAircraftHistory(), [range]);
    const {positions, transmitters} = useMemo(() => mergeHistory(savedPositions, savedTransmitters, liveAircraft, range,
        {now: Math.max(liveNow, Date.now()), selectedTransmitterId}),
    [mergeHistory, savedPositions, savedTransmitters, liveAircraft, range, liveNow, selectedTransmitterId]);
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
    }, Math.max(liveNow, Date.now())), [positions, liveNow]);
    // Live playback follows every transmitter's newest fix, including new IDs.
    const currentPlaybackTime = isLive ? liveTime : playbackTime;
    const rows = useMemo(() => transmitterRows(positions, transmitters), [positions, transmitters]);
    const displayedRange = useMemo(() => isLive ? liveRangeAt(currentPlaybackTime) : range, [isLive, currentPlaybackTime, range]);
    const [preserveViewRequest, setPreserveViewRequest] = useState(0);
    const applyPresetRange = (nextRange) => {
        applyRange(nextRange);
        setSelectedTransmitterId(null);
        // Freeze the current camera before the replacement results arrive,
        // including repeated presets and views that have never been panned.
        setPreserveViewRequest((value) => value + 1);
    };
    const selectedTransmitter = rows.find((row) => row.id === selectedTransmitterId) || null;
    const lastSelectedAircraft = useRef(null);
    const retained = lastSelectedAircraft.current;
    // Keep only the selected aircraft's explanation after LIVE removes its
    // positions and table row. Range changes and other selections discard it.
    const expiredAircraft = isLive && retained?.range === range && retained.transmitter.id === selectedTransmitterId
        && aircraftReceptionAt([Date.parse(retained.transmitter.captured_at)], currentPlaybackTime).status === 'expired'
        ? retained.transmitter : null;
    useEffect(() => {
        if (selectedTransmitter?.kind === 'adsb') lastSelectedAircraft.current = {transmitter: selectedTransmitter, range};
        // A deletion before expiry is not a timeout. Do not retain its details
        // and make them reappear later when the old fix would have expired.
        else if (!expiredAircraft) lastSelectedAircraft.current = null;
    }, [selectedTransmitter, expiredAircraft, range]);
    const [hiddenTypes, setHiddenTypes] = useState(() => {
        const saved = readStored(hiddenTypesStoreName);
        return Array.isArray(saved) ? saved.filter((kind) => typeof kind === 'string') : [];
    });
    // Apply the table's type selection before building any map markers or
    // tracks, alongside the additional visibility choices in map settings.
    const visiblePositions = useMemo(() => positions.filter((point) => !hiddenTypes.includes(point.kind)
        && (!Array.isArray(excludedTypes) || !excludedTypes.includes(point.kind))), [positions, hiddenTypes, excludedTypes]);
    const changeHiddenTypes = (next) => {
        setHiddenTypes(next);
        writeStored(hiddenTypesStoreName, next);
    };
    const selectTransmitter = (id, {movePlayback = true, navigation = 'follow'} = {}) => {
        setSelectedTransmitterId(id);
        // A fresh object also resumes following an already-selected row.
        setNavigationRequest({type: navigation, transmitterId: id});
        const transmitter = rows.find((row) => row.id === id);
        const kind = transmitter?.kind;
        // Selecting a hidden transmitter should reveal its marker and track.
        if (hiddenTypes.includes(kind)) changeHiddenTypes(hiddenTypes.filter((value) => value !== kind));
        if (movePlayback && !isLive) {
            // Use recorded fixes rather than the row's latest telemetry: only
            // positions in the loaded history can reveal a marker and trail.
            const times = positions.filter((point) => point.transmitter_id === id)
                .map((point) => Date.parse(point.captured_at)).filter(Number.isFinite).sort((left, right) => left - right);
            const {status} = aircraftReceptionAt(times, currentPlaybackTime);
            // Aircraft can expire between recorded flights. Other protocols
            // retain their last position, so use their recorded interval to
            // bring a past sonde, station or node back to its actual reception.
            const outsideHistory = times.length > 0
                && (currentPlaybackTime < times[0] || currentPlaybackTime > times.at(-1));
            const shouldJump = kind === 'adsb' ? status === 'upcoming' || status === 'expired' : outsideHistory;
            if (shouldJump) {
                // Jump only on selection so manual scrubbing remains free to
                // leave this transmitter's history. Its endpoint reveals the trail.
                const time = times.at(-1);
                setPlaybackTime(time);
            }
        }
    };
    const transmitterAction = (action, id) => {
        const transmitter = rows.find((row) => row.id === id);
        if (!transmitter) return;
        if (action === 'captures') {
            setCapturesTransmitter(transmitter);
            return;
        }
        if (action === 'first' || action === 'last') {
            if (isLive) return;
            const track = transmitterTrack(positions, id);
            const time = action === 'first' ? track.times[0] : track.times.at(-1);
            if (!Number.isFinite(time)) return;
            setPlaybackTime(time);
            selectTransmitter(id, {movePlayback: false});
            return;
        }
        selectTransmitter(id, {movePlayback: false, navigation: action});
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
        <DateRangeBar range={displayedRange} positions={positions} onChange={applyRange}
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
                        navigationRequest={navigationRequest} onFollowingChange={setFollowedTransmitterId}
                        hiddenTypes={hiddenTypes} onHiddenTypesChange={changeHiddenTypes} onFitAll={() => setSelectedTransmitterId(null)} />
                </StyledIslandParentNoScrollbar>
                <StyledIslandParentNoScrollbar key="transmitter-info">
                    <TransmitterInfo transmitter={selectedTransmitter ?? expiredAircraft} selectedTransmitterId={selectedTransmitterId}
                        socket={socket}
                        positions={positions} playbackTime={currentPlaybackTime} isLive={isLive}
                        onJumpToPosition={isLive ? undefined : setPlaybackTime}
                        loading={loading} gridEditable={gridEditable} onClearSelection={() => setSelectedTransmitterId(null)} />
                </StyledIslandParentNoScrollbar>
                <StyledIslandParentNoScrollbar key="transmitters">
                    <TransmitterList rows={rows} loading={loading} hiddenTypes={hiddenTypes} gridEditable={gridEditable}
                        positions={positions}
                        selectedTransmitterId={selectedTransmitterId} onSelectTransmitter={selectTransmitter}
                        playbackTime={currentPlaybackTime} isLive={isLive} followedTransmitterId={followedTransmitterId}
                        onTransmitterAction={transmitterAction} />
                </StyledIslandParentNoScrollbar>
            </Responsive>}
        </div>
        {capturesTransmitter && <TransmitterCapturesDialog key={capturesTransmitter.id} transmitter={capturesTransmitter}
            socket={socket} onClose={() => setCapturesTransmitter(null)} />}
    </PageTabsLayout>;
}
