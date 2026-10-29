# This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild
# type: ignore

import kaitaistruct
from kaitaistruct import KaitaiStruct, KaitaiStream, BytesIO


if getattr(kaitaistruct, 'API_VERSION', (0, 9)) < (0, 11):
    raise Exception("Incompatible Kaitai Struct Python API: 0.11 or later is required, but you have %s" % (kaitaistruct.__version__))

class UspPower(KaitaiStruct):
    def __init__(self, _io, _parent=None, _root=None):
        super(UspPower, self).__init__(_io)
        self._parent = _parent
        self._root = _root or self
        self._read()

    def _read(self):
        self.panel_voltage_1_raw = self._io.read_u2le()
        self.panel_voltage_2_raw = self._io.read_u2le()
        self.panel_voltage_3_raw = self._io.read_u2le()
        self.panel_current_1_raw = self._io.read_u2le()
        self.panel_current_2_raw = self._io.read_u2le()
        self.panel_current_3_raw = self._io.read_u2le()
        self.battery_current_raw = self._io.read_s2le()
        self.channel_current_1_raw = self._io.read_u2le()
        self.channel_current_2_raw = self._io.read_u2le()
        self.channel_current_3_raw = self._io.read_u2le()
        self.channel_current_4_raw = self._io.read_u2le()
        self.battery_temperature_1_raw = self._io.read_s2le()
        self.battery_temperature_2_raw = self._io.read_s2le()
        self.battery_temperature_3_raw = self._io.read_s2le()
        self.battery_temperature_4_raw = self._io.read_s2le()
        self.power_flags_raw = self._io.read_u4le()
        self.battery_voltage_raw = self._io.read_s2le()
        self.record_id_raw = self._io.read_u4le()
        self.time_unix_s_raw = self._io.read_s4le()
        self.reset_count_raw = self._io.read_u1()
        self.reset_reason_raw = self._io.read_u1()


    def _fetch_instances(self):
        pass

    @property
    def battery_current(self):
        if hasattr(self, '_m_battery_current'):
            return self._m_battery_current

        self._m_battery_current = self.battery_current_raw
        return getattr(self, '_m_battery_current', None)

    @property
    def battery_temperature_1(self):
        if hasattr(self, '_m_battery_temperature_1'):
            return self._m_battery_temperature_1

        self._m_battery_temperature_1 = self.battery_temperature_1_raw / 100.0
        return getattr(self, '_m_battery_temperature_1', None)

    @property
    def battery_temperature_2(self):
        if hasattr(self, '_m_battery_temperature_2'):
            return self._m_battery_temperature_2

        self._m_battery_temperature_2 = self.battery_temperature_2_raw / 100.0
        return getattr(self, '_m_battery_temperature_2', None)

    @property
    def battery_temperature_3(self):
        if hasattr(self, '_m_battery_temperature_3'):
            return self._m_battery_temperature_3

        self._m_battery_temperature_3 = self.battery_temperature_3_raw / 100.0
        return getattr(self, '_m_battery_temperature_3', None)

    @property
    def battery_temperature_4(self):
        if hasattr(self, '_m_battery_temperature_4'):
            return self._m_battery_temperature_4

        self._m_battery_temperature_4 = self.battery_temperature_4_raw / 100.0
        return getattr(self, '_m_battery_temperature_4', None)

    @property
    def battery_voltage(self):
        if hasattr(self, '_m_battery_voltage'):
            return self._m_battery_voltage

        self._m_battery_voltage = self.battery_voltage_raw / 1000.0
        return getattr(self, '_m_battery_voltage', None)

    @property
    def channel_current_1(self):
        if hasattr(self, '_m_channel_current_1'):
            return self._m_channel_current_1

        self._m_channel_current_1 = self.channel_current_1_raw
        return getattr(self, '_m_channel_current_1', None)

    @property
    def channel_current_2(self):
        if hasattr(self, '_m_channel_current_2'):
            return self._m_channel_current_2

        self._m_channel_current_2 = self.channel_current_2_raw
        return getattr(self, '_m_channel_current_2', None)

    @property
    def channel_current_3(self):
        if hasattr(self, '_m_channel_current_3'):
            return self._m_channel_current_3

        self._m_channel_current_3 = self.channel_current_3_raw
        return getattr(self, '_m_channel_current_3', None)

    @property
    def channel_current_4(self):
        if hasattr(self, '_m_channel_current_4'):
            return self._m_channel_current_4

        self._m_channel_current_4 = self.channel_current_4_raw
        return getattr(self, '_m_channel_current_4', None)

    @property
    def panel_current_1(self):
        if hasattr(self, '_m_panel_current_1'):
            return self._m_panel_current_1

        self._m_panel_current_1 = self.panel_current_1_raw
        return getattr(self, '_m_panel_current_1', None)

    @property
    def panel_current_2(self):
        if hasattr(self, '_m_panel_current_2'):
            return self._m_panel_current_2

        self._m_panel_current_2 = self.panel_current_2_raw
        return getattr(self, '_m_panel_current_2', None)

    @property
    def panel_current_3(self):
        if hasattr(self, '_m_panel_current_3'):
            return self._m_panel_current_3

        self._m_panel_current_3 = self.panel_current_3_raw
        return getattr(self, '_m_panel_current_3', None)

    @property
    def panel_voltage_1(self):
        if hasattr(self, '_m_panel_voltage_1'):
            return self._m_panel_voltage_1

        self._m_panel_voltage_1 = self.panel_voltage_1_raw / 1000.0
        return getattr(self, '_m_panel_voltage_1', None)

    @property
    def panel_voltage_2(self):
        if hasattr(self, '_m_panel_voltage_2'):
            return self._m_panel_voltage_2

        self._m_panel_voltage_2 = self.panel_voltage_2_raw / 1000.0
        return getattr(self, '_m_panel_voltage_2', None)

    @property
    def panel_voltage_3(self):
        if hasattr(self, '_m_panel_voltage_3'):
            return self._m_panel_voltage_3

        self._m_panel_voltage_3 = self.panel_voltage_3_raw / 1000.0
        return getattr(self, '_m_panel_voltage_3', None)

    @property
    def record_id(self):
        if hasattr(self, '_m_record_id'):
            return self._m_record_id

        self._m_record_id = self.record_id_raw
        return getattr(self, '_m_record_id', None)

    @property
    def reset_count(self):
        if hasattr(self, '_m_reset_count'):
            return self._m_reset_count

        self._m_reset_count = self.reset_count_raw
        return getattr(self, '_m_reset_count', None)

    @property
    def reset_reason(self):
        if hasattr(self, '_m_reset_reason'):
            return self._m_reset_reason

        self._m_reset_reason = self.reset_reason_raw
        return getattr(self, '_m_reset_reason', None)

    @property
    def time_unix_s(self):
        if hasattr(self, '_m_time_unix_s'):
            return self._m_time_unix_s

        self._m_time_unix_s = self.time_unix_s_raw
        return getattr(self, '_m_time_unix_s', None)


