# UMKA-1 telemetry

UMKA-1 (NORAD 57172, AX.25 source `RS40S-1`) sends SPUTNIX USP messages.
The existing USP deframer handles radio framing and FEC. `BaseDecoder` removes
the recorder's enclosing `0x7e` bytes and calls `TelemetryParser` with the AX.25
protocol hint. The AX.25 information field is then passed to `USPParser`,
registered under the base callsign `RS40S`.

Each information field can contain multiple messages. Each message starts with
four little-endian unsigned 16-bit fields: message ID, source device, destination
device, and body length. Unknown messages are skipped using that length so they
cannot hide a later supported message. Known messages require the exact documented
length. Truncated messages do not produce engineering values.

| Message | Body length | Decoded data |
| --- | ---: | --- |
| `0x4246` | 25 | UHF temperatures, RSSI, RF power, current, voltage, clock, uptime and schedule flags |
| `0xDE21` | 46 | Solar input voltages/currents, battery current/voltage, four battery temperatures, output currents, heater/channel flags and reset data |
| `0xF210` | 125 | Attitude solutions/angular velocities, position, wheel speeds, clock, uptime, task and validity data |

Voltages are converted from millivolts to volts; battery temperatures are signed
16-bit hundredths of a degree Celsius. Radio temperatures are signed 8-bit degrees
Celsius, currents are milliamps, and battery current is signed. RSSI is the negative
of the transmitted unsigned byte. The official PS3 resource declares battery
voltage signed, which is retained here. ADCS time is microseconds since the Unix
epoch. Invalid attitude/wheel readings and nonfinite floats are shown as unavailable,
with the transmitted values retained in `raw_fields`.

Subsystem timestamps are decoded literally. For example, the October 23 night
capture's radio clock reads 2026-10-23, while its power-system clock reads
2018-02-27. The reception time remains separately available in the Overview tab;
it must not be substituted for the satellite's subsystem clock.

## Dialog data flow

`BaseDecoder` saves the complete parser result in the `.bin` file's JSON metadata file
under `metadata.telemetry`. The file browser, observation dialog and live packet
drawer fetch that metadata and pass it to `TelemetryViewerDialog`.
`TelemetryValuesTab` reads `metadata.telemetry.telemetry.messages` for USP packets,
grouping engineering values by message with labels and units from `field_info`.
Other satellites continue to use the existing `values` / `raw_fields` representation.
File-transfer, terminal and acknowledgement messages are identified without
interpreting their bytes as temperatures or voltages. Unsupported message bodies
remain available in the Hex + ASCII tab.

Previously recorded JSON metadata contains the result from the parser available at
capture time. It must be regenerated to use a new parser; adding the parser does
not silently rewrite historical files. Only the `telemetry` key needs replacement,
using the original binary, `decoder_config.payload_protocol`, and framing hints.
Keep the original metadata before doing this. The three locally imported October
21/23 observations were refreshed this way during development.

## References and validation

- [SPUTNIX radio-amateur documentation](https://sputnix.ru/en/satellites-sputnix/for-radioamateurs)
- [Official English telemetry resources](https://sputnix.ru/tpl/docs/amateurs/resources-en.zip):
  `devices/UHF_msgid.xml`, `devices/PS3_msgid.xml`, `devices/OBCU_msgid.xml`
- [SatsDecoder USP layouts](https://github.com/baskiton/SatsDecoder/blob/master/SatsDecoder/systems/usp.py)
  by Alexander Baskikh (MIT), used to cross-check offsets, signedness and scaling.
- USP protocol description v1.05 (2026-05-05), linked from SPUTNIX's page, confirms
  that USP AX.25 encapsulation has no AX.25 FCS. No final payload bytes are discarded.

`backend/tests/fixtures/umka.json` contains three actual captured frames with their
source filenames. Tests cover combined day/night beacons, negative current and
temperature, flags, ADCS validity, unsupported messages, malformed lengths, and
JSON-safe output. The imported corpus contains 325 files: 29 combined radio/power
beacons, one ADCS beacon, 174 other valid AX.25/USP packets, and 121 packets that
fail AX.25 validation. These last packets are preserved without invented telemetry.
