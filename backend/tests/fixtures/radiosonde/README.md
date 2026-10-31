`rs41.hex` is a synthetic, dewhitened RS41 frame with serial TEST0042,
frame counter 42, GPS week 2400, and an equatorial WGS84 altitude of 1000 m.
Its status, PTU, GPS and padding blocks have CRC-16/CCITT checksums. The two
interleaved shortened RS(255,231) codewords were encoded with rs1729/RS's
`rs_encode` at revision 89b1ea7f3371d99c630f6734c42014d88e667853. It contains
no sensor calibration and does not represent a real flight.

`m10.hex` and `m20.hex` are synthetic, checksum-valid frames with GPS week
2400, time-of-week 172800 s, latitude/longitude 0, and altitude 1000 m. Serial
bytes are `0100234506` (M10-203-1-01605) and `552310` (M20-702-7-01032).
The checksum is the upstream `checkM10` recurrence; M20 also has a valid
essential-block checksum. Sensor fields are zero and are not calibrated.

`dfm.hex` contains 24 synthetic DFM-09 frames in RS's `--rawecc` / `--rawhex`
format. The 7/13/13-nibble configuration and data blocks were encoded with
DFM's systematic (8,4) Hamming generator and interleaved by bit plane.
Configuration channel A alternates the two halfwords of serial 23000042.
Each three-frame cycle carries data IDs (0,1), (2,3), (4,8): position mode 2,
frame counter, UTC seconds, latitude/longitude 0, altitude 1000 m, and date
2026-01-06. Eight cycles advance seconds and frame count together; nine GPS
satellites are reported. No sensor calibration is included.

`testradiosonde.py` modulates these fixtures (RS41 whitening/GFSK, DFM
Manchester, M10/M20 differential Manchester), shifts them away from the SDR
center, and streams irregular chunks through the worker and actual RS tools.
Both forced and automatic decoding are checked at 48/96 kS/s, including clean
subprocess shutdown. Tests also feed native rawhex through DFM/M10/M20 codecs
and check live/file/reparse consistency. Real codec tests skip if their required
executables are absent; the other tests need no native tools.
