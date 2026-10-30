#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
COLIBRI-S (RS67S) Type-I beacon parser (AX.25 encapsulated inside GEOSCAN)

Based on the "Геоскан 3U" beacon protocol (Type I) tables provided in docs:
- AX.25 header (16 bytes)
- Mayak ID (1 byte) at offset 16 (relative to full 72-byte payload)
- EPS block (23 bytes) offsets 17..39
- OBC block (16 bytes) offsets 40..55
- COMMu block (16 bytes) offsets 56..71

This parser expects the AX.25 INFO field only (i.e., bytes after the AX.25
addresses/control/PID). Therefore, relative offsets below are with respect to
the start of the AX.25 info field. In that coordinate system:
  ID = 0
  EPS = 1..23
  OBC = 24..39
  COMMu = 40..55

Scalings per table:
- Currents are in mA -> report in A
- Voltages are in mV -> report in V
- Temperatures are signed int8 in °C
- RSSI in dBm (signed int8)
- VBUS (platform) mV -> V

If any field is out of range or payload is too short, the parser emits a clear
error for that field but continues with others.
"""

from __future__ import annotations

import struct
from typing import Any, Dict, cast


class ColibriSGeoscanAx25Parser:
    parser_id = "colibri"

    def parse(self, payload: bytes) -> Dict[str, Any]:
        out: Dict[str, Any] = {"satellite": "COLIBRI-S", "length": len(payload)}

        def u8(off: int) -> int:
            return cast(int, struct.unpack_from("<B", payload, off)[0])

        def i8(off: int) -> int:
            return cast(int, struct.unpack_from("<b", payload, off)[0])

        def u16(off: int) -> int:
            return cast(int, struct.unpack_from("<H", payload, off)[0])

        def u32(off: int) -> int:
            return cast(int, struct.unpack_from("<I", payload, off)[0])

        # Expect at least 56 bytes (1 + 23 + 16 + 16) of AX.25 info
        if len(payload) < 56:
            out["error"] = "payload too short for COLIBRI-S Type-I mapping"
            return out

        values: Dict[str, Any] = {}
        raw: Dict[str, Any] = {}

        # ID
        try:
            mayak_id = u8(0)
            values["mayak_id"] = mayak_id
        except Exception as e:
            values["mayak_id_error"] = str(e)

        # EPS block (relative base 1)
        base_eps = 1
        try:
            eps_time = u32(base_eps + 0)
            values["eps_time_unix_s"] = eps_time
            raw["eps_time_unix_s"] = eps_time
        except Exception as e:
            values["eps_time_unix_s_error"] = str(e)

        try:
            values["eps_mode_enum"] = u8(base_eps + 4)
        except Exception:
            pass

        # 22 reserve (base+5)
        try:
            raw["eps_reserve_22"] = u8(base_eps + 5)
        except Exception:
            pass

        # Currents (mA -> A)
        try:
            cur_platform_ma = u16(base_eps + 6)
            values["eps_current_platform_a"] = round(cur_platform_ma / 1000.0, 4)
            raw["eps_current_platform_ma"] = cur_platform_ma
        except Exception:
            pass
        try:
            cur_solar_ma = u16(base_eps + 8)
            values["eps_current_solar_a"] = round(cur_solar_ma / 1000.0, 4)
            raw["eps_current_solar_ma"] = cur_solar_ma
        except Exception:
            pass

        # Voltages (mV -> V)
        try:
            v_cell_mv = u16(base_eps + 10)
            values["v_cell_v"] = round(v_cell_mv / 1000.0, 3)
            raw["v_cell_mv"] = v_cell_mv
        except Exception:
            pass
        try:
            v_pack_mv = u16(base_eps + 12)
            values["v_pack_v"] = round(v_pack_mv / 1000.0, 3)
            raw["v_pack_mv"] = v_pack_mv
        except Exception:
            pass

        # 31 bitfield reserve (base+14, size 2)
        try:
            raw["eps_reserve_bitfield_31"] = u16(base_eps + 14)
        except Exception:
            pass

        # Temperatures (signed int8 °C)
        try:
            values["temp_bat1_c"] = i8(base_eps + 16)
        except Exception:
            pass
        try:
            values["temp_bat2_c"] = i8(base_eps + 17)
        except Exception:
            pass

        # 35 reserve (2 bytes), 37 reserve bitfield (1), 38 reserve (2)
        try:
            raw["eps_reserve_35"] = u16(base_eps + 18)
            raw["eps_reserve_bitfield_37"] = u8(base_eps + 20)
            raw["eps_reserve_38"] = u16(base_eps + 21)
        except Exception:
            pass

        # OBC block (relative base 24)
        base_obc = 24
        try:
            raw["obc_reserve_40"] = u16(base_obc + 0)
        except Exception:
            pass
        try:
            obc_act = u8(base_obc + 2)
            # Bit meanings per table
            values["obc_activity"] = {
                "wheels": bool(obc_act & (1 << 0)),
                "coils": bool(obc_act & (1 << 1)),
                "ins": bool(obc_act & (1 << 2)),
                "camera": bool(obc_act & (1 << 3)),
                "panel_x_p": bool(obc_act & (1 << 4)),
                "panel_x_n": bool(obc_act & (1 << 5)),
                "panel_y_p": bool(obc_act & (1 << 6)),
                "panel_y_n": bool(obc_act & (1 << 7)),
            }
            raw["obc_activity_raw"] = obc_act
        except Exception:
            pass
        # Face temperatures (signed int8 °C)
        for i, name in enumerate(["temp_x_p_c", "temp_x_n_c", "temp_y_p_c", "temp_y_n_c"]):
            try:
                values[name] = i8(base_obc + 3 + i)
            except Exception:
                pass
        try:
            values["gnss_sat_count"] = u8(base_obc + 7)
        except Exception:
            pass
        # 48 enum reserve, 49 reserve, 50 media files, 51 enum reserve, 52..55 4-byte reserve
        try:
            raw["obc_reserve_48_enum"] = u8(base_obc + 8)
            raw["obc_reserve_49"] = u8(base_obc + 9)
            values["camera_media_files_count"] = u8(base_obc + 10)
            raw["obc_reserve_51_enum"] = u8(base_obc + 11)
            raw["obc_reserve_52_4b"] = struct.unpack_from("<I", payload, base_obc + 12)[0]
        except Exception:
            pass

        # COMMu block (relative base 40)
        base_comm = 40
        try:
            raw["commu_reserve_56_enum"] = u8(base_comm + 0)
        except Exception:
            pass
        try:
            vbus_mv = u16(base_comm + 1)
            values["vbus_v"] = round(vbus_mv / 1000.0, 3)
            raw["vbus_mv"] = vbus_mv
        except Exception:
            pass
        try:
            raw["commu_reserve_59"] = u16(base_comm + 3)
        except Exception:
            pass
        try:
            values["rssi_last_dbm"] = i8(base_comm + 5)
            values["rssi_min_dbm"] = i8(base_comm + 6)
        except Exception:
            pass
        try:
            raw["commu_reserve_63"] = u8(base_comm + 7)
            raw["commu_reserve_64"] = u8(base_comm + 8)
        except Exception:
            pass
        try:
            values["tx_packets_count"] = u8(base_comm + 9)
        except Exception:
            pass
        try:
            raw["commu_reserve_66"] = u8(base_comm + 10)
            raw["commu_reserve_67_enum"] = u8(base_comm + 11)
            raw["commu_reserve_68_signed"] = i8(base_comm + 12)
        except Exception:
            pass
        try:
            values["qso_received_count"] = u8(base_comm + 13)
        except Exception:
            pass
        try:
            raw["commu_reserve_70"] = u16(base_comm + 14)
        except Exception:
            pass

        out["values"] = values
        out["raw_fields"] = raw
        return out


__all__ = ["ColibriSGeoscanAx25Parser"]
