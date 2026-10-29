meta:
  id: usp_uhf
  title: SPUTNIX USP UHF radio beacon body (msgid 0x4246)
  license: GPL-3.0-or-later
  encoding: UTF-8

# Body (after the 8-byte USP routing header) of the UHF radio telemetry
# message, 25 bytes. Layout follows SPUTNIX UHF_msgid resources, cross-checked
# against SatsDecoder; previously hand-coded as UHF_FIELDS in parsers/usp.py.
# Seq fields are raw wire values; instances carry engineering units. Labels
# and the schedule-flag bit meanings stay in usp.py (presentation metadata).

seq:
  - id: amplifier_temperature_raw
    type: s1
  - id: radio_temperature_raw
    type: s1
  - id: received_signal_strength_raw
    type: u1
  - id: idle_signal_strength_raw
    type: u1
  - id: forward_power_raw
    type: s1
  - id: reflected_power_raw
    type: s1
  - id: reset_count_raw
    type: u1
  - id: radio_flags_raw
    type: u1
  - id: time_unix_s_raw
    type: s4le
  - id: uptime_raw
    type: u4le
  - id: receive_bitrate_raw
    type: u4le
  - id: current_raw
    type: u2le
  - id: input_voltage_raw
    type: s2le
  - id: schedule_flags_raw
    type: u1

instances:
  amplifier_temperature:
    value: amplifier_temperature_raw
  radio_temperature:
    value: radio_temperature_raw
  # RSSI bytes are transmitted unsigned-positive and displayed as negative dBm.
  received_signal_strength:
    value: received_signal_strength_raw * -1
  idle_signal_strength:
    value: idle_signal_strength_raw * -1
  forward_power:
    value: forward_power_raw
  reflected_power:
    value: reflected_power_raw
  reset_count:
    value: reset_count_raw
  radio_flags:
    value: radio_flags_raw
  time_unix_s:
    value: time_unix_s_raw
  uptime:
    value: uptime_raw
  receive_bitrate:
    value: receive_bitrate_raw
  current:
    value: current_raw
  input_voltage:
    value: input_voltage_raw / 1000.0
