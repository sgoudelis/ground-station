meta:
  id: rs52s
  title: RS52S (STRATOSAT-TK 1) beacon payload
  license: GPL-3.0-or-later
  encoding: UTF-8

# AX.25 info field of RS52S GEOSCAN beacons (post-deframe, post-AX.25 header
# removal). Layout matches the community mapping used by the Edelveis decoder
# (same table previously hand-coded in parsers/rs52s.py). Little-endian.
# Scales are chosen so computed instances match published decoders' units.

seq:
  - id: time_unix_s
    type: u4le
  - id: battery_current_raw
    type: u2le
  - id: panel_current_raw
    type: u2le
  - id: v_cell_raw
    type: u2le
  - id: v_pack_raw
    type: u2le
  - id: temp_x_p_c
    type: s1
  - id: temp_x_n_c
    type: s1
  - id: temp_y_p_c
    type: s1
  - id: temp_y_n_c
    type: s1
  - id: reserved_16
    type: u1
  - id: temp_z_n_c
    type: s1
  - id: temp_bat1_c
    type: s1
  - id: temp_bat2_c
    type: s1
  - id: cpu_load_raw
    type: s1
  - id: obc_counter_raw
    type: s2le
  - id: comm_counter_raw
    type: s2le
  - id: rssi_raw
    type: s1

instances:
  battery_current_a:
    value: battery_current_raw * 0.0000766
  panel_current_a:
    value: panel_current_raw * 0.00003076
  v_cell_v:
    value: v_cell_raw * 0.00006928
  v_pack_v:
    value: v_pack_raw * 0.00013856
  cpu_load_pct:
    value: cpu_load_raw * 0.390625
  obc_counter:
    value: obc_counter_raw - 7476
  comm_counter:
    value: comm_counter_raw - 1505
  rssi_dbm:
    value: rssi_raw - 99
