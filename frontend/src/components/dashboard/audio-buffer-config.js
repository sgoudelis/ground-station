// Centralized frontend audio buffering constants (UI playback path)

// Lead applied when a VFO starts (or recovers from an underrun). Incoming
// chunks are scheduled this far ahead of the AudioContext clock, so a main
// thread stall shorter than this stays inaudible. Costs the same amount of
// latency.
export const AUDIO_JITTER_BUFFER_SECONDS = 0.2;

// Once the scheduled-ahead audio exceeds this (typically after a long stall
// delivered a burst of chunks), incoming chunks are skipped until we are back
// under the limit. Skipping trims latency without overlapping sources.
export const AUDIO_MAX_BUFFER_SECONDS = 0.8;
