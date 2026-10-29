# This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild
# type: ignore

import kaitaistruct
from kaitaistruct import KaitaiStruct, KaitaiStream, BytesIO


if getattr(kaitaistruct, 'API_VERSION', (0, 9)) < (0, 11):
    raise Exception("Incompatible Kaitai Struct Python API: 0.11 or later is required, but you have %s" % (kaitaistruct.__version__))

class Uwe4(KaitaiStruct):
    def __init__(self, _io, _parent=None, _root=None):
        super(Uwe4, self).__init__(_io)
        self._parent = _parent
        self._root = _root or self
        self._read()

    def _read(self):
        self.flags1_raw = self._io.read_u1()
        self.flags2_raw = self._io.read_u1()
        self.packet_id_raw = self._io.read_u2le()
        self.fm_system_id_raw = self._io.read_u1()
        self.fm_subsystem_id_raw = self._io.read_u1()
        self.to_system_id_raw = self._io.read_u1()
        self.to_subsystem_id_raw = self._io.read_u1()
        self.api_raw = self._io.read_u1()
        if not  ((self.api_raw == 14) or (self.api_raw == 103)) :
            raise kaitaistruct.ValidationNotAnyOfError(self.api_raw, self._io, u"/seq/7")
        self.payload_size_raw = self._io.read_u1()
        _ = self.payload_size_raw
        if not  ((self._io.size() == _ + 12) and ( (( ((self.api_raw == 14) and (_ == 46)) ) or ( ((self.api_raw == 103) and (_ >= 6)) )) )) :
            raise kaitaistruct.ValidationExprError(self.payload_size_raw, self._io, u"/seq/8")
        _on = self.api_raw
        if _on == 103:
            pass
            self._raw_payload = self._io.read_bytes(self.payload_size_raw)
            _io__raw_payload = KaitaiStream(BytesIO(self._raw_payload))
            self.payload = Uwe4.RfMessage(_io__raw_payload, self, self._root)
        elif _on == 14:
            pass
            self._raw_payload = self._io.read_bytes(self.payload_size_raw)
            _io__raw_payload = KaitaiStream(BytesIO(self._raw_payload))
            self.payload = Uwe4.HskpPayload(_io__raw_payload, self, self._root)
        else:
            pass
            self.payload = self._io.read_bytes(self.payload_size_raw)
        self.crc_raw = self._io.read_u2le()


    def _fetch_instances(self):
        pass
        _on = self.api_raw
        if _on == 103:
            pass
            self.payload._fetch_instances()
        elif _on == 14:
            pass
            self.payload._fetch_instances()
        else:
            pass

    class HskpPayload(KaitaiStruct):
        def __init__(self, _io, _parent=None, _root=None):
            super(Uwe4.HskpPayload, self).__init__(_io)
            self._parent = _parent
            self._root = _root
            self._read()

        def _read(self):
            self.command_raw = self._io.read_u1()
            self.var_id_raw = self._io.read_u2le()
            self.typeandlength_raw = self._io.read_u2le()
            self.timestamp_raw = []
            for i in range(6):
                self.timestamp_raw.append(self._io.read_u1())

            self.beacon_rate_raw = self._io.read_u4le()
            self.vals_out_of_range_raw = self._io.read_u2le()
            self.uptime_raw = self._io.read_u4le()
            self.subsystem_status_raw = self._io.read_u2le()
            self.batt_a_temp_raw = self._io.read_s1()
            self.batt_a_soc_raw = self._io.read_s1()
            self.batt_b_temp_raw = self._io.read_s1()
            self.batt_b_soc_raw = self._io.read_s1()
            self.batt_a_current_raw = self._io.read_s2le()
            self.batt_a_voltage_raw = self._io.read_s2le()
            self.batt_b_current_raw = self._io.read_s2le()
            self.batt_b_voltage_raw = self._io.read_s2le()
            self.power_consumption_raw = self._io.read_s2le()
            self.obc_temp_raw = self._io.read_s1()
            self.panel_pos_x_temp_raw = self._io.read_s1()
            self.panel_neg_x_temp_raw = self._io.read_s1()
            self.panel_pos_y_temp_raw = self._io.read_s1()
            self.panel_neg_y_temp_raw = self._io.read_s1()
            self.panel_pos_z_temp_raw = self._io.read_s1()
            self.panel_neg_z_temp_raw = self._io.read_s1()
            self.freq_raw = self._io.read_u2le()


        def _fetch_instances(self):
            pass
            for i in range(len(self.timestamp_raw)):
                pass


        @property
        def batt_a_current_ma(self):
            if hasattr(self, '_m_batt_a_current_ma'):
                return self._m_batt_a_current_ma

            self._m_batt_a_current_ma = self.batt_a_current_raw
            return getattr(self, '_m_batt_a_current_ma', None)

        @property
        def batt_a_soc_pct(self):
            if hasattr(self, '_m_batt_a_soc_pct'):
                return self._m_batt_a_soc_pct

            self._m_batt_a_soc_pct = self.batt_a_soc_raw
            return getattr(self, '_m_batt_a_soc_pct', None)

        @property
        def batt_a_temp_c(self):
            if hasattr(self, '_m_batt_a_temp_c'):
                return self._m_batt_a_temp_c

            self._m_batt_a_temp_c = self.batt_a_temp_raw
            return getattr(self, '_m_batt_a_temp_c', None)

        @property
        def batt_a_voltage_v(self):
            if hasattr(self, '_m_batt_a_voltage_v'):
                return self._m_batt_a_voltage_v

            self._m_batt_a_voltage_v = self.batt_a_voltage_raw * 0.001
            return getattr(self, '_m_batt_a_voltage_v', None)

        @property
        def batt_b_current_ma(self):
            if hasattr(self, '_m_batt_b_current_ma'):
                return self._m_batt_b_current_ma

            self._m_batt_b_current_ma = self.batt_b_current_raw
            return getattr(self, '_m_batt_b_current_ma', None)

        @property
        def batt_b_soc_pct(self):
            if hasattr(self, '_m_batt_b_soc_pct'):
                return self._m_batt_b_soc_pct

            self._m_batt_b_soc_pct = self.batt_b_soc_raw
            return getattr(self, '_m_batt_b_soc_pct', None)

        @property
        def batt_b_temp_c(self):
            if hasattr(self, '_m_batt_b_temp_c'):
                return self._m_batt_b_temp_c

            self._m_batt_b_temp_c = self.batt_b_temp_raw
            return getattr(self, '_m_batt_b_temp_c', None)

        @property
        def batt_b_voltage_v(self):
            if hasattr(self, '_m_batt_b_voltage_v'):
                return self._m_batt_b_voltage_v

            self._m_batt_b_voltage_v = self.batt_b_voltage_raw * 0.001
            return getattr(self, '_m_batt_b_voltage_v', None)

        @property
        def beacon_rate_s(self):
            if hasattr(self, '_m_beacon_rate_s'):
                return self._m_beacon_rate_s

            self._m_beacon_rate_s = self.beacon_rate_raw / 1024.0
            return getattr(self, '_m_beacon_rate_s', None)

        @property
        def freq_khz(self):
            if hasattr(self, '_m_freq_khz'):
                return self._m_freq_khz

            self._m_freq_khz = self.freq_raw + 400000
            return getattr(self, '_m_freq_khz', None)

        @property
        def obc_temp_c(self):
            if hasattr(self, '_m_obc_temp_c'):
                return self._m_obc_temp_c

            self._m_obc_temp_c = self.obc_temp_raw
            return getattr(self, '_m_obc_temp_c', None)

        @property
        def panel_neg_x_temp_c(self):
            if hasattr(self, '_m_panel_neg_x_temp_c'):
                return self._m_panel_neg_x_temp_c

            self._m_panel_neg_x_temp_c = self.panel_neg_x_temp_raw
            return getattr(self, '_m_panel_neg_x_temp_c', None)

        @property
        def panel_neg_y_temp_c(self):
            if hasattr(self, '_m_panel_neg_y_temp_c'):
                return self._m_panel_neg_y_temp_c

            self._m_panel_neg_y_temp_c = self.panel_neg_y_temp_raw
            return getattr(self, '_m_panel_neg_y_temp_c', None)

        @property
        def panel_neg_z_temp_c(self):
            if hasattr(self, '_m_panel_neg_z_temp_c'):
                return self._m_panel_neg_z_temp_c

            self._m_panel_neg_z_temp_c = self.panel_neg_z_temp_raw
            return getattr(self, '_m_panel_neg_z_temp_c', None)

        @property
        def panel_pos_x_temp_c(self):
            if hasattr(self, '_m_panel_pos_x_temp_c'):
                return self._m_panel_pos_x_temp_c

            self._m_panel_pos_x_temp_c = self.panel_pos_x_temp_raw
            return getattr(self, '_m_panel_pos_x_temp_c', None)

        @property
        def panel_pos_y_temp_c(self):
            if hasattr(self, '_m_panel_pos_y_temp_c'):
                return self._m_panel_pos_y_temp_c

            self._m_panel_pos_y_temp_c = self.panel_pos_y_temp_raw
            return getattr(self, '_m_panel_pos_y_temp_c', None)

        @property
        def panel_pos_z_temp_c(self):
            if hasattr(self, '_m_panel_pos_z_temp_c'):
                return self._m_panel_pos_z_temp_c

            self._m_panel_pos_z_temp_c = self.panel_pos_z_temp_raw
            return getattr(self, '_m_panel_pos_z_temp_c', None)

        @property
        def power_consumption_mw(self):
            if hasattr(self, '_m_power_consumption_mw'):
                return self._m_power_consumption_mw

            self._m_power_consumption_mw = self.power_consumption_raw
            return getattr(self, '_m_power_consumption_mw', None)

        @property
        def uptime_s(self):
            if hasattr(self, '_m_uptime_s'):
                return self._m_uptime_s

            self._m_uptime_s = self.uptime_raw
            return getattr(self, '_m_uptime_s', None)


    class RfMessage(KaitaiStruct):
        def __init__(self, _io, _parent=None, _root=None):
            super(Uwe4.RfMessage, self).__init__(_io)
            self._parent = _parent
            self._root = _root
            self._read()

        def _read(self):
            self.message_prefix_raw = self._io.read_bytes(6)
            self.message = (self._io.read_bytes(self._parent.payload_size_raw - 6)).decode(u"UTF-8")


        def _fetch_instances(self):
            pass


    @property
    def api(self):
        if hasattr(self, '_m_api'):
            return self._m_api

        self._m_api = self.api_raw
        return getattr(self, '_m_api', None)

    @property
    def packet_id(self):
        if hasattr(self, '_m_packet_id'):
            return self._m_packet_id

        self._m_packet_id = self.packet_id_raw
        return getattr(self, '_m_packet_id', None)

    @property
    def payload_size(self):
        if hasattr(self, '_m_payload_size'):
            return self._m_payload_size

        self._m_payload_size = self.payload_size_raw
        return getattr(self, '_m_payload_size', None)


