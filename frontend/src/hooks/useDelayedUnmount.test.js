import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDelayedUnmount } from './useDelayedUnmount.js';

describe('useDelayedUnmount', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('is false while closed from the start', () => {
        const { result } = renderHook(() => useDelayedUnmount(false, 200));
        expect(result.current).toBe(false);
    });

    it('stays mounted for the delay after closing, then unmounts', () => {
        const { result, rerender } = renderHook(({ open }) => useDelayedUnmount(open, 200), {
            initialProps: { open: true },
        });
        expect(result.current).toBe(true);

        rerender({ open: false });
        expect(result.current).toBe(true);

        act(() => vi.advanceTimersByTime(199));
        expect(result.current).toBe(true);

        act(() => vi.advanceTimersByTime(1));
        expect(result.current).toBe(false);
    });

    it('cancels the pending unmount when reopened', () => {
        const { result, rerender } = renderHook(({ open }) => useDelayedUnmount(open, 200), {
            initialProps: { open: true },
        });

        rerender({ open: false });
        act(() => vi.advanceTimersByTime(100));
        rerender({ open: true });
        act(() => vi.advanceTimersByTime(500));

        expect(result.current).toBe(true);
    });
});
