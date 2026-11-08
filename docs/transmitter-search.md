# Transmitter catalog search

The authenticated Socket.IO `api.call` command `get-transmitter-search` searches
the entire local transmitter catalog. It is a read operation available to both
operators and administrators through the normal command dispatcher.

```js
socket.emit('api.call', {
    cmd: 'get-transmitter-search',
    data: { keyword: 'ISS APRS', page: 0, page_size: 20 },
}, response => { /* response.data contains this page */ });
```

`keyword` is a trimmed string of 2–100 characters. `page` is a zero-based integer
(default 0, maximum 10000). `page_size` is an integer from 1 to 50 (default 20).
Unknown fields and invalid types, including booleans for integers, are rejected
before opening a database session.

Text searches are case-insensitive. Every whitespace-separated word must match
at least one of: owner name/aliases, NORAD ID, target key, transmitter description,
transmitter ID/external ID, mode, or service. SQL wildcard characters are literal.
Exact owner names, descriptions and IDs rank first, then prefixes, then other
matches. Owner name, description, and unique transmitter ID give stable ordering
within each rank. No owner, source, status, or downlink-availability filter is
implicitly applied.

Numeric searches accept `Hz`, `kHz`, `MHz`, or `GHz` (case-insensitive). Without a
unit, values below 1,000,000 mean MHz; larger values mean Hz. Typed precision
defines a half-open frequency interval: `145.8` searches 145.800–145.899999 MHz;
`145825000 Hz` searches exactly that Hz. A transmitter matches when its downlink
point or passband overlaps this interval. A missing low/high endpoint uses the
other endpoint. Numeric input also participates in the text search, allowing
NORAD IDs and numeric descriptions to match.

Successful replies use the standard envelope with pagination metadata:

```json
{
  "success": true,
  "data": [{
    "id": "example-id", "description": "APRS", "owner_name": "ISS",
    "owner_type": "satellite", "norad_cat_id": 25544, "target_key": null,
    "downlink_low": 145825000, "downlink_high": null,
    "mode": "FM", "baud": 1200, "deviation": null, "framing": null,
    "lora_config": null, "status": "active", "alive": true,
    "source": "manual"
  }],
  "total": 1, "page": 0, "page_size": 20, "has_more": false, "error": null
}
```

`owner_type` is `satellite`, `mission`, or `body`. Frequencies are integer Hz.
An empty or out-of-range page succeeds with an empty `data` array and the matching
`total`. Catalog changes between page requests can shift rows; clients should
de-duplicate by transmitter ID. Search uses parameterized SQL, two outer joins,
one count query, and one bounded page query. It does not load complete satellite
records, orbital data, or per-owner transmitter lists.

Invalid requests return `success: false`, `data: []`, an `error`, and
`validation_errors` containing field names and messages. Database failures log
server details and return a generic error. Authentication errors use the normal
dispatcher envelope.

The continuous-observation helper debounces input, fetches subsequent pages on
scroll, and discards stale or timed-out replies. Rows without a positive downlink
are visible but cannot fill a VFO. Selecting a row copies its low downlink
frequency (or high endpoint if low is unavailable). Recognized modes also prefill
the decoder, its starting receiver bandwidth, and supported catalog parameters:
baud rate, deviation, framing, DBPSK differential mode, and explicit LoRa settings.
APRS detection requires an explicit APRS mode or an APRS description with FM/AFSK
and a supported Bell 202 rate. Generic FM or AFSK does not imply APRS. Unknown modes
preserve the existing decoder and settings. Missing metadata preserves existing
parameters for the same decoder; switching decoder types initializes their defaults.
Unsupported framing/LoRa values are ignored. Valid packet rates and deviations
outside the usual dropdown choices are shown as additional selectable values.
`downlink_high - downlink_low` is not treated as signal bandwidth.

No transmitter identity is saved, and all values remain manually editable.
The receiver center changes only if Auto center from VFOs is enabled.
