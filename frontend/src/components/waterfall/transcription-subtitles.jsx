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

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Box, IconButton, Tooltip, Fade, ToggleButtonGroup, ToggleButton, Grid } from '@mui/material';
import {
    clearTranscriptions,
    increaseFontSize,
    decreaseFontSize,
    setTextAlignment
} from './transcription-slice';
import ClearIcon from '@mui/icons-material/Clear';
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft';
import FormatAlignCenterIcon from '@mui/icons-material/FormatAlignCenter';
import FormatAlignRightIcon from '@mui/icons-material/FormatAlignRight';
import TextIncreaseIcon from '@mui/icons-material/TextIncrease';
import TextDecreaseIcon from '@mui/icons-material/TextDecrease';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeMuteIcon from '@mui/icons-material/VolumeMute';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatTime } from '../../utils/date-time.js';

/**
 * Language code to emoji flag mapping
 * Using Unicode regional indicator symbols
 */
const getLanguageFlag = (languageCode) => {
    if (!languageCode || languageCode === 'auto' || languageCode === 'unknown') {
        return '🌐'; // Globe for unknown/auto
    }

    const lowerCode = languageCode.toLowerCase();

    // Handle regional variants (e.g., pt-br, en-us, zh-cn)
    const regionalMapping = {
        'pt-br': 'br', // Brazilian Portuguese
        'pt-pt': 'pt', // European Portuguese
        'en-us': 'us', // American English
        'en-gb': 'gb', // British English
        'en-au': 'au', // Australian English
        'en-ca': 'ca', // Canadian English
        'es-mx': 'mx', // Mexican Spanish
        'es-es': 'es', // European Spanish
        'zh-cn': 'cn', // Simplified Chinese
        'zh-tw': 'tw', // Traditional Chinese
        'fr-ca': 'ca', // Canadian French
        'fr-fr': 'fr', // European French
    };

    // Check regional mapping first
    if (regionalMapping[lowerCode]) {
        const countryCode = regionalMapping[lowerCode];
        const codePoints = [...countryCode.toUpperCase()].map(char =>
            0x1F1E6 + char.charCodeAt(0) - 'A'.charCodeAt(0)
        );
        return String.fromCodePoint(...codePoints);
    }

    // Map language codes to country codes (approximate)
    const languageToCountry = {
        'en': 'gb', // English -> UK flag
        'es': 'es', // Spanish
        'fr': 'fr', // French
        'de': 'de', // German
        'it': 'it', // Italian
        'pt': 'pt', // Portuguese
        'ru': 'ru', // Russian
        'zh': 'cn', // Chinese
        'ja': 'jp', // Japanese
        'ko': 'kr', // Korean
        'ar': 'sa', // Arabic
        'el': 'gr', // Greek
        'nl': 'nl', // Dutch
        'sv': 'se', // Swedish
        'no': 'no', // Norwegian
        'da': 'dk', // Danish
        'fi': 'fi', // Finnish
        'pl': 'pl', // Polish
        'tr': 'tr', // Turkish
        'hi': 'in', // Hindi
        'th': 'th', // Thai
        'vi': 'vn', // Vietnamese
        'id': 'id', // Indonesian
        'ms': 'my', // Malay
        'uk': 'ua', // Ukrainian
        'cs': 'cz', // Czech
        'ro': 'ro', // Romanian
        'hu': 'hu', // Hungarian
        'he': 'il', // Hebrew
    };

    const countryCode = languageToCountry[lowerCode] || lowerCode.split('-')[0]; // Fallback to first part before hyphen

    // Convert country code to flag emoji
    // Regional indicator symbols: 🇦 = U+1F1E6, 🇿 = U+1F1FF
    try {
        const codePoints = [...countryCode.toUpperCase()].map(char =>
            0x1F1E6 + char.charCodeAt(0) - 'A'.charCodeAt(0)
        );
        return String.fromCodePoint(...codePoints);
    } catch (e) {
        return '🌐'; // Fallback to globe if conversion fails
    }
};

/**
 * Single VFO Subtitle Component
 */
