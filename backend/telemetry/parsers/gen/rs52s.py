# This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild
# type: ignore

import kaitaistruct
from kaitaistruct import KaitaiStruct, KaitaiStream, BytesIO


if getattr(kaitaistruct, 'API_VERSION', (0, 9)) < (0, 11):
    raise Exception("Incompatible Kaitai Struct Python API: 0.11 or later is required, but you have %s" % (kaitaistruct.__version__))

class Rs52s(KaitaiStruct):
    def __init__(self, _io, _parent=None, _root=None):
        super(Rs52s, self).__init__(_io)
        self._parent = _parent
        self._root = _root or self
        self._read()

    def _read(self):
        self.time_unix_s = self._io.read_u4le()
        self.battery_current_raw = self._io.read_u2le()
        self.panel_current_raw = self._io.read_u2le()
        self.v_cell_raw = self._io.read_u2le()
        self.v_pack_raw = self._io.read_u2le()
        self.temp_x_p_c = self._io.read_s1()
        self.temp_x_n_c = self._io.read_s1()
        self.temp_y_p_c = self._io.read_s1()
        self.temp_y_n_c = self._io.read_s1()
        self.reserved_16 = self._io.read_u1()
        self.temp_z_n_c = self._io.read_s1()
        self.temp_bat1_c = self._io.read_s1()
        self.temp_bat2_c = self._io.read_s1()
        self.cpu_load_raw = self._io.read_s1()
        self.obc_counter_raw = self._io.read_s2le()
        self.comm_counter_raw = self._io.read_s2le()
        self.rssi_raw = self._io.read_s1()


    def _fetch_instances(self):
        pass

    @property
    def battery_current_a(self):
        if hasattr(self, '_m_battery_current_a'):
            return self._m_battery_current_a

        self._m_battery_current_a = self.battery_current_raw * 0.0000766
        return getattr(self, '_m_battery_current_a', None)

    @property
    def comm_counter(self):
        if hasattr(self, '_m_comm_counter'):
            return self._m_comm_counter

        self._m_comm_counter = self.comm_counter_raw - 1505
        return getattr(self, '_m_comm_counter', None)

    @property
    def cpu_load_pct(self):
        if hasattr(self, '_m_cpu_load_pct'):
            return self._m_cpu_load_pct

        self._m_cpu_load_pct = self.cpu_load_raw * 0.390625
        return getattr(self, '_m_cpu_load_pct', None)

    @property
    def obc_counter(self):
        if hasattr(self, '_m_obc_counter'):
            return self._m_obc_counter

        self._m_obc_counter = self.obc_counter_raw - 7476
        return getattr(self, '_m_obc_counter', None)

    @property
    def panel_current_a(self):
        if hasattr(self, '_m_panel_current_a'):
            return self._m_panel_current_a

        self._m_panel_current_a = self.panel_current_raw * 0.00003076
        return getattr(self, '_m_panel_current_a', None)

    @property
    def rssi_dbm(self):
        if hasattr(self, '_m_rssi_dbm'):
            return self._m_rssi_dbm

        self._m_rssi_dbm = self.rssi_raw - 99
        return getattr(self, '_m_rssi_dbm', None)

    @property
    def v_cell_v(self):
        if hasattr(self, '_m_v_cell_v'):
            return self._m_v_cell_v

        self._m_v_cell_v = self.v_cell_raw * 0.00006928
        return getattr(self, '_m_v_cell_v', None)

    @property
    def v_pack_v(self):
        if hasattr(self, '_m_v_pack_v'):
            return self._m_v_pack_v

        self._m_v_pack_v = self.v_pack_raw * 0.00013856
        return getattr(self, '_m_v_pack_v', None)


