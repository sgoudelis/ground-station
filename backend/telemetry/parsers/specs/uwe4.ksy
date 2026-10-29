meta:
  id: uwe4
  title: UWE-4 (DP0UWH) beacon info field
  license: GPL-3.0-or-later
  encoding: UTF-8

# UWE-4 beacon as delivered by TelemetryParser: the AX.25 info field (after
# addresses/control/PID), 58 bytes for the housekeeping packet. Structure
# follows the SatNOGS decoders' uwe4.ksy (satnogs-decoders repo); that spec
# parses the whole AX.25 frame, so its frame/header portion is dropped here.
# Wire values are *_raw; instances carry engineering units. The Fletcher CRC
# over header+payload is NOT validated (the deframer's AX.25 FCS already
# gates the frame and SatNOGS does not check it either). Unknown API values
# and inconsistent body lengths fail validation and fall back to hex.

seq:
  # --- beacon header (10 bytes) ---
  - id: flags1_raw
    type: u1
  - id: flags2_raw
    type: u1
  - id: packet_id_raw
    type: u2le
  - id: fm_system_id_raw
    type: u1
  - id: fm_subsystem_id_raw
    type: u1
  - id: to_system_id_raw
    type: u1
  - id: to_subsystem_id_raw
    type: u1
  - id: api_raw
    type: u1
    valid:
      any-of: [14, 103]
  - id: payload_size_raw
    type: u1
    # The declared size excludes the ten-byte header and two-byte checksum.
    valid:
      expr: _io.size == _ + 12 and ((api_raw == 14 and _ == 46) or (api_raw == 103 and _ >= 6))
  # --- payload selected by mission-API id: 14 = housekeeping, 103 = RF text ---
  - id: payload
    size: payload_size_raw
    type:
      switch-on: api_raw
      cases:
        14: hskp_payload
        103: rf_message
  - id: crc_raw
    type: u2le
    doc: 'Fletcher CRC of header+payload (not validated)'

instances:
  packet_id:
    value: packet_id_raw
  api:
    value: api_raw
  payload_size:
    value: payload_size_raw

types:
  hskp_payload:
    seq:
      - id: command_raw
        type: u1
      - id: var_id_raw
        type: u2le
      - id: typeandlength_raw
        type: u2le
        doc: 'to be ignored (SatNOGS note)'
      - id: timestamp_raw
        type: u1
        repeat: expr
        repeat-expr: 6
        doc: '48-bit little-endian unix timestamp'
      - id: beacon_rate_raw
        type: u4le
        doc: 's = raw / 1024'
      - id: vals_out_of_range_raw
        type: u2le
      - id: uptime_raw
        type: u4le
        doc: 'seconds'
      - id: subsystem_status_raw
        type: u2le
        doc: 'subsystem status bitmap'
      - id: batt_a_temp_raw
        type: s1
      - id: batt_a_soc_raw
        type: s1
      - id: batt_b_temp_raw
        type: s1
      - id: batt_b_soc_raw
        type: s1
      - id: batt_a_current_raw
        type: s2le
        doc: 'mA'
      - id: batt_a_voltage_raw
        type: s2le
        doc: 'mV'
      - id: batt_b_current_raw
        type: s2le
        doc: 'mA'
      - id: batt_b_voltage_raw
        type: s2le
        doc: 'mV'
      - id: power_consumption_raw
        type: s2le
        doc: 'mW'
      - id: obc_temp_raw
        type: s1
      - id: panel_pos_x_temp_raw
        type: s1
      - id: panel_neg_x_temp_raw
        type: s1
      - id: panel_pos_y_temp_raw
        type: s1
      - id: panel_neg_y_temp_raw
        type: s1
      - id: panel_pos_z_temp_raw
        type: s1
      - id: panel_neg_z_temp_raw
        type: s1
      - id: freq_raw
        type: u2le
        doc: 'kHz offset above 400000 kHz'
    instances:
      # The 6 timestamp bytes are left raw: SatNOGS documents them as a 48-bit
      # unix timestamp but live DP0UWH beacons decode them to year ~8.9M (they
      # advance like an uptime counter), so no datetime promotion is done.
      uptime_s:
        value: uptime_raw
      beacon_rate_s:
        value: beacon_rate_raw / 1024.0
      batt_a_temp_c:
        value: batt_a_temp_raw
      batt_a_soc_pct:
        value: batt_a_soc_raw
      batt_b_temp_c:
        value: batt_b_temp_raw
      batt_b_soc_pct:
        value: batt_b_soc_raw
      batt_a_current_ma:
        value: batt_a_current_raw
      batt_a_voltage_v:
        value: batt_a_voltage_raw * 0.001
      batt_b_current_ma:
        value: batt_b_current_raw
      batt_b_voltage_v:
        value: batt_b_voltage_raw * 0.001
      power_consumption_mw:
        value: power_consumption_raw
      obc_temp_c:
        value: obc_temp_raw
      panel_pos_x_temp_c:
        value: panel_pos_x_temp_raw
      panel_neg_x_temp_c:
        value: panel_neg_x_temp_raw
      panel_pos_y_temp_c:
        value: panel_pos_y_temp_raw
      panel_neg_y_temp_c:
        value: panel_neg_y_temp_raw
      panel_pos_z_temp_c:
        value: panel_pos_z_temp_raw
      panel_neg_z_temp_c:
        value: panel_neg_z_temp_raw
      freq_khz:
        value: freq_raw + 400000
  rf_message:
    seq:
      - id: message_prefix_raw
        size: 6
      - id: message
        type: str
        encoding: UTF-8
        size: _parent.payload_size_raw - 6
