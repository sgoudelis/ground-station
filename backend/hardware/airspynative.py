"""
Native Airspy/Airspy HF+ ctypes bindings used by probes and workers.

The project already ships libairspy/libairspyhf at system level. This module
keeps all C interop details in one place so runtime workers can stay focused on
streaming logic.
"""

from __future__ import annotations

import ctypes
import ctypes.util
from dataclasses import dataclass
from typing import Callable, Iterable, List, Optional

AIRSPY_SAMPLE_FLOAT32_IQ = 0


class AirspyNativeError(RuntimeError):
    """Raised when native Airspy/Airspy HF+ library calls fail."""


def _resolve_shared_object(candidates: Iterable[Optional[str]]) -> str:
    candidate_list = [name for name in candidates if name]
    for name in candidate_list:
        if not name:
            continue
        try:
            ctypes.CDLL(name)
            return str(name)
        except OSError:
            continue
    raise AirspyNativeError(
        "Unable to load native Airspy library. "
        "Install system packages `libairspy-dev` and `libairspyhf-dev` "
        f"(candidates: {candidate_list})"
    )


def _normalize_serial(serial: object) -> int:
    if serial is None:
        raise ValueError("serial is required")
    if isinstance(serial, int):
        return serial

    serial_text = str(serial).strip()
    if not serial_text:
        raise ValueError("serial is required")

    # USB serials are often represented as uppercase hex without a 0x prefix.
    if serial_text.lower().startswith("0x"):
        return int(serial_text, 16)
    if all(ch in "0123456789abcdefABCDEF" for ch in serial_text):
        return int(serial_text, 16)
    return int(serial_text)


def format_serial(serial: int) -> str:
    return f"{serial:016X}"


def parse_serial(serial: object) -> int:
    return _normalize_serial(serial)


class AirspyTransfer(ctypes.Structure):
    _fields_ = [
        ("device", ctypes.c_void_p),
        ("ctx", ctypes.c_void_p),
        ("samples", ctypes.c_void_p),
        ("sample_count", ctypes.c_int),
        ("dropped_samples", ctypes.c_uint64),
        ("sample_type", ctypes.c_int),
    ]


AirspyCallback = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(AirspyTransfer))


class AirspyhfComplexFloat(ctypes.Structure):
    _fields_ = [("re", ctypes.c_float), ("im", ctypes.c_float)]


class AirspyhfTransfer(ctypes.Structure):
    _fields_ = [
        ("device", ctypes.c_void_p),
        ("ctx", ctypes.c_void_p),
        ("samples", ctypes.POINTER(AirspyhfComplexFloat)),
        ("sample_count", ctypes.c_int),
        ("dropped_samples", ctypes.c_uint64),
    ]


AirspyhfCallback = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(AirspyhfTransfer))


def _raise_if_error(code: int, context: str) -> None:
    if code < 0:
        raise AirspyNativeError(f"{context} failed with code {code}")


def _raise_if_not_success(code: int, context: str) -> None:
    # Most mutating calls return 0 on success. `is_streaming()` is handled separately.
    if code != 0:
        raise AirspyNativeError(f"{context} failed with code {code}")


def _extract_samplerates(
    getter: Callable[[ctypes.c_void_p, ctypes.Array, int], int], handle: ctypes.c_void_p
) -> List[int]:
    count_probe = (ctypes.c_uint32 * 1)()
    probe_code = getter(handle, count_probe, 0)
    _raise_if_error(probe_code, "query samplerate count")

    count = int(count_probe[0])
    if count <= 0:
        count = int(probe_code) if probe_code > 0 else 0
    if count <= 0:
        return []

    rates_buf = (ctypes.c_uint32 * count)()
    read_code = getter(handle, rates_buf, count)
    _raise_if_error(read_code, "read samplerates")

    rates = [int(rates_buf[idx]) for idx in range(count)]
    return sorted({rate for rate in rates if rate > 0})


