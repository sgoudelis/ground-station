# Ground Station Backend

This package contains the backend services for Ground Station.

For full project documentation, setup, and usage details, see the repository
root README:

https://github.com/sgoudelis/ground-station#readme

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
