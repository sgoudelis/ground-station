# Ground Station Backend

This package contains the backend services for Ground Station.

For full project documentation, setup, and usage details, see the repository
root README:

https://github.com/sgoudelis/ground-station#readme

## ADS-B decoding

Select **ADS-B** on a manual VFO tuned to **1090 MHz**. The SDR must capture at
least **2.4 MS/s**, with the entire 2 MHz VFO channel inside its bandwidth.
Ground Station translates the VFO to baseband, resamples to 2.4 MS/s, converts
to little-endian signed 16-bit interleaved IQ, and pipes it into
[readsb](https://github.com/wiedehopf/readsb). Retuning or an IQ discontinuity
restarts the child and its accumulated aircraft state. No second SDR is opened.
Scheduled ADS-B observations are intentionally unavailable.

Docker builds readsb at `READSB_COMMIT`. For a native installation, install
the C build toolchain, zlib and zstd development packages, then build the same revision:

```bash
git clone https://github.com/wiedehopf/readsb.git
cd readsb
git checkout 321931802d89f1695a38f6dfb0a64ba5c1211be4
make -j4 DISABLE_INTERACTIVE=yes
```

Install the binary on the backend's PATH or into `backend/venv/bin/`, retaining
its LICENSE with the installation. A missing executable appears as a decoder error.

### Aircraft database

Install the pinned Mictronics aircraft snapshot for native development from `backend/`:

```bash
./venv/bin/python tools/aircraftdb.py
```

The installer verifies SHA-256 checksums, combines the detailed aircraft export with
the type/operator tables, and writes `data/adsb/aircraft.csv.gz`, `metadata.json`,
`LICENSE`, and `NOTICE`. It requires network access only when installing. The data
is ignored by Git. Docker runs the same installer at build time and includes the
snapshot at `/usr/local/share/ground-station/adsb`, outside the persistent data mount.

The decoder automatically selects `GS_ADSB_DB_DIR` (if set), then `backend/data/adsb`,
then the bundled Docker snapshot. An override directory must contain the CSV and
matching metadata files produced by the installer. Unavailable/invalid snapshots
are logged and skipped; decoding continues without database enrichment. Restart
the ADS-B decoder after installing/replacing a snapshot so its lookup tables and
readsb use the same version. Updating the pinned upstream revision requires changing
the installer revision, date, and archive checksums together.

With a database installed, readsb receives `--db-file <path> --db-file-lt`. Live
aircraft, saved states, and Packet Map details include registration, type/model,
military/interesting flags, aircraft class, engine count/type, wake category,
broadcast emitter category, and inferred operator name/country/radio callsign.
Select an aircraft row or its details button to inspect all metadata; additional
table columns can be enabled using the column menu. Owner and manufacture year
appear only if the readsb report actually supplies them; Mictronics does not.
Military markings can also originate from readsb's ICAO address-range rules.
Unclassified does not establish civilian ownership, and aircraft class does not
establish recreational use. Operator matches use the broadcast ICAO callsign prefix
and do not establish ownership. Older saved states recover metadata from their
retained readsb reports without rewriting capture files.

Contains information from the [Mictronics Aircraft Database](https://github.com/Mictronics/aircraft-database),
which is made available under the [ODC Attribution License](https://opendatacommons.org/licenses/by/1-0/).
The converted database remains under ODC-By, separately from the application code.
License/notice files accompany the installed data, and aircraft views display attribution.

Open the **ADS-B** tab in the waterfall's decoded-data panel for live aircraft,
or the Packet Map for positions. These views share a subscription: aircraft
changes are batched once per second, never inserted into the generic packet
history, and unsubscribed when the views close. Live trails retain at most 120
fixes per aircraft, with a 1,000-aircraft live limit and 60-second expiry;
the map bounds ADS-B geometry to 5,000 points. Initial
historical ADS-B map responses are also sampled to at most 5,000 points.

Aircraft history defaults to one state every five seconds per ICAO address,
with squawk/emergency changes and final pending states retained. Zero saves
every new readsb snapshot, rather than every individual radio message.
State files retain normalized SI fields, position timestamps, reception
provenance and the original readsb report. Repeated/stale positions do not
become new historical fixes. ICAO-addressed targets are supported; non-ICAO
addresses are omitted instead of being mixed with real ICAO identities.
Optional raw capture verifies DF17/18 CRC parity independently. These are readsb's
emitted frames, which may include its bit corrections, rather than untouched RF bits.

Captures follow the radiosonde identity/run convention:

```text
data/decoded/adsb_406b90/20261101T120000.000000Z.gsadsb/
  run.json
  track_<receiver-id>.jsonl
  messages_<receiver-id>.jsonl  # optional raw DF17/18 capture
```

Runs cover a fixed 12-hour window from the first record, shared across VFOs and
sessions. Reception reports arriving up to ten seconds before the first record's
timestamp join that run when no earlier window fits. Separate receiver files avoid
competing appenders. The worker flushes
buffered records every second and announces changed aircraft folders every five
seconds. The library reads only appended complete track records, keeping offsets
for paginated/cursor-based inspection. Raw logs are never parsed for library updates.
Existing browser rows update in place where sorting/filtering permits; otherwise
only the visible page is refreshed. Startup, manual and periodic reconciliation
can discover externally copied captures without reparsing unchanged log contents.

## Radiosonde decoding

Select **Radiosonde** on a VFO tuned to the sonde. Start with a 20 kHz channel
bandwidth and the default 48 kS/s processing rate; 96 kS/s is also available.
**Auto** detects RS41, DFM (including DFM-06/09/17), and M10/M20. A family can
also be selected manually in the decoder settings.

Ground Station extracts and resamples the VFO channel from SDR IQ, preserving
mixer, resampler and filter state between chunks. It streams headerless complex
float32 IQ directly to [rs1729/RS](https://github.com/rs1729/RS). Audio
demodulation settings do not affect this decoder.

In Auto mode, `dft_detect` requires two matching detections before Ground Station
launches `rs41mod`, `dfm09mod`, or `m10m20mod`. An eight-second IQ history is
replayed into the selected codec, and a valid telemetry report confirms reception.
After 20 seconds of received IQ without an accepted report it returns to detection;
DFM gets 60 seconds for initial assembly of navigation/configuration data.
Detection operates within the selected VFO; it does not scan the SDR frequency range.
Manual selection keeps the chosen codec active through signal loss.

Docker builds and installs all four tools at the revision pinned by
`RADIOSONDE_RS_COMMIT` in the Dockerfile. Native installation:

```bash
git clone https://github.com/rs1729/RS.git radiosonde-rs
cd radiosonde-rs
git checkout 89b1ea7f3371d99c630f6734c42014d88e667853
make -C demod/mod rs41mod dfm09mod m10m20mod
gcc -O2 scan/dft_detect.c -lm -o scan/dft_detect
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/licenses/radiosonde-rs"
install -m 755 demod/mod/rs41mod demod/mod/dfm09mod demod/mod/m10m20mod scan/dft_detect "$HOME/.local/bin/"
install -m 644 LICENSE "$HOME/.local/share/licenses/radiosonde-rs/LICENSE"
```

The binaries and GNU coreutils `stdbuf` must be on the backend's PATH. Missing
executables appear as decoder errors. Auto requires all four RS tools; manual
selection requires only the chosen codec.

The shared decoder pipeline saves each accepted report as a `.bin` with a `.json`
sidecar and publishes the same telemetry to the live packet viewer:

- RS41 binary files contain error-corrected, dewhitened 320/518-byte frames.
- M10/M20 files contain checksum-validated frames, including length/type and checksum.
- DFM files contain the latest 33-byte encoded radio frame without its sync word,
  in RS's `--rawecc` rawhex representation (four bits per hex nibble, least
  significant bit first). The JSON report assembles navigation and identity from
  multiple frames, so that binary alone does not contain the complete fix.

The saved parse context includes the RS report because navigation and calibrated
weather readings can depend on earlier frames. Reparse reapplies Ground Station's
telemetry adapter to this saved report; it does not rerun RF decoding or recreate
multi-frame calibration. Fields appear as RS obtains them. RS's `ref_datetime`
identifies the time scale (GPS or UTC), and `ref_position` identifies the altitude
reference. Encrypted RS41-SGM navigation placeholders are omitted.

Retuning, changing VFO bandwidth, or dropped IQ restarts the channel and detector
(or forced codec), discarding buffered IQ and accumulated calibration. One external
process runs per VFO, either the detector or the selected decoder.

Run the receive tests from `backend/`:

```bash
ALEMBIC_CONTEXT=1 ./venv/bin/pytest --no-cov tests/testradiosonde.py
```

Synthetic transmissions exercise both Auto and manual selection for all four
models at 48/96 kS/s, including translation from an offset carrier, non-integer
resampling, real RS subprocesses, file output, and clean shutdown. Codec tests
skip when their required tools are absent. No live RF fixture is included.
