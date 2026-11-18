/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
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
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Alert,Dialog,DialogActions,DialogContent,DialogTitle,Typography,} from '@mui/material';
import {useTranslation} from 'react-i18next';
import CapsButton from './capsbutton.jsx';

const DEFAULT_MAP_LOAD_TIMEOUT_MS = 20000;

export function sanitizeMapErrorMessage(value) {
    const message = String(value || '').trim();
    if (!message) {
        return '';
    }

    // Tile-provider errors can include credentials in their requested URL.
    return message.replace(
        /(\b(?:api[_-]?key|access[_-]?token|token|key)=)[^&\s]+/gi,
        '$1[redacted]'
    );
}

export function getMapErrorMessage(error, fallbackMessage) {
    const candidate = error?.error?.message
        || error?.message
        || (typeof error === 'string' ? error : '');
    return sanitizeMapErrorMessage(candidate) || fallbackMessage;
}

export function useMapLoadFailure({
    engine,
    loadKey,
    timeoutMs = DEFAULT_MAP_LOAD_TIMEOUT_MS,
    enabled = true,
}) {
    const [failure, setFailure] = useState(null);
    const [attempt, setAttempt] = useState(0);
    const timeoutRef = useRef(null);

    const clearLoadTimeout = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    }, []);

    const reportLoaded = useCallback(() => {
        clearLoadTimeout();
    }, [clearLoadTimeout]);

    const reportError = useCallback((error) => {
        const cause = error?.error || error;
        // Map engines abort in-flight tile requests during normal remounts and navigation.
        if (cause?.name === 'AbortError') {
            return;
        }
        clearLoadTimeout();
        setFailure({
            engine,
            message: getMapErrorMessage(error, `${engine} could not load the selected basemap.`),
        });
    }, [clearLoadTimeout, engine]);

    useEffect(() => {
        setFailure(null);
        clearLoadTimeout();
        if (!enabled) {
            return clearLoadTimeout;
        }
        timeoutRef.current = setTimeout(() => {
            const timeoutSeconds = Math.round(timeoutMs / 1000);
            setFailure({
                engine,
                message: `${engine} did not finish loading the selected basemap within ${timeoutSeconds} ${timeoutSeconds === 1 ? 'second' : 'seconds'}.`,
            });
        }, timeoutMs);

        return clearLoadTimeout;
    }, [attempt, clearLoadTimeout, enabled, engine, loadKey, timeoutMs]);

    const retry = useCallback(() => {
        setFailure(null);
        setAttempt((currentAttempt) => currentAttempt + 1);
    }, []);

    const dismiss = useCallback(() => {
        setFailure(null);
    }, []);

    return {
        attempt,
        dismiss,
        failure,
        reportError,
        reportLoaded,
        retry,
    };
}

export class MapRendererErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = {failed: false};
    }

    static getDerivedStateFromError() {
        return {failed: true};
    }

    componentDidCatch(error) {
        this.props.onError?.(error);
    }

    componentDidUpdate(previousProps) {
        // Clear a renderer failure when its configuration changes without
        // remounting a healthy map just to reset the error boundary.
        if (previousProps.resetKey !== this.props.resetKey && this.state.failed) {
            this.setState({failed: false});
        }
    }

    render() {
        return this.state.failed ? null : this.props.children;
    }
}

export function MapLoadErrorDialog({failure, onClose, onRetry, onSwitchEngine, switchEngineLabel}) {
    const {t} = useTranslation('common');

    return (
        <Dialog open={Boolean(failure)} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>
                {t('map_load_error.title', {defaultValue: 'Map failed to load'})}
            </DialogTitle>
            <DialogContent>
                <Alert severity="error" variant="outlined" sx={{mb: 2}}>
                    {t('map_load_error.summary', {
                        defaultValue: '{{engine}} could not display the map.',
                        engine: failure?.engine || t('unknown'),
                    })}
                </Alert>
                <Typography variant="body2" sx={{wordBreak: 'break-word'}}>
                    {failure?.message}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{display: 'block', mt: 2}}>
                    {t('map_load_error.help', {
                        defaultValue: 'Check the browser console and network connection for more details.',
                    })}
                </Typography>
            </DialogContent>
            <DialogActions>
                <CapsButton onClick={onClose}>{t('close')}</CapsButton>
                {onSwitchEngine ? (
                    <CapsButton onClick={onSwitchEngine}>{switchEngineLabel}</CapsButton>
                ) : null}
                <CapsButton variant="contained" onClick={onRetry}>
                    {t('map_load_error.retry', {defaultValue: 'Retry'})}
                </CapsButton>
            </DialogActions>
        </Dialog>
    );
}
