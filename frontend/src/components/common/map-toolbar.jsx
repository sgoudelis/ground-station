/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Box, Divider, IconButton, Paper, Stack, Tooltip} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import {useTranslation} from 'react-i18next';

function ToolbarButton({label, icon, onClick, disabled = false, pressed, tooltipContainer}) {
    return (
        <Tooltip title={label} slotProps={{popper: {container: tooltipContainer}}}>
            <span>
                <IconButton size="small" color={pressed ? 'warning' : 'primary'} onClick={onClick}
                            disabled={disabled} aria-label={label}
                            {...(pressed !== undefined ? {'aria-pressed': pressed} : {})}
                            sx={{borderRadius: 0}}>
                    {icon}
                </IconButton>
            </span>
        </Tooltip>
    );
}

// Keep map controls accessible in narrow grid windows and in fullscreen.
export default function ScrollableMapToolbar({buttons, label, tooltipContainer}) {
    const {t} = useTranslation('earthview');
    const scrollViewportRef = useRef(null);
    const [scrollState, setScrollState] = useState({hasOverflow: false, atStart: true, atEnd: true});

    const updateScrollState = useCallback(() => {
        const viewport = scrollViewportRef.current;
        if (!viewport) return;
        const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
        const nextState = {hasOverflow: maxScrollLeft > 2, atStart: viewport.scrollLeft <= 2,
            atEnd: viewport.scrollLeft >= maxScrollLeft - 2};
        setScrollState((current) => current.hasOverflow === nextState.hasOverflow
            && current.atStart === nextState.atStart && current.atEnd === nextState.atEnd
            ? current : nextState);
    }, []);

    useEffect(() => {
        const viewport = scrollViewportRef.current;
        if (!viewport) return undefined;
        const frame = requestAnimationFrame(updateScrollState);
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScrollState);
        observer?.observe(viewport);
        window.addEventListener('resize', updateScrollState);
        viewport.addEventListener('scroll', updateScrollState, {passive: true});
        return () => {
            cancelAnimationFrame(frame);
            observer?.disconnect();
            window.removeEventListener('resize', updateScrollState);
            viewport.removeEventListener('scroll', updateScrollState);
        };
    }, [updateScrollState]);

    const scrollToolbar = (direction) => {
        const viewport = scrollViewportRef.current;
        viewport?.scrollBy({left: direction * Math.max(160, viewport.clientWidth * 0.75), behavior: 'smooth'});
    };

    return (
        <Paper elevation={1} sx={{width: '100%', flexShrink: 0, borderBottom: '1px solid', borderColor: 'divider', borderRadius: 0}}>
            <Box sx={{display: 'flex', alignItems: 'center', overflow: 'hidden'}}>
                {scrollState.hasOverflow && <ToolbarButton label={t('map_controls.scroll_left', {defaultValue: 'Scroll map controls left'})} icon={<ChevronLeftIcon />} onClick={() => scrollToolbar(-1)} disabled={scrollState.atStart} tooltipContainer={tooltipContainer} />}
                <Box ref={scrollViewportRef} sx={{minWidth: 0, flex: 1, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', '&::-webkit-scrollbar': {display: 'none'}}}>
                    <Stack direction="row" spacing={0} role="toolbar" aria-label={label} sx={{minWidth: 'min-content', flexWrap: 'nowrap'}}>
                        {buttons.map(({key, content, ...button}) => content
                            ? <Box key={key} sx={{display: 'flex', alignItems: 'center', px: 0.5}}>{content}</Box>
                            : button.label
                            ? <ToolbarButton key={key} {...button} tooltipContainer={tooltipContainer} />
                            : <Divider key={key} orientation="vertical" flexItem sx={{mx: 0.5}} />)}
                    </Stack>
                </Box>
                {scrollState.hasOverflow && <ToolbarButton label={t('map_controls.scroll_right', {defaultValue: 'Scroll map controls right'})} icon={<ChevronRightIcon />} onClick={() => scrollToolbar(1)} disabled={scrollState.atEnd} tooltipContainer={tooltipContainer} />}
            </Box>
        </Paper>
    );
}
