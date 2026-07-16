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
    

import React, { useRef, useEffect, useState, useCallback } from 'react';
import {preciseHumanizeFrequency} from "../common/common.jsx";
import { shallowEqual, useDispatch, useSelector } from "react-redux";
import {
    setBookMarks
} from "./waterfall-slice.jsx";
import { useTheme } from '@mui/material/styles';
import { getBookmarkSourceStyle, normalizeBookmarkSource } from './bookmark-source-styles.js';
import { parseTargetSlotNumber } from '../target/celestial-target-utils.js';


const BookmarkCanvas = ({
                            centerFrequency,
                            sampleRate,
                            containerWidth,
                            transformTick = 0,
                            interactionActive = false,
                            allowInteractionMeasure = false,
                            interactionMeasureTick = 0,
                            height,
                            bandOverlayHeight = 20,
                            onBookmarkClick = null
                        }) => {
    const dispatch = useDispatch();
    const theme = useTheme();
    const canvasRef = useRef(null);
    const bookmarkContainerRef = useRef(null);
    const rowAssignmentsRef = useRef(new Map());
    const [actualWidth, setActualWidth] = useState(2048);
    const lastMeasuredWidthRef = useRef(0);

    const {
        bookmarks,
        neighboringTransmitters,
        showNeighboringTransmitters,
        showBookmarkSources,
    } = useSelector((state) => ({
        bookmarks: state.waterfall.bookmarks,
        neighboringTransmitters: state.waterfall.neighboringTransmitters,
        showNeighboringTransmitters: state.waterfall.showNeighboringTransmitters,
        showBookmarkSources: state.waterfall.showBookmarkSources,
    }), shallowEqual);

    const {
        activeTrackerId,
        trackerViews,
        rigData,
        availableTransmitters,
    } = useSelector((state) => ({
        activeTrackerId: state.targetSatTrack.trackerId,
        trackerViews: state.targetSatTrack.trackerViews,
        rigData: state.targetSatTrack.rigData,
        availableTransmitters: state.targetSatTrack.availableTransmitters,
    }), shallowEqual);

    // Calculate frequency range
    const startFreq = centerFrequency - sampleRate / 2;
    const endFreq = centerFrequency + sampleRate / 2;

    const updateActualWidth = useCallback(() => {
        // Get the actual client dimensions of the element
        const rect = bookmarkContainerRef.current?.getBoundingClientRect();

        // Only update if the width has changed significantly (avoid unnecessary redraws)
        if (rect && Math.abs(rect.width - lastMeasuredWidthRef.current) > 1) {
            if (rect.width > 0) {
                lastMeasuredWidthRef.current = rect.width;
                setActualWidth(rect.width);
            }
        }
    }, []);

    // Function to add a bookmark at a specific frequency
    const makeBookMark = (frequency, label, color, metadata = {}) => {
        return {
            frequency,
            label,
            color,
            metadata,
        };
    };

    // Update width when layout or transform-driven width changes
    useEffect(() => {
        if (interactionActive) {
            return;
        }
        updateActualWidth();
    }, [containerWidth, transformTick, interactionActive, updateActualWidth]);

    useEffect(() => {
        if (!interactionActive || !allowInteractionMeasure) {
            return;
        }
        updateActualWidth();
    }, [interactionActive, allowInteractionMeasure, interactionMeasureTick, updateActualWidth]);

    // Helper function to compare bookmarks arrays
    function areBookmarksEqual(bookmarksA, bookmarksB) {
        if (bookmarksA.length !== bookmarksB.length) return false;

        // Deep comparison of each bookmark
        for (let i = 0; i < bookmarksA.length; i++) {
            const a = bookmarksA[i];
            const b = bookmarksB[i];

            // Simple comparison of important fields
            if (a.frequency !== b.frequency ||
                a.label !== b.label ||
                a.color !== b.color ||
                a.metadata?.type !== b.metadata?.type ||
                a.metadata?.source !== b.metadata?.source ||
                a.metadata?.tracker_id !== b.metadata?.tracker_id ||
                a.metadata?.transmitter_id !== b.metadata?.transmitter_id ||
                a.metadata?.alive !== b.metadata?.alive) {
                return false;
            }
        }
        return true;
    }

    // Merged effect: Create transmitter, doppler-shifted, and neighboring transmitter bookmarks
    useEffect(() => {
        const isSourceEnabled = (source) => {
            const normalized = normalizeBookmarkSource(source);
            if (!showBookmarkSources) {
                return true;
            }
            if (!Object.prototype.hasOwnProperty.call(showBookmarkSources, normalized)) {
                return true;
            }
            return Boolean(showBookmarkSources[normalized]);
        };

        const isRenderableTransmitter = (transmitterLike) => {
            if (!transmitterLike) {
                return false;
            }

            if (typeof transmitterLike.alive === 'boolean' && transmitterLike.alive === false) {
                return false;
            }

            const status = String(transmitterLike.status ?? '').toLowerCase();
            if (status && status !== 'active' && status !== 'alive') {
                return false;
            }

            return true;
        };

        const normalizedActiveTrackerId = String(activeTrackerId || 'active');
        const sortedTrackerIds = Object.keys(trackerViews || {}).sort((left, right) =>
            left.localeCompare(right, undefined, { numeric: true })
        );
        const trackerEntries = sortedTrackerIds.map((trackerId) => {
            const trackerView = trackerViews?.[trackerId] || {};
            return {
                trackerId,
                availableTransmitters: Array.isArray(trackerView.availableTransmitters) ? trackerView.availableTransmitters : [],
                rigTransmitters: Array.isArray(trackerView.rigData?.transmitters) ? trackerView.rigData.transmitters : [],
            };
        });

        // Ensure currently active tracker is still represented even if trackerViews has not been hydrated yet.
        if (!trackerEntries.some((entry) => entry.trackerId === normalizedActiveTrackerId)) {
            trackerEntries.push({
                trackerId: normalizedActiveTrackerId,
                availableTransmitters: Array.isArray(availableTransmitters) ? availableTransmitters : [],
                rigTransmitters: Array.isArray(rigData?.transmitters) ? rigData.transmitters : [],
            });
        }

        // 1. Create static transmitter bookmarks from all tracker views
        const transmitterBookmarks = [];
        trackerEntries.forEach(({ trackerId, availableTransmitters: trackerTransmitters }) => {
            trackerTransmitters.forEach(transmitter => {
                if (!isSourceEnabled(transmitter.source)) {
                    return;
                }
                if (!isRenderableTransmitter(transmitter)) {
                    return;
                }
                const isActive = transmitter['status'] === 'active';
                transmitterBookmarks.push(makeBookMark(
                    transmitter['downlink_low'],
                    `${transmitter['description']} (${preciseHumanizeFrequency(transmitter['downlink_low'])})`,
                    isActive ? theme.palette.success.main : theme.palette.grey[500],
                    {
                        type: 'transmitter',
                        source: normalizeBookmarkSource(transmitter.source),
                        tracker_id: trackerId,
                        transmitter_id: transmitter['id'],
                        active: isActive,
                        alive: typeof transmitter.alive === 'boolean' ? transmitter.alive : undefined
                    }
                ));
            });
        });

        // 2. Create doppler-shifted bookmarks from all tracker views
        const dopplerBookmarks = trackerEntries.flatMap(({ trackerId, rigTransmitters }) =>
            rigTransmitters
                .filter(transmitter =>
                    transmitter.downlink_observed_freq > 0 &&
                    isSourceEnabled(transmitter.source) &&
                    isRenderableTransmitter(transmitter)
                )
                .map(transmitter => ({
                    frequency: transmitter.downlink_observed_freq,
                    label: `${transmitter.description || 'Unknown'}`,
                    color: theme.palette.warning.main,
                    metadata: {
                        type: 'doppler_shift',
                        source: normalizeBookmarkSource(transmitter.source),
                        tracker_id: trackerId,
                        transmitter_id: transmitter.id,
                        alive: typeof transmitter.alive === 'boolean' ? transmitter.alive : undefined
                    }
                }))
        );

        // 3. Create neighboring transmitter bookmarks (from groupOfSats) - only if enabled
        const neighborBookmarks = showNeighboringTransmitters
            ? neighboringTransmitters
                .filter(tx => isSourceEnabled(tx.source) && isRenderableTransmitter(tx))
                .map(tx => {
                // Check if this is a grouped transmitter
                const label = tx.is_group
                    ? `${tx.satellite_name} (${tx.group_count})`
                    : tx.satellite_name;

                return {
                    frequency: tx.doppler_frequency,
                    label: label,
                    color: theme.palette.info.main,
                    metadata: {
                        type: 'neighbor_transmitter',
                        source: normalizeBookmarkSource(tx.source),
                        transmitter_id: tx.id,
                        satellite_norad_id: tx.satellite_norad_id,
                        doppler_shift: tx.doppler_shift,
                        is_group: tx.is_group || false,
                        group_count: tx.group_count || 1,
                        alive: typeof tx.alive === 'boolean' ? tx.alive : true
                    }
                };
            })
            : [];

        // 4. Combine all types of bookmarks
        const updatedBookmarks = [...transmitterBookmarks, ...dopplerBookmarks, ...neighborBookmarks];

        // 5. Only dispatch if bookmarks actually changed
        if (!areBookmarksEqual(bookmarks, updatedBookmarks)) {
            dispatch(setBookMarks(updatedBookmarks));
        }
    }, [
        activeTrackerId,
        trackerViews,
        availableTransmitters,
        rigData,
        neighboringTransmitters,
        showNeighboringTransmitters,
        showBookmarkSources,
        theme.palette.success.main,
        theme.palette.warning.main,
        theme.palette.info.main,
        theme.palette.grey
    ]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const ctx = canvas.getContext('2d', { willReadFrequently: true});

        // Set canvas width based on actual measured width
        canvas.width = actualWidth;
        canvas.height = height;

        // Clear the canvas with a transparent background
        ctx.clearRect(0, 0, canvas.width, height);

        // Calculate frequency range
        const freqRange = endFreq - startFreq;

        // Constants for label sizing
        const textHeight = 14;
        const padding = 4;
        const labelGap = 2; // Extra spacing between stacked labels
        const verticalSpacing = textHeight + padding * 2 + labelGap; // Total height of a label plus gap
        const baseY = 16; // Base Y position for the first label
        const bookmarkLabelOffset = 20; // Vertical offset from base position for bookmark labels
        const maxLabelBottomY = Math.max(0, height - bandOverlayHeight - 4);
        const clampLabelY = (candidateLabelY) => {
            const boxHeight = textHeight + padding * 2;
            const maxAllowedLabelY = maxLabelBottomY - boxHeight;
            return Math.min(candidateLabelY, maxAllowedLabelY);
        };
        // Keep bookmark labels aligned on predictable rows across all bookmark layers.
        const mainLabelBaseY = clampLabelY(baseY + 35 + bookmarkLabelOffset + verticalSpacing);
        const neighborLabelBaseY = mainLabelBaseY;
        const dopplerLabelBaseY = clampLabelY(mainLabelBaseY - (verticalSpacing + 6));

        const getLabelAccentColor = (bookmark) => {
            const sourceStyle = getBookmarkSourceStyle(bookmark.metadata?.source, theme);
            return sourceStyle.accent;
        };

        const toShortTransmitterName = (label) => {
            const raw = String(label ?? '');
            const normalized = raw.split(' (')[0].split(' - ')[0].trim();
            if (!normalized) {
                return 'Unknow...';
            }
            return `${normalized.slice(0, 6)}...`;
        };

        const getTrackerSlotLabel = (bookmark) => {
            const slotNumber = parseTargetSlotNumber(bookmark.metadata?.tracker_id);
            return slotNumber == null ? '' : `T${slotNumber}`;
        };

        // Mirror Earthview map-tooltip TargetNumberIcon style in canvas.
        const getTrackerSlotBadgeMetrics = (trackerSlotLabel) => {
            if (!trackerSlotLabel) {
                return null;
            }
            const SLOT_BADGE_SCALE = 0.95;
            const badgeHeight = 15 * SLOT_BADGE_SCALE;
            const minWidth = 16 * SLOT_BADGE_SCALE;
            const padX = 4 * SLOT_BADGE_SCALE;
            const sideGap = 4 * SLOT_BADGE_SCALE;
            const fontSize = Math.max(10, Math.round(badgeHeight * 0.68));
            const fontFamily = theme.typography?.fontFamily || 'Arial';
            ctx.save();
            ctx.font = `900 ${fontSize}px ${fontFamily}`;
            const textWidth = Math.ceil(ctx.measureText(trackerSlotLabel).width);
            ctx.restore();
            const badgeWidth = Math.max(minWidth, textWidth + (padX * 2));
            return {
                padX,
                badgeHeight,
                minWidth,
                fontSize,
                fontFamily,
                textWidth,
                badgeWidth,
                borderRadius: 3 * SLOT_BADGE_SCALE,
                leftReserve: badgeWidth + sideGap,
            };
        };

        const drawTrackerSlotBadge = ({
            boxLeft,
            boxTop,
            boxHeight,
            trackerSlotLabel,
            metrics,
            faded = false,
        }) => {
            if (!trackerSlotLabel || !metrics) {
                return;
            }
            const slotBadgePalette = theme.palette.badge?.targetSlot || {};
            const badgeTop = boxTop + ((boxHeight - metrics.badgeHeight) / 2);
            const badgeLeft = boxLeft + padding;
            const badgeCenterY = badgeTop + (metrics.badgeHeight / 2);

            ctx.save();
            ctx.beginPath();
            ctx.roundRect(
                badgeLeft,
                badgeTop,
                metrics.badgeWidth,
                metrics.badgeHeight,
                metrics.borderRadius
            );
            ctx.fillStyle = slotBadgePalette.background || theme.palette.warning.main;
            ctx.globalAlpha = faded ? 0.62 : 1.0;
            ctx.shadowColor = slotBadgePalette.shadow || 'rgba(0, 0, 0, 0.2)';
            ctx.shadowBlur = 3;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 1;
            ctx.fill();

            ctx.font = `900 ${metrics.fontSize}px ${metrics.fontFamily}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = slotBadgePalette.text || theme.palette.common.black;
            ctx.globalAlpha = faded ? 0.9 : 1.0;
            ctx.fillText(
                trackerSlotLabel,
                badgeLeft + (metrics.badgeWidth / 2),
                badgeCenterY
            );
            ctx.restore();
        };

        const CLUSTER_FREQUENCY_TOLERANCE_HZ = 500;

        const getClusterMetaKey = (bookmark) => {
            const trackerKey = bookmark.metadata?.tracker_id || 'active';
            const sourceKey = bookmark.metadata?.source || 'unknown';
            const typeKey = bookmark.metadata?.type || 'unknown';
            const aliveKey = typeof bookmark.metadata?.alive === 'boolean' ? String(bookmark.metadata.alive) : 'unknown';
            return `${trackerKey}|${sourceKey}|${typeKey}|${aliveKey}`;
        };

        const toFrequencyNumber = (frequency) => {
            const numeric = Number(frequency);
            return Number.isFinite(numeric) ? numeric : 0;
        };

        const clusterBookmarks = (items) => {
            const groupedByMeta = new Map();
            items.forEach((bookmark) => {
                const key = getClusterMetaKey(bookmark);
                if (!groupedByMeta.has(key)) {
                    groupedByMeta.set(key, []);
                }
                groupedByMeta.get(key).push(bookmark);
            });

            const frequencyAwareClusters = [];
            groupedByMeta.forEach((metaItems) => {
                const sortedByFrequency = [...metaItems].sort(
                    (a, b) => toFrequencyNumber(a.frequency) - toFrequencyNumber(b.frequency)
                );

                let currentCluster = [];
                sortedByFrequency.forEach((bookmark) => {
                    if (currentCluster.length === 0) {
                        currentCluster = [bookmark];
                        return;
                    }

                    const previous = currentCluster[currentCluster.length - 1];
                    const diffHz = Math.abs(
                        toFrequencyNumber(bookmark.frequency) - toFrequencyNumber(previous.frequency)
                    );

                    // Merge labels when frequencies are close enough to be effectively the same signal area.
                    if (diffHz <= CLUSTER_FREQUENCY_TOLERANCE_HZ) {
                        currentCluster.push(bookmark);
                        return;
                    }

                    frequencyAwareClusters.push(currentCluster);
                    currentCluster = [bookmark];
                });

                if (currentCluster.length > 0) {
                    frequencyAwareClusters.push(currentCluster);
                }
            });

            return frequencyAwareClusters.map((clusterItems) => {
                const primary = clusterItems[0];
                const maxLabelParts = 6;
                const shortParts = clusterItems.map((item) => toShortTransmitterName(item.label));
                const visibleParts = shortParts.slice(0, maxLabelParts);
                const hiddenCount = Math.max(0, shortParts.length - visibleParts.length);
                const averagedClusterFrequency = Math.round(
                    clusterItems.reduce((sum, item) => sum + toFrequencyNumber(item.frequency), 0) / clusterItems.length
                );
                const entityIds = clusterItems
                    .map((item) => (
                        item.metadata?.transmitter_id ??
                        item.metadata?.satellite_norad_id ??
                        item.label ??
                        ''
                    ))
                    .map((value) => String(value))
                    .filter(Boolean)
                    .sort();
                const anchorEntityId = entityIds[0] || String(primary.label || 'unknown');
                const clusterRowKey = [
                    primary.metadata?.tracker_id || 'active',
                    primary.metadata?.type || 'unknown',
                    primary.metadata?.source || 'unknown',
                    anchorEntityId
                ].join('|');
                const label = clusterItems.length > 1
                    ? `${visibleParts.join(', ')}${hiddenCount > 0 ? ` +${hiddenCount}` : ''}`
                    : primary.label;

                return {
                    ...primary,
                    frequency: averagedClusterFrequency,
                    label,
                    metadata: {
                        ...primary.metadata,
                        cluster_count: clusterItems.length,
                        cluster_row_key: clusterRowKey,
                    }
                };
            }).sort((a, b) => {
                if (a.frequency !== b.frequency) {
                    return a.frequency - b.frequency;
                }
                const rowKeyA = String(a.metadata?.cluster_row_key || '');
                const rowKeyB = String(b.metadata?.cluster_row_key || '');
                return rowKeyA.localeCompare(rowKeyB);
            });
        };

        const getDrawKey = (bookmark, layer) => {
            return `${layer}|${String(bookmark.metadata?.cluster_row_key || bookmark.metadata?.transmitter_id || bookmark.label || bookmark.frequency)}`;
        };

        const assignProximityRows = (items, layer, nearDistancePx = 72, rowCount = 3) => {
            const candidates = items
                .filter((bookmark) => bookmark.frequency >= startFreq && bookmark.frequency <= endFreq)
                .map((bookmark) => ({
                    bookmark,
                    x: ((bookmark.frequency - startFreq) / freqRange) * canvas.width,
                    key: getDrawKey(bookmark, layer),
                }))
                .sort((a, b) => {
                    if (a.x !== b.x) {
                        return a.x - b.x;
                    }
                    return a.key.localeCompare(b.key);
                });

            const assigned = new Map();
            const placed = [];

            candidates.forEach((entry) => {
                const activeRows = new Set(
                    placed
                        .filter((prev) => Math.abs(prev.x - entry.x) <= nearDistancePx)
                        .map((prev) => prev.row)
                );

                const cachedRow = rowAssignmentsRef.current.get(entry.key);
                let row = typeof cachedRow === 'number' ? cachedRow : null;
                if (row === null || activeRows.has(row)) {
                    row = null;
                    for (let candidateRow = 0; candidateRow < rowCount; candidateRow++) {
                        if (!activeRows.has(candidateRow)) {
                            row = candidateRow;
                            break;
                        }
                    }
                    if (row === null) {
                        row = placed.length % rowCount;
                    }
                }

                rowAssignmentsRef.current.set(entry.key, row);
                assigned.set(entry.key, row);
                placed.push({ x: entry.x, row });
            });

            return assigned;
        };

        // First, identify all transmitter IDs that have doppler shift bookmarks
        // We'll use this to skip the corresponding transmitter bookmarks
        const transmitterKeysWithDoppler = new Set();
        bookmarks.forEach(bookmark => {
            if (bookmark.metadata?.type === 'doppler_shift' && bookmark.metadata?.transmitter_id) {
                const trackerKey = bookmark.metadata?.tracker_id || 'active';
                transmitterKeysWithDoppler.add(`${trackerKey}|${String(bookmark.metadata.transmitter_id)}`);
            }
        });

        // Draw bookmarks in order: neighbors first (bottom layer), then main transmitters and doppler (top layer)
        if (bookmarks.length) {
            // Separate bookmarks by type for layered rendering
            const neighborBookmarks = clusterBookmarks(
                bookmarks.filter(b => b.metadata?.type === 'neighbor_transmitter')
            );
            const mainBookmarks = clusterBookmarks(
                bookmarks.filter(b => b.metadata?.type !== 'neighbor_transmitter')
            );
            const mainNonDopplerVisible = mainBookmarks.filter((bookmark) =>
                bookmark.frequency >= startFreq &&
                bookmark.frequency <= endFreq &&
                !(bookmark.metadata?.type === 'transmitter' &&
                    bookmark.metadata?.transmitter_id &&
                    transmitterKeysWithDoppler.has(`${bookmark.metadata?.tracker_id || 'active'}|${String(bookmark.metadata.transmitter_id)}`))
            );
            const dopplerVisible = mainBookmarks.filter((bookmark) =>
                bookmark.frequency >= startFreq &&
                bookmark.frequency <= endFreq &&
                bookmark.metadata?.type === 'doppler_shift'
            );
            const neighborRowAssignments = assignProximityRows(neighborBookmarks, 'neighbor');
            const mainRowAssignments = assignProximityRows(mainNonDopplerVisible, 'main');
            const dopplerRowAssignments = assignProximityRows(dopplerVisible, 'doppler');

            // Draw neighbor transmitters first (bottom layer)
            neighborBookmarks.forEach((bookmark) => {
                // Skip if the bookmark is outside the visible range
                if (bookmark.frequency < startFreq || bookmark.frequency > endFreq) {
                    return;
                }

                // Calculate x position based on frequency
                const x = ((bookmark.frequency - startFreq) / freqRange) * canvas.width;
                const sourceStyle = getBookmarkSourceStyle(bookmark.metadata?.source, theme);

                // Check if this is an inactive transmitter for line styling
                const isInactiveTransmitter = false; // Neighbors are always active
                const isNeighborTransmitter = true;

                // Draw a downward-pointing arrow at the bottom of the canvas
                ctx.beginPath();
                const arrowSize = 5;
                const arrowY = height - arrowSize; // Position at bottom of canvas

                // Draw the arrow path
                ctx.moveTo(x - arrowSize, arrowY);
                ctx.lineTo(x + arrowSize, arrowY);
                ctx.lineTo(x, height);
                ctx.closePath();

                // Fill the arrow for neighbor transmitters
                ctx.fillStyle = bookmark.color || theme.palette.info.main;
                ctx.globalAlpha = 0.6;
                ctx.fill();
                ctx.strokeStyle = sourceStyle.accent;
                ctx.lineWidth = sourceStyle.strokeWidth;
                ctx.globalAlpha = 0.5;
                ctx.stroke();
                ctx.globalAlpha = 1.0;

                // Variable to store the label bottom Y position for the dotted line
                let labelBottomY = 0;

                // Display label at top with alternating heights
                if (bookmark.label) {
                    const labelOffset = (neighborRowAssignments.get(getDrawKey(bookmark, 'neighbor')) ?? 0) * verticalSpacing;
                    const labelY = clampLabelY(neighborLabelBaseY + labelOffset);

                    // Store the bottom edge of the label box (south edge)
                    labelBottomY = labelY + textHeight + padding * 2;

                    const fontSize = '9px';

                    ctx.font = `${fontSize} Arial`;
                    ctx.fillStyle = bookmark.color || theme.palette.info.main;
                    ctx.textAlign = 'center';

                    // Add semi-transparent background
                    const leftReserve = 0;
                    const displayLabel = bookmark.label;
                    const textMetrics = ctx.measureText(displayLabel);
                    const textWidth = textMetrics.width;
                    const boxWidth = textWidth + padding * 2 + leftReserve;
                    const radius = 3;
                    const boxLeft = x - boxWidth / 2;
                    const boxTop = labelY - padding;
                    const boxHeight = textHeight + padding * 2;

                    ctx.beginPath();
                    ctx.roundRect(
                        boxLeft,
                        boxTop,
                        boxWidth,
                        boxHeight,
                        radius
                    );
                    const bgColor = theme.palette.background.paper;
                    ctx.globalAlpha = 0.75;
                    ctx.fillStyle = bgColor.startsWith('#')
                        ? bgColor + 'E6'
                        : bgColor.replace(')', ', 0.9)');
                    ctx.fill();
                    ctx.globalAlpha = 1.0;

                    // Draw the text
                    ctx.shadowBlur = 2;
                    ctx.shadowColor = theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)';
                    ctx.globalAlpha = 0.75;
                    ctx.fillStyle = theme.palette.text.primary;
                    const textX = x + (leftReserve / 2);
                    ctx.fillText(displayLabel, textX, labelY + textHeight - padding);
                    ctx.globalAlpha = 1.0;

                    // Draw dotted line from bottom of canvas to south edge of label
                    ctx.beginPath();
                    ctx.strokeStyle = sourceStyle.accent;
                    ctx.lineWidth = 0.8;
                    ctx.setLineDash(sourceStyle.lineDash.length ? sourceStyle.lineDash : [1.5, 3]);
                    ctx.globalAlpha = 0.22;
                    ctx.shadowBlur = 1;
                    ctx.shadowColor = theme.palette.background.paper;
                    ctx.moveTo(x, height); // Start from bottom
                    ctx.lineTo(x, labelBottomY); // End at south edge of label
                    ctx.stroke();
                    ctx.setLineDash([]); // Reset dash pattern
                    ctx.globalAlpha = 1.0;
                    ctx.shadowBlur = 0;

                }

                // Reset shadow
                ctx.shadowBlur = 0;
            });

            // Draw main transmitters and doppler markers (top layer)
            mainBookmarks.forEach((bookmark) => {
                // Skip if the bookmark is outside the visible range
                if (bookmark.frequency < startFreq || bookmark.frequency > endFreq) {
                    return;
                }

                // Skip transmitter bookmarks that have a corresponding doppler shift bookmark
                if (bookmark.metadata?.type === 'transmitter' &&
                    bookmark.metadata?.transmitter_id &&
                    transmitterKeysWithDoppler.has(`${bookmark.metadata?.tracker_id || 'active'}|${String(bookmark.metadata.transmitter_id)}`)) {
                    return;
                }

                // Calculate x position based on frequency
                const x = ((bookmark.frequency - startFreq) / freqRange) * canvas.width;
                const sourceStyle = getBookmarkSourceStyle(bookmark.metadata?.source, theme);

                // Check if this is an inactive transmitter for line styling
                const isInactiveTransmitter = bookmark.metadata?.type === 'transmitter' && !bookmark.metadata?.active;

                // Draw a downward-pointing arrow at the bottom of the canvas
                ctx.beginPath();
                const arrowSize = isInactiveTransmitter ? 4 : 6;
                const arrowY = height - arrowSize; // Position at bottom of canvas

                // Draw the arrow path
                ctx.moveTo(x - arrowSize, arrowY);
                ctx.lineTo(x + arrowSize, arrowY);
                ctx.lineTo(x, height);
                ctx.closePath();

                // If the bookmark is a transmitter, draw a hollow arrow with colored outline
                if (bookmark.metadata?.type === 'transmitter') {
                    ctx.strokeStyle = bookmark.color || theme.palette.warning.main;
                    ctx.lineWidth = isInactiveTransmitter ? 1 : 2;
                    ctx.globalAlpha = isInactiveTransmitter ? 0.5 : 1.0;
                    ctx.stroke();

                } else {
                    // For all other bookmarks, fill the arrow
                    ctx.fillStyle = bookmark.color || theme.palette.warning.main;
                    ctx.globalAlpha = 1.0;
                    ctx.fill();
                }
                ctx.strokeStyle = sourceStyle.accent;
                ctx.lineWidth = sourceStyle.strokeWidth;
                ctx.stroke();

                // Check if this is a doppler_shift type bookmark
                const isDopplerShift = bookmark.metadata?.type === 'doppler_shift';
                const isNeighborTransmitter = bookmark.metadata?.type === 'neighbor_transmitter';

                // Variable to store the label bottom Y position for the dotted line
                let labelBottomY = 0;

                // For regular bookmarks and neighbor transmitters - display at top with alternating heights
                if (bookmark.label && !isDopplerShift) {
                    const labelOffset = (mainRowAssignments.get(getDrawKey(bookmark, 'main')) ?? 0) * verticalSpacing;
                    const labelY = clampLabelY(mainLabelBaseY + labelOffset);

                    // Store the bottom edge of the label box (south edge)
                    labelBottomY = labelY + textHeight + padding * 2;

                    // Check if this is an inactive transmitter or a neighbor transmitter
                    const isInactive = bookmark.metadata?.type === 'transmitter' && !bookmark.metadata?.active;
                    // Use slightly smaller font for neighbor transmitters to differentiate
                    const fontSize = isInactive ? '8px' : (isNeighborTransmitter ? '9px' : '10px');

                    ctx.font = `${fontSize} Arial`;
                    ctx.fillStyle = bookmark.color || theme.palette.warning.main;
                    ctx.textAlign = 'center';

                    // Add semi-transparent background
                    const trackerSlotLabel = getTrackerSlotLabel(bookmark);
                    const slotBadgeMetrics = getTrackerSlotBadgeMetrics(trackerSlotLabel);
                    const leftReserve = slotBadgeMetrics ? slotBadgeMetrics.leftReserve : 0;
                    const displayLabel = bookmark.label;
                    const textMetrics = ctx.measureText(displayLabel);
                    const textWidth = textMetrics.width;
                    const boxWidth = textWidth + padding * 2 + leftReserve;
                    const radius = 3;
                    const boxLeft = x - boxWidth / 2;
                    const boxTop = labelY - padding;
                    const boxHeight = textHeight + padding * 2;

                    ctx.beginPath();
                    ctx.roundRect(
                        boxLeft,
                        boxTop,
                        boxWidth,
                        boxHeight,
                        radius
                    );
                    const bgColor = theme.palette.background.paper;
                    ctx.fillStyle = bgColor.startsWith('#')
                        ? bgColor + 'E6'
                        : bgColor.replace(')', ', 0.9)');
                    ctx.fill();

                    // Add subtle border
                    ctx.strokeStyle = getLabelAccentColor(bookmark);
                    ctx.globalAlpha = isInactive ? 0.28 : 0.42;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;

                    // Draw T# badge with the same visual style as Earthview map tooltip labels.
                    if (trackerSlotLabel) {
                        drawTrackerSlotBadge({
                            boxLeft,
                            boxTop,
                            boxHeight,
                            trackerSlotLabel,
                            metrics: slotBadgeMetrics,
                            faded: isInactive,
                        });
                    }

                    // Draw the text
                    ctx.shadowBlur = 2;
                    ctx.shadowColor = theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)';
                    ctx.globalAlpha = isInactive ? 0.6 : 1.0;
                    ctx.fillStyle = theme.palette.text.primary;
                    const textX = x + (leftReserve / 2);
                    ctx.fillText(displayLabel, textX, labelY + textHeight - padding);
                    ctx.globalAlpha = 1.0;

                    // Draw dotted line from bottom of canvas to south edge of label
                    ctx.beginPath();
                    ctx.strokeStyle = sourceStyle.accent;
                    ctx.lineWidth = isInactiveTransmitter ? 0.7 : 0.9;
                    ctx.setLineDash(sourceStyle.lineDash.length ? sourceStyle.lineDash : [1.5, 3]);
                    ctx.globalAlpha = isInactiveTransmitter ? 0.3 : 0.45;
                    ctx.shadowBlur = 1;
                    ctx.shadowColor = theme.palette.background.paper;
                    ctx.moveTo(x, height); // Start from bottom
                    ctx.lineTo(x, labelBottomY); // End at south edge of label
                    ctx.stroke();
                    ctx.setLineDash([]); // Reset dash pattern
                    ctx.globalAlpha = 1.0;
                    ctx.shadowBlur = 0;

                }

                // For doppler_shift bookmarks - track their index separately for stacking
                if (bookmark.label && isDopplerShift) {
                    ctx.font = '10px Arial';
                    ctx.fillStyle = bookmark.color || theme.palette.info.main;
                    ctx.textAlign = 'center';

                    const dopplerLabelOffset = (dopplerRowAssignments.get(getDrawKey(bookmark, 'doppler')) ?? 0) * verticalSpacing;
                    const dopplerLabelY = clampLabelY(dopplerLabelBaseY + dopplerLabelOffset);

                    // Store the bottom edge of the doppler label box (south edge)
                    labelBottomY = dopplerLabelY + textHeight + padding * 2;

                    // Add semi-transparent background
                    const trackerSlotLabel = getTrackerSlotLabel(bookmark);
                    const slotBadgeMetrics = getTrackerSlotBadgeMetrics(trackerSlotLabel);
                    const leftReserve = slotBadgeMetrics ? slotBadgeMetrics.leftReserve : 0;
                    const displayLabel = bookmark.label;
                    const textMetrics = ctx.measureText(displayLabel);
                    const textWidth = textMetrics.width;
                    const boxWidth = textWidth + padding * 2 + leftReserve;
                    const radius = 3;
                    const boxLeft = x - boxWidth / 2;
                    const boxTop = dopplerLabelY - padding;
                    const boxHeight = textHeight + padding * 2;

                    ctx.beginPath();
                    ctx.roundRect(
                        boxLeft,
                        boxTop,
                        boxWidth,
                        boxHeight,
                        radius
                    );
                    const bgColor = theme.palette.background.paper;
                    ctx.fillStyle = bgColor.startsWith('#')
                        ? bgColor + 'B3'
                        : bgColor.replace(')', ', 0.7)');
                    ctx.fill();

                    // Add subtle border
                    ctx.strokeStyle = getLabelAccentColor(bookmark);
                    ctx.globalAlpha = 0.38;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;

                    // Draw T# badge with the same visual style as Earthview map tooltip labels.
                    if (trackerSlotLabel) {
                        drawTrackerSlotBadge({
                            boxLeft,
                            boxTop,
                            boxHeight,
                            trackerSlotLabel,
                            metrics: slotBadgeMetrics,
                            faded: false,
                        });
                    }

                    // Draw the text
                    ctx.shadowBlur = 2;
                    ctx.shadowColor = theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)';
                    ctx.globalAlpha = 1.0;
                    ctx.fillStyle = theme.palette.text.primary;
                    const textX = x + (leftReserve / 2);
                    ctx.fillText(displayLabel, textX, dopplerLabelY + textHeight - padding);

                    // Draw dotted line from bottom of canvas to south edge of doppler label
                    ctx.beginPath();
                    ctx.strokeStyle = sourceStyle.accent;
                    ctx.lineWidth = 0.9;
                    ctx.setLineDash(sourceStyle.lineDash.length ? sourceStyle.lineDash : [1.5, 3]);
                    ctx.globalAlpha = 0.45;
                    ctx.shadowBlur = 1;
                    ctx.shadowColor = theme.palette.background.paper;
                    ctx.moveTo(x, height); // Start from bottom
                    ctx.lineTo(x, labelBottomY); // End at south edge of label
                    ctx.stroke();
                    ctx.setLineDash([]); // Reset dash pattern
                    ctx.globalAlpha = 1.0;
                    ctx.shadowBlur = 0;
                }

                // Reset shadow
                ctx.shadowBlur = 0;
            });
        }
    }, [bookmarks, centerFrequency, sampleRate, actualWidth, height, theme]);

    return (
        <div
            ref={bookmarkContainerRef}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${height}px`,
                pointerEvents: 'none',
            }}
        >
            <canvas
                className={'bookmark-canvas'}
                ref={canvasRef}
                width={actualWidth}
                height={height}
                style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    touchAction: 'pan-y',
                }}
            />
        </div>
    );
};

export default BookmarkCanvas;
