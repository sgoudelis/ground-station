import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import TransmitterCapturesDialog from '../transmitter-captures-dialog.jsx';
import {callLibrary} from '../use-packet-positions.js';

await i18n.use(initReactI18next).init({lng: 'en', resources: {}});
vi.mock('../use-packet-positions.js', () => ({callLibrary: vi.fn()}));
vi.mock('../../filebrowser/aircraft-folder-dialog.jsx', () => ({default: ({folder, onClose}) =>
    <div data-testid="adsb-captures">{folder.id}<button onClick={onClose}>Close captures</button></div>}));
vi.mock('../../filebrowser/aprs-folder-dialog.jsx', () => ({default: ({folder, onOpenPacket}) =>
    <div data-testid="aprs-captures">{folder.id}<button onClick={() => onOpenPacket({type: 'decoded',
        filename: 'packet.bin', url: '/decoded/aprs_SV1ABC/run/packet.bin'})}>View packet</button></div>}));
vi.mock('../../filebrowser/meshtastic-folder-dialog.jsx', () => ({default: ({folder}) =>
    <div data-testid="meshtastic-captures">{folder.id}</div>}));
vi.mock('../../filebrowser/radiosonde-folder-dialog.jsx', () => ({default: ({folder}) =>
    <div data-testid="radiosonde-captures">{folder.id}</div>}));
vi.mock('../../filebrowser/telemetry-viewer-dialog.jsx', () => ({default: ({file, metadata, onClose}) =>
    <div data-testid="packet-viewer">{file.filename} {metadata.marker}<button onClick={onClose}>Close packet</button></div>}));

beforeEach(() => vi.clearAllMocks());

it.each([
    ['adsb', {source: '4D2406'}, 'decoded_folder:adsb_4d2406'],
    ['aprs', {source: 'SV1ABC', name: 'Balloon object', file_id: 'decoded:aprs_SV1ABC/run/packet.bin'}, 'decoded_folder:aprs_SV1ABC'],
    ['meshtastic', {source: '!2008e299', file_id: 'decoded:meshtastic_2008e299/run/packet.bin'}, 'decoded_folder:meshtastic_2008e299'],
    ['radiosonde', {name: 'V123', file_id: 'decoded:radiosonde_RS41_V123/run/packet.bin'}, 'decoded_folder:radiosonde_RS41_V123'],
])('opens the existing %s capture viewer using the real storage identity', async (kind, fields, id) => {
    callLibrary.mockResolvedValue({type: 'decoded_folder', folder_kind: kind, id});
    const socket = {};
    render(<TransmitterCapturesDialog transmitter={{id: `${kind}:A`, kind, ...fields}} socket={socket} onClose={vi.fn()} />);
    expect(await screen.findByTestId(`${kind}-captures`)).toHaveTextContent(id);
    expect(callLibrary).toHaveBeenCalledExactlyOnceWith(socket, 'filebrowser.item', {id});
});

it('explains live aircraft without saved captures and lets the user close the dialog', async () => {
    callLibrary.mockRejectedValue(new Error('Library item not found'));
    const onClose = vi.fn();
    render(<TransmitterCapturesDialog transmitter={{kind: 'adsb', source: '4d2406'}} socket={{}} onClose={onClose} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No saved captures are available for this transmitter.');
    fireEvent.click(screen.getByRole('button', {name: 'Close', exact: true}));
    expect(onClose).toHaveBeenCalledOnce();
});

it('opens packet metadata from a capture folder and returns to that folder when the packet closes', async () => {
    callLibrary.mockResolvedValue({type: 'decoded_folder', folder_kind: 'aprs', id: 'decoded_folder:aprs_SV1ABC'});
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ok: true, json: async () => ({marker: 'decoded APRS'})});
    const onClose = vi.fn();
    try {
        render(<TransmitterCapturesDialog transmitter={{kind: 'aprs', file_id: 'decoded:aprs_SV1ABC/run/packet.bin'}}
            socket={{}} onClose={onClose} />);
        fireEvent.click(await screen.findByRole('button', {name: 'View packet'}));
        expect(await screen.findByTestId('packet-viewer')).toHaveTextContent('packet.bin decoded APRS');
        expect(fetch).toHaveBeenCalledWith('/decoded/aprs_SV1ABC/run/packet.json', expect.objectContaining({signal: expect.any(AbortSignal)}));
        fireEvent.click(screen.getByRole('button', {name: 'Close packet'}));
        expect(screen.getByTestId('aprs-captures')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    } finally {
        fetch.mockRestore();
    }
});

it('opens legacy flat captures and observation packets in the telemetry viewer', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ok: true, json: async () => ({marker: 'legacy'})});
    callLibrary.mockResolvedValue({type: 'decoded', name: 'old.bin', url: '/decoded/old.bin'});
    const onClose = vi.fn();
    try {
        const view = render(<TransmitterCapturesDialog transmitter={{kind: 'aprs', file_id: 'decoded:old.bin'}}
            socket={{}} onClose={onClose} />);
        expect(await screen.findByTestId('packet-viewer')).toHaveTextContent('old.bin legacy');
        fireEvent.click(screen.getByRole('button', {name: 'Close packet'}));
        expect(onClose).toHaveBeenCalledOnce();
        view.unmount();
        callLibrary.mockClear();
        render(<TransmitterCapturesDialog transmitter={{kind: 'aprs', file_id: 'observation:pass 1/decoded/packet.bin'}}
            socket={{}} onClose={onClose} />);
        expect(await screen.findByTestId('packet-viewer')).toHaveTextContent('packet.bin');
        expect(fetch).toHaveBeenLastCalledWith('/observations/pass%201/decoded/packet.json', expect.any(Object));
        expect(callLibrary).not.toHaveBeenCalled();
    } finally {
        fetch.mockRestore();
    }
});

it('ignores a late capture lookup after switching transmitters', async () => {
    let finish;
    callLibrary.mockImplementationOnce(() => new Promise((resolve) => {finish = resolve;}));
    callLibrary.mockResolvedValue({type: 'decoded_folder', folder_kind: 'adsb', id: 'decoded_folder:adsb_abcdef'});
    const element = (source) => <TransmitterCapturesDialog key={source} transmitter={{kind: 'adsb', source}}
        socket={{}} onClose={vi.fn()} />;
    const {rerender} = render(element('4d2406'));
    rerender(element('abcdef'));
    expect(await screen.findByTestId('adsb-captures')).toHaveTextContent('adsb_abcdef');
    await act(async () => finish({type: 'decoded_folder', folder_kind: 'adsb', id: 'decoded_folder:adsb_4d2406'}));
    expect(screen.getByTestId('adsb-captures')).toHaveTextContent('adsb_abcdef');
    expect(screen.queryByText('decoded_folder:adsb_4d2406')).not.toBeInTheDocument();
});

it('aborts packet metadata loading when its capture viewer closes', async () => {
    let finish;
    let signal;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => {
        signal = options.signal;
        return new Promise((resolve) => {finish = resolve;});
    });
    try {
        const {unmount} = render(<TransmitterCapturesDialog transmitter={{kind: 'aprs', file_id: 'observation:pass/decoded/packet.bin'}}
            socket={{}} onClose={vi.fn()} />);
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        unmount();
        expect(signal.aborted).toBe(true);
        await act(async () => finish({ok: true, json: async () => ({marker: 'late'})}));
        expect(screen.queryByTestId('packet-viewer')).not.toBeInTheDocument();
    } finally {
        fetch.mockRestore();
    }
});
