meta:
  id: geoscan_type1_full66
  title: GEOSCAN Type-I full 66-byte frame (64-byte payload, truncated OBC)
  license: GPL-3.0-or-later
  encoding: UTF-8

# GEOSCAN Type-I beacon for 66-byte frames, full-frame view (64-byte payload
# starting with AX.25 addresses; OBC block truncated at camera_media_files).
# Mirrors the table previously hand-coded as LAYOUTS[66] in
# parsers/geoscan.py, which skips bytes 35..39 of the EPS block; that gap is
# kept as an explicit raw skip so later fields stay aligned. LE.

seq:
  - id: ax25_addresses_raw
    size: 14
    valid:
      expr: _io.size == 64
  - id: ax25_control_raw
    type: u1
  - id: ax25_pid_raw
    type: u1
  - id: mayak_id_raw
    type: u1
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
  - id: eps_gap_35_39_raw
    size: 5
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
  # Preserve the unmodeled remainder instead of accepting a shortened frame.
  - id: trailing_data_raw
    size: 13

instances:
  ax25_control:
    value: ax25_control_raw
  ax25_pid:
    value: ax25_pid_raw
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
