import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/config.js';
import TransmitterFrequencySearch from './transmitter-frequency-search.jsx';

const socket = vi.hoisted(() => ({ connected: true, emit: vi.fn() }));
vi.mock('../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));

const aprs = { id: 'aprs', owner_name: 'ISS', description: 'APRS', downlink_low: 145825000, mode: 'FM', baud: 1200 };
const response = (data, extra = {}) => ({ success: true, data, total: data.length, has_more: false, ...extra });
const query = (value) => fireEvent.change(screen.getByRole('combobox'), { target: { value } });
const tick = (milliseconds = 300) => act(() => vi.advanceTimersByTimeAsync(milliseconds));

describe('transmitter frequency helper', () => {
    beforeEach(() => {
        socket.connected = true;
        socket.emit.mockReset();
        vi.useFakeTimers();
    });
    afterEach(() => vi.useRealTimers());

    it('debounces a full-catalog query and returns the selected catalog snapshot for prefilling', async () => {
        const onSelect = vi.fn();
        socket.emit.mockImplementation((_event, _payload, acknowledge) => acknowledge(response([aprs])));
        render(<TransmitterFrequencySearch onTransmitterSelect={onSelect} />);
        expect(socket.emit).not.toHaveBeenCalled();
        query('I');
        await tick();
        expect(socket.emit).not.toHaveBeenCalled();
        query('IS');
        await tick(200);
        query('ISS');
        await tick();
        expect(socket.emit).toHaveBeenCalledTimes(1);
        expect(socket.emit.mock.calls[0][1]).toEqual({
            cmd: 'get-transmitter-search', data: { keyword: 'ISS', page: 0, page_size: 20 },
        });
        const option = screen.getByRole('option', { name: /ISS · APRS.*145.825 MHz.*FM.*1200 baud/ });
        fireEvent.click(option);
        expect(onSelect).toHaveBeenCalledExactlyOnceWith(aprs);
        expect(screen.getByRole('combobox')).toHaveValue('');
        await tick();
        expect(socket.emit).toHaveBeenCalledTimes(1);
    });

    it('ignores stale responses after a new query or clearing the input', async () => {
        const replies = [];
        socket.emit.mockImplementation((_event, _payload, acknowledge) => replies.push(acknowledge));
        render(<TransmitterFrequencySearch onTransmitterSelect={vi.fn()} />);
        query('ISS');
        await tick();
        query('Moon');
        act(() => replies[0](response([aprs])));
        expect(screen.queryByRole('option')).not.toBeInTheDocument();
        await tick();
        query('');
        act(() => replies[1](response([aprs])));
        expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });

    it('appends paginated results, de-duplicates moved rows, and searches the next query from page zero', async () => {
        socket.emit.mockImplementation((_event, payload, acknowledge) => {
            acknowledge(payload.data.page === 0
                ? response([aprs], { total: 3, has_more: true })
                : response([aprs, { ...aprs, id: 'other', description: 'Voice' }], { total: 3 }));
        });
        render(<TransmitterFrequencySearch onTransmitterSelect={vi.fn()} />);
        query('ISS');
        await tick();
        expect(screen.getByText(/Showing 1 of 3 results/)).toBeVisible();
        fireEvent.scroll(screen.getByRole('listbox'), { target: { scrollTop: 1 } });
        await tick(1);
        expect(socket.emit.mock.calls[1][1].data.page).toBe(1);
        expect(screen.getAllByRole('option')).toHaveLength(2);
        expect(screen.getByRole('listbox').scrollTop).toBe(1);
        query('Voice');
        await tick();
        expect(socket.emit.mock.calls[2][1].data).toEqual({ keyword: 'Voice', page: 0, page_size: 20 });
    });

    it('shows missing downlinks as disabled and uses a high-only frequency when available', async () => {
        const onSelect = vi.fn();
        socket.emit.mockImplementation((_event, _payload, acknowledge) => acknowledge(response([
            { ...aprs, id: 'unknown', description: 'Unknown', downlink_low: null },
            { ...aprs, id: 'high', description: 'High only', downlink_low: null, downlink_high: 145850000 },
        ])));
        render(<TransmitterFrequencySearch onTransmitterSelect={onSelect} />);
        query('ISS');
        await tick();
        const unknown = screen.getByRole('option', { name: /Unknown.*No downlink/ });
        expect(unknown).toHaveAttribute('aria-disabled', 'true');
        // Disabled options are excluded from keyboard selection as well as clicks.
        fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
        expect(onSelect).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('option', { name: /High only/ }));
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ downlink_high: 145850000 }));
    });

    it('reports timeout, ignores late replies, and can retry the same query', async () => {
        let lateReply;
        socket.emit.mockImplementation((_event, _payload, acknowledge) => { lateReply = acknowledge; });
        render(<TransmitterFrequencySearch onTransmitterSelect={vi.fn()} />);
        query('ISS');
        await tick();
        expect(screen.getByRole('progressbar')).toBeVisible();
        await tick(8000);
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        expect(screen.getAllByText(/Search failed/).length).toBeGreaterThan(0);
        act(() => lateReply(response([aprs])));
        expect(screen.queryByRole('option')).not.toBeInTheDocument();
        socket.emit.mockImplementation((_event, _payload, acknowledge) => acknowledge(response([aprs])));
        fireEvent.click(screen.getByRole('button', { name: 'Retry transmitter search' }));
        await tick();
        expect(screen.getByRole('option', { name: /APRS/ })).toBeVisible();
    });

    it('shows empty results, server errors, and offline guidance without selecting anything', async () => {
        const onSelect = vi.fn();
        socket.emit.mockImplementationOnce((_event, _payload, acknowledge) => acknowledge(response([])))
            .mockImplementationOnce((_event, _payload, acknowledge) => acknowledge({ success: false }));
        const { rerender } = render(<TransmitterFrequencySearch onTransmitterSelect={onSelect} />);
        query('Absent');
        await tick();
        expect(screen.getByText('No transmitters match your search.')).toBeVisible();
        query('Error');
        await tick();
        expect(screen.getAllByText(/Search failed/).length).toBeGreaterThan(0);
        socket.connected = false;
        rerender(<TransmitterFrequencySearch onTransmitterSelect={onSelect} />);
        query('ISS');
        await tick();
        expect(screen.getAllByText(/Connect to the backend to search/).length).toBeGreaterThan(0);
        expect(socket.emit).toHaveBeenCalledTimes(2);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('invalidates in-flight requests when unmounted', async () => {
        let reply;
        socket.emit.mockImplementation((_event, _payload, acknowledge) => { reply = acknowledge; });
        const onSelect = vi.fn();
        const { unmount } = render(<TransmitterFrequencySearch onTransmitterSelect={onSelect} />);
        query('ISS');
        await tick();
        unmount();
        act(() => reply(response([aprs])));
        expect(onSelect).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});
