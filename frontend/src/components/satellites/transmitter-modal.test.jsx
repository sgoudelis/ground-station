import React from 'react';
import {configureStore} from '@reduxjs/toolkit';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {Provider} from 'react-redux';
import {beforeEach, expect, it, vi} from 'vitest';
import '../../i18n/config.js';
import satellitesReducer from './satellite-slice.jsx';
import TransmitterModal from './transmitter-modal.jsx';

const socket = vi.hoisted(() => ({emit: vi.fn()}));
vi.mock('../common/socket.jsx', () => ({useSocket: () => ({socket})}));

beforeEach(() => {
    socket.emit.mockReset();
    socket.emit.mockImplementation((_event, request, reply) => {
        reply({success: true, data: [request.data]});
    });
});

function renderTransmitter(profile = {sf: 10, bw: 203125, cr: 1, sync_word: [18]}) {
    const store = configureStore({reducer: {satellites: satellitesReducer}});
    const transmitter = {
        id: 'profile-1', description: 'Test Satellite LoRa', source: 'tinygs',
        type: 'Transmitter', status: 'active', alive: true,
        downlinkLow: 436701300, mode: 'LoRa',
        _original: {lora_config: profile},
    };
    render(
        <Provider store={store}>
            <TransmitterModal open onClose={vi.fn()} transmitter={transmitter} satelliteId={44001}/>
        </Provider>
    );
}

it('sends the selected TinyGS LoRa profile when editing a transmitter', async () => {
    renderTransmitter();
    expect(screen.getByText('203125 (current)')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', {name: 'Preamble Length'})).toHaveValue(null);
    fireEvent.click(screen.getByRole('button', {name: 'Save Changes'}));

    await waitFor(() => expect(socket.emit).toHaveBeenCalled());
    const request = socket.emit.mock.calls[0][1];
    expect(request.cmd).toBe('edit-transmitter');
    expect(request.data.lora_config).toEqual({sf: 10, bw: 203125, cr: 1, sync_word: [18]});
    expect(request.data.loraConfig).toBeUndefined();
});

it('validates numeric preambles and saves a custom integer', async () => {
    renderTransmitter({preamble_len: 15});
    const preamble = screen.getByRole('spinbutton', {name: 'Preamble Length'});
    const save = screen.getByRole('button', {name: 'Save Changes'});
    expect(preamble).toHaveValue(15);

    for (const value of ['4', '17.5', '65536']) {
        fireEvent.change(preamble, {target: {value}});
        expect(preamble).toHaveAttribute('aria-invalid', 'true');
        expect(save).toBeDisabled();
    }
    expect(socket.emit).not.toHaveBeenCalled();
    fireEvent.change(preamble, {target: {value: '17'}});
    expect(preamble).not.toHaveAttribute('aria-invalid', 'true');
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(socket.emit).toHaveBeenCalled());
    expect(socket.emit.mock.calls[0][1].data.lora_config).toEqual({preamble_len: 17});
});

it('allows clearing a profile preamble without storing zero or a decoder default', async () => {
    renderTransmitter({sf: 10, preamble_len: 17});
    const preamble = screen.getByRole('spinbutton', {name: 'Preamble Length'});
    fireEvent.change(preamble, {target: {value: ''}});
    expect(preamble).not.toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', {name: 'Save Changes'}));
    await waitFor(() => expect(socket.emit).toHaveBeenCalled());
    expect(socket.emit.mock.calls[0][1].data.lora_config).toEqual({sf: 10});
});
