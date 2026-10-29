# Telemetry Payload Parsing

Two-stage design: `backend/telemetry/parser.py` identifies the link layer
(AX.25 / CSP / CCSDS / proprietary GEOSCAN / LoRa / APRS) and then delegates
the payload to satellite-specific parsers from `backend/telemetry/parsers/`,
selected by the registry (`registry.py`) via source callsign or protocol/service
hints. Unknown payloads fall back to the generic `PayloadAnalyzer` views.

## Binary payload parsers: Kaitai specs (`.ksy`)

Binary (non-text) payload layouts are described as
[Kaitai Struct](https://kaitai.io) specs, which are the shared definition
format across the community decoder ecosystem (SatNOGS ships ~170 `.ksy`
files; TinyGS decoders were built the same way).

```
backend/telemetry/parsers/
├── specs/       # source of truth: one .ksy per layout, citing its reference
├── gen/         # generated Python modules (committed, never hand-edited)
├── kaitai.py    # generic adapter that exposes specs to the registry
└── registry.py  # callsign/protocol -> parser factory bindings
```

Decoding is **fail-fast**: a truncated frame or failed validation raises
`ValueError`, which `TelemetryParser` converts into the hex fallback instead
of emitting partially decoded values. Validate allowed payload-type selectors
before switching: Kaitai otherwise leaves an unmatched switch as `None`.
Fixed-size layouts validate their complete stream size, including unmodeled
tails retained as raw bytes. Tianqi beacons require 100 bytes; GEOSCAN's 66/74
frames deliver 64/72 bytes or their 48/56-byte AX.25 information fields.
UWE-4 validates the declared body size, parses it in a bounded substream and
reads the two-byte checksum separately (10-byte header + body + checksum).

Output envelope (consumed by metadata/UI): `{"satellite", "format": "kaitai",
"spec", "length", "values", "field_info", "raw_fields"?}`; fields named `*_raw` land in
`raw_fields`, everything else (including computed instances) in `values`. A
spec field `time_unix_s` additionally surfaces as top-level `time_unix_s` and
`time_utc`. GEOSCAN's `eps_time_unix_s` also provides those conveniences.
`presentation.py` supplies labels and units without duplicating binary layouts.
The viewer shows spacecraft UTC separately from capture/reception time.

GEOSCAN, Colibri-S and RS52S housekeeping values are grouped into power,
onboard-computer and communications sections. The viewer accepts both legacy
`{value, unit}` entries and current scalar values, so existing metadata benefit
without reparsing. Small currents are displayed in mA, reserved/raw fields
remain collapsed, and spacecraft and reception clocks use the selected user
timezone and locale. Numeric mode codes stay numeric until their meanings
are documented.

Routing: AX.25 payloads are matched by source callsign; LoRa payloads (no
callsign exists at that layer) are matched by the observation satellite name
against `TelemetryParser.lora_parsers`, registered from
`registry._iter_builtin_lora_parsers()`.

### Adding or updating a satellite parser

1. Add/edit `specs/<name>.ksy`. Cite the layout source in the header comment
   (SatNOGS `.ksy`, mission docs, or raw/parsed pairs recovered from another
   network) — same provenance discipline as the existing hand-written parsers.
2. Regenerate:

   ```bash
   cd backend
   GS_JAVA=/path/to/java GS_KSC=/path/to/kaitai-struct-compiler-bin ./kaitaigen.sh
   ```

   (`GS_JAVA`/`GS_KSC` are only needed on machines without them on `PATH`;
   CI never runs codegen because generated modules are committed.)
3. Bind it in `registry.py`:

   ```python
   ("CALLSIGN", KaitaiPayloadParser.factory("<name>", satellite="CALL")),
   ```

4. Add labels and units to `presentation.py`, then a parity/routing test using real captured
   packets where possible (observations on the rfbox5 data pool contain
   decoded `.bin` payloads; USP captures live in `tests/fixtures/umka.json`).
5. Run: `ALEMBIC_CONTEXT=1 ./venv/bin/pytest -q tests/testkaitai.py`

Versions in use: compiler `kaitai-struct-compiler 0.11`, runtime
`kaitaistruct>=0.11` (see `backend/pyproject.toml`).

### Exceptions: text formats stay hand-written

`lasarsat.py` (CSV beacons) and `aprsparser.py` (APRS 1.01 info fields) parse
text protocols; expressing them in Kaitai loses clarity, so they remain
hand-written and out of scope for specs.

LASARSAT's `BEACON_FIELDS` definitions in `lasarsat.py` specify CSV column
order, decimal/hex/text parsing, missing values, labels and display groups for
OBC, PSU, SOL, MGS, DOS, NAV, UHF (`U`) and VHF (`V`) beacons. The parser emits
scalar `values` and matching `field_info` with `label`, `unit`, `group` and
`order`. Sensor and timing readings additionally carry `calibrated: false`:
their physical conversion is not documented, so no voltage, temperature,
duration or RSSI scales are guessed. The viewer marks these readings `(raw)`;
counters, text and decoded channel flags retain their normal presentation.
SOL's `nan` readings become JSON null and display as unavailable.

`raw_fields` preserves the original CSV tokens, including hexadecimal channel
bits, leading signs/zeros and missing readings; `text` preserves the CSV body.
The PSU channel bitfield stays in raw details while its seven documented
channel flags appear as display values. Shared telemetry cards honor backend
`field_info.group` and numeric `order`, including fields named `*_raw` when
explicitly assigned a display group. Existing satellite fallbacks still work
without metadata. When an older LASARSAT capture lacks grouped telemetry, the
viewer requests `filebrowser.preview-telemetry` over the authenticated socket.
This decodes the binary with the current backend parser for display without
rewriting either capture file, rebuilding the library, or publishing changes.
The File Browser, live decoded-packet drawer and scheduler packet viewer all
support this path. Frame decoding errors are shown in the Telemetry tab.
`tests/fixtures/lasarsat.json` contains legacy DOS, SOL and UHF packets plus an
invalid AX.25 frame captured on 2026-01-31 to cover this behavior.

### Refreshing saved captures

Open a binary packet in either the File Browser or the live decoded-packet
drawer and click **Reparse telemetry**. The authenticated command
`filebrowser.reparse-telemetry` uses its saved protocol, satellite and framing
configuration to refresh only the `telemetry` section of its JSON metadata.
The binary and other capture fields are preserved; the metadata file is replaced
atomically and the library is refreshed. Existing files are not rewritten
until this action is requested; automatic previews only affect the current
view. Both `/decoded/*.bin` and observation-bundle
decoded packets are supported; metadata must identify a supported protocol.

## Current status

| Key | Satellite | Backed by |
|---|---|---|
| `RS52S` | STRATOSAT-TK 1 | `specs/rs52s.ksy` (parity-proven vs old hand-coded parser) |
| `RS40S` | UMKA-1 (SPUTNIX USP) | `specs/usp_uhf/power/adcs.ksy` bodies + `usp.py` (framing, labels, flag semantics; envelope byte-identical to pre-migration) |
| `RS67S` / `COLIBRI-S` | Colibri-S GEOSCAN Type-I | `colibri_s.py` (ksy migration planned; same Type-I info layout as `geoscan_type1_info56.ksy`) |
| `OK0LSR` | LasaSat | `lasarsat.py` (text, stays) |
| `DP0UWH` | UWE-4 | `specs/uwe4.ksy` (hskp + RF-message payloads; ported from SatNOGS, pinned to rfbox5 captures) |
| `TIANQI*` (LoRa) | Tianqi fleet (FHRSS) | `specs/tianqi.ksy`; offsets recovered from TinyGS raw+parsed pairs, beacon clock validated vs 62 rfbox5 capture clocks |
| — | GEOSCAN 66/74 frames | `specs/geoscan_type1_*.ksy` (4 layouts) + `geoscan.py` dispatcher (parity-proven vs legacy tables on 39 rfbox5 GEOSCAN-6 packets) |
