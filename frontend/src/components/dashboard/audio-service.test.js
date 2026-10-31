import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    flushAudioBuffers,
    registerFlushCallback,
    unregisterFlushCallback,
} from './audio-service.js';
import {
    AUDIO_JITTER_BUFFER_SECONDS,
    AUDIO_MAX_BUFFER_SECONDS,
} from './audio-buffer-config.js';

afterEach(() => unregisterFlushCallback());

describe('audio service', () => {
    it('forwards all-buffer and per-VFO flush requests to the registered callback', () => {
        const flush = vi.fn();
        registerFlushCallback(flush);

        flushAudioBuffers();
        flushAudioBuffers(2);

        expect(flush).toHaveBeenNthCalledWith(1, null);
        expect(flush).toHaveBeenNthCalledWith(2, 2);
    });

    it('does nothing after its callback is unregistered', () => {
        const flush = vi.fn();
        registerFlushCallback(flush);
        unregisterFlushCallback();

        flushAudioBuffers(1);

        expect(flush).not.toHaveBeenCalled();
    });
});

describe('audio buffer limits', () => {
    it('keeps the jitter lead well below the trim threshold', () => {
        expect(AUDIO_JITTER_BUFFER_SECONDS).toBeGreaterThan(0);
        // Trimming must not kick in right after an underrun re-primes the lead.
        expect(AUDIO_MAX_BUFFER_SECONDS).toBeGreaterThan(AUDIO_JITTER_BUFFER_SECONDS * 2);
    });
});