const VFOSubtitle = ({
    vfoNumber,
    transcription,
    vfoColor,
    fontSizeMultiplier,
    textAlignment,
    maxLines,
    historyLimit,
    maxWordsPerLine,
    onClear,
    onIncreaseFontSize,
    onDecreaseFontSize,
    onSetAlignment,
    isStreaming,
    isMuted,
    translateTo,
    sourceLang,
    provider,
    timezone,
    locale
}) => {
    const [lines, setLines] = useState([]);

    // Individual position state per VFO
    const [position, setPosition] = useState(() => {
        try {
            const saved = localStorage.getItem(`transcription_overlay_position_vfo${vfoNumber}`);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Validate bounds - reset if out of reasonable range
                if (parsed.y < 0 || parsed.y > window.innerHeight - 100) {
                    return { x: 0, y: 40 + (vfoNumber - 1) * 150 }; // Offset each VFO vertically
                }
                return parsed;
            }
            return { x: 0, y: 40 + (vfoNumber - 1) * 150 }; // Default with vertical offset
        } catch {
            return { x: 0, y: 40 + (vfoNumber - 1) * 150 };
        }
    });
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const containerRef = useRef(null);

    // Track maximum width reached - never shrink once expanded
    const maxWidthRef = useRef(0);
    const contentRef = useRef(null);
    const scrollContainerRef = useRef(null);

    useEffect(() => {
        if (!transcription || !transcription.segments || transcription.segments.length === 0) {
            setLines([]);
            return;
        }

        // Build lines from segments
        const wordsWithTimestamps = [];
        transcription.segments.forEach(segment => {
            const words = segment.text.split(/\s+/).filter(w => w.length > 0);
            words.forEach(word => {
                wordsWithTimestamps.push({
                    word,
                    timestamp: new Date(segment.timestamp).getTime()
                });
            });
        });

        // Build lines by filling them up to maxWordsPerLine
        // Also start a new line if 1+ minute has passed since last word
        const newLines = [];
        let currentLineWords = [];
        let currentLineSegments = [];
        let lastTimestamp = null;

        for (let i = 0; i < wordsWithTimestamps.length; i++) {
            const { word, timestamp } = wordsWithTimestamps[i];

            // Check if we need to start a new line
            const shouldStartNewLine =
                currentLineWords.length >= maxWordsPerLine ||
                (lastTimestamp !== null && (timestamp - lastTimestamp) >= 60000); // 60000ms = 1 minute

            if (shouldStartNewLine && currentLineWords.length > 0) {
                newLines.push({
                    text: currentLineWords.join(' '),
                    segments: currentLineSegments,
                    id: `vfo${vfoNumber}-line-${i}-${Date.now()}`
                });
                currentLineWords = [word];
                currentLineSegments = [{ word, timestamp }];
            } else {
                currentLineWords.push(word);
                currentLineSegments.push({ word, timestamp });
            }

            lastTimestamp = timestamp;
        }

        if (currentLineWords.length > 0) {
            newLines.push({
                text: currentLineWords.join(' '),
                segments: currentLineSegments,
                id: `vfo${vfoNumber}-line-${wordsWithTimestamps.length}-${Date.now()}`
            });
        }

        // Keep a larger subtitle history; viewport controls how many lines are visible at once.
        const displayLines = newLines.slice(-historyLimit);
        setLines(displayLines);
    }, [transcription, historyLimit, maxWordsPerLine, vfoNumber]);

    // Track maximum width reached - never shrink
    useEffect(() => {
        if (contentRef.current) {
            const currentWidth = contentRef.current.offsetWidth;
            if (currentWidth > maxWidthRef.current) {
                maxWidthRef.current = currentWidth;
            }
        }
    }, [lines]);

    // Force re-render every second to update color transitions
    useEffect(() => {
        const interval = setInterval(() => {
            if (lines.length > 0) {
                setLines(prevLines => [...prevLines]);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [lines.length]);

    const latestLineId = lines.length > 0 ? lines[lines.length - 1].id : null;

    // Keep the newest subtitle lines in view while preserving manual scroll position when reading history.
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distanceFromBottom <= 48) {
            container.scrollTop = container.scrollHeight;
        }
    }, [latestLineId]);

    // Constrain position to viewport boundaries
    const constrainPosition = (newX, newY) => {
        const container = containerRef.current;
        if (!container) return { x: newX, y: newY };

        const rect = container.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Calculate boundaries considering centered positioning and actual overlay width.
        // On mobile we keep a tighter margin so overlays can reach near the screen edges.
        const horizontalMargin = viewportWidth <= 600 ? 6 : 20;
        const halfWidth = rect.width / 2;
        // If the overlay is wider than the available viewport space, lock horizontal dragging.
        const maxHorizontalOffset = Math.max(0, (viewportWidth / 2) - halfWidth - horizontalMargin);
        const maxX = maxHorizontalOffset;
        const minX = -maxHorizontalOffset;

        // For Y: bottom positioning, so higher Y = further up
        const maxY = viewportHeight - rect.height - 20;
        const minY = 20;

        const constrainedX = Math.max(minX, Math.min(maxX, newX));
        const constrainedY = Math.max(minY, Math.min(maxY, newY));

        return { x: constrainedX, y: constrainedY };
    };

    // Drag handlers for mouse
    const handleMouseDown = (e) => {
        if (e.target.closest('.subtitle-header')) {
            setIsDragging(true);
            dragStart.current = { x: e.clientX - position.x, y: e.clientY + position.y };
            e.preventDefault();
        }
    };

    const handleMouseMove = (e) => {
        if (isDragging) {
            const newX = e.clientX - dragStart.current.x;
            const newY = dragStart.current.y - e.clientY;
            const constrained = constrainPosition(newX, newY);
            setPosition(constrained);
        }
    };

    const handleMouseUp = () => {
        if (isDragging) {
            setIsDragging(false);
            localStorage.setItem(`transcription_overlay_position_vfo${vfoNumber}`, JSON.stringify(position));
        }
    };

    // Drag handlers for touch
    const handleTouchStart = (e) => {
        if (e.target.closest('.subtitle-header')) {
            const touch = e.touches[0];
            setIsDragging(true);
            dragStart.current = { x: touch.clientX - position.x, y: touch.clientY + position.y };
            e.preventDefault();
        }
    };

    const handleTouchMove = (e) => {
        if (isDragging && e.touches.length > 0) {
            const touch = e.touches[0];
            const newX = touch.clientX - dragStart.current.x;
            const newY = dragStart.current.y - touch.clientY;
            const constrained = constrainPosition(newX, newY);
            setPosition(constrained);
            e.preventDefault();
        }
    };

    const handleTouchEnd = () => {
        if (isDragging) {
            setIsDragging(false);
            localStorage.setItem(`transcription_overlay_position_vfo${vfoNumber}`, JSON.stringify(position));
        }
    };

    // Add event listeners
    useEffect(() => {
        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.addEventListener('touchmove', handleTouchMove, { passive: false });
            document.addEventListener('touchend', handleTouchEnd);

            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                document.removeEventListener('touchmove', handleTouchMove);
                document.removeEventListener('touchend', handleTouchEnd);
            };
        }
    }, [isDragging, position]);

    // Ensure position is within bounds on mount and window resize
    useEffect(() => {
        const checkBounds = () => {
            const constrained = constrainPosition(position.x, position.y);
            if (constrained.x !== position.x || constrained.y !== position.y) {
                setPosition(constrained);
                localStorage.setItem(`transcription_overlay_position_vfo${vfoNumber}`, JSON.stringify(constrained));
            }
        };

        checkBounds();
        window.addEventListener('resize', checkBounds);
        return () => window.removeEventListener('resize', checkBounds);
    }, []);

    if (lines.length === 0) {
        return null;
    }

    return (
        <Fade in={true} timeout={300}>
            <Box
                ref={containerRef}
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                sx={{
                    position: 'fixed',
                    bottom: `${position.y}px`,
                    left: '50%',
                    transform: `translate(calc(-50% + ${position.x}px), 0)`,
                    width: { xs: 'calc(100vw - 12px)', sm: 'auto' },
                    maxWidth: { xs: 'calc(100vw - 12px)', sm: 'none' },
                    zIndex: 1000,
                    pointerEvents: 'auto',
                    cursor: isDragging ? 'grabbing' : 'default',
                    userSelect: 'none',
                }}
            >
                {/* Subtitle box - split into header and body */}
                <Box
                    sx={{
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
                        borderRadius: '8px',
                        width: { xs: '100%', sm: 'fit-content' },
                        maxWidth: '100%',
                        minWidth: { xs: 'auto', sm: 'max-content' },
                        overflow: 'hidden',
                    }}
                >
                    {/* Header with VFO color background */}
                    <Box
                        className="subtitle-header"
                        sx={{
                            backgroundColor: `${vfoColor}80`,
                            padding: { xs: '4px 6px', sm: '6px 10px' },
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 2,
                            cursor: 'grab',
                            '&:active': {
                                cursor: 'grabbing',
                            },
                        }}
                    >
                        {/* VFO Label with Speaker Icon and Language Info - Left */}
                        <Box
                            sx={{
                                fontSize: { xs: '0.65rem', sm: '0.7rem', md: '0.75rem' },
                                fontWeight: 700,
                                color: 'rgba(255, 255, 255, 0.95)',
                                letterSpacing: '0.5px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                            }}
                        >
                            <span>VFO{vfoNumber}</span>

                            {/* Speaker Icon - three states like VFO marker */}
                            {!isStreaming ? (
                                <VolumeMuteIcon sx={{ fontSize: '0.9rem', color: '#888888' }} />
                            ) : isMuted ? (
                                <VolumeMuteIcon sx={{ fontSize: '0.9rem', color: '#00ff00' }} />
                            ) : (
                                <VolumeUpIcon sx={{ fontSize: '0.9rem', color: '#00ff00' }} />
                            )}

                            {/* Language Display Logic:
                                - When NOT translating: show detected language from transcription
                                - When translating: show source → target with arrow
                            */}
                            {translateTo && translateTo !== 'none' ? (
                                // Translation mode: show source → target
                                <>
                                    {/* Source Language */}
                                    <span style={{ fontSize: '1rem', lineHeight: 1 }}>
                                        {getLanguageFlag(sourceLang)}
                                    </span>
                                    <span style={{
                                        fontSize: '0.6rem',
                                        opacity: 0.7,
                                        fontWeight: 400,
                                        textTransform: 'uppercase'
                                    }}>
                                        {sourceLang === 'auto' ? 'AUTO' : sourceLang}
                                    </span>

                                    {/* Arrow */}
                                    <ArrowForwardIcon sx={{ fontSize: '0.8rem', opacity: 0.7 }} />

                                    {/* Target Language */}
                                    <span style={{ fontSize: '1rem', lineHeight: 1 }}>
                                        {getLanguageFlag(translateTo)}
                                    </span>
                                    <span style={{
                                        fontSize: '0.6rem',
                                        opacity: 0.7,
                                        fontWeight: 400,
                                        textTransform: 'uppercase'
                                    }}>
                                        {translateTo}
                                    </span>
                                </>
                            ) : (
                                // No translation: show detected language
                                transcription.language && transcription.language !== 'auto' && transcription.language !== 'unknown' && (
                                    <>
                                        <span style={{ fontSize: '1rem', lineHeight: 1 }}>
                                            {getLanguageFlag(transcription.language)}
                                        </span>
                                        <span style={{
                                            fontSize: '0.6rem',
                                            opacity: 0.7,
                                            fontWeight: 400,
                                            textTransform: 'uppercase'
                                        }}>
                                            {transcription.language}
                                        </span>
                                    </>
                                )
                            )}
                        </Box>

                        {/* Controls - Right */}
                        <Box
                            sx={{
                                display: 'flex',
                                gap: 0.25,
                                alignItems: 'center',
                            }}
                        >
                            {/* Text alignment toggle */}
                            <ToggleButtonGroup
                                value={textAlignment}
                                exclusive
                                onChange={onSetAlignment}
                                size="small"
                                sx={{
                                    height: '24px',
                                    '& .MuiToggleButton-root': {
                                        color: 'rgba(255, 255, 255, 0.6)',
                                        border: 'none',
                                        padding: '2px 4px',
                                        minWidth: 'unset',
                                        '&:hover': {
                                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                        },
                                        '&.Mui-selected': {
                                            color: 'white',
                                            backgroundColor: 'rgba(255, 255, 255, 0.2)',
                                            '&:hover': {
                                                backgroundColor: 'rgba(255, 255, 255, 0.25)',
                                            },
                                        },
                                    },
                                }}
                            >
                                <ToggleButton value="left">
                                    <FormatAlignLeftIcon sx={{ fontSize: '0.9rem' }} />
                                </ToggleButton>
                                <ToggleButton value="center">
                                    <FormatAlignCenterIcon sx={{ fontSize: '0.9rem' }} />
                                </ToggleButton>
                                <ToggleButton value="right">
                                    <FormatAlignRightIcon sx={{ fontSize: '0.9rem' }} />
                                </ToggleButton>
                            </ToggleButtonGroup>

                            {/* Font size controls */}
                            <Tooltip title="Decrease font size">
                                <IconButton
                                    size="small"
                                    onClick={onDecreaseFontSize}
                                    sx={{
                                        color: 'rgba(255, 255, 255, 0.6)',
                                        padding: '2px',
                                        '&:hover': { color: 'white', backgroundColor: 'rgba(255, 255, 255, 0.1)' }
                                    }}
                                >
                                    <TextDecreaseIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Increase font size">
                                <IconButton
                                    size="small"
                                    onClick={onIncreaseFontSize}
                                    sx={{
                                        color: 'rgba(255, 255, 255, 0.6)',
                                        padding: '2px',
                                        '&:hover': { color: 'white', backgroundColor: 'rgba(255, 255, 255, 0.1)' }
                                    }}
                                >
                                    <TextIncreaseIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>

                            {/* Clear button - rightmost */}
                            <Tooltip title="Clear subtitles">
                                <IconButton
                                    size="small"
                                    onClick={() => onClear(vfoNumber)}
                                    sx={{
                                        color: 'rgba(255, 255, 255, 0.6)',
                                        padding: '2px',
                                        '&:hover': { color: 'white', backgroundColor: 'rgba(255, 255, 255, 0.1)' }
                                    }}
                                >
                                    <ClearIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    </Box>

                    {/* Body with subtitle text - dark background */}
                    <Box
                        ref={contentRef}
                        sx={{
                            backgroundColor: 'rgba(0, 0, 0, 0.85)',
                            padding: { xs: '8px 12px', sm: '10px 16px' },
                            textAlign: textAlignment,
                            border: `1px solid ${vfoColor}60`,
                            borderTop: 'none',
                            borderBottomLeftRadius: '8px',
                            borderBottomRightRadius: '8px',
                            minWidth: maxWidthRef.current > 0 ? `${maxWidthRef.current}px` : 'auto',
                        }}
                    >
                        <Box
                            ref={scrollContainerRef}
                            sx={{
                                maxHeight: `calc(${maxLines} * 1.5em)`,
                                overflowY: 'auto',
                                overflowX: 'hidden',
                                pr: 0.5,
                                scrollbarWidth: 'thin',
                                scrollbarColor: 'rgba(255, 255, 255, 0.2) transparent',
                                '&::-webkit-scrollbar': {
                                    width: '6px',
                                },
                                '&::-webkit-scrollbar-track': {
                                    background: 'transparent',
                                },
                                '&::-webkit-scrollbar-thumb': {
                                    backgroundColor: 'rgba(255, 255, 255, 0.2)',
                                    borderRadius: '4px',
                                },
                                '&:hover::-webkit-scrollbar-thumb': {
                                    backgroundColor: 'rgba(255, 255, 255, 0.35)',
                                },
                            }}
                        >
                            {lines.map((line, lineIdx) => (
                                <Box
                                    key={line.id}
                                    sx={{
                                        fontSize: {
                                            xs: `${0.75 * fontSizeMultiplier}rem`,
                                            sm: `${0.85 * fontSizeMultiplier}rem`,
                                            md: `${0.9 * fontSizeMultiplier}rem`
                                        },
                                        fontWeight: 600,
                                        lineHeight: 1.6,
                                        textShadow: '2px 2px 4px rgba(0, 0, 0, 0.8)',
                                        letterSpacing: '0.3px',
                                        fontFamily: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                                        whiteSpace: { xs: 'normal', sm: 'nowrap' },
                                        wordWrap: { xs: 'break-word', sm: 'normal' },
                                        overflowWrap: { xs: 'break-word', sm: 'normal' },
                                        mb: lineIdx < lines.length - 1 ? 0.5 : 0,
                                    }}
                                >
                                    {/* Timestamp at the beginning of the line */}
                                    {line.segments.length > 0 && (() => {
                                        const firstTimestamp = line.segments[0].timestamp;
                                        const timeString = formatTime(firstTimestamp, {
                                            timezone,
                                            locale,
                                            options: { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
                                        });

                                        return (
                                            <Box
                                                component="span"
                                                sx={{
                                                    color: 'rgba(200, 200, 200, 0.8)',
                                                    marginRight: '0.5em',
                                                    fontWeight: 500,
                                                }}
                                            >
                                                [{timeString}]
                                            </Box>
                                        );
                                    })()}

                                    {line.segments.map((segment, segIdx) => {
                                        const ageMs = Date.now() - segment.timestamp;
                                        const isRecent = ageMs < 10000;
                                        const color = isRecent ? 'white' : 'rgba(169, 169, 169, 1)';

                                        return (
                                            <Box
                                                key={`${line.id}-seg-${segIdx}`}
                                                component="span"
                                                sx={{
                                                    color: color,
                                                    transition: 'color 0.5s ease-out',
                                                }}
                                            >
                                                {segment.word}
                                                {segIdx < line.segments.length - 1 ? ' ' : ''}
                                            </Box>
                                        );
                                    })}
                                </Box>
                            ))}
                        </Box>
                    </Box>
                </Box>
            </Box>
        </Fade>
    );
};

/**
 * TranscriptionSubtitles Component
 *
 * Displays separate subtitle overlays for each active VFO with responsive grid layout
 */
const TranscriptionSubtitles = ({ maxLines = 4, maxWordsPerLine = 20, historyLimit = 100 }) => {
    const dispatch = useDispatch();
    const { timezone, locale } = useUserTimeSettings();

    // Get live transcription state
    const liveTranscription = useSelector((state) => state.transcription.liveTranscription);

    // Get subtitle settings
    const vfoFontSizes = useSelector((state) => state.transcription.vfoFontSizes);
    const vfoTextAlignments = useSelector((state) => state.transcription.vfoTextAlignments);

    // Get VFO data from Redux
    const vfoColors = useSelector((state) => state.vfo.vfoColors);
    const vfoMarkers = useSelector((state) => state.vfo.vfoMarkers);
    const streamingVFOs = useSelector((state) => state.vfo.streamingVFOs);
    const vfoMuted = useSelector((state) => state.vfo.vfoMuted);

    // Get active VFOs (those with transcriptions)
    const activeVFOs = useMemo(() => {
        return Object.entries(liveTranscription)
            .filter(([_, transcription]) =>
                transcription &&
                transcription.segments &&
                transcription.segments.length > 0
            )
            .map(([_, transcription]) => ({
                vfoNumber: transcription.vfoNumber,
                transcription
            }))
            .sort((a, b) => a.vfoNumber - b.vfoNumber);
    }, [liveTranscription]);

    // Handlers - per VFO
    const handleClear = (vfoNumber) => {
        dispatch(clearTranscriptions({ vfoNumber }));
    };

    const handleIncreaseFontSize = (vfoNumber) => {
        dispatch(increaseFontSize({ vfoNumber }));
    };

    const handleDecreaseFontSize = (vfoNumber) => {
        dispatch(decreaseFontSize({ vfoNumber }));
    };

    const handleSetAlignment = (vfoNumber, event, alignment) => {
        if (alignment !== null) {
            dispatch(setTextAlignment({ vfoNumber, alignment }));
        }
    };

    if (activeVFOs.length === 0) {
        return null;
    }

    return (
        <>
            {activeVFOs.map(({ vfoNumber, transcription }) => {
                const vfoMarker = vfoMarkers[vfoNumber]; // vfoMarkers is an object with keys 1, 2, 3, 4
                const translateTo = vfoMarker?.transcriptionTranslateTo || 'none';
                const sourceLang = vfoMarker?.transcriptionLanguage || 'auto';
                const provider = vfoMarker?.transcriptionProvider || 'gemini';

                return (
                            <React.Fragment key={vfoNumber}>
                                <VFOSubtitle
                                    vfoNumber={vfoNumber}
                                    transcription={transcription}
                                    vfoColor={vfoColors[vfoNumber - 1]}
                                    fontSizeMultiplier={vfoFontSizes[vfoNumber]}
                                    textAlignment={vfoTextAlignments[vfoNumber]}
                                    maxLines={maxLines}
                                    historyLimit={historyLimit}
                                    maxWordsPerLine={maxWordsPerLine}
                                    onClear={() => handleClear(vfoNumber)}
                                    onIncreaseFontSize={() => handleIncreaseFontSize(vfoNumber)}
                                    onDecreaseFontSize={() => handleDecreaseFontSize(vfoNumber)}
                                    onSetAlignment={(e, alignment) => handleSetAlignment(vfoNumber, e, alignment)}
                                    isStreaming={streamingVFOs.includes(vfoNumber)}
                                    isMuted={vfoMuted[vfoNumber]}
                                    translateTo={translateTo}
                                    sourceLang={sourceLang}
                                    provider={provider}
                                    timezone={timezone}
                                    locale={locale}
                                />
                            </React.Fragment>
                        );
                    })}
        </>
    );
};

export default TranscriptionSubtitles;
