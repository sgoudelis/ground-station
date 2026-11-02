"""LoRa PHY settings shared by the resolver and receiver (no native imports)."""

import re
from typing import Any

LORA_DEFAULTS: dict[str, Any] = {
    "sf": 7,
    "bw": 125000,
    "cr": 1,
    "sync_word": [0x12],
    "preamble_len": 8,
    "ldro_mode": 2,  # gr-lora_sdr: off=0, on=1, automatic=2
    "implicit_header": False,
    "payload_length": 255,
    "has_crc": True,
    "invert_iq": False,
}


def lora_sync_symbols(sync_word: list[int], sf: int) -> list[int]:
    """Expand a Semtech network byte into the native receiver's FFT bins."""
    if len(sync_word) != 1:
        return list(sync_word)
    # Hardware encodes each nibble as a signed four-bit offset. The native
    # library's unsigned byte expansion rejects e.g. Meshtastic 0x2B at SF > 7.
    nibbles = (sync_word[0] >> 4, sync_word[0] & 0x0F)
    return [(((nibble + 8) % 16 - 8) * 8) % (1 << sf) for nibble in nibbles]


def normalize_lora(values: dict[str, Any]) -> dict[str, Any]:
    """Validate before passing settings to native blocks; retain legacy aliases."""
    params: dict[str, Any] = {key: values.get(key) for key in LORA_DEFAULTS}
    params = {key: value for key, value in params.items() if value is not None}
    if "ldro_mode" not in params and values.get("fldro") is not None:
        # TinyGS fldro means FORCE LDRO. False still permits automatic LDRO.
        params["ldro_mode"] = 1 if values["fldro"] else 2
    params = {**LORA_DEFAULTS, **params}
    for key, low, high in (
        ("sf", 7, 12),
        ("bw", 7800, 500000),
        ("cr", 1, 8),
        ("preamble_len", 5, 65535),
        ("payload_length", 1, 255),
        ("ldro_mode", 0, 2),
    ):
        value = params[key]
        number = int(value)
        if float(value) != number or not low <= number <= high:
            raise ValueError(f"LoRa {key} must be an integer between {low} and {high}")
        params[key] = number
    # TinyGS uses denominators 5..8; old Ground Station configs use 1..4.
    if params["cr"] >= 5:
        params["cr"] -= 4
    for key in ("implicit_header", "has_crc", "invert_iq"):
        if params[key] not in (True, False, 0, 1):
            raise ValueError(f"LoRa {key} must be a boolean")
        params[key] = bool(params[key])
    sync = params["sync_word"]
    if isinstance(sync, str):
        sync = int(sync, 16 if sync.lower().startswith("0x") else 10)
    if isinstance(sync, int):
        sync = [sync]
    if not isinstance(sync, (list, tuple)) or len(sync) > 2:
        raise ValueError("LoRa sync_word must be a byte or one/two sync symbols")
    if not sync:
        sync = [0, 0]  # Native code cannot safely accept an empty vector.
    limit = 255 if len(sync) == 1 else (1 << params["sf"]) - 1
    if any(not isinstance(value, int) or not 0 <= value <= limit for value in sync):
        raise ValueError(f"LoRa sync_word values must be integers between 0 and {limit}")
    params["sync_word"] = list(sync)
    if params["implicit_header"] and params["has_crc"] and params["payload_length"] < 2:
        raise ValueError("The LoRa receiver requires at least two payload bytes with CRC")
    return params


def lora_metadata(transmitter: dict[str, Any]) -> dict[str, Any]:
    """Read explicit PHY fields and unambiguous SF/BW/CR description tokens."""
    description = str(transmitter.get("description") or "")
    params = {}
    for key, pattern in (
        ("sf", r"\bSF\s*[:=]?\s*(7|8|9|10|11|12)\b"),
        ("bw", r"\bBW\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(k(?:hz)?|hz)?\b"),
        ("cr", r"\bCR\s*[:=]?\s*4\s*/\s*([5-8])\b"),
    ):
        match = re.search(pattern, description, re.IGNORECASE)
        if match:
            value = float(match[1])
            if key == "bw" and (
                str(match[2]).lower().startswith("k") or (not match[2] and value <= 500)
            ):
                value *= 1000
            params[key] = int(value)
    profile = transmitter.get("lora_config")
    if isinstance(profile, dict):
        for key in LORA_DEFAULTS:
            if profile.get(key) is not None:
                params[key] = profile[key]
    for key in (*LORA_DEFAULTS, "fldro"):
        if transmitter.get(key) is not None:
            params[key] = transmitter[key]
    return params
