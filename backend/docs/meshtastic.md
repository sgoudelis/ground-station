# Meshtastic packets

The LoRa telemetry parser recognizes Meshtastic radio packets and decodes
unencrypted payloads or payloads encrypted with the public default channel key
(`1PG7OiApB1nwvP+rz05pAQ==`). No key configuration is required.

Supported applications:

- Position: latitude, longitude, altitude, ground speed/course, GPS quality and
  satellite count. Coordinates retain the precision transmitted by the sender.
- Node information: node ID, long/short name, hardware and role codes.
- Text messages, detection alerts and range-test messages (UTF-8).
- Device, environment, power and air-quality telemetry, with units and field
  presence preserved (an absent measurement is different from zero).

Battery values above 100 indicate external power. These display as a power
source rather than an impossible percentage; the original code is retained in
raw fields.

The packet viewer shows these fields under **Meshtastic** and maps decoded
positions. Saved positions also appear in the packet map with a Meshtastic
filter and node labels. The decoded packet table's **From** column uses a node's
long name, short name, or sender address, depending on what the packet carries;
encrypted packets can still show their sender address. Use **Reparse** on older captures to update their saved interpretation
and position index; opening a preview does not rewrite files.

Other applications and telemetry variants retain their application bytes for
inspection. Channel keys other than the public default key, including private
direct-message encryption, are not supported. For these packets the decoder's
Meshtastic sync word (`0x2B`, entered as the logical byte) identifies the radio
header: source/destination, packet ID, channel hash and relay/hop flags remain
available. A channel hash is not a channel name or decryption key. Without that
sync-word hint, unrecognized LoRa data remains opaque. Satellite-specific LoRa
parsers take precedence.

Every result retains the original packet and ciphertext. Meshtastic AES-CTR is
unauthenticated: a plausible protobuf envelope is an identification heuristic,
not an integrity or identity guarantee. Radio CRC checking still belongs to the
LoRa decoder. Arbitrary truncated/corrupted encrypted bytes cannot reliably be
distinguished from a packet using a different key.

## Wire definitions

`telemetry/parsers/specs/meshtastic.proto` is a wire-compatible subset of the
[Meshtastic protobufs](https://github.com/meshtastic/protobufs/tree/master/meshtastic)
(GPL-3.0). Field numbers/types and optional presence follow upstream. Hardware,
role and port enumerations are stored as numbers to avoid importing unrelated
device configuration schemas. Unknown fields remain in the recorded bytes.

The AES nonce follows firmware `CryptoEngine.cpp`: little-endian 64-bit packet
ID, 32-bit sender, then a 32-bit zero counter. Ground track follows firmware
`GPS.cpp` (degrees multiplied by 100,000), whose implementation differs from the
older scale still mentioned in `mesh.proto`; ground speed is km/h.

To regenerate the checked-in Python module, use `protoc` 3.21.12 and run from
`backend/`:

```bash
meshtastic_build=$(mktemp -d)
protoc --proto_path=telemetry/parsers/specs --python_out="$meshtastic_build" meshtastic.proto
./venv/bin/python - "$meshtastic_build/meshtastic_pb2.py" <<'PY'
import sys
from pathlib import Path

source = Path(sys.argv[1]).read_text()
source = source.replace("'meshtastic_pb2'", "'telemetry.parsers.gen.meshtastic'")
notice = "# Copyright (c) Meshtastic contributors; GPL-3.0-only.\n"
Path("telemetry/parsers/gen/meshtastic.py").write_text(notice + source)
PY
rm -r "$meshtastic_build"
```

Only the protobuf runtime is required in production. The full Meshtastic Python
client and a compiler are not runtime dependencies.
