/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useCallback, useMemo, useState} from 'react';
import {Alert, Box, LinearProgress} from '@mui/material';
import {useSelector} from 'react-redux';
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

export {gridLayoutStoreName} from './storage.js';

export default function PacketMapLayout() {
    const {socket} = useSocket();
    const gridEditable = useSelector((state) => Boolean(state.dashboard?.isEditing));
    const {width, containerRef, mounted} = useContainerWidth({measureBeforeMount: true});
    const [layouts, setLayouts] = useState(loadLayouts);
    const [range, setRange] = useState(() => {
        const now = Date.now();
        return {start: new Date(now - 86400000).toISOString(), end: new Date(now).toISOString()};
    });
    const [playbackTime, setPlaybackTime] = useState(() => Date.parse(range.end));
    const applyRange = (nextRange) => {
        setRange(nextRange);
        // Start at the latest fix whenever a new filesystem window is applied.
        setPlaybackTime(nextRange.end === null ? null : Date.parse(nextRange.end));
    };
    const {positions, transmitters, available_range, loading, error, refresh} = usePacketPositions(socket, range);
    const isLive = range.end === null;
    const liveTime = useMemo(() => positions.reduce((latest, point) => {
        const capturedAt = Date.parse(point.captured_at);
        return capturedAt > latest ? capturedAt : latest;
    }, Math.max(Date.now(), Date.parse(range.start))), [positions, range.start]);
    // Live playback follows every transmitter's newest fix, including new IDs.
    const currentPlaybackTime = isLive ? liveTime : playbackTime;
    const rows = useMemo(() => transmitterRows(positions, transmitters), [positions, transmitters]);
    const [selectedTransmitterId, setSelectedTransmitterId] = useState(null);
    const [fitRequest, setFitRequest] = useState(0);
    const applyPresetRange = (nextRange) => {
        applyRange(nextRange);
        setSelectedTransmitterId(null);
        // Explicit requests override a saved or manually panned view, even when
        // no transmitter is selected or the same preset is clicked again.
        setFitRequest((value) => value + 1);
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
        // Selecting a hidden transmitter should reveal the path being fitted.
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

    return <PageTabsLayout sx={{bgcolor: 'transparent'}} tabs={<DateRangeBar
        range={range} availableRange={available_range} positions={positions} onChange={applyRange}
        onPresetChange={applyPresetRange}
        playbackTime={currentPlaybackTime} onPlaybackTimeChange={setPlaybackTime}
        onRefresh={reconcile} loading={loading || reconciling} />}>
        <Box sx={{height: 3}}>{(loading || reconciling) && <LinearProgress sx={{height: 3}} />}</Box>
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
                        fitRequest={fitRequest} selectedTransmitterId={selectedTransmitterId} onSelectTransmitter={selectTransmitter}
                        hiddenTypes={hiddenTypes} onHiddenTypesChange={changeHiddenTypes} onFitAll={() => setSelectedTransmitterId(null)} />
                </StyledIslandParentNoScrollbar>
                <StyledIslandParentNoScrollbar key="transmitter-info">
                    <TransmitterInfo transmitter={selectedTransmitter} selectedTransmitterId={selectedTransmitterId}
                        loading={loading} gridEditable={gridEditable} onClearSelection={() => setSelectedTransmitterId(null)} />
                </StyledIslandParentNoScrollbar>
                <StyledIslandParentNoScrollbar key="transmitters">
                    <TransmitterTable rows={rows} loading={loading} hiddenTypes={hiddenTypes} gridEditable={gridEditable}
                        selectedTransmitterId={selectedTransmitterId} onSelectTransmitter={selectTransmitter} />
                </StyledIslandParentNoScrollbar>
            </Responsive>}
        </div>
    </PageTabsLayout>;
}
