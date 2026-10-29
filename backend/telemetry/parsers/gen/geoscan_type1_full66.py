# This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild
# type: ignore

import kaitaistruct
from kaitaistruct import KaitaiStruct, KaitaiStream, BytesIO


if getattr(kaitaistruct, 'API_VERSION', (0, 9)) < (0, 11):
    raise Exception("Incompatible Kaitai Struct Python API: 0.11 or later is required, but you have %s" % (kaitaistruct.__version__))

class GeoscanType1Full66(KaitaiStruct):
    def __init__(self, _io, _parent=None, _root=None):
        super(GeoscanType1Full66, self).__init__(_io)
        self._parent = _parent
        self._root = _root or self
        self._read()

    def _read(self):
        self.ax25_addresses_raw = self._io.read_bytes(14)
        _ = self.ax25_addresses_raw
        if not self._io.size() == 64:
            raise kaitaistruct.ValidationExprError(self.ax25_addresses_raw, self._io, u"/seq/0")
        self.ax25_control_raw = self._io.read_u1()
        self.ax25_pid_raw = self._io.read_u1()
        self.mayak_id_raw = self._io.read_u1()
        self.eps_time_unix_s_raw = self._io.read_u4le()
        self.eps_mode_enum_raw = self._io.read_u1()
        self.eps_reserve_22_raw = self._io.read_u1()
        self.eps_current_platform_a_raw = self._io.read_u2le()
        self.eps_current_solar_a_raw = self._io.read_u2le()
        self.v_cell_v_raw = self._io.read_u2le()
        self.v_pack_v_raw = self._io.read_u2le()
        self.eps_reserve_bitfield_31_raw = self._io.read_u2le()
        self.temp_bat1_c_raw = self._io.read_s1()
        self.temp_bat2_c_raw = self._io.read_s1()
        self.eps_gap_35_39_raw = self._io.read_bytes(5)
        self.obc_reserve_40_raw = self._io.read_u2le()
        self.obc_activity_raw = self._io.read_u1()
        self.temp_x_p_c_raw = self._io.read_s1()
        self.temp_x_n_c_raw = self._io.read_s1()
        self.temp_y_p_c_raw = self._io.read_s1()
        self.temp_y_n_c_raw = self._io.read_s1()
        self.gnss_sat_count_raw = self._io.read_u1()
        self.obc_reserve_48_enum_raw = self._io.read_u1()
        self.obc_reserve_49_raw = self._io.read_u1()
        self.camera_media_files_count_raw = self._io.read_u1()
        self.trailing_data_raw = self._io.read_bytes(13)


    def _fetch_instances(self):
        pass

    @property
    def ax25_control(self):
        if hasattr(self, '_m_ax25_control'):
            return self._m_ax25_control

        self._m_ax25_control = self.ax25_control_raw
        return getattr(self, '_m_ax25_control', None)

    @property
    def ax25_pid(self):
        if hasattr(self, '_m_ax25_pid'):
            return self._m_ax25_pid

        self._m_ax25_pid = self.ax25_pid_raw
        return getattr(self, '_m_ax25_pid', None)

    @property
    def camera_media_files_count(self):
        if hasattr(self, '_m_camera_media_files_count'):
            return self._m_camera_media_files_count

        self._m_camera_media_files_count = self.camera_media_files_count_raw
        return getattr(self, '_m_camera_media_files_count', None)

    @property
    def eps_current_platform_a(self):
        if hasattr(self, '_m_eps_current_platform_a'):
            return self._m_eps_current_platform_a

        self._m_eps_current_platform_a = self.eps_current_platform_a_raw * 0.001
        return getattr(self, '_m_eps_current_platform_a', None)

    @property
    def eps_current_solar_a(self):
        if hasattr(self, '_m_eps_current_solar_a'):
            return self._m_eps_current_solar_a

        self._m_eps_current_solar_a = self.eps_current_solar_a_raw * 0.001
        return getattr(self, '_m_eps_current_solar_a', None)

    @property
    def eps_mode_enum(self):
        if hasattr(self, '_m_eps_mode_enum'):
            return self._m_eps_mode_enum

        self._m_eps_mode_enum = self.eps_mode_enum_raw
        return getattr(self, '_m_eps_mode_enum', None)

    @property
    def eps_time_unix_s(self):
        if hasattr(self, '_m_eps_time_unix_s'):
            return self._m_eps_time_unix_s

        self._m_eps_time_unix_s = self.eps_time_unix_s_raw
        return getattr(self, '_m_eps_time_unix_s', None)

    @property
    def gnss_sat_count(self):
        if hasattr(self, '_m_gnss_sat_count'):
            return self._m_gnss_sat_count

        self._m_gnss_sat_count = self.gnss_sat_count_raw
        return getattr(self, '_m_gnss_sat_count', None)

    @property
    def mayak_id(self):
        if hasattr(self, '_m_mayak_id'):
            return self._m_mayak_id

        self._m_mayak_id = self.mayak_id_raw
        return getattr(self, '_m_mayak_id', None)

    @property
    def obc_activity(self):
        if hasattr(self, '_m_obc_activity'):
            return self._m_obc_activity

        self._m_obc_activity = self.obc_activity_raw
        return getattr(self, '_m_obc_activity', None)

    @property
    def temp_bat1_c(self):
        if hasattr(self, '_m_temp_bat1_c'):
            return self._m_temp_bat1_c

        self._m_temp_bat1_c = self.temp_bat1_c_raw
        return getattr(self, '_m_temp_bat1_c', None)

    @property
    def temp_bat2_c(self):
        if hasattr(self, '_m_temp_bat2_c'):
            return self._m_temp_bat2_c

        self._m_temp_bat2_c = self.temp_bat2_c_raw
        return getattr(self, '_m_temp_bat2_c', None)

    @property
    def temp_x_n_c(self):
        if hasattr(self, '_m_temp_x_n_c'):
            return self._m_temp_x_n_c

        self._m_temp_x_n_c = self.temp_x_n_c_raw
        return getattr(self, '_m_temp_x_n_c', None)

    @property
    def temp_x_p_c(self):
        if hasattr(self, '_m_temp_x_p_c'):
            return self._m_temp_x_p_c

        self._m_temp_x_p_c = self.temp_x_p_c_raw
        return getattr(self, '_m_temp_x_p_c', None)

    @property
    def temp_y_n_c(self):
        if hasattr(self, '_m_temp_y_n_c'):
            return self._m_temp_y_n_c

        self._m_temp_y_n_c = self.temp_y_n_c_raw
        return getattr(self, '_m_temp_y_n_c', None)

    @property
    def temp_y_p_c(self):
        if hasattr(self, '_m_temp_y_p_c'):
            return self._m_temp_y_p_c

        self._m_temp_y_p_c = self.temp_y_p_c_raw
        return getattr(self, '_m_temp_y_p_c', None)

    @property
    def v_cell_v(self):
        if hasattr(self, '_m_v_cell_v'):
            return self._m_v_cell_v

        self._m_v_cell_v = self.v_cell_v_raw * 0.001
        return getattr(self, '_m_v_cell_v', None)

    @property
    def v_pack_v(self):
        if hasattr(self, '_m_v_pack_v'):
            return self._m_v_pack_v

        self._m_v_pack_v = self.v_pack_v_raw * 0.001
        return getattr(self, '_m_v_pack_v', None)


