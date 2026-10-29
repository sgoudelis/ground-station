# This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild
# type: ignore

import kaitaistruct
from kaitaistruct import KaitaiStruct, KaitaiStream, BytesIO


if getattr(kaitaistruct, 'API_VERSION', (0, 9)) < (0, 11):
    raise Exception("Incompatible Kaitai Struct Python API: 0.11 or later is required, but you have %s" % (kaitaistruct.__version__))

class UspUhf(KaitaiStruct):
    def __init__(self, _io, _parent=None, _root=None):
        super(UspUhf, self).__init__(_io)
        self._parent = _parent
        self._root = _root or self
        self._read()

    def _read(self):
        self.amplifier_temperature_raw = self._io.read_s1()
        self.radio_temperature_raw = self._io.read_s1()
        self.received_signal_strength_raw = self._io.read_u1()
        self.idle_signal_strength_raw = self._io.read_u1()
        self.forward_power_raw = self._io.read_s1()
        self.reflected_power_raw = self._io.read_s1()
        self.reset_count_raw = self._io.read_u1()
        self.radio_flags_raw = self._io.read_u1()
        self.time_unix_s_raw = self._io.read_s4le()
        self.uptime_raw = self._io.read_u4le()
        self.receive_bitrate_raw = self._io.read_u4le()
        self.current_raw = self._io.read_u2le()
        self.input_voltage_raw = self._io.read_s2le()
        self.schedule_flags_raw = self._io.read_u1()


    def _fetch_instances(self):
        pass

    @property
    def amplifier_temperature(self):
        if hasattr(self, '_m_amplifier_temperature'):
            return self._m_amplifier_temperature

        self._m_amplifier_temperature = self.amplifier_temperature_raw
        return getattr(self, '_m_amplifier_temperature', None)

    @property
    def current(self):
        if hasattr(self, '_m_current'):
            return self._m_current

        self._m_current = self.current_raw
        return getattr(self, '_m_current', None)

    @property
    def forward_power(self):
        if hasattr(self, '_m_forward_power'):
            return self._m_forward_power

        self._m_forward_power = self.forward_power_raw
        return getattr(self, '_m_forward_power', None)

    @property
    def idle_signal_strength(self):
        if hasattr(self, '_m_idle_signal_strength'):
            return self._m_idle_signal_strength

        self._m_idle_signal_strength = self.idle_signal_strength_raw * -1
        return getattr(self, '_m_idle_signal_strength', None)

    @property
    def input_voltage(self):
        if hasattr(self, '_m_input_voltage'):
            return self._m_input_voltage

        self._m_input_voltage = self.input_voltage_raw / 1000.0
        return getattr(self, '_m_input_voltage', None)

    @property
    def radio_flags(self):
        if hasattr(self, '_m_radio_flags'):
            return self._m_radio_flags

        self._m_radio_flags = self.radio_flags_raw
        return getattr(self, '_m_radio_flags', None)

    @property
    def radio_temperature(self):
        if hasattr(self, '_m_radio_temperature'):
            return self._m_radio_temperature

        self._m_radio_temperature = self.radio_temperature_raw
        return getattr(self, '_m_radio_temperature', None)

    @property
    def receive_bitrate(self):
        if hasattr(self, '_m_receive_bitrate'):
            return self._m_receive_bitrate

        self._m_receive_bitrate = self.receive_bitrate_raw
        return getattr(self, '_m_receive_bitrate', None)

    @property
    def received_signal_strength(self):
        if hasattr(self, '_m_received_signal_strength'):
            return self._m_received_signal_strength

        self._m_received_signal_strength = self.received_signal_strength_raw * -1
        return getattr(self, '_m_received_signal_strength', None)

    @property
    def reflected_power(self):
        if hasattr(self, '_m_reflected_power'):
            return self._m_reflected_power

        self._m_reflected_power = self.reflected_power_raw
        return getattr(self, '_m_reflected_power', None)

    @property
    def reset_count(self):
        if hasattr(self, '_m_reset_count'):
            return self._m_reset_count

        self._m_reset_count = self.reset_count_raw
        return getattr(self, '_m_reset_count', None)

    @property
    def time_unix_s(self):
        if hasattr(self, '_m_time_unix_s'):
            return self._m_time_unix_s

        self._m_time_unix_s = self.time_unix_s_raw
        return getattr(self, '_m_time_unix_s', None)

    @property
    def uptime(self):
        if hasattr(self, '_m_uptime'):
            return self._m_uptime

        self._m_uptime = self.uptime_raw
        return getattr(self, '_m_uptime', None)


