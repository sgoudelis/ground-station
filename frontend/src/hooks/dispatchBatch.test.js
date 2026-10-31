import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDispatchBatcher } from './dispatchBatch.js';

describe('createDispatchBatcher', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('runs queued handlers once, in order, after the window elapses', () => {
        const calls = [];
        const batcher = createDispatchBatcher({ windowMs: 50 });

        batcher.enqueue(() => calls.push('a'));
        batcher.enqueue(() => calls.push('b'));
        expect(calls).toEqual([]);

        vi.advanceTimersByTime(49);
        expect(calls).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(calls).toEqual(['a', 'b']);

        // A new burst starts a new window rather than piggybacking on the old one.
        batcher.enqueue(() => calls.push('c'));
        vi.advanceTimersByTime(50);
        expect(calls).toEqual(['a', 'b', 'c']);
    });

    it('keeps running the batch when one handler throws', () => {
        const onError = vi.fn();
        const calls = [];
        const batcher = createDispatchBatcher({ windowMs: 10, onError });

        batcher.enqueue(() => { throw new Error('boom'); });
        batcher.enqueue(() => calls.push('after'));
        vi.advanceTimersByTime(10);

        expect(calls).toEqual(['after']);
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('drops pending handlers on dispose', () => {
        const calls = [];
        const batcher = createDispatchBatcher({ windowMs: 10 });

        batcher.enqueue(() => calls.push('never'));
        batcher.dispose();
        vi.advanceTimersByTime(10);

        expect(calls).toEqual([]);
    });
});
