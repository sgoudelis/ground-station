# APRS station captures

APRS packets are grouped by their validated AX.25 source callsign, including SSID:

```text
backend/data/decoded/aprs_N0CALL-7/
    20261103T080000.000000Z.gsaprs/
        run.json
        aprs_1200baud_<packet timestamp>.bin
        aprs_1200baud_<packet timestamp>.json
```

Each capture covers a fixed twelve-hour window starting at its first received
packet. Sessions, VFOs, midnight and decoder restarts do not split the window;
later packets do not extend it. `run.json` retains the source and UTC anchor.
The window uses reception time, independent of the transmitter's clock.
Scheduled captures use the same structure inside their `.gsobs/decoded/` root.

Every accepted packet retains its original bytes, metadata and parsing context.
APRS received by other AX.25 demodulators is grouped when the parsed payload is
identified as APRS. Unsupported payloads, including Mic-E, still have a validated
sender and can be grouped. Invalid envelopes and unrelated telemetry remain in
their original location. Repeated receptions remain separate packets.

The file browser presents a station summary, capture-run filtering, paginated
packets, latest station position/status/message/weather/telemetry, the existing
APRS packet viewer, downloads and deletion. Summary values are derived from packet
metadata. Objects and items remain in their reporting station's folder and keep
their separate map identities; their coordinates do not replace the station's
latest position. Every saved position remains available on the packet map.

## Historical captures

Pause APRS reception and run from `backend/`:

```sh
./venv/bin/python -m tools.migrateaprs          # Read-only preview
./venv/bin/python -m tools.migrateaprs --apply  # Back up, verify and group
```

The migration scans flat packets in `data/decoded/` and completed observations.
Active observations, symbolic links, unrelated telemetry and packets without a
valid APRS envelope are left in place. Old captures are parsed using their saved
context and explicit APRS provenance; filenames alone do not identify APRS.

Before moving any packet, an archive under `data/backups/aprs_*.tar.gz` stores
every original binary/JSON pair and `migration.json` with source/target paths and
SHA-256 checksums. The archive is verified before relocation. Binary bytes,
permissions and modification dates are preserved; metadata keeps its dates and
permissions while its binary path, parsing context and parsed result are updated.
Destination collisions stop preflight without moving packets. An interrupted
run retains its recovery archive; a completed migration moves zero packets when
repeated. Refresh File Browser after migration to rebuild the library index.

For a different data root, pass `--backend-dir /path/to/backend`. For container
installations, run with that installation's Python environment and backend root
so saved paths refer to their normal runtime location.
