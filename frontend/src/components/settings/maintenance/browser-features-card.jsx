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

import React, { useState, useEffect } from 'react';
import { Typography, Divider, Alert, CircularProgress } from '@mui/material';
import Grid from '@mui/material/Grid';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import InfoIcon from '@mui/icons-material/Info';
import { useTranslation } from 'react-i18next';

const BrowserFeaturesCard = () => {
    const { t } = useTranslation('settings');

    // Feature detection states
    const [workersSupported, setWorkersSupported] = useState(null);
    const [offscreenCanvasSupported, setOffscreenCanvasSupported] = useState(null);
    const [offscreenTransferSupported, setOffscreenTransferSupported] = useState(null);
    const [offscreenInWorkerSupported, setOffscreenInWorkerSupported] = useState(null);
    const [canvasTransferToWorkerSupported, setCanvasTransferToWorkerSupported] = useState(null);

    // Test status states
    const [isTestingWorkers, setIsTestingWorkers] = useState(false);
    const [isTestingOffscreen, setIsTestingOffscreen] = useState(false);
    const [isTestingOffscreenInWorker, setIsTestingOffscreenInWorkerSupported] = useState(false);
    const [isTestingCanvasTransfer, setIsTestingCanvasTransfer] = useState(false);

    const getSupportIcon = (supported) => {
        if (supported === null) return <InfoIcon color="info" />;
        return supported ? <CheckCircleIcon color="success" /> : <CancelIcon color="error" />;
    };

    // Test functions (same as in main file)
    const testWebWorkers = () => {
        setIsTestingWorkers(true);
        if (typeof Worker !== 'undefined') {
            try {
                const workerBlob = new Blob([
                    'self.onmessage = function(e) { self.postMessage("Worker received: " + e.data); };'
                ], { type: 'application/javascript' });
                const workerURL = URL.createObjectURL(workerBlob);
                const worker = new Worker(workerURL);
                worker.onmessage = function() {
                    setWorkersSupported(true);
                    URL.revokeObjectURL(workerURL);
                    worker.terminate();
                    setIsTestingWorkers(false);
                };
                worker.onerror = function() {
                    setWorkersSupported(false);
                    URL.revokeObjectURL(workerURL);
                    worker.terminate();
                    setIsTestingWorkers(false);
                };
                worker.postMessage('test');
            } catch (error) {
                setWorkersSupported(false);
                setIsTestingWorkers(false);
            }
        } else {
            setWorkersSupported(false);
            setIsTestingWorkers(false);
        }
    };

    const testOffscreenCanvas = () => {
        setIsTestingOffscreen(true);
        if (typeof OffscreenCanvas !== 'undefined') {
            try {
                const offscreenCanvas = new OffscreenCanvas(100, 100);
                const ctx = offscreenCanvas.getContext('2d');
                ctx.fillRect(0, 0, 100, 100);
                setOffscreenCanvasSupported(true);
            } catch (error) {
                setOffscreenCanvasSupported(false);
            }
        } else {
            setOffscreenCanvasSupported(false);
        }
        setIsTestingOffscreen(false);
    };

    const testOffscreenCanvasInWorker = () => {
        setIsTestingOffscreenInWorkerSupported(true);
        if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
            setOffscreenInWorkerSupported(false);
            setIsTestingOffscreenInWorkerSupported(false);
            return;
        }
        try {
            const workerCode = `
                self.onmessage = function() {
                    try {
                        const canvas = new OffscreenCanvas(200, 200);
                        canvas.getContext('2d').fillRect(0, 0, 200, 200);
                        self.postMessage({ success: true });
                    } catch (error) {
                        self.postMessage({ success: false });
                    }
                };
            `;
            const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
            const workerURL = URL.createObjectURL(workerBlob);
            const worker = new Worker(workerURL);
            worker.onmessage = function(e) {
                setOffscreenInWorkerSupported(e.data.success);
                URL.revokeObjectURL(workerURL);
                worker.terminate();
                setIsTestingOffscreenInWorkerSupported(false);
            };
            worker.onerror = function() {
                setOffscreenInWorkerSupported(false);
                URL.revokeObjectURL(workerURL);
                worker.terminate();
                setIsTestingOffscreenInWorkerSupported(false);
            };
            worker.postMessage('start');
        } catch (error) {
            setOffscreenInWorkerSupported(false);
            setIsTestingOffscreenInWorkerSupported(false);
        }
    };

    const testCanvasTransferToWorker = () => {
        setIsTestingCanvasTransfer(true);
        if (typeof Worker === 'undefined' || typeof document === 'undefined') {
            setCanvasTransferToWorkerSupported(false);
            setIsTestingCanvasTransfer(false);
            return;
        }
        try {
            const canvas = document.createElement('canvas');
            if (typeof canvas.transferControlToOffscreen !== 'function') {
                setCanvasTransferToWorkerSupported(false);
                setIsTestingCanvasTransfer(false);
                return;
            }
            document.body.appendChild(canvas);
            const workerCode = `
                self.onmessage = function(e) {
                    try {
                        const ctx = e.data.canvas.getContext('2d');
                        ctx.fillRect(0, 0, 200, 200);
                        self.postMessage({ success: true });
                    } catch (error) {
                        self.postMessage({ success: false });
                    }
                };
            `;
            const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
            const workerURL = URL.createObjectURL(workerBlob);
            const worker = new Worker(workerURL);
            worker.onmessage = function(e) {
                setCanvasTransferToWorkerSupported(e.data.success);
                URL.revokeObjectURL(workerURL);
                worker.terminate();
                if (document.body.contains(canvas)) document.body.removeChild(canvas);
                setIsTestingCanvasTransfer(false);
            };
            worker.onerror = function() {
                setCanvasTransferToWorkerSupported(false);
                URL.revokeObjectURL(workerURL);
                worker.terminate();
                if (document.body.contains(canvas)) document.body.removeChild(canvas);
                setIsTestingCanvasTransfer(false);
            };
            const offscreenCanvas = canvas.transferControlToOffscreen();
            worker.postMessage({ canvas: offscreenCanvas }, [offscreenCanvas]);
        } catch (error) {
            setCanvasTransferToWorkerSupported(false);
            setIsTestingCanvasTransfer(false);
        }
    };

    // Test transfer support once
    useEffect(() => {
        if (typeof document !== 'undefined') {
            const testCanvas = document.createElement('canvas');
            setOffscreenTransferSupported(typeof testCanvas.transferControlToOffscreen === 'function');
        }
    }, []);

    // Auto-trigger all tests
    useEffect(() => {
        const timer = setTimeout(() => {
            testWebWorkers();
            testOffscreenCanvas();
            testOffscreenCanvasInWorker();
            testCanvasTransferToWorker();
        }, 1000);
        return () => clearTimeout(timer);
    }, []);

    return (
        <>
            <Typography variant="h6" gutterBottom>
                {t('browser_features_card.browser_features_diagnostics', { defaultValue: 'Browser Features & Diagnostics' })}
            </Typography>
            <Divider sx={{ mb: 2 }} />

            <Alert severity="info" sx={{ mb: 2 }}>
                {t('maintenance.browser_features_subtitle')}
            </Alert>

            <Grid container spacing={2} columns={16}>
                <Grid size={12}>
                    <Typography variant="body2" fontWeight="medium">
                        {t('maintenance.web_workers')}
                    </Typography>
                </Grid>
                <Grid size={4} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                    {getSupportIcon(workersSupported)}
                    {isTestingWorkers && <CircularProgress size={16} />}
                </Grid>

                <Grid size={12}>
                    <Typography variant="body2" fontWeight="medium">
                        {t('maintenance.offscreen_canvas')}
                    </Typography>
                </Grid>
                <Grid size={4} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                    {getSupportIcon(offscreenCanvasSupported)}
                    {isTestingOffscreen && <CircularProgress size={16} />}
                </Grid>

                <Grid size={12}>
                    <Typography variant="body2" fontWeight="medium">
                        {t('browser_features_card.canvas_transfer_to_offscreen', { defaultValue: 'Canvas Transfer to Offscreen' })}
                    </Typography>
                </Grid>
                <Grid size={4} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                    {getSupportIcon(offscreenTransferSupported)}
                </Grid>

                <Grid size={12}>
                    <Typography variant="body2" fontWeight="medium">
                        {t('maintenance.offscreen_in_worker')}
                    </Typography>
                </Grid>
                <Grid size={4} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                    {getSupportIcon(offscreenInWorkerSupported)}
                    {isTestingOffscreenInWorker && <CircularProgress size={16} />}
                </Grid>

                <Grid size={12}>
                    <Typography variant="body2" fontWeight="medium">
                        {t('browser_features_card.canvas_transfer_to_worker', { defaultValue: 'Canvas Transfer to Worker' })}
                    </Typography>
                </Grid>
                <Grid size={4} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                    {getSupportIcon(canvasTransferToWorkerSupported)}
                    {isTestingCanvasTransfer && <CircularProgress size={16} />}
                </Grid>

                {(workersSupported !== null || offscreenCanvasSupported !== null ||
                    offscreenTransferSupported !== null || offscreenInWorkerSupported !== null ||
                    canvasTransferToWorkerSupported !== null) && (
                    <Grid size={16}>
                        <Alert severity={
                            (workersSupported && offscreenCanvasSupported && offscreenTransferSupported &&
                                offscreenInWorkerSupported && canvasTransferToWorkerSupported)
                                ? 'success'
                                : 'warning'
                        } sx={{ mt: 1 }}>
                            {(workersSupported && offscreenCanvasSupported && offscreenTransferSupported &&
                                offscreenInWorkerSupported && canvasTransferToWorkerSupported)
                                ? t('maintenance.all_features_message')
                                : t('maintenance.missing_features_message')}
                        </Alert>
                    </Grid>
                )}
            </Grid>
        </>
    );
};

export default BrowserFeaturesCard;
