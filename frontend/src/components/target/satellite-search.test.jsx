import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SatelliteSearchAutocomplete from './satellite-search.jsx';

const { socket, toastError } = vi.hoisted(() => ({
    socket: { emit: vi.fn() },
    toastError: vi.fn(),
}));

vi.mock('../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));
vi.mock('../../utils/toast-with-timestamp.jsx', () => ({ toast: { error: toastError } }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key, options) => options?.defaultValue || key }),
}));

describe('shared target search request lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        socket.emit.mockReset();
        toastError.mockReset();
    });
    afterEach(() => vi.useRealTimers());

    it.each(['clear', 'close', 'disable'])('ignores an in-flight reply after %s', (action) => {
        const onTargetSelect = vi.fn();
        const { rerender } = render(<SatelliteSearchAutocomplete onTargetSelect={onTargetSelect} />);
        const input = screen.getByRole('combobox');
        fireEvent.change(input, { target: { value: 'starlink' } });
        act(() => vi.advanceTimersByTime(220));
        expect(socket.emit).toHaveBeenCalledTimes(1);
        const acknowledge = socket.emit.mock.calls[0][2];

        if (action === 'clear') fireEvent.change(input, { target: { value: '' } });
        if (action === 'close') fireEvent.keyDown(input, { key: 'Escape' });
        if (action === 'disable') rerender(<SatelliteSearchAutocomplete disabled onTargetSelect={onTargetSelect} />);
        act(() => acknowledge({ success: false, error: 'Stale error' }));

        expect(toastError).not.toHaveBeenCalled();
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
});
