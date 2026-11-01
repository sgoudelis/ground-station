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
