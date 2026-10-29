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
 *
 */

import React, { useCallback, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import '../../../i18n/config.js';
import FileSearchInput from '../file-search-input.jsx';

function Search({ onChange, initial = '' }) {
    const [value, setValue] = useState(initial);
    const apply = useCallback((next) => {
        setValue(next);
        onChange(next);
    }, [onChange]);
    return <FileSearchInput value={value} onChange={apply} />;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('debounces typing, then applies Enter immediately without another request', () => {
    const onChange = vi.fn();
    render(<Search onChange={onChange} />);
    const input = screen.getByRole('searchbox', { name: 'Search files' });
    fireEvent.change(input, { target: { value: 'ISS' } });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.change(input, { target: { value: 'ISS APRS' } });
    act(() => vi.advanceTimersByTime(299));
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('ISS APRS');

    fireEvent.change(input, { target: { value: '25544' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('25544');
    act(() => vi.advanceTimersByTime(400));
    expect(onChange).toHaveBeenCalledTimes(2);
});

test('Clear and Escape cancel pending text and apply an empty query immediately', () => {
    const onChange = vi.fn();
    render(<Search onChange={onChange} initial="ISS" />);
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'old pending text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveValue('');
    act(() => vi.advanceTimersByTime(400));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('');

    fireEvent.change(input, { target: { value: 'more pending text' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(400));
    expect(input).toHaveValue('');
    expect(onChange).toHaveBeenCalledTimes(2);
});

test('unmounting cancels a pending search', () => {
    const onChange = vi.fn();
    const { unmount } = render(<Search onChange={onChange} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pending' } });
    unmount();
    act(() => vi.advanceTimersByTime(400));
    expect(onChange).not.toHaveBeenCalled();
});
