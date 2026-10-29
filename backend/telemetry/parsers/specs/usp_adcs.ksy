meta:
  id: usp_adcs
  title: SPUTNIX USP attitude-control telemetry body (msgid 0xF210)
  license: GPL-3.0-or-later
  encoding: UTF-8

# Body of the OBCU attitude-control message, 125 bytes. Layout follows
# SPUTNIX OBCU_msgid resources; previously hand-coded as ADCS_FIELDS in
# parsers/usp.py. Each attitude solution is 7 floats (quaternion wxyz then
# angular velocity xyz) followed by a validity/policy byte at 40/69/98.
# Policy bits, invalid-solution suppression and wheel fault masking are
# semantics handled by usp.py; this spec is pure layout.

seq:
  - id: time_unix_us_raw
    type: s8le
  - id: uptime_raw
    type: u4le
  - id: eci_quaternion_w_raw
    type: f4le
  - id: eci_quaternion_x_raw
    type: f4le
  - id: eci_quaternion_y_raw
    type: f4le
  - id: eci_quaternion_z_raw
    type: f4le
  - id: eci_angular_velocity_x_raw
    type: f4le
  - id: eci_angular_velocity_y_raw
    type: f4le
  - id: eci_angular_velocity_z_raw
    type: f4le
  - id: eci_flags_raw
    type: u1
  - id: orb_quaternion_w_raw
    type: f4le
  - id: orb_quaternion_x_raw
    type: f4le
  - id: orb_quaternion_y_raw
    type: f4le
  - id: orb_quaternion_z_raw
    type: f4le
  - id: orb_angular_velocity_x_raw
    type: f4le
  - id: orb_angular_velocity_y_raw
    type: f4le
  - id: orb_angular_velocity_z_raw
    type: f4le
  - id: orb_flags_raw
    type: u1
  - id: forced_quaternion_w_raw
    type: f4le
  - id: forced_quaternion_x_raw
    type: f4le
  - id: forced_quaternion_y_raw
    type: f4le
  - id: forced_quaternion_z_raw
    type: f4le
  - id: forced_angular_velocity_x_raw
    type: f4le
  - id: forced_angular_velocity_y_raw
    type: f4le
  - id: forced_angular_velocity_z_raw
    type: f4le
  - id: forced_flags_raw
    type: u1
  - id: latitude_raw
    type: f4le
  - id: longitude_raw
    type: f4le
  - id: altitude_raw
    type: f4le
  - id: control_flags_raw
    type: u1
  - id: task_type_raw
    type: u1
  - id: task_count_raw
    type: u1
  - id: wheel_speed_x_plus_raw
    type: s2le
  - id: wheel_speed_x_minus_raw
    type: s2le
  - id: wheel_speed_y_plus_raw
    type: s2le
  - id: wheel_speed_y_minus_raw
    type: s2le
  - id: sensor_flags_raw
    size: 3

instances:
  time_unix_us:
    value: time_unix_us_raw
  uptime:
    value: uptime_raw
  eci_quaternion_w:
    value: eci_quaternion_w_raw
  eci_quaternion_x:
    value: eci_quaternion_x_raw
  eci_quaternion_y:
    value: eci_quaternion_y_raw
  eci_quaternion_z:
    value: eci_quaternion_z_raw
  eci_angular_velocity_x:
    value: eci_angular_velocity_x_raw
  eci_angular_velocity_y:
    value: eci_angular_velocity_y_raw
  eci_angular_velocity_z:
    value: eci_angular_velocity_z_raw
  orb_quaternion_w:
    value: orb_quaternion_w_raw
  orb_quaternion_x:
    value: orb_quaternion_x_raw
  orb_quaternion_y:
    value: orb_quaternion_y_raw
  orb_quaternion_z:
    value: orb_quaternion_z_raw
  orb_angular_velocity_x:
    value: orb_angular_velocity_x_raw
  orb_angular_velocity_y:
    value: orb_angular_velocity_y_raw
  orb_angular_velocity_z:
    value: orb_angular_velocity_z_raw
  forced_quaternion_w:
    value: forced_quaternion_w_raw
  forced_quaternion_x:
    value: forced_quaternion_x_raw
  forced_quaternion_y:
    value: forced_quaternion_y_raw
  forced_quaternion_z:
    value: forced_quaternion_z_raw
  forced_angular_velocity_x:
    value: forced_angular_velocity_x_raw
  forced_angular_velocity_y:
    value: forced_angular_velocity_y_raw
  forced_angular_velocity_z:
    value: forced_angular_velocity_z_raw
  latitude:
    value: latitude_raw
  longitude:
    value: longitude_raw
  altitude:
    value: altitude_raw
  task_type:
    value: task_type_raw
  task_count:
    value: task_count_raw
  wheel_speed_x_plus:
    value: wheel_speed_x_plus_raw
  wheel_speed_x_minus:
    value: wheel_speed_x_minus_raw
  wheel_speed_y_plus:
    value: wheel_speed_y_plus_raw
  wheel_speed_y_minus:
    value: wheel_speed_y_minus_raw
