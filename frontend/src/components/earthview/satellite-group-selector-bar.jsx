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
import { useDispatch, useSelector } from "react-redux";
import { useStore } from "react-redux";
import { Box, FormControl, InputLabel, Select, MenuItem, Chip, Menu, Typography, Tooltip, Button, useMediaQuery, useTheme, ListSubheader, Stack } from "@mui/material";
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

    const [visiblePillIds, setVisiblePillIds] = useState(new Set());
    const [anchorEl, setAnchorEl] = useState(null);
    const [visibleSatStats, setVisibleSatStats] = useState({ total: 0, rising: 0, peak: 0, falling: 0 });
    const containerRef = useRef(null);
    const pillRefs = useRef(new Map());

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

    const handleOnGroupChange = useCallback((event) => {
        const satGroupId = event.target.value;
        if (!satGroupId || satGroupId === 'none') {
            return;
        }
        dispatch(setSelectedSatGroupId(satGroupId));
        dispatch(fetchSatellitesByGroupId({ socket, satGroupId }));
    }, [dispatch, socket]);

    const handleRecentGroupClick = useCallback((groupId) => {
        // Verify the group exists before fetching
        const groupExists = satGroups.some(group => group.id === groupId);
        if (!groupExists) {
            console.warn(`Satellite group ${groupId} not found. Ignoring selection.`);
            setAnchorEl(null);
            return;
        }

        dispatch(setSelectedSatGroupId(groupId));
        dispatch(fetchSatellitesByGroupId({ socket, satGroupId: groupId }));
        setAnchorEl(null); // Close menu if open
    }, [dispatch, socket, satGroups]);

    // Flat ranking used by both dropdown and pills: selected first, then recent, then alphabetical.
    const rankedGroups = useMemo(() => {
        const normalizedGroups = satGroups.map((group) => ({
            id: group.id,
            name: group.name,
            satelliteCount: group.satellite_ids?.length || 0,
            type: group.type,
        }));

        if (normalizedGroups.length <= 1) {
            return normalizedGroups;
        }

        const recentOrder = new Map(
            recentGroups
                .filter((group) => satGroups.some((candidate) => candidate.id === group.id))
                .map((group, index) => [group.id, index])
        );

        return normalizedGroups.sort((a, b) => {
            const aIsSelected = a.id === selectedSatGroupId ? 0 : 1;
            const bIsSelected = b.id === selectedSatGroupId ? 0 : 1;
            if (aIsSelected !== bIsSelected) {
                return aIsSelected - bIsSelected;
            }

            const aRecentIndex = recentOrder.get(a.id);
            const bRecentIndex = recentOrder.get(b.id);
            const aIsRecent = aRecentIndex === undefined ? 1 : 0;
            const bIsRecent = bRecentIndex === undefined ? 1 : 0;
            if (aIsRecent !== bIsRecent) {
                return aIsRecent - bIsRecent;
            }
            if (aRecentIndex !== undefined && bRecentIndex !== undefined && aRecentIndex !== bRecentIndex) {
                return aRecentIndex - bRecentIndex;
            }

            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
    }, [satGroups, recentGroups, selectedSatGroupId]);

    // Use IntersectionObserver to detect which pills are visible
    useEffect(() => {
        if (!containerRef.current || rankedGroups.length === 0) return;

        // Create observer with threshold to detect when pills start to overflow
        const observer = new IntersectionObserver(
            (entries) => {
                // Batch updates to prevent excessive re-renders
                const updates = {};
                entries.forEach((entry) => {
                    const pillId = entry.target.getAttribute('data-pill-id');
                    const isFullyVisible = entry.isIntersecting && entry.intersectionRatio >= 0.95;
                    updates[pillId] = isFullyVisible;
                });

                setVisiblePillIds((prev) => {
                    const newSet = new Set(prev);
                    let changed = false;

                    Object.entries(updates).forEach(([pillId, isVisible]) => {
                        if (isVisible && !newSet.has(pillId)) {
                            newSet.add(pillId);
                            changed = true;
                        } else if (!isVisible && newSet.has(pillId)) {
                            newSet.delete(pillId);
                            changed = true;
                        }
                    });

                    // Only return new Set if something actually changed
                    return changed ? newSet : prev;
                });
            },
            {
                root: containerRef.current,
                threshold: [0, 0.95, 1],
                rootMargin: '0px',
            }
        );

        // Small delay to ensure DOM is ready
        const timeoutId = setTimeout(() => {
            // Observe all current pills
            pillRefs.current.forEach((element) => {
                if (element) {
                    observer.observe(element);
                }
            });
        }, 100);

        return () => {
            clearTimeout(timeoutId);
            observer.disconnect();
        };
    }, [rankedGroups]);

    const handleMoreClick = (event) => {
        setAnchorEl(event.currentTarget);
    };

    const handleMenuClose = () => {
        setAnchorEl(null);
    };

    const getGroupOptionIcon = useCallback((groupType) => {
        const normalizedType = String(groupType || '').toLowerCase();
        if (normalizedType === 'user') {
            return <FolderSharedOutlinedIcon fontSize="small" sx={{ color: 'primary.main' }} />;
        }
        return <FolderOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />;
    }, []);

    // Determine which pills are hidden (not visible in container)
    const hiddenPills = rankedGroups.filter(group => !visiblePillIds.has(group.id));
    const hasHiddenPills = hiddenPills.length > 0;
    const userRankedGroups = rankedGroups.filter((group) => String(group.type || '').toLowerCase() === 'user');
    const tleRankedGroups = rankedGroups.filter((group) => String(group.type || '').toLowerCase() !== 'user');

    // Use the state variable for visible satellite counts (updated periodically)
    const { total: visibleSatellitesCount, rising: risingCount, peak: peakCount, falling: fallingCount } = visibleSatStats;

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                padding: isTightHeader ? '8px 10px' : '12px 12px',
                bgcolor: 'background.paper',
                borderBottom: '1px solid',
                borderColor: 'border.main',
                height: isTightHeader ? '56px' : '64px',
                minHeight: isTightHeader ? '56px' : '64px',
                maxHeight: isTightHeader ? '56px' : '64px',
                maxWidth: '100%',
                overflow: 'hidden',
            }}
        >
            <FormControl
                sx={{
                    minWidth: isTightHeader ? 160 : (isCompactHeader ? 180 : 200),
                    maxWidth: isTightHeader ? 250 : 300,
                    flexShrink: 0,
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
                        [select group]
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

            <Box
                sx={{
                    // Hide recent-group pills area on mobile
                    display: { xs: 'none', sm: 'flex' },
                    flex: 1,
                    alignItems: 'center',
                    minWidth: 0,
                    position: 'relative',
                    gap: 1,
                }}
            >
                {/* Scrollable container for pills */}
                <Box
                    ref={containerRef}
                    sx={{
                        display: 'flex',
                        gap: 1,
                        alignItems: 'center',
                        overflow: 'hidden',
                        flex: 1,
                        minWidth: 0,
                    }}
                >
                    {/* All pills - let IntersectionObserver determine visibility */}
                    {rankedGroups.map((group) => (
                        <Tooltip
                            key={group.id}
                            title={`${group.name} (${group.satelliteCount} satellites)`}
                            arrow
                        >
                            <Button
                                data-pill-id={group.id}
                                ref={(el) => {
                                    if (el) {
                                        pillRefs.current.set(group.id, el);
                                    } else {
                                        pillRefs.current.delete(group.id);
                                    }
                                }}
                                variant={selectedSatGroupId === group.id ? "contained" : "outlined"}
                                size="small"
                                onClick={() => handleRecentGroupClick(group.id)}
                                sx={{
                                    flexShrink: 0,
                                    textTransform: 'none',
                                    borderRadius: '16px',
                                    px: isTightHeader ? 1 : (isCompactHeader ? 1.25 : 2),
                                    minHeight: isTightHeader ? 22 : (isCompactHeader ? 24 : 28),
                                    height: isTightHeader ? 22 : (isCompactHeader ? 24 : 28),
                                    fontSize: isTightHeader ? '0.68rem' : (isCompactHeader ? '0.72rem' : '0.78rem'),
                                    lineHeight: 1.05,
                                }}
                            >
                                {group.name}
                                <Box
                                    component="span"
                                    sx={{
                                        ml: 1,
                                        opacity: 1,
                                        fontWeight: 800,
                                        fontSize: 'inherit',
                                    }}
                                >
                                    {group.satelliteCount}
                                </Box>
                            </Button>
                        </Tooltip>
                    ))}
                </Box>

                {/* "More" button */}
                {hasHiddenPills && (
                    <Tooltip title={`Show ${hiddenPills.length} more groups`} arrow>
                        <Chip
                            label={`+${hiddenPills.length}`}
                            size="small"
                            clickable
                            onClick={handleMoreClick}
                            sx={{
                                cursor: 'pointer',
                                flexShrink: 0,
                                height: isTightHeader ? 20 : 24,
                                fontSize: isTightHeader ? '0.68rem' : '0.75rem',
                                bgcolor: 'action.selected',
                                '&:hover': {
                                    bgcolor: 'action.hover',
                                },
                            }}
                        />
                    </Tooltip>
                )}

                {/* Dropdown menu for hidden pills */}
                <Menu
                    anchorEl={anchorEl}
                    open={Boolean(anchorEl)}
                    onClose={handleMenuClose}
                    PaperProps={{
                        sx: {
                            maxHeight: 400,
                            maxWidth: 300,
                        }
                    }}
                >
                    {hiddenPills.map((group) => (
                        <MenuItem
                            key={group.id}
                            onClick={() => handleRecentGroupClick(group.id)}
                            selected={selectedSatGroupId === group.id}
                            sx={{
                                bgcolor: selectedSatGroupId === group.id ? 'primary.main' : 'inherit',
                                '&:hover': {
                                    bgcolor: selectedSatGroupId === group.id ? 'primary.dark' : 'action.hover',
                                },
                            }}
                        >
                            <Typography variant="body2">{group.name}</Typography>
                        </MenuItem>
                    ))}
                </Menu>
            </Box>

            {/* Visible satellites counter */}
            <Tooltip
                title={
                    <Box>
                        <Typography variant="caption" display="block">
                            Rising: {risingCount}
                        </Typography>
                        <Typography variant="caption" display="block">
                            Peak: {peakCount}
                        </Typography>
                        <Typography variant="caption" display="block">
                            Falling: {fallingCount}
                        </Typography>
                    </Box>
                }
                arrow
            >
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: isTightHeader ? '4px 8px' : '6px 12px',
                        bgcolor: 'action.hover',
                        borderRadius: '16px',
                        flexShrink: 0,
                        ml: 'auto',
                        cursor: 'help',
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <VisibilityIcon sx={{ fontSize: isTightHeader ? '1rem' : '1.2rem', color: 'success.main' }} />
                        <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                            {visibleSatellitesCount}
                        </Typography>
                    </Box>

                    {risingCount > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                            <TrendingUpIcon sx={{ fontSize: isTightHeader ? '0.85rem' : '1rem', color: 'info.main' }} />
                            <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'info.main' }}>
                                {risingCount}
                            </Typography>
                        </Box>
                    )}

                    {peakCount > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                            <HorizontalRuleIcon sx={{ fontSize: isTightHeader ? '0.85rem' : '1rem', color: 'warning.main' }} />
                            <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'warning.main' }}>
                                {peakCount}
                            </Typography>
                        </Box>
                    )}

                    {fallingCount > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
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