def _configure_airspy_signatures(lib: ctypes.CDLL) -> None:
    lib.airspy_list_devices.argtypes = [ctypes.POINTER(ctypes.c_uint64), ctypes.c_int]
    lib.airspy_list_devices.restype = ctypes.c_int
    lib.airspy_open.argtypes = [ctypes.POINTER(ctypes.c_void_p)]
    lib.airspy_open.restype = ctypes.c_int
    lib.airspy_open_sn.argtypes = [ctypes.POINTER(ctypes.c_void_p), ctypes.c_uint64]
    lib.airspy_open_sn.restype = ctypes.c_int
    lib.airspy_close.argtypes = [ctypes.c_void_p]
    lib.airspy_close.restype = ctypes.c_int
    lib.airspy_get_samplerates.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_uint32),
        ctypes.c_uint32,
    ]
    lib.airspy_get_samplerates.restype = ctypes.c_int
    lib.airspy_set_sample_type.argtypes = [ctypes.c_void_p, ctypes.c_int]
    lib.airspy_set_sample_type.restype = ctypes.c_int
    lib.airspy_set_samplerate.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    lib.airspy_set_samplerate.restype = ctypes.c_int
    lib.airspy_set_freq.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    lib.airspy_set_freq.restype = ctypes.c_int
    lib.airspy_set_sensitivity_gain.argtypes = [ctypes.c_void_p, ctypes.c_uint8]
    lib.airspy_set_sensitivity_gain.restype = ctypes.c_int
    lib.airspy_set_linearity_gain.argtypes = [ctypes.c_void_p, ctypes.c_uint8]
    lib.airspy_set_linearity_gain.restype = ctypes.c_int
    lib.airspy_set_lna_gain.argtypes = [ctypes.c_void_p, ctypes.c_uint8]
    lib.airspy_set_lna_gain.restype = ctypes.c_int
    lib.airspy_set_mixer_gain.argtypes = [ctypes.c_void_p, ctypes.c_uint8]
    lib.airspy_set_mixer_gain.restype = ctypes.c_int
    lib.airspy_set_vga_gain.argtypes = [ctypes.c_void_p, ctypes.c_uint8]
    lib.airspy_set_vga_gain.restype = ctypes.c_int
    lib.airspy_set_lna_agc.argtypes = [ctypes.c_void_p, ctypes.c_uint8]
    lib.airspy_set_lna_agc.restype = ctypes.c_int
    lib.airspy_set_mixer_agc.argtypes = [ctypes.c_void_p, ctypes.c_uint8]
    lib.airspy_set_mixer_agc.restype = ctypes.c_int
    lib.airspy_set_rf_bias.argtypes = [ctypes.c_void_p, ctypes.c_uint8]
    lib.airspy_set_rf_bias.restype = ctypes.c_int
    lib.airspy_start_rx.argtypes = [ctypes.c_void_p, AirspyCallback, ctypes.c_void_p]
    lib.airspy_start_rx.restype = ctypes.c_int
    lib.airspy_stop_rx.argtypes = [ctypes.c_void_p]
    lib.airspy_stop_rx.restype = ctypes.c_int
    lib.airspy_is_streaming.argtypes = [ctypes.c_void_p]
    lib.airspy_is_streaming.restype = ctypes.c_int


