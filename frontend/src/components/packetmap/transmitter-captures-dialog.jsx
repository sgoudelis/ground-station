/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {lazy, Suspense, useEffect, useState} from 'react';
import {Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle} from '@mui/material';
import {useTranslation} from 'react-i18next';
import {callLibrary} from './use-packet-positions.js';
import {captureFile, captureItemId} from './transmitter-actions.js';

// Capture viewers are large and only needed after an explicit menu action.
const AircraftFolderDialog = lazy(() => import('../filebrowser/aircraft-folder-dialog.jsx'));
const AprsFolderDialog = lazy(() => import('../filebrowser/aprs-folder-dialog.jsx'));
const MeshtasticFolderDialog = lazy(() => import('../filebrowser/meshtastic-folder-dialog.jsx'));
const RadiosondeFolderDialog = lazy(() => import('../filebrowser/radiosonde-folder-dialog.jsx'));
const TelemetryViewerDialog = lazy(() => import('../filebrowser/telemetry-viewer-dialog.jsx'));
const folderDialogs = {adsb: AircraftFolderDialog, aprs: AprsFolderDialog,
    meshtastic: MeshtasticFolderDialog, radiosonde: RadiosondeFolderDialog};

export default function TransmitterCapturesDialog({transmitter, socket, onClose}) {
    const {t} = useTranslation('navigation');
    const label = (key, fallback) => t(`packet_map.context.${key}`, {defaultValue: fallback});
    const [folder, setFolder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [packetFile, setPacketFile] = useState(null);
    const [packet, setPacket] = useState(null);
    useEffect(() => {
        let active = true;
        const load = async () => {
            try {
                const id = captureItemId(transmitter);
                const detail = id ? await callLibrary(socket, 'filebrowser.item', {id}) : captureFile(transmitter);
                if (!active) return;
                if (detail?.type === 'decoded_folder' && folderDialogs[detail.folder_kind]) setFolder(detail);
                else if (detail?.type === 'decoded' && detail.url) setPacketFile({...detail,
                    filename: detail.filename || detail.name});
                else throw new Error(label('no_captures', 'No saved captures are available for this transmitter.'));
            } catch (failure) {
                if (active) setError(failure.message === 'Library item not found'
                    ? label('no_captures', 'No saved captures are available for this transmitter.') : failure.message);
            } finally {
                if (active) setLoading(false);
            }
        };
        void load();
        // Closing or switching transmitters must invalidate late replies.
        return () => {active = false;};
    }, [socket, transmitter]);
    useEffect(() => {
        if (!packetFile) return;
        const controller = new AbortController();
        setLoading(true);
        setError('');
        setPacket(null);
        const load = async () => {
            try {
                const response = await fetch(packetFile.url.replace(/\.bin$/, '.json'), {signal: controller.signal});
                if (!response.ok) throw new Error(label('packet_failed', 'Unable to load packet metadata.'));
                const metadata = await response.json();
                if (!controller.signal.aborted) setPacket({file: packetFile, metadata});
            } catch (failure) {
                if (!controller.signal.aborted) setError(failure.message);
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        };
        void load();
        return () => controller.abort();
    }, [packetFile]);
    const closePacket = () => {
        setPacketFile(null);
        setPacket(null);
        setError('');
        if (!folder) onClose();
    };
    const FolderDialog = folderDialogs[folder?.folder_kind];
    const pending = <Dialog open onClose={folder ? closePacket : onClose} fullWidth maxWidth="xs">
        <DialogTitle>{label('captures', 'Open captures')}</DialogTitle>
        <DialogContent>{error ? <Alert severity="info">{error}</Alert> : <CircularProgress size={24}
            aria-label={label('loading_captures', 'Loading captures…')} />}</DialogContent>
        <DialogActions><Button onClick={folder ? closePacket : onClose}>{label('close', 'Close')}</Button></DialogActions>
    </Dialog>;
    return <Suspense fallback={pending}>
        {FolderDialog && <FolderDialog folder={folder} socket={socket} onClose={onClose} onOpenPacket={setPacketFile} />}
        {(loading || error) && pending}
        {packet && <TelemetryViewerDialog open file={packet.file} metadata={packet.metadata} socket={socket}
            onClose={closePacket} onMetadataChange={(metadata) => setPacket({...packet, metadata})} />}
    </Suspense>;
}
