meta:
  id: usp_power
  title: SPUTNIX USP power system telemetry body (msgid 0xDE21)
  license: GPL-3.0-or-later
  encoding: UTF-8

# Body of the PS3 power-system message, 46 bytes. Layout follows SPUTNIX
# PS3_msgid resources; previously hand-coded as POWER_FIELDS in parsers/usp.py.
# The 4-byte status word at offset 30 is exposed raw; its bit meanings are
# expanded by usp.py (labels are presentation metadata).

seq:
  - id: panel_voltage_1_raw
    type: u2le
  - id: panel_voltage_2_raw
    type: u2le
  - id: panel_voltage_3_raw
    type: u2le
  - id: panel_current_1_raw
    type: u2le
  - id: panel_current_2_raw
    type: u2le
  - id: panel_current_3_raw
    type: u2le
  - id: battery_current_raw
    type: s2le
  - id: channel_current_1_raw
    type: u2le
  - id: channel_current_2_raw
    type: u2le
  - id: channel_current_3_raw
    type: u2le
  - id: channel_current_4_raw
    type: u2le
  - id: battery_temperature_1_raw
    type: s2le
  - id: battery_temperature_2_raw
    type: s2le
  - id: battery_temperature_3_raw
    type: s2le
  - id: battery_temperature_4_raw
    type: s2le
  - id: power_flags_raw
    type: u4le
  - id: battery_voltage_raw
    type: s2le
  - id: record_id_raw
    type: u4le
  - id: time_unix_s_raw
    type: s4le
  - id: reset_count_raw
    type: u1
  - id: reset_reason_raw
    type: u1

instances:
  panel_voltage_1:
    value: panel_voltage_1_raw / 1000.0
  panel_voltage_2:
    value: panel_voltage_2_raw / 1000.0
  panel_voltage_3:
    value: panel_voltage_3_raw / 1000.0
  panel_current_1:
    value: panel_current_1_raw
  panel_current_2:
    value: panel_current_2_raw
  panel_current_3:
    value: panel_current_3_raw
  battery_current:
    value: battery_current_raw
  channel_current_1:
    value: channel_current_1_raw
  channel_current_2:
    value: channel_current_2_raw
  channel_current_3:
    value: channel_current_3_raw
  channel_current_4:
    value: channel_current_4_raw
  battery_temperature_1:
    value: battery_temperature_1_raw / 100.0
  battery_temperature_2:
    value: battery_temperature_2_raw / 100.0
  battery_temperature_3:
    value: battery_temperature_3_raw / 100.0
  battery_temperature_4:
    value: battery_temperature_4_raw / 100.0
  battery_voltage:
    value: battery_voltage_raw / 1000.0
  record_id:
    value: record_id_raw
  time_unix_s:
    value: time_unix_s_raw
  reset_count:
    value: reset_count_raw
  reset_reason:
    value: reset_reason_raw