def _configure_airspyhf_signatures(lib: ctypes.CDLL) -> None:
    lib.airspyhf_list_devices.argtypes = [ctypes.POINTER(ctypes.c_uint64), ctypes.c_int]
    lib.airspyhf_list_devices.restype = ctypes.c_int
    lib.airspyhf_open.argtypes = [ctypes.POINTER(ctypes.c_void_p)]
    lib.airspyhf_open.restype = ctypes.c_int
    lib.airspyhf_open_sn.argtypes = [ctypes.POINTER(ctypes.c_void_p), ctypes.c_uint64]
    lib.airspyhf_open_sn.restype = ctypes.c_int
    lib.airspyhf_close.argtypes = [ctypes.c_void_p]
    lib.airspyhf_close.restype = ctypes.c_int
    lib.airspyhf_get_samplerates.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_uint32),
        ctypes.c_uint32,
    ]
    lib.airspyhf_get_samplerates.restype = ctypes.c_int
    lib.airspyhf_set_samplerate.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    lib.airspyhf_set_samplerate.restype = ctypes.c_int
    lib.airspyhf_set_freq.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    lib.airspyhf_set_freq.restype = ctypes.c_int
    lib.airspyhf_set_hf_agc.argtypes = [ctypes.c_void_p, ctypes.c_uint8]
    lib.airspyhf_set_hf_agc.restype = ctypes.c_int
    lib.airspyhf_set_hf_att.argtypes = [ctypes.c_void_p, ctypes.c_uint8]
    lib.airspyhf_set_hf_att.restype = ctypes.c_int
    lib.airspyhf_set_hf_lna.argtypes = [ctypes.c_void_p, ctypes.c_uint8]
    lib.airspyhf_set_hf_lna.restype = ctypes.c_int
    lib.airspyhf_start.argtypes = [ctypes.c_void_p, AirspyhfCallback, ctypes.c_void_p]
    lib.airspyhf_start.restype = ctypes.c_int
    lib.airspyhf_stop.argtypes = [ctypes.c_void_p]
    lib.airspyhf_stop.restype = ctypes.c_int
    lib.airspyhf_is_streaming.argtypes = [ctypes.c_void_p]
    lib.airspyhf_is_streaming.restype = ctypes.c_int


_AIRSPY_LIB: Optional[ctypes.CDLL] = None
_AIRSPYHF_LIB: Optional[ctypes.CDLL] = None


def _get_airspy_lib() -> ctypes.CDLL:
    global _AIRSPY_LIB
    if _AIRSPY_LIB is None:
        candidate = ctypes.util.find_library("airspy")
        so_path = _resolve_shared_object(
            (
                candidate,
                "libairspy.so",
                "/lib/x86_64-linux-gnu/libairspy.so.0",
                "/lib/x86_64-linux-gnu/libairspy.so",
            )
        )
        _AIRSPY_LIB = ctypes.CDLL(so_path)
        _configure_airspy_signatures(_AIRSPY_LIB)
    return _AIRSPY_LIB


def _get_airspyhf_lib() -> ctypes.CDLL:
    global _AIRSPYHF_LIB
    if _AIRSPYHF_LIB is None:
        candidate = ctypes.util.find_library("airspyhf")
        so_path = _resolve_shared_object(
            (
                candidate,
                "libairspyhf.so.1",
                "/lib/x86_64-linux-gnu/libairspyhf.so.1",
                "/usr/lib/x86_64-linux-gnu/libairspyhf.so.1",
            )
        )
        _AIRSPYHF_LIB = ctypes.CDLL(so_path)
        _configure_airspyhf_signatures(_AIRSPYHF_LIB)
    return _AIRSPYHF_LIB


