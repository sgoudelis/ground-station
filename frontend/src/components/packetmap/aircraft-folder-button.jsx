/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {lazy, memo, Suspense, useEffect, useState} from 'react';
import {IconButton, Tooltip} from '@mui/material';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import {useTranslation} from 'react-i18next';
import {toast} from 'react-toastify';
import {callLibrary} from './use-packet-positions.js';

// Fetch the dialog code on first use to keep the map's initial bundle small.
const AircraftFolderDialog = lazy(() => import('../filebrowser/aircraft-folder-dialog.jsx'));

// Live position updates leave this button and any open capture history untouched.
const AircraftFolderButton = memo(function AircraftFolderButton({socket, icao}) {
    const {t} = useTranslation('navigation');
    const [opening, setOpening] = useState(false);
    const [folder, setFolder] = useState(null);
    useEffect(() => {
        if (!opening) return;
        let active = true;
        // Resolve captures only on demand; live aircraft may not have a saved folder.
        void callLibrary(socket, 'filebrowser.item', {id: `decoded_folder:adsb_${icao}`}).then((detail) => {
            if (active) setFolder(detail);
        }).catch((failure) => {
            if (active) toast.error(failure.message);
        }).finally(() => {
            if (active) setOpening(false);
        });
        // A late response must not open the previous aircraft after selection changes.
        return () => {active = false;};
    }, [socket, icao, opening]);

    const label = t('packet_map.info.open_aircraft_folder', 'Open aircraft captures');
    return <>
        <Tooltip title={label}>
            <span><IconButton size="small" aria-label={label} disabled={opening} onClick={() => setOpening(true)}
                sx={{p: '2px', color: 'text.secondary'}}>
                <FolderOpenOutlinedIcon sx={{fontSize: 16}} />
            </IconButton></span>
        </Tooltip>
        {/* Unmounting releases the history subscriptions and the dialog's map. */}
        {folder && <Suspense fallback={null}>
            <AircraftFolderDialog folder={folder} socket={socket} onClose={() => setFolder(null)} />
        </Suspense>}
    </>;
});

export default AircraftFolderButton;
