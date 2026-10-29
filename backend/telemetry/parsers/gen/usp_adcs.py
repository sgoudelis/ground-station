# This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild
# type: ignore

import kaitaistruct
from kaitaistruct import KaitaiStruct, KaitaiStream, BytesIO


if getattr(kaitaistruct, 'API_VERSION', (0, 9)) < (0, 11):
    raise Exception("Incompatible Kaitai Struct Python API: 0.11 or later is required, but you have %s" % (kaitaistruct.__version__))

class UspAdcs(KaitaiStruct):
    def __init__(self, _io, _parent=None, _root=None):
        super(UspAdcs, self).__init__(_io)
        self._parent = _parent
        self._root = _root or self
        self._read()

    def _read(self):
        self.time_unix_us_raw = self._io.read_s8le()
        self.uptime_raw = self._io.read_u4le()
        self.eci_quaternion_w_raw = self._io.read_f4le()
        self.eci_quaternion_x_raw = self._io.read_f4le()
        self.eci_quaternion_y_raw = self._io.read_f4le()
        self.eci_quaternion_z_raw = self._io.read_f4le()
        self.eci_angular_velocity_x_raw = self._io.read_f4le()
        self.eci_angular_velocity_y_raw = self._io.read_f4le()
        self.eci_angular_velocity_z_raw = self._io.read_f4le()
        self.eci_flags_raw = self._io.read_u1()
        self.orb_quaternion_w_raw = self._io.read_f4le()
        self.orb_quaternion_x_raw = self._io.read_f4le()
        self.orb_quaternion_y_raw = self._io.read_f4le()
        self.orb_quaternion_z_raw = self._io.read_f4le()
        self.orb_angular_velocity_x_raw = self._io.read_f4le()
        self.orb_angular_velocity_y_raw = self._io.read_f4le()
        self.orb_angular_velocity_z_raw = self._io.read_f4le()
        self.orb_flags_raw = self._io.read_u1()
        self.forced_quaternion_w_raw = self._io.read_f4le()
        self.forced_quaternion_x_raw = self._io.read_f4le()
        self.forced_quaternion_y_raw = self._io.read_f4le()
        self.forced_quaternion_z_raw = self._io.read_f4le()
        self.forced_angular_velocity_x_raw = self._io.read_f4le()
        self.forced_angular_velocity_y_raw = self._io.read_f4le()
        self.forced_angular_velocity_z_raw = self._io.read_f4le()
        self.forced_flags_raw = self._io.read_u1()
        self.latitude_raw = self._io.read_f4le()
        self.longitude_raw = self._io.read_f4le()
        self.altitude_raw = self._io.read_f4le()
        self.control_flags_raw = self._io.read_u1()
        self.task_type_raw = self._io.read_u1()
        self.task_count_raw = self._io.read_u1()
        self.wheel_speed_x_plus_raw = self._io.read_s2le()
        self.wheel_speed_x_minus_raw = self._io.read_s2le()
        self.wheel_speed_y_plus_raw = self._io.read_s2le()
        self.wheel_speed_y_minus_raw = self._io.read_s2le()
        self.sensor_flags_raw = self._io.read_bytes(3)


    def _fetch_instances(self):
        pass

    @property
    def altitude(self):
        if hasattr(self, '_m_altitude'):
            return self._m_altitude

        self._m_altitude = self.altitude_raw
        return getattr(self, '_m_altitude', None)

    @property
    def eci_angular_velocity_x(self):
        if hasattr(self, '_m_eci_angular_velocity_x'):
            return self._m_eci_angular_velocity_x

        self._m_eci_angular_velocity_x = self.eci_angular_velocity_x_raw
        return getattr(self, '_m_eci_angular_velocity_x', None)

    @property
    def eci_angular_velocity_y(self):
        if hasattr(self, '_m_eci_angular_velocity_y'):
            return self._m_eci_angular_velocity_y

        self._m_eci_angular_velocity_y = self.eci_angular_velocity_y_raw
        return getattr(self, '_m_eci_angular_velocity_y', None)

    @property
    def eci_angular_velocity_z(self):
        if hasattr(self, '_m_eci_angular_velocity_z'):
            return self._m_eci_angular_velocity_z

        self._m_eci_angular_velocity_z = self.eci_angular_velocity_z_raw
        return getattr(self, '_m_eci_angular_velocity_z', None)

    @property
    def eci_quaternion_w(self):
        if hasattr(self, '_m_eci_quaternion_w'):
            return self._m_eci_quaternion_w

        self._m_eci_quaternion_w = self.eci_quaternion_w_raw
        return getattr(self, '_m_eci_quaternion_w', None)

    @property
    def eci_quaternion_x(self):
        if hasattr(self, '_m_eci_quaternion_x'):
            return self._m_eci_quaternion_x

        self._m_eci_quaternion_x = self.eci_quaternion_x_raw
        return getattr(self, '_m_eci_quaternion_x', None)

    @property
    def eci_quaternion_y(self):
        if hasattr(self, '_m_eci_quaternion_y'):
            return self._m_eci_quaternion_y

        self._m_eci_quaternion_y = self.eci_quaternion_y_raw
        return getattr(self, '_m_eci_quaternion_y', None)

    @property
    def eci_quaternion_z(self):
        if hasattr(self, '_m_eci_quaternion_z'):
            return self._m_eci_quaternion_z

        self._m_eci_quaternion_z = self.eci_quaternion_z_raw
        return getattr(self, '_m_eci_quaternion_z', None)

    @property
    def forced_angular_velocity_x(self):
        if hasattr(self, '_m_forced_angular_velocity_x'):
            return self._m_forced_angular_velocity_x

        self._m_forced_angular_velocity_x = self.forced_angular_velocity_x_raw
        return getattr(self, '_m_forced_angular_velocity_x', None)

    @property
    def forced_angular_velocity_y(self):
        if hasattr(self, '_m_forced_angular_velocity_y'):
            return self._m_forced_angular_velocity_y

        self._m_forced_angular_velocity_y = self.forced_angular_velocity_y_raw
        return getattr(self, '_m_forced_angular_velocity_y', None)

    @property
    def forced_angular_velocity_z(self):
        if hasattr(self, '_m_forced_angular_velocity_z'):
            return self._m_forced_angular_velocity_z

        self._m_forced_angular_velocity_z = self.forced_angular_velocity_z_raw
        return getattr(self, '_m_forced_angular_velocity_z', None)

    @property
    def forced_quaternion_w(self):
        if hasattr(self, '_m_forced_quaternion_w'):
            return self._m_forced_quaternion_w

        self._m_forced_quaternion_w = self.forced_quaternion_w_raw
        return getattr(self, '_m_forced_quaternion_w', None)

    @property
    def forced_quaternion_x(self):
        if hasattr(self, '_m_forced_quaternion_x'):
            return self._m_forced_quaternion_x

        self._m_forced_quaternion_x = self.forced_quaternion_x_raw
        return getattr(self, '_m_forced_quaternion_x', None)

    @property
    def forced_quaternion_y(self):
        if hasattr(self, '_m_forced_quaternion_y'):
            return self._m_forced_quaternion_y

        self._m_forced_quaternion_y = self.forced_quaternion_y_raw
        return getattr(self, '_m_forced_quaternion_y', None)

    @property
    def forced_quaternion_z(self):
        if hasattr(self, '_m_forced_quaternion_z'):
            return self._m_forced_quaternion_z

        self._m_forced_quaternion_z = self.forced_quaternion_z_raw
        return getattr(self, '_m_forced_quaternion_z', None)

    @property
    def latitude(self):
        if hasattr(self, '_m_latitude'):
            return self._m_latitude

        self._m_latitude = self.latitude_raw
        return getattr(self, '_m_latitude', None)

    @property
    def longitude(self):
        if hasattr(self, '_m_longitude'):
            return self._m_longitude

        self._m_longitude = self.longitude_raw
        return getattr(self, '_m_longitude', None)

    @property
    def orb_angular_velocity_x(self):
        if hasattr(self, '_m_orb_angular_velocity_x'):
            return self._m_orb_angular_velocity_x

        self._m_orb_angular_velocity_x = self.orb_angular_velocity_x_raw
        return getattr(self, '_m_orb_angular_velocity_x', None)

    @property
    def orb_angular_velocity_y(self):
        if hasattr(self, '_m_orb_angular_velocity_y'):
            return self._m_orb_angular_velocity_y

        self._m_orb_angular_velocity_y = self.orb_angular_velocity_y_raw
        return getattr(self, '_m_orb_angular_velocity_y', None)

    @property
    def orb_angular_velocity_z(self):
        if hasattr(self, '_m_orb_angular_velocity_z'):
            return self._m_orb_angular_velocity_z

        self._m_orb_angular_velocity_z = self.orb_angular_velocity_z_raw
        return getattr(self, '_m_orb_angular_velocity_z', None)

    @property
    def orb_quaternion_w(self):
        if hasattr(self, '_m_orb_quaternion_w'):
            return self._m_orb_quaternion_w

        self._m_orb_quaternion_w = self.orb_quaternion_w_raw
        return getattr(self, '_m_orb_quaternion_w', None)

    @property
    def orb_quaternion_x(self):
        if hasattr(self, '_m_orb_quaternion_x'):
            return self._m_orb_quaternion_x

        self._m_orb_quaternion_x = self.orb_quaternion_x_raw
        return getattr(self, '_m_orb_quaternion_x', None)

    @property
    def orb_quaternion_y(self):
        if hasattr(self, '_m_orb_quaternion_y'):
            return self._m_orb_quaternion_y

        self._m_orb_quaternion_y = self.orb_quaternion_y_raw
        return getattr(self, '_m_orb_quaternion_y', None)

    @property
    def orb_quaternion_z(self):
        if hasattr(self, '_m_orb_quaternion_z'):
            return self._m_orb_quaternion_z

        self._m_orb_quaternion_z = self.orb_quaternion_z_raw
        return getattr(self, '_m_orb_quaternion_z', None)

    @property
    def task_count(self):
        if hasattr(self, '_m_task_count'):
            return self._m_task_count

        self._m_task_count = self.task_count_raw
        return getattr(self, '_m_task_count', None)

    @property
    def task_type(self):
        if hasattr(self, '_m_task_type'):
            return self._m_task_type

        self._m_task_type = self.task_type_raw
        return getattr(self, '_m_task_type', None)

    @property
    def time_unix_us(self):
        if hasattr(self, '_m_time_unix_us'):
            return self._m_time_unix_us

        self._m_time_unix_us = self.time_unix_us_raw
        return getattr(self, '_m_time_unix_us', None)

    @property
    def uptime(self):
        if hasattr(self, '_m_uptime'):
            return self._m_uptime

        self._m_uptime = self.uptime_raw
        return getattr(self, '_m_uptime', None)

    @property
    def wheel_speed_x_minus(self):
        if hasattr(self, '_m_wheel_speed_x_minus'):
            return self._m_wheel_speed_x_minus

        self._m_wheel_speed_x_minus = self.wheel_speed_x_minus_raw
        return getattr(self, '_m_wheel_speed_x_minus', None)

    @property
    def wheel_speed_x_plus(self):
        if hasattr(self, '_m_wheel_speed_x_plus'):
            return self._m_wheel_speed_x_plus

        self._m_wheel_speed_x_plus = self.wheel_speed_x_plus_raw
        return getattr(self, '_m_wheel_speed_x_plus', None)

    @property
    def wheel_speed_y_minus(self):
        if hasattr(self, '_m_wheel_speed_y_minus'):
            return self._m_wheel_speed_y_minus

        self._m_wheel_speed_y_minus = self.wheel_speed_y_minus_raw
        return getattr(self, '_m_wheel_speed_y_minus', None)

    @property
    def wheel_speed_y_plus(self):
        if hasattr(self, '_m_wheel_speed_y_plus'):
            return self._m_wheel_speed_y_plus

        self._m_wheel_speed_y_plus = self.wheel_speed_y_plus_raw
        return getattr(self, '_m_wheel_speed_y_plus', None)


