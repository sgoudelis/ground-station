# This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild
# type: ignore

import kaitaistruct
from kaitaistruct import KaitaiStruct, KaitaiStream, BytesIO


if getattr(kaitaistruct, 'API_VERSION', (0, 9)) < (0, 11):
    raise Exception("Incompatible Kaitai Struct Python API: 0.11 or later is required, but you have %s" % (kaitaistruct.__version__))

class Tianqi(KaitaiStruct):
    def __init__(self, _io, _parent=None, _root=None):
        super(Tianqi, self).__init__(_io)
        self._parent = _parent
        self._root = _root or self
        self._read()

    def _read(self):
        self.net_id_raw = self._io.read_u1()
        _ = self.net_id_raw
        if not  ((_ == 235) and (self._io.size() == 100)) :
            raise kaitaistruct.ValidationExprError(self.net_id_raw, self._io, u"/seq/0")
        self.frame = Tianqi.Body(self._io, self, self._root)


    def _fetch_instances(self):
        pass
        self.frame._fetch_instances()

    class Body(KaitaiStruct):
        def __init__(self, _io, _parent=None, _root=None):
            super(Tianqi.Body, self).__init__(_io)
            self._parent = _parent
            self._root = _root
            self._read()

        def _read(self):
            self.msg_type_id_raw = self._io.read_u1()
            self.head_unk_raw = self._io.read_u1()
            self.timestamp_raw = self._io.read_u4be()
            self.sat_id_raw = self._io.read_u1()
            self.status_unk_raw = self._io.read_u1()
            self.payload_data_raw = self._io.read_bytes(91)


        def _fetch_instances(self):
            pass

        @property
        def msg_type_id(self):
            if hasattr(self, '_m_msg_type_id'):
                return self._m_msg_type_id

            self._m_msg_type_id = self.msg_type_id_raw
            return getattr(self, '_m_msg_type_id', None)

        @property
        def sat_id(self):
            if hasattr(self, '_m_sat_id'):
                return self._m_sat_id

            self._m_sat_id = self.sat_id_raw
            return getattr(self, '_m_sat_id', None)

        @property
        def time_unix_s(self):
            if hasattr(self, '_m_time_unix_s'):
                return self._m_time_unix_s

            self._m_time_unix_s = self.timestamp_raw + 1514764800
            return getattr(self, '_m_time_unix_s', None)


    @property
    def net_id(self):
        if hasattr(self, '_m_net_id'):
            return self._m_net_id

        self._m_net_id = self.net_id_raw
        return getattr(self, '_m_net_id', None)


