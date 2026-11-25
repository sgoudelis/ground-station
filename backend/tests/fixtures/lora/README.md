KOSAR 1.5 (NORAD 67264), user-supplied recording on rfbox5:
`KOSAR_1_5_433-436_600MHz-20261023_230232_20261023_200232`.

Source: cf32_le, 2 MS/s, center 436.6 MHz, capture start 2026-10-23T20:02:32Z.
The half-second excerpt starts at sample 38,260,000 (19.13 seconds).
Original excerpt SHA256: `3d7b817f25e5cc9b31a136263956a052f9f139fe11f3c34b66c9d592c405045b`.

`kosar.npz` is a compact regression fixture: translate by +500 kHz,
filter with scipy.signal.firwin(161, 85000, fs=2000000), lfilter, decimate
by 4, quantize real and imaginary components to int16 using the stored scale.
Reconstruct as `(iq.astype(float32) * scale).view(complex64)`.
Result: 250,000 samples at 500 kS/s, centered at 436.1 MHz.

The expected 107-byte packet in `expected.json` was independently recovered
from the original IQ with gr-lora_sdr, with a valid payload CRC.
PHY: SF8, BW125 kHz, CR4/5, sync 0x34, explicit header, normal IQ, auto LDRO.
No satellite application-field interpretations are assumed by these tests.

Narrowband regression (`ufo.npz`, settings and expected bytes in `ufo.json`):
user-supplied rfbox5 recording
`UFO_10_USA_146_-256_950MHz-20261125_132813_20261125_112813.sigmf-data`.
The label identifies the recording, not an independently established transmitter.
Source: cf32_le, 1 MS/s, center 256.95 MHz, capture start 2026-11-25T11:28:13Z.
The 14.8–28.6 second excerpt contains one complete, uninterrupted transmission
at approximately 257.0499 MHz. The full recording has two sample gaps outside
this excerpt.

To reproduce the fixture, mix the full recording by -100 kHz using absolute
sample indices, causally filter using `firwin(481, 18000, fs=1000000)`, and
decimate by 20. Select channel samples `[740000:1430000]`, resample with
`resample_poly(iq, 5, 8)`, and quantize both components to int8 with
`scale = max(abs(real).max(), abs(imag).max()) / 120`. The fixture has 431,250
complex samples at 31,250 samples/s, centered at 257.050 MHz. Reconstruct as
`(iq.astype(float32) * scale).view(complex64).ravel()`.

The 10-byte result was independently recovered from the original wideband IQ
using reference-chirp timing/CFO estimation, FFT demodulation, Gray mapping,
deinterleaving, Hamming decoding and dewhitening. Both FEC blocks had zero
parity discrepancies. Re-encoding reproduced every data symbol in a clean
packet. PHY interpretation: SF12, physical BW125000/12 Hz (nominal BW10.4),
CR4/8, sync 0x12, 12 preamble chirps, normal IQ, LDRO on, implicit header,
10 payload bytes, CRC disabled. CRC is inferred absent, not validated; the test
requires the saved packet to remain marked unchecked. No application-field
interpretations are assumed.
