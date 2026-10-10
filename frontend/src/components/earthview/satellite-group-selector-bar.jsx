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

import React, { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { Box, FormControl, InputLabel, Select, MenuItem, Typography, Tooltip, Button, useMediaQuery, useTheme, ListSubheader, Stack } from "@mui/material";
import VisibilityIcon from '@mui/icons-material/Visibility';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderSharedOutlinedIcon from '@mui/icons-material/FolderSharedOutlined';
import { useTranslation } from 'react-i18next';
import { useSocket } from "../common/socket.jsx";
import {
    setSelectedSatGroupId,
    fetchSatellitesByGroupId,
    addRecentSatelliteGroup,
    setRecentSatelliteGroups,
} from './earthview-slice.jsx';

const SATELLITE_NUMBER_LIMIT = 200;
const RECENT_GROUPS_KEY = 'satellite-recent-groups';

const SatelliteGroupSelectorBar = React.memo(function SatelliteGroupSelectorBar() {
    const dispatch = useDispatch();
    const { t } = useTranslation('earthview');
    const { socket } = useSocket();
    const store = useStore();
    const theme = useTheme();
    const isCompactHeader = useMediaQuery(theme.breakpoints.down('lg'));
    const isTightHeader = useMediaQuery(theme.breakpoints.down('md'));

    const selectedSatGroupId = useSelector(state => state.earthViewTrack.selectedSatGroupId);
    const satGroups = useSelector(state => state.earthViewTrack.satGroups);
    const passesLoading = useSelector(state => state.earthViewTrack.passesLoading);
    const recentGroups = useSelector(state => state.earthViewTrack.recentSatelliteGroups);

    // Use ref-based selector to prevent re-renders from position updates
    const selectedSatellitePositionsRef = useRef(() => {
        const state = store.getState();
        return state.earthViewTrack.selectedSatellitePositions;
    });

    const [displayedRecentIds, setDisplayedRecentIds] = useState([]);
    const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });
    const [visibleSatStats, setVisibleSatStats] = useState({ total: 0, rising: 0, peak: 0, falling: 0 });
    const recentScrollRef = useRef(null);
    const recentTrackRef = useRef(null);

    // Update visible satellite stats periodically (every 3 seconds) to avoid constant re-renders
    useEffect(() => {
        const updateStats = () => {
            const positions = selectedSatellitePositionsRef.current();
            const visibleSatellites = Object.values(positions || {}).filter(pos => pos.el > 0);
            const risingCount = visibleSatellites.filter(pos => pos.trend === 'rising_slow' || pos.trend === 'rising_fast').length;
            const fallingCount = visibleSatellites.filter(pos => pos.trend === 'falling_slow' || pos.trend === 'falling_fast').length;
            const peakCount = visibleSatellites.filter(pos => pos.trend === 'peak').length;

            setVisibleSatStats({
                total: visibleSatellites.length,
                rising: risingCount,
                peak: peakCount,
                falling: fallingCount
            });
        };

        // Initial update
        updateStats();

        // Update every 3 seconds
        const interval = setInterval(updateStats, 3000);

        return () => clearInterval(interval);
    }, [selectedSatellitePositionsRef]);

    // Load recent groups from localStorage on mount and store in Redux
    // Clean up stale groups that no longer exist
    useEffect(() => {
        try {
            const stored = localStorage.getItem(RECENT_GROUPS_KEY);
            if (stored && satGroups.length > 0) {
                const parsedGroups = JSON.parse(stored);
                if (!Array.isArray(parsedGroups)) return;
                // Filter out groups that no longer exist in satGroups
                const validGroups = parsedGroups.filter(rg =>
                    satGroups.some(g => g.id === rg.id)
                );
                dispatch(setRecentSatelliteGroups(validGroups));
            }
        } catch (e) {
            console.error('Failed to load recent groups:', e);
        }
    }, [dispatch, satGroups]);

    // Update recent groups when selection changes
    useEffect(() => {
        if (!selectedSatGroupId || selectedSatGroupId === 'none') return;

        const group = satGroups.find(g => g.id === selectedSatGroupId);
        if (!group) return;

        // Add to Redux
        dispatch(addRecentSatelliteGroup({ id: group.id, name: group.name }));

    }, [selectedSatGroupId, satGroups, dispatch]);

    // Persist recentGroups to localStorage whenever it changes
    useEffect(() => {
        if (recentGroups && recentGroups.length > 0) {
            try {
                localStorage.setItem(RECENT_GROUPS_KEY, JSON.stringify(recentGroups));
            } catch (e) {
                console.error('Failed to save recent groups:', e);
            }
        }
    }, [recentGroups]);

    // Keep shortcuts in place while this view is open. The stored list still
    // records each selection, so the next visit starts in true recent order.
    useEffect(() => {
        const recentIds = recentGroups.map(group => group.id);
        const recentIdSet = new Set(recentIds);
        setDisplayedRecentIds(previousIds => {
            const retainedIds = previousIds.filter(id => recentIdSet.has(id));
            const retainedIdSet = new Set(retainedIds);
            const addedIds = recentIds.filter(id => !retainedIdSet.has(id));
            const nextIds = [...retainedIds, ...addedIds];
            return nextIds.length === previousIds.length && nextIds.every((id, index) => id === previousIds[index])
                ? previousIds
                : nextIds;
        });
    }, [recentGroups]);

    const handleOnGroupChange = useCallback((event) => {
        const satGroupId = event.target.value;
        if (!satGroupId || satGroupId === 'none') {
            return;
        }
        dispatch(setSelectedSatGroupId(satGroupId));
        dispatch(fetchSatellitesByGroupId({ socket, satGroupId }));
    }, [dispatch, socket]);

    const handleRecentGroupClick = useCallback((groupId) => {
        const group = satGroups.find(candidate => candidate.id === groupId);
        if (!group || group.satellite_ids?.length > SATELLITE_NUMBER_LIMIT || passesLoading) return;

        dispatch(setSelectedSatGroupId(groupId));
        dispatch(fetchSatellitesByGroupId({ socket, satGroupId: groupId }));
    }, [dispatch, socket, satGroups, passesLoading]);

    const allGroups = useMemo(() => satGroups.map((group) => ({
            id: group.id,
            name: group.name,
            satelliteCount: group.satellite_ids?.length || 0,
            type: group.type,
        })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })), [satGroups]);
    const groupsById = useMemo(() => new Map(allGroups.map(group => [group.id, group])), [allGroups]);
    const displayedRecentGroups = displayedRecentIds.map(id => groupsById.get(id)).filter(Boolean);

    // A subtle fade advertises more pills without covering the last visible pill.
    useEffect(() => {
        const scrollElement = recentScrollRef.current;
        if (!scrollElement) return;
        const updateEdges = () => {
            const left = scrollElement.scrollLeft > 1;
            const right = scrollElement.scrollLeft + scrollElement.clientWidth < scrollElement.scrollWidth - 1;
            setScrollEdges(previous => previous.left === left && previous.right === right ? previous : { left, right });
        };
        const observer = new ResizeObserver(updateEdges);
        observer.observe(scrollElement);
        if (recentTrackRef.current) observer.observe(recentTrackRef.current);
        scrollElement.addEventListener('scroll', updateEdges, { passive: true });
        updateEdges();
        return () => {
            observer.disconnect();
            scrollElement.removeEventListener('scroll', updateEdges);
        };
    }, [displayedRecentGroups.length]);

    const getGroupOptionIcon = useCallback((groupType) => {
        const normalizedType = String(groupType || '').toLowerCase();
        if (normalizedType === 'user') {
            return <FolderSharedOutlinedIcon fontSize="small" sx={{ color: 'primary.main' }} />;
        }
        return <FolderOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />;
    }, []);

    const userRankedGroups = allGroups.filter((group) => String(group.type || '').toLowerCase() === 'user');
    const tleRankedGroups = allGroups.filter((group) => String(group.type || '').toLowerCase() !== 'user');

    // Use the state variable for visible satellite counts (updated periodically)
    const { total: visibleSatellitesCount, rising: risingCount, peak: peakCount, falling: fallingCount } = visibleSatStats;

    return (
        <Box
            sx={{
                display: 'grid',
                gridTemplateAreas: { xs: '"selector status" "recent recent"', md: '"selector recent status"' },
                gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', md: 'minmax(160px, 220px) minmax(0, 1fr) auto' },
                alignItems: 'center',
                columnGap: { xs: 1, md: 2 },
                rowGap: { xs: 1, md: 0 },
                padding: { xs: '8px 10px', md: '12px 12px' },
                bgcolor: 'background.paper',
                borderBottom: '1px solid',
                borderColor: 'border.main',
                minHeight: { xs: 56, md: 64 },
                height: { xs: 'auto', md: 64 },
                maxWidth: '100%',
            }}
        >
            <FormControl
                sx={{
                    gridArea: 'selector',
                    minWidth: 0,
                    width: '100%',
                }}
                disabled={passesLoading}
                variant="outlined"
                size="small"
            >
                <InputLabel htmlFor="grouped-select">{t('satellite_selector.group_label')}</InputLabel>
                <Select
                    disabled={passesLoading}
                    value={selectedSatGroupId && satGroups.some(group => group.id === selectedSatGroupId) ? selectedSatGroupId : "none"}
                    id="grouped-select"
                    label={t('satellite_selector.group_label')}
                    size="small"
                    onChange={handleOnGroupChange}
                >
                    <MenuItem value="none" key="none">
                        {t('satellite_group_selector_bar.select_group', { defaultValue: '[select group]' })}
                    </MenuItem>
                    <ListSubheader>{t('satellite_selector.user_groups')}</ListSubheader>
                    {userRankedGroups.length === 0 ? (
                        <MenuItem disabled value="" key="none-defined">
                            {t('satellite_selector.none_defined')}
                        </MenuItem>
                    ) : (
                        userRankedGroups.map((group) => (
                            <MenuItem
                                disabled={group.satelliteCount > SATELLITE_NUMBER_LIMIT}
                                value={group.id}
                                key={group.id}
                            >
                                <Stack direction="row" spacing={1} alignItems="center">
                                    {getGroupOptionIcon(group.type)}
                                    <span>{group.name} ({group.satelliteCount})</span>
                                </Stack>
                            </MenuItem>
                        ))
                    )}
                    <ListSubheader>{t('satellite_selector.tle_groups')}</ListSubheader>
                    {tleRankedGroups.length === 0 ? (
                        <MenuItem disabled value="" key="none-defined-tle">
                            {t('satellite_selector.none_defined')}
                        </MenuItem>
                    ) : (
                        tleRankedGroups.map((group) => (
                            <MenuItem
                                disabled={group.satelliteCount > SATELLITE_NUMBER_LIMIT}
                                value={group.id}
                                key={group.id}
                            >
                                <Stack direction="row" spacing={1} alignItems="center">
                                    {getGroupOptionIcon(group.type)}
                                    <span>{group.name} ({group.satelliteCount})</span>
                                </Stack>
                            </MenuItem>
                        ))
                    )}
                </Select>
            </FormControl>

            {displayedRecentGroups.length > 0 && (
                <Box sx={{ gridArea: 'recent', display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0 }}>
                        {t('satellite_selector.recent_groups')}
                    </Typography>
                    <Box sx={{ position: 'relative', minWidth: 0, flex: 1 }}>
                        <Box
                            ref={recentScrollRef}
                            role="group"
                            aria-label={t('satellite_selector.recent_groups')}
                            sx={{
                                overflowX: 'auto',
                                overflowY: 'hidden',
                                minWidth: 0,
                                msOverflowStyle: 'none',
                                scrollbarWidth: 'none',
                                '&::-webkit-scrollbar': { display: 'none' },
                            }}
                        >
                            <Stack ref={recentTrackRef} direction="row" spacing={1} sx={{ width: 'max-content', flexWrap: 'nowrap' }}>
                                {displayedRecentGroups.map((group) => (
                                    <Tooltip
                                        key={group.id}
                                        title={group.satelliteCount > SATELLITE_NUMBER_LIMIT
                                            ? t('satellite_selector.group_too_large', { count: SATELLITE_NUMBER_LIMIT })
                                            : `${group.name} (${group.satelliteCount})`}
                                        arrow
                                    >
                                        <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}>
                                            <Button
                                                data-pill-id={group.id}
                                                variant={selectedSatGroupId === group.id ? 'contained' : 'outlined'}
                                                size="small"
                                                disabled={passesLoading || group.satelliteCount > SATELLITE_NUMBER_LIMIT}
                                                aria-pressed={selectedSatGroupId === group.id}
                                                aria-label={`${group.name}, ${t('satellites_table.satellites_count', { count: group.satelliteCount })}`}
                                                onClick={() => handleRecentGroupClick(group.id)}
                                                sx={{
                                                    textTransform: 'none',
                                                    borderRadius: 4,
                                                    px: { xs: 1.25, md: isCompactHeader ? 1.25 : 1.5 },
                                                    minHeight: { xs: 34, md: 30 },
                                                    maxWidth: 220,
                                                    fontSize: '0.78rem',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {group.name}
                                                </Box>
                                                <Box component="span" sx={{ ml: 1, opacity: 0.75, fontWeight: 700, flexShrink: 0 }}>
                                                    {group.satelliteCount}
                                                </Box>
                                            </Button>
                                        </Box>
                                    </Tooltip>
                                ))}
                            </Stack>
                        </Box>
                        {scrollEdges.left && <Box aria-hidden="true" sx={{ position: 'absolute', inset: '0 auto 0 0', width: 16, pointerEvents: 'none', background: `linear-gradient(90deg, ${theme.palette.background.paper}, transparent)` }} />}
                        {scrollEdges.right && <Box aria-hidden="true" sx={{ position: 'absolute', inset: '0 0 0 auto', width: 16, pointerEvents: 'none', background: `linear-gradient(270deg, ${theme.palette.background.paper}, transparent)` }} />}
                    </Box>
                </Box>
            )}

            {/* Visible satellites counter */}
            <Tooltip
                title={
                    <Box>
                        <Typography variant="caption" display="block">
                            {t('satellite_group_selector_bar.rising', { defaultValue: 'Rising:' })} {risingCount}
                        </Typography>
                        <Typography variant="caption" display="block">
                            {t('satellite_group_selector_bar.peak', { defaultValue: 'Peak:' })} {peakCount}
                        </Typography>
                        <Typography variant="caption" display="block">
                            {t('satellite_group_selector_bar.falling', { defaultValue: 'Falling:' })} {fallingCount}
                        </Typography>
                    </Box>
                }
                arrow
            >
                <Box
                    sx={{
                        gridArea: 'status',
                        display: 'flex',
                        alignItems: 'center',
                        gap: { xs: 0.75, md: 1.5 },
                        padding: isTightHeader ? '4px 8px' : '6px 12px',
                        bgcolor: 'action.hover',
                        borderRadius: '16px',
                        justifySelf: 'end',
                        whiteSpace: 'nowrap',
                        cursor: 'help',
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <VisibilityIcon sx={{ fontSize: isTightHeader ? '1rem' : '1.2rem', color: 'success.main' }} />
                        <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                            {visibleSatellitesCount}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {t('passes_table.status_visible')}
                        </Typography>
                    </Box>

                    {risingCount > 0 && (
                        <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: '2px' }}>
                            <TrendingUpIcon sx={{ fontSize: isTightHeader ? '0.85rem' : '1rem', color: 'info.main' }} />
                            <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'info.main' }}>
                                {risingCount}
                            </Typography>
                        </Box>
                    )}

                    {peakCount > 0 && (
                        <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: '2px' }}>
                            <HorizontalRuleIcon sx={{ fontSize: isTightHeader ? '0.85rem' : '1rem', color: 'warning.main' }} />
                            <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'warning.main' }}>
                                {peakCount}
                            </Typography>
                        </Box>
                    )}

                    {fallingCount > 0 && (
                        <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: '2px' }}>
                            <TrendingDownIcon sx={{ fontSize: isTightHeader ? '0.85rem' : '1rem', color: 'error.main' }} />
                            <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'error.main' }}>
                                {fallingCount}
                            </Typography>
                        </Box>
                    )}
                </Box>
            </Tooltip>
        </Box>
    );
});

export default SatelliteGroupSelectorBar;
