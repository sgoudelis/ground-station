"""CSP headers with an explicit version; AX100 profiles use CSP v1 by default."""

from typing import Any


class CSPParser:
    def parse(self, packet: bytes, version: int = 1) -> dict[str, Any]:
        if version not in (1, 2):
            return {"success": False, "error": "Unsupported CSP version"}
        size = 4 if version == 1 else 6
        if len(packet) < size:
            return {"success": False, "error": "Packet too short for CSP header"}
        word = int.from_bytes(packet[:size], "big")
        if version == 1:
            headers = {
                "prio": (word >> 30) & 3,
                "src": (word >> 25) & 31,
                "dst": (word >> 20) & 31,
                "dport": (word >> 14) & 63,
                "sport": (word >> 8) & 63,
                "flags": word & 255,
            }
        else:
            # CSP v2 is a 48-bit header, not an alternate guess at v1's four bytes.
            headers = {
                "prio": (word >> 46) & 3,
                "dst": (word >> 32) & 16383,
                "src": (word >> 18) & 16383,
                "dport": (word >> 12) & 63,
                "sport": (word >> 6) & 63,
                "flags": word & 63,
            }
        headers.update(version=version, raw_header=word)
        return {"success": True, "headers": headers, "payload": packet[size:]}
