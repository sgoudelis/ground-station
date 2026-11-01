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
import {columns, LAYOUT_VERSION, loadLayouts} from './layouts.js';
import {transmitterRows} from './transmitters.js';
import TransmitterTable from './transmitter-table.jsx';
import TransmitterTypes from './transmitter-types.jsx';

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
    const {positions, transmitters, available_range, loading, error, refresh} = usePacketPositions(socket, range);
    const rows = useMemo(() => transmitterRows(positions, transmitters), [positions, transmitters]);
    const [hiddenTypes, setHiddenTypes] = useState(() => {
        const saved = readStored(hiddenTypesStoreName);
        return Array.isArray(saved) ? saved.filter((kind) => typeof kind === 'string') : [];
    });
    const visiblePositions = useMemo(() => positions.filter((point) => !hiddenTypes.includes(point.kind)), [positions, hiddenTypes]);
    const toggleType = (kind) => {
        const next = hiddenTypes.includes(kind) ? hiddenTypes.filter((value) => value !== kind) : [...hiddenTypes, kind];
        setHiddenTypes(next);
        writeStored(hiddenTypesStoreName, next);
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
        writeStored(gridLayoutStoreName, {version: LAYOUT_VERSION, layouts: all});
    }, []);

    return <PageTabsLayout sx={{bgcolor: 'transparent'}} tabs={<DateRangeBar
        range={range} availableRange={available_range} onChange={setRange}
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
                    <PacketMap positions={visiblePositions} hasPositions={positions.length > 0} loading={loading} gridEditable={gridEditable} fitRequest={0} />
                </StyledIslandParentNoScrollbar>
                <StyledIslandParentNoScrollbar key="transmitter-types">
                    <TransmitterTypes rows={rows} positions={positions} hiddenTypes={hiddenTypes} onToggle={toggleType} gridEditable={gridEditable} />
                </StyledIslandParentNoScrollbar>
                <StyledIslandParentNoScrollbar key="transmitters">
                    <TransmitterTable rows={rows} loading={loading} hiddenTypes={hiddenTypes} gridEditable={gridEditable} />
                </StyledIslandParentNoScrollbar>
            </Responsive>}
        </div>
    </PageTabsLayout>;
}