@dataclass(slots=True)
class AirspyDevice:
    handle: ctypes.c_void_p
    serial: Optional[int] = None

    @staticmethod
    def list_serials(max_devices: int = 32) -> List[int]:
        lib = _get_airspy_lib()
        serials = (ctypes.c_uint64 * max_devices)()
        count = lib.airspy_list_devices(serials, max_devices)
        _raise_if_error(count, "list Airspy devices")
        return [int(serials[idx]) for idx in range(min(count, max_devices))]

    @classmethod
    def open(cls, serial: Optional[int] = None) -> "AirspyDevice":
        lib = _get_airspy_lib()
        handle = ctypes.c_void_p()
        if serial is None:
            _raise_if_not_success(lib.airspy_open(ctypes.byref(handle)), "open Airspy device")
            return cls(handle=handle, serial=None)

        serial_value = _normalize_serial(serial)
        _raise_if_not_success(
            lib.airspy_open_sn(ctypes.byref(handle), ctypes.c_uint64(serial_value)),
            "open Airspy device by serial",
        )
        return cls(handle=handle, serial=serial_value)

    def close(self) -> None:
        if not self.handle:
            return
        lib = _get_airspy_lib()
        _raise_if_not_success(lib.airspy_close(self.handle), "close Airspy device")
        self.handle = ctypes.c_void_p()

    def is_streaming(self) -> bool:
        lib = _get_airspy_lib()
        code = lib.airspy_is_streaming(self.handle)
        _raise_if_error(code, "check Airspy stream state")
        return int(code) > 0

    def get_samplerates(self) -> List[int]:
        lib = _get_airspy_lib()
        return _extract_samplerates(lib.airspy_get_samplerates, self.handle)

    def set_sample_type_float32_iq(self) -> None:
        lib = _get_airspy_lib()
        _raise_if_not_success(
            lib.airspy_set_sample_type(self.handle, AIRSPY_SAMPLE_FLOAT32_IQ),
            "set Airspy sample type",
        )

    def set_samplerate(self, samplerate_hz: int) -> None:
        lib = _get_airspy_lib()
        _raise_if_not_success(
            lib.airspy_set_samplerate(self.handle, ctypes.c_uint32(int(samplerate_hz))),
            "set Airspy samplerate",
        )

    def set_frequency(self, frequency_hz: int) -> None:
        lib = _get_airspy_lib()
        _raise_if_not_success(
            lib.airspy_set_freq(self.handle, ctypes.c_uint32(int(frequency_hz))),
            "set Airspy frequency",
        )

    def set_sensitivity_gain(self, value: int) -> None:
        lib = _get_airspy_lib()
        _raise_if_not_success(
            lib.airspy_set_sensitivity_gain(self.handle, ctypes.c_uint8(int(value))),
            "set Airspy sensitivity gain",
        )

    def set_linearity_gain(self, value: int) -> None:
        lib = _get_airspy_lib()
        _raise_if_not_success(
            lib.airspy_set_linearity_gain(self.handle, ctypes.c_uint8(int(value))),
            "set Airspy linearity gain",
        )

    def set_lna_gain(self, value: int) -> None:
        lib = _get_airspy_lib()
        _raise_if_not_success(
            lib.airspy_set_lna_gain(self.handle, ctypes.c_uint8(int(value))),
            "set Airspy LNA gain",
        )

    def set_mixer_gain(self, value: int) -> None:
        lib = _get_airspy_lib()
        _raise_if_not_success(
            lib.airspy_set_mixer_gain(self.handle, ctypes.c_uint8(int(value))),
            "set Airspy mixer gain",
        )

    def set_vga_gain(self, value: int) -> None:
        lib = _get_airspy_lib()
        _raise_if_not_success(
            lib.airspy_set_vga_gain(self.handle, ctypes.c_uint8(int(value))),
            "set Airspy VGA gain",
        )

    def set_lna_agc(self, enabled: bool) -> None:
        lib = _get_airspy_lib()
        _raise_if_not_success(
            lib.airspy_set_lna_agc(self.handle, ctypes.c_uint8(1 if enabled else 0)),
            "set Airspy LNA AGC",
        )

    def set_mixer_agc(self, enabled: bool) -> None:
        lib = _get_airspy_lib()
        _raise_if_not_success(
            lib.airspy_set_mixer_agc(self.handle, ctypes.c_uint8(1 if enabled else 0)),
            "set Airspy mixer AGC",
        )

    def set_bias_t(self, enabled: bool) -> None:
        lib = _get_airspy_lib()
        _raise_if_not_success(
            lib.airspy_set_rf_bias(self.handle, ctypes.c_uint8(1 if enabled else 0)),
            "set Airspy bias tee",
        )

    def start_rx(self, callback: object) -> None:
        lib = _get_airspy_lib()
        _raise_if_not_success(lib.airspy_start_rx(self.handle, callback, None), "start Airspy RX")

    def stop_rx(self) -> None:
        lib = _get_airspy_lib()
        _raise_if_not_success(lib.airspy_stop_rx(self.handle), "stop Airspy RX")


