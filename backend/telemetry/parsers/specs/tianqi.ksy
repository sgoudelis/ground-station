meta:
  id: tianqi
  title: Tianqi (FHRSS) LoRa ground-beacon frame
  license: GPL-3.0-or-later
  encoding: UTF-8

# Tianqi fleet LoRa beacon received on the lora demodulator path (100-byte
# frame). Offsets recovered by correlating TinyGS raw+parsed pairs
# (api.tinygs.com /v3/packets) with 62 rfbox5 captures whose packet receive
# clocks are independent ground truth:
#  - netId 0xEB, msgTypeId byte, then a u32 BIG-endian beacon clock at @3;
#    beacon_time + 2018-01-01 epoch matched every capture timestamp within 2s.
#  - byte @7 is the fleet satellite number (39 in TinyGS's own Tianqi-39
#    decode, "satId"); byte @8 co-varies perfectly with it (TinyGS "unkF8").
#  - bytes 9..99 are zero in every packet seen (TinyGS's guessed orbit and
#    telemetry sub-fields decode to zeros too), so the tail stays one raw
#    blob instead of invented field offsets.
# Known msgTypeId values: F0-F5 and FA-FC in our captures, F6 on TinyGS.

seq:
  - id: net_id_raw
    type: u1
    # Only the captured 100-byte beacon layout is supported. Unknown tail
    # contents are preserved, but missing or extra bytes invalidate the frame.
    valid:
      expr: _ == 235 and _io.size == 100
  - id: frame
    type: body

instances:
  net_id:
    value: net_id_raw

types:
  body:
    seq:
      - id: msg_type_id_raw
        type: u1
      - id: head_unk_raw
        type: u1
        doc: 'varies per packet, meaning unknown (TinyGS headUnk)'
      - id: timestamp_raw
        type: u4be
        doc: 'seconds since 2018-01-01 UTC (verified vs capture clocks)'
      - id: sat_id_raw
        type: u1
        doc: 'fleet satellite number: 18, 29, 39 observed'
      - id: status_unk_raw
        type: u1
        doc: 'co-varies with sat_id (TinyGS unkF8); meaning unknown'
      - id: payload_data_raw
        size: 91
        doc: 'zero-filled in every observed packet'
    instances:
      msg_type_id:
        value: msg_type_id_raw
      sat_id:
        value: sat_id_raw
      # Promote to time_unix_s so the adapter emits time_utc as well.
      time_unix_s:
        value: timestamp_raw + 1514764800
