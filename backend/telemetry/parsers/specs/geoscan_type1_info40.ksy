meta:
  id: geoscan_type1_info40
  title: GEOSCAN Type-I AX.25 info field (48 bytes, 66-byte frames)
  license: GPL-3.0-or-later
  encoding: UTF-8

# GEOSCAN Type-I beacon for 66-byte frames given as the bare AX.25 info field
# (typically 48 bytes: ID at 0, EPS 1..23, OBC 24..39; no COMMu). Mirrors the
# table previously hand-coded as LAYOUTS[("ax25_info", 66)] in
# parsers/geoscan.py - that table was unreachable in the legacy dispatcher,
# which decoded short 66-frame payloads with the misaligned full-frame table.
# LE.

seq:
  - id: mayak_id_raw
    type: u1
    valid:
      expr: _io.size == 48
  - id: eps_time_unix_s_raw
    type: u4le
  - id: eps_mode_enum_raw
    type: u1
  - id: eps_reserve_22_raw
    type: u1
  - id: eps_current_platform_a_raw
    type: u2le
  - id: eps_current_solar_a_raw
    type: u2le
  - id: v_cell_v_raw
    type: u2le
  - id: v_pack_v_raw
    type: u2le
  - id: eps_reserve_bitfield_31_raw
    type: u2le
  - id: temp_bat1_c_raw
    type: s1
  - id: temp_bat2_c_raw
    type: s1
  - id: eps_reserve_35_raw
    type: u2le
  - id: eps_reserve_bitfield_37_raw
    type: u1
  - id: eps_reserve_38_raw
    type: u2le
  - id: obc_reserve_40_raw
    type: u2le
  - id: obc_activity_raw
    type: u1
  - id: temp_x_p_c_raw
    type: s1
  - id: temp_x_n_c_raw
    type: s1
  - id: temp_y_p_c_raw
    type: s1
  - id: temp_y_n_c_raw
    type: s1
  - id: gnss_sat_count_raw
    type: u1
  - id: obc_reserve_48_enum_raw
    type: u1
  - id: obc_reserve_49_raw
    type: u1
  - id: camera_media_files_count_raw
    type: u1
  - id: obc_reserve_51_enum_raw
    type: u1
  - id: obc_reserve_52_4b_raw
    type: u4le
  - id: trailing_data_raw
    size: 8

instances:
  mayak_id:
    value: mayak_id_raw
  eps_time_unix_s:
    value: eps_time_unix_s_raw
  eps_mode_enum:
    value: eps_mode_enum_raw
  eps_current_platform_a:
    value: eps_current_platform_a_raw * 0.001
  eps_current_solar_a:
    value: eps_current_solar_a_raw * 0.001
  v_cell_v:
    value: v_cell_v_raw * 0.001
  v_pack_v:
    value: v_pack_v_raw * 0.001
  temp_bat1_c:
    value: temp_bat1_c_raw
  temp_bat2_c:
    value: temp_bat2_c_raw
  obc_activity:
    value: obc_activity_raw
  temp_x_p_c:
    value: temp_x_p_c_raw
  temp_x_n_c:
    value: temp_x_n_c_raw
  temp_y_p_c:
    value: temp_y_p_c_raw
  temp_y_n_c:
    value: temp_y_n_c_raw
  gnss_sat_count:
    value: gnss_sat_count_raw
  camera_media_files_count:
    value: camera_media_files_count_raw