@dataclass(slots=True)
class AirspyhfDevice:
    handle: ctypes.c_void_p
    serial: Optional[int] = None

    @staticmethod
    def list_serials(max_devices: int = 16) -> List[int]:
        lib = _get_airspyhf_lib()
        serials = (ctypes.c_uint64 * max_devices)()
        count = lib.airspyhf_list_devices(serials, max_devices)
        _raise_if_error(count, "list AirspyHF devices")
        return [int(serials[idx]) for idx in range(min(count, max_devices))]

    @classmethod
    def open(cls, serial: Optional[int] = None) -> "AirspyhfDevice":
        lib = _get_airspyhf_lib()
        handle = ctypes.c_void_p()
        if serial is None:
            _raise_if_not_success(lib.airspyhf_open(ctypes.byref(handle)), "open AirspyHF device")
            return cls(handle=handle, serial=None)

        serial_value = _normalize_serial(serial)
        _raise_if_not_success(
            lib.airspyhf_open_sn(ctypes.byref(handle), ctypes.c_uint64(serial_value)),
            "open AirspyHF device by serial",
        )
        return cls(handle=handle, serial=serial_value)

    def close(self) -> None:
        if not self.handle:
            return
        lib = _get_airspyhf_lib()
        _raise_if_not_success(lib.airspyhf_close(self.handle), "close AirspyHF device")
        self.handle = ctypes.c_void_p()

    def is_streaming(self) -> bool:
        lib = _get_airspyhf_lib()
        code = lib.airspyhf_is_streaming(self.handle)
        _raise_if_error(code, "check AirspyHF stream state")
        return int(code) > 0

    def get_samplerates(self) -> List[int]:
        lib = _get_airspyhf_lib()
        return _extract_samplerates(lib.airspyhf_get_samplerates, self.handle)

    def set_samplerate(self, samplerate_hz: int) -> None:
        lib = _get_airspyhf_lib()
        _raise_if_not_success(
            lib.airspyhf_set_samplerate(self.handle, ctypes.c_uint32(int(samplerate_hz))),
            "set AirspyHF samplerate",
        )

    def set_frequency(self, frequency_hz: int) -> None:
        lib = _get_airspyhf_lib()
        _raise_if_not_success(
            lib.airspyhf_set_freq(self.handle, ctypes.c_uint32(int(frequency_hz))),
            "set AirspyHF frequency",
        )

    def set_hf_agc(self, enabled: bool) -> None:
        lib = _get_airspyhf_lib()
        _raise_if_not_success(
            lib.airspyhf_set_hf_agc(self.handle, ctypes.c_uint8(1 if enabled else 0)),
            "set AirspyHF AGC",
        )

    def set_hf_att(self, value: int) -> None:
        lib = _get_airspyhf_lib()
        _raise_if_not_success(
            lib.airspyhf_set_hf_att(self.handle, ctypes.c_uint8(int(value))),
            "set AirspyHF attenuation",
        )

    def set_hf_lna(self, enabled: bool) -> None:
        lib = _get_airspyhf_lib()
        _raise_if_not_success(
            lib.airspyhf_set_hf_lna(self.handle, ctypes.c_uint8(1 if enabled else 0)),
            "set AirspyHF LNA",
        )

    def start_rx(self, callback: object) -> None:
        lib = _get_airspyhf_lib()
        _raise_if_not_success(lib.airspyhf_start(self.handle, callback, None), "start AirspyHF RX")

    def stop_rx(self) -> None:
        lib = _get_airspyhf_lib()
        _raise_if_not_success(lib.airspyhf_stop(self.handle), "stop AirspyHF RX")
