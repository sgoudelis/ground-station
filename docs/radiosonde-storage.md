# Radiosonde captures

Manual decoding stores packets under:

```text
backend/data/decoded/radiosonde_<model>_<serial>/<UTC run start>.gssonde/
    run.json
    radiosonde_<model>_<packet timestamp>.bin
    radiosonde_<model>_<packet timestamp>.json
```

For example, `radiosonde_RS41_TEST0042/20261101T103000.000000Z.gssonde/`.
The `.gssonde` suffix identifies a radiosonde flight capture bundle. The serial
parent remains a plain directory; `.gsobs` continues to identify automated
observation bundles with their own manifest and artifact directories.
Scheduled decoders use the same structure inside their observation bundle's
`decoded/` directory. Binary packets and calibrated decoder reports are retained
individually, including the context needed to reparse them later.

A flight is approximated by a fixed **12-hour window** for each model/serial,
starting at its first decoded packet. Packets before that deadline share the
same folder; a packet at or after the deadline starts a new window. Later packets
never extend the deadline. Reception gaps, midnight, browser sessions, VFOs,
retunes and decoder/application restarts do not split the window. Its original
start is recovered from `run.json` (or the UTC folder name for older captures),
independent of file modification times. Session and VFO remain packet provenance.
This is a practical flight heuristic: a very long transmission can span windows,
and an unusually rapid relaunch can share a window with the previous flight.

The file browser shows one folder per model/serial, with packet and flight counts.
Open it to filter by flight, page through packets, view telemetry, download a packet
or download all captures as a ZIP. Deleting/purging the sonde folder removes all
its runs. Packet map history includes every packet with a valid position.

## Decoder diagnostics

Rejected-report warnings include the validation error, selected decoder, VFO,
tuned frequency, bandwidth, signal power in dBFS, frame length, the first 80 frame
bytes as hex, and up to 2048 bytes of the original JSON report. The logged byte
counts show when a preview is truncated. A strong signal can still fail frame
validation; the error distinguishes identity mismatches, invalid lengths and
checksum failures.

The `radiosondedecoder` logger also emits DEBUG messages with complete rejected
frames and reports, reports without a preceding raw frame, unrecognized raw
output, subprocess commands and decoder stderr. The default logging template
already enables DEBUG through the root logger. If your logging configuration
filters it out, add `radiosondedecoder: {level: DEBUG}` under `loggers` in
`backend/data/configs/log_config.yaml` (or your custom logging configuration),
ensure its handler permits DEBUG, and restart the backend.

Each decoder has a **Packet save interval (seconds)** parameter, available in the
waterfall decoder parameters dialog and scheduled decoder settings. It defaults
to **5 seconds per sonde**; **0** saves every validated packet. Decoding and
calibration continue at full rate. The first fix and ascent/descent changes are
saved immediately, and the latest pending fix is saved when the interval expires
or before a retune, decoder switch, or graceful stop. These exceptions can save
packets closer together than the selected interval. Delayed packets retain their
original reception timestamp, signal measurements, and calibrated report.

Saved packets are sent to the live UI immediately. Library indexing
runs separately from FFT forwarding, with a two-second batching window and one
scan at a time across SDRs and VFOs. Packets arriving during a scan trigger a
follow-up, including the final packet when reception stops. File Browser and
packet-map updates therefore follow the completed index refresh. The frontend
coalesces library notifications and only requests a listing while File Browser
is open; other pages check the new-files badge until it is lit.

## Historical captures

Flat packet files, the earlier serial-only layout and timestamp-only run folders
remain readable. To migrate them to `.gssonde` runs, stop reception and run from `backend/`:

```sh
./venv/bin/python -m tools.migratesondes          # preview moves
./venv/bin/python -m tools.migratesondes --apply  # regroup historical captures
```

Back up captures before applying the migration. It groups captures by saved
model/serial and reception timestamps using the same fixed 12-hour windows,
including packets already in older run folders. It preserves binary bytes,
packet metadata, file permissions and modification times, updates saved binary
paths and skips active observation bundles. Conflicting destination filenames
prevent any moves within that decoded root. Empty old run folders and their
obsolete markers are removed; unknown files are retained. Running it again makes
no further moves. Refresh the file browser after migration to rebuild its index.
