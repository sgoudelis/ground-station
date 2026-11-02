import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import '../../i18n/config.js';
import SoapyProbeControls from './soapy-probe-controls.jsx';

const device = {type: 'soapysdrremote', host: 'radio.local', port: 55132,
    driver: 'sdrplay', serial: 'ABC', name: 'My radio', antenna_labels: {rx: {A: 'Yagi'}}};
const capabilities = {sample_rate_values: [1000000, 2000000], gain_values: [0, 10],
    antennas: {rx: ['A', 'B'], tx: []}};

function connection() {
    let reply;
    const socket = {timeout: vi.fn().mockReturnThis(), emit: vi.fn((_event, _request, callback) => {
        reply = callback;
    })};
    return {socket, respond: (response, error = null) => act(async () => reply(error, response))};
}

describe('manual SoapySDR controls', () => {
    it('discovers on demand and probes the current unsaved connection with a capability summary', async () => {
        const {socket, respond} = connection();
        const discover = vi.fn();
        const apply = vi.fn();
        render(<SoapyProbeControls socket={socket} values={device}
            onDiscover={discover} onParameters={apply}/>);
        expect(socket.emit).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: 'Discover SoapySDR Servers'}));
        expect(discover).toHaveBeenCalledOnce();
        expect(socket.emit).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: 'Probe selected SDR'}));
        expect(socket.emit).toHaveBeenCalledWith('api.call', {cmd: 'probe-sdr', data: device}, expect.any(Function));
        expect(screen.getByRole('button', {name: 'Probing SDR…'})).toBeDisabled();
        await respond({success: true, data: capabilities, cached: false});
        expect(apply).toHaveBeenCalledWith(capabilities);
        expect(screen.getByText('2 sample rates · 2 gain values · RX: A, B · TX: —')).toBeInTheDocument();
        expect(device.antenna_labels.rx.A).toBe('Yagi');
    });

    it('keeps discovery available before entering a device and disables probes during discovery', () => {
        const {socket} = connection();
        const view = render(<SoapyProbeControls socket={socket} values={{type: 'soapysdrremote'}} onDiscover={vi.fn()}/>);
        expect(screen.getByRole('button', {name: 'Probe selected SDR'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Discover SoapySDR Servers'})).toBeEnabled();
        view.rerender(<SoapyProbeControls socket={socket} values={device} discovering onDiscover={vi.fn()}/>);
        expect(screen.getByRole('button', {name: 'Probe selected SDR'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Discovering…'})).toBeDisabled();
    });

    it('shows probe errors inline and allows retry without losing the form', async () => {
        const {socket, respond} = connection();
        render(<SoapyProbeControls socket={socket} values={device}/>);
        fireEvent.click(screen.getByRole('button', {name: 'Probe selected SDR'}));
        await respond({success: false, error: 'Stop the active SDR stream before probing this hardware.'});
        expect(screen.getByRole('alert')).toHaveTextContent('Stop the active SDR stream');
        fireEvent.click(screen.getByRole('button', {name: 'Probe selected SDR'}));
        await respond({success: true, data: capabilities, cached: true});
        expect(screen.getByRole('alert')).toHaveTextContent('SDR is streaming. Showing cached capabilities.');
        expect(socket.emit).toHaveBeenCalledTimes(2);
    });

    it('discards late responses when the dialog closes', async () => {
        const {socket, respond} = connection();
        const apply = vi.fn();
        const busy = vi.fn();
        const view = render(<SoapyProbeControls socket={socket} values={device}
            onParameters={apply} onProbingChange={busy}/>);
        fireEvent.click(screen.getByRole('button', {name: 'Probe selected SDR'}));
        expect(busy).toHaveBeenLastCalledWith(true);
        view.unmount();
        expect(busy).toHaveBeenLastCalledWith(false);
        await respond({success: true, data: capabilities});
        expect(apply).not.toHaveBeenCalled();
    });

    it('reports a missing response and permits retry', async () => {
        const {socket, respond} = connection();
        render(<SoapyProbeControls socket={socket} values={device}/>);
        fireEvent.click(screen.getByRole('button', {name: 'Probe selected SDR'}));
        await respond(null, new Error('ack timeout'));
        expect(screen.getByRole('alert')).toHaveTextContent('The SDR probe timed out.');
        expect(screen.getByRole('button', {name: 'Probe selected SDR'})).toBeEnabled();
    });
});
