meta:
  id: geoscan_type1_74
  title: GEOSCAN Type-I full 74-byte frame (72-byte payload, AX.25 addresses inlined)
  license: GPL-3.0-or-later
  encoding: UTF-8

# GEOSCAN (Geoscan 3U) Type-I beacon, full-frame view: the deframer delivers
# the 74-byte frame minus its 2-byte CRC, so 72 bytes starting with the AX.25
# address fields. Layout mirrors the table previously hand-coded as
# LAYOUTS[74] in parsers/geoscan.py (Геоскан 3U Type-I PDF tables). LE.
# Wire values are *_raw; computed instances carry engineering units (mA/mV
# scaled by 0.001). Reserve fields stay raw-only (no values entry) - a
# deliberate cleanup versus the legacy parser.

seq:
  - id: ax25_addresses_raw
    size: 14
    valid:
      expr: _io.size == 72
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
  - id: commu_reserve_56_enum_raw
    type: u1
  - id: vbus_v_raw
    type: u2le
  - id: commu_reserve_59_raw
    type: u2le
  - id: rssi_last_dbm_raw
    type: s1
  - id: rssi_min_dbm_raw
    type: s1
  - id: commu_reserve_63_raw
    type: u1
  - id: commu_reserve_64_raw
    type: u1
  - id: tx_packets_count_raw
    type: u1
  - id: commu_reserve_66_raw
    type: u1
  - id: commu_reserve_67_enum_raw
    type: u1
  - id: commu_reserve_68_signed_raw
    type: s1
  - id: qso_received_count_raw
    type: u1
  - id: commu_reserve_70_raw
    type: u2le

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
  # Activity byte: raw keeps the bitfield; consumers wanting flags can
  # bit-test obc_activity.
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
  vbus_v:
    value: vbus_v_raw * 0.001
  rssi_last_dbm:
    value: rssi_last_dbm_raw
  rssi_min_dbm:
    value: rssi_min_dbm_raw
  tx_packets_count:
    value: tx_packets_count_raw
  qso_received_count:
    value: qso_received_count_raw
