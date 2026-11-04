# LoRa reception

Select **LoRa** on a VFO, enable its decoder parameters, and tune to the
satellite's downlink. The same controls are available in scheduled decoder
tasks. LoRa consumes raw complex IQ and performs its own channel filtering.
The SDR capture must contain the whole channel and sample at least twice the
selected LoRa bandwidth. The receiver resamples internally to four times BW.

| Control | Meaning / TinyGS equivalent |
| --- | --- |
| SF | Spreading factor 7–12 (`sf`); SF5/6 are not supported by this receiver |
| BW | Bandwidth in Hz in Ground Station; TinyGS commonly expresses `bw` in kHz |
| CR | 4/5–4/8; TinyGS `cr` uses 5–8, legacy Ground Station uses 1–4; the backend accepts either |
| Sync word | Network byte, shown as hex and decimal (`sw`); accept-any is `[0,0]` |
| Preamble | Number of preamble symbols (`pl`) |
| Implicit header | TinyGS `ih`; enable only for transmissions without an explicit header |
| Implicit payload length | Exact payload size excluding CRC; required in implicit mode |
| Implicit payload CRC | CRC presence in implicit mode (`crc`) |
| Invert IQ | TinyGS `iq` |
| LDRO | Automatic, off, or on; TinyGS `fldro=true` maps to forced on; false maps to automatic |

Explicit headers supply the received payload length, coding rate, and CRC
presence. Their values are stored with each packet. A failed payload CRC is
always discarded. Packets transmitted without a CRC are saved and marked
**unchecked**. Receiver settings and actual received header values are stored
separately. No LoRaWAN decryption or satellite-specific telemetry interpretation
is implied: raw application bytes and hex are preserved, including `00`, `7e`
and `ff`. File timestamps are decode time, including during recording playback.

The selected transmitter's explicit PHY fields and SF/BW/CR description tokens
provide defaults; manual settings take precedence. A satellite can have multiple
LoRa transmitters with different PHY settings. Sync word is satellite-specific;
the generic default is 0x12. Legacy two-symbol sync arrays remain supported.

## Receiver profiles

The waterfall decoder parameters dialog has a grouped **LoRa profile** dropdown:

- MeshCore: EU/UK Narrow, deprecated EU/UK Legacy, USA and Australia Narrow.
- Meshtastic: Short Fast, Short Slow, Medium Fast, Medium Slow, Long Fast and Long Moderate.
- LoRaWAN EU868: DR0–DR6, with separate uplink and downlink profiles.
- LoRaWAN US915: uplink DR0–DR4 and downlink DR8–DR13.
- Reticulum / RNode: an editable SF8/BW125/CR4/5 example with sync 0x12
  and the SX126x RNode's 18-symbol minimum preamble. Reticulum networks have
  configurable modem settings; match the local interface rather than assuming
  this example is a network-wide default.
- Generic LoRa: restores the decoder's default parameters.

Selecting a profile enables parameter overrides in the dialog draft. **Apply**
commits the settings; **Cancel** discards them. Editing a field displays
**Custom** when the draft no longer matches a profile. Switching profiles resets
all LoRa fields, including hidden implicit-header values. Suggested MeshCore
frequencies are informational; tune the VFO separately.

MeshCore profiles use sync 0x12 and current firmware preambles (32 symbols at
SF7/8, 16 above SF8). Meshtastic uses sync 0x2B and preamble 16. LoRaWAN uses
sync 0x34 and preamble 8; downlink profiles invert IQ. All supplied profiles use
explicit headers and automatic LDRO. Header coding rate and CRC presence come
from received packets. Each VFO receives one channel and data rate at a time.
Selecting a profile does not add an application parser or decryption keys.

Profile sources:

- [MeshCore regional presets](https://api.meshcore.nz/api/v1/config) and
  [preamble handling](https://github.com/meshcore-dev/MeshCore/blob/main/src/helpers/radiolib/RadioLibWrappers.h)
- [Meshtastic radio settings](https://meshtastic.org/docs/overview/radio-settings/),
  [sync word](https://github.com/meshtastic/firmware/blob/master/src/mesh/RadioLibInterface.h) and
  [preamble](https://github.com/meshtastic/firmware/blob/master/src/mesh/RadioInterface.h)
- LoRaWAN [EU868](https://www.thethingsnetwork.org/docs/lorawan/regional-parameters/eu868/) and
  [US915](https://www.thethingsnetwork.org/docs/lorawan/regional-parameters/us915/)
- [Reticulum RNode configuration](https://reticulum.network/manual/interfaces.html#rnode-lora-interface)

## KOSAR recording settings

For the supplied NORAD 67264 recording, tune to **436.100 MHz** and use **SF8,
BW125 kHz, sync 0x34 (52), explicit headers, normal IQ, preamble 8, auto LDRO**.
The received headers report CR4/5 and a payload CRC. The transmitter database
currently supplies SF8/BW125 in its description; set sync 0x34 explicitly.

The full 43.122688-second, 2 MS/s recording was run through the new worker in
an isolated directory on rfbox5. It produced 13 independent CRC-valid packets
(12 × 107 bytes and 1 × 87 bytes), 1371 payload bytes, matching the previous
independent decode byte-for-byte. This does not establish a satellite rule of
13 packets per beacon or an application-level relationship between the packets.

## Runtime and validation

A persistent GNU Radio chain retains filter, resampler and packet synchronization
state across IQ chunks. Frequency translation retains oscillator phase during
Doppler updates. Capture-rate changes, large retunes, playback seeks, broadcaster
queue gaps, and input overflow reset acquisition. Input and packet queues are
bounded. Status, packet output, binary/JSON files, CPU/memory and ingest statistics
use the existing decoder pipeline. Known packet CRC failures and stream resets
are included in performance counters.

GNU Radio with `gr-lora_sdr` is required (already included in the Docker image).
If its imports fail, the registry reports LoRa as unavailable. Native ABI problems
must be fixed in that installation. The development workstation's installation
currently aborts even after a standalone import; the rfbox5 container passes the
native regression tests.

Run from `backend/`:

```sh
ALEMBIC_CONTEXT=1 ./venv/bin/pytest tests/testlora.py tests/testdecoderhandler.py
```

CI sets `GS_REQUIRE_LORA=1`, so the recorded-IQ regression cannot silently skip
because the image lacks GNU Radio. Native checks run in subprocesses with time
limits. The compact fixture's provenance is in `tests/fixtures/lora/README.md`.

Validation for this change:

- 33 focused backend checks passed in the isolated rfbox5 copy, including six
  native receiver scenarios, scheduler mapping, output-directory preservation,
  and IQ/frequency contracts.
- All 479 frontend tests passed; ESLint passed on the changed frontend files.
- Black, isort and flake8 passed on changed Python files. Mypy passed for the
  eight changed non-registry modules. The registry retains 18 pre-existing
  optional-import typing errors, confirmed against the unchanged HEAD version;
  the LoRa registration adds none.
- The live application was not replaced or restarted. The full-recording outputs
  remain in the container's `/tmp/lorareview/fullrecording` review directory.
