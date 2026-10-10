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

import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import { useTranslation } from 'react-i18next';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export default function ZoomableImage({
    src,
    alt,
    containerSx,
    imageSx,
    minZoom = 1,
    maxZoom = 6,
    constrainPan = true,
    showHint = true,
    hintText = 'Scroll or pinch to zoom · Drag to pan',
    showZoomBadge = true,
    hintDurationMs = 2500,
    resetKey,
    getCursorInfo,
    renderOverlay,
}) {
    const { t } = useTranslation('common');
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [showHintState, setShowHintState] = useState(showHint);
    const [cursorInfo, setCursorInfo] = useState(null);
    const panStartRef = useRef({ x: 0, y: 0 });
    const pointerStartRef = useRef({ x: 0, y: 0 });
    const pointersRef = useRef(new Map());
    const pinchStartRef = useRef({ distance: 0, zoom: 1, pan: { x: 0, y: 0 } });
    const zoomContainerRef = useRef(null);
    const zoomImageRef = useRef(null);
    const lastPointerTypeRef = useRef('mouse');

    useEffect(() => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setIsPanning(false);
        setShowHintState(showHint);
        setCursorInfo(null);
    }, [resetKey, src, showHint]);

    useEffect(() => {
        if (!showHintState) return undefined;
        const timer = setTimeout(() => setShowHintState(false), hintDurationMs);
        return () => clearTimeout(timer);
    }, [showHintState, hintDurationMs]);

    useEffect(() => {
        const container = zoomContainerRef.current;
        if (!container) return undefined;

        const handleWheel = (event) => {
            if (!src) return;
            event.preventDefault();
            event.stopPropagation();
            handleZoom(event);
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => {
            container.removeEventListener('wheel', handleWheel);
        };
    }, [src, zoom, pan]);

    const getPanBounds = (zoomValue) => {
        const container = zoomContainerRef.current;
        const image = zoomImageRef.current;
        if (!container || !image) {
            return { maxX: 0, maxY: 0 };
        }
        const rect = container.getBoundingClientRect();
        const naturalWidth = image.naturalWidth || 0;
        const naturalHeight = image.naturalHeight || 0;
        if (!naturalWidth || !naturalHeight) {
            return { maxX: 0, maxY: 0 };
        }
        const scaleToContain = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
        const scaledWidth = naturalWidth * scaleToContain * zoomValue;
        const scaledHeight = naturalHeight * scaleToContain * zoomValue;
        const maxX = Math.max(0, (scaledWidth - rect.width) / 2);
        const maxY = Math.max(0, (scaledHeight - rect.height) / 2);
        return { maxX, maxY };
    };

    const clampPan = (nextPan, zoomValue) => {
        if (zoomValue <= 1) {
            return { x: 0, y: 0 };
        }
        if (!constrainPan) {
            return nextPan;
        }
        const { maxX, maxY } = getPanBounds(zoomValue);
        return {
            x: clamp(nextPan.x, -maxX, maxX),
            y: clamp(nextPan.y, -maxY, maxY),
        };
    };

    const computeCursorInfo = (event) => {
        if (!getCursorInfo) return null;
        const container = zoomContainerRef.current;
        const image = zoomImageRef.current;
        if (!container || !image) return null;
        const rect = container.getBoundingClientRect();
        const naturalWidth = image.naturalWidth || 0;
        const naturalHeight = image.naturalHeight || 0;
        if (!naturalWidth || !naturalHeight) return null;
        return getCursorInfo({
            event,
            containerRect: rect,
            naturalWidth,
            naturalHeight,
            pan,
            zoom,
        });
    };

    const handleZoom = (event) => {
        setShowHintState(false);
        lastPointerTypeRef.current = event.pointerType || 'mouse';
        if (!src) return;
        if (!zoomContainerRef.current) return;
        const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
        const nextZoom = clamp(zoom * zoomFactor, minZoom, maxZoom);
        const rect = zoomContainerRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const cursorOffset = {
            x: event.clientX - centerX,
            y: event.clientY - centerY,
        };
        const ratio = nextZoom / zoom;
        const nextPan = {
            x: pan.x + (1 - ratio) * cursorOffset.x,
            y: pan.y + (1 - ratio) * cursorOffset.y,
        };

        setZoom(nextZoom);
        setPan(clampPan(nextPan, nextZoom));

        const nextCursorInfo = computeCursorInfo(event);
        if (event.pointerType !== 'touch') {
            setCursorInfo(nextCursorInfo);
        }
    };

    const handlePointerDown = (event) => {
        if (!src) return;
        if (event.pointerType !== 'touch' && event.button !== 0) return;
        setShowHintState(false);
        lastPointerTypeRef.current = event.pointerType || 'mouse';
        if (event.pointerType !== 'touch' || pointersRef.current.size === 0) {
            setCursorInfo(computeCursorInfo(event));
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (pointersRef.current.size === 2) {
            const [p1, p2] = Array.from(pointersRef.current.values());
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            pinchStartRef.current = {
                distance: Math.hypot(dx, dy),
                zoom,
                pan: { ...pan },
            };
            setIsPanning(false);
            return;
        }

        if (pointersRef.current.size === 1) {
            setIsPanning(true);
            pointerStartRef.current = { x: event.clientX, y: event.clientY };
            panStartRef.current = { ...pan };
        }
    };

    const handlePointerMove = (event) => {
        if (!src) return;
        lastPointerTypeRef.current = event.pointerType || 'mouse';
        if (event.pointerType !== 'touch' || pointersRef.current.size < 2) {
            setCursorInfo(computeCursorInfo(event));
        }
        if (!pointersRef.current.has(event.pointerId)) return;
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (pointersRef.current.size === 2) {
            const [p1, p2] = Array.from(pointersRef.current.values());
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const distance = Math.hypot(dx, dy);
            const start = pinchStartRef.current;
            if (!start.distance) return;

            const ratio = distance / start.distance;
            const nextZoom = clamp(start.zoom * ratio, minZoom, maxZoom);
            const rect = zoomContainerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const centerX = (p1.x + p2.x) / 2 - (rect.left + rect.width / 2);
            const centerY = (p1.y + p2.y) / 2 - (rect.top + rect.height / 2);
            const zoomRatio = nextZoom / start.zoom;
            const nextPan = {
                x: start.pan.x + (1 - zoomRatio) * centerX,
                y: start.pan.y + (1 - zoomRatio) * centerY,
            };

            setZoom(nextZoom);
            setPan(clampPan(nextPan, nextZoom));
            return;
        }

        if (!isPanning) return;
        const dx = event.clientX - pointerStartRef.current.x;
        const dy = event.clientY - pointerStartRef.current.y;
        setPan(clampPan({ x: panStartRef.current.x + dx, y: panStartRef.current.y + dy }, zoom));
    };

    const handlePointerUp = (event) => {
        if (pointersRef.current.has(event.pointerId)) {
            pointersRef.current.delete(event.pointerId);
        }
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (pointersRef.current.size < 2) {
            pinchStartRef.current = { distance: 0, zoom: 1, pan: { x: 0, y: 0 } };
        }
        if (pointersRef.current.size === 1) {
            const [p1] = Array.from(pointersRef.current.values());
            pointerStartRef.current = { x: p1.x, y: p1.y };
            panStartRef.current = { ...pan };
            setIsPanning(true);
            return;
        }
        setIsPanning(false);
    };

    return (
        <Box
            ref={zoomContainerRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={() => {
                if (lastPointerTypeRef.current !== 'touch') {
                    setCursorInfo(null);
                }
            }}
            onDoubleClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
            }}
            sx={{
                textAlign: 'center',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1.5,
                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50'),
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                touchAction: 'none',
                position: 'relative',
                ...containerSx,
            }}
        >
            <img
                src={src}
                alt={alt}
                ref={zoomImageRef}
                draggable={false}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: 'center center',
                    cursor: zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default',
                    ...imageSx,
                }}
            />
            {showZoomBadge && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        px: 1,
                        py: 0.5,
                        borderRadius: 999,
                        bgcolor: 'rgba(0, 0, 0, 0.55)',
                        color: 'common.white',
                        fontSize: '0.7rem',
                        letterSpacing: '0.02em',
                        pointerEvents: 'none',
                    }}
                >
                    <ZoomInIcon sx={{ fontSize: '0.9rem' }} />
                    {t('zoomable_image.zoom', { defaultValue: 'Zoom' })}
                </Box>
            )}
            {showHint && showHintState && (
                <Box
                    sx={{
                        position: 'absolute',
                        bottom: 8,
                        left: 8,
                        px: 1.25,
                        py: 0.6,
                        borderRadius: 1,
                        bgcolor: 'rgba(0, 0, 0, 0.55)',
                        color: 'common.white',
                        fontSize: '0.7rem',
                        letterSpacing: '0.02em',
                        pointerEvents: 'none',
                    }}
                >
                    {hintText}
                </Box>
            )}
            {renderOverlay ? renderOverlay({ zoom, isPanning, cursorInfo }) : null}
        </Box>
    );
}
