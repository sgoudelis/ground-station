/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {isValidMapPosition} from '../filebrowser/position-utils.js';
import {buildPlaybackTrack} from './playback.js';

export function transmitterTrack(positions, id) {
    return buildPlaybackTrack(positions.filter((point) => point.transmitter_id === id
        && isValidMapPosition(point.latitude, point.longitude)));
}

export function captureItemId(transmitter) {
    if (transmitter?.kind === 'adsb' && /^[0-9a-f]{6}$/i.test(transmitter.source ?? '')) {
        return `decoded_folder:adsb_${transmitter.source.toLowerCase()}`;
    }
    const file = transmitter?.file_id;
    if (!file?.startsWith('decoded:')) return null;
    const path = file.slice('decoded:'.length);
    // Grouped packet IDs retain their real storage folder, including the
    // reporting station for APRS objects. Do not guess it from the display name.
    return path.includes('/') ? `decoded_folder:${path.split('/')[0]}` : file;
}

export function captureFile(transmitter) {
    const file = transmitter?.file_id;
    const mount = file?.startsWith('observation:') ? 'observations' : file?.startsWith('decoded:') ? 'decoded' : null;
    if (!mount) return null;
    const path = file.slice(file.indexOf(':') + 1);
    return {type: 'decoded', filename: path.split('/').at(-1),
        url: `/${mount}/${path.split('/').map(encodeURIComponent).join('/')}`};
}

export async function copyTransmitterText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    // Clipboard API is unavailable on some HTTP ground-station installations.
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.left = '-9999px';
    document.body.appendChild(field);
    try {
        field.focus({preventScroll: true});
        field.select();
        if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
    } finally {
        field.remove();
    }
}
