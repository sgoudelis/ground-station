"""The packet boundary shared by capture, preview and reparsing."""

from dataclasses import asdict, dataclass
from typing import Any

from constants import AX25_FRAMINGS, payload_protocol_from_framing

PROTOCOLS = {"ax25", "csp", "ccsds", "proprietary", "lora", "unknown"}


@dataclass(frozen=True)
class ParseContext:
    protocol: str
    framing: str | None = None
    satellite: str | None = None
    frame_size: int | None = None
    csp_version: int = 1
    hdlc_flags: bool = False

    def __post_init__(self):
        if not isinstance(self.protocol, str) or self.protocol not in PROTOCOLS:
            raise ValueError("Unsupported packet protocol")
        if type(self.csp_version) is not int or self.csp_version not in (1, 2):
            raise ValueError("CSP version must be 1 or 2")
        if self.frame_size is not None and (
            type(self.frame_size) is not int or self.frame_size <= 0
        ):
            raise ValueError("Invalid packet frame size")
        if self.satellite is not None and not isinstance(self.satellite, str):
            raise ValueError("Invalid packet satellite name")
        if self.framing is not None and not isinstance(self.framing, str):
            raise ValueError("Invalid packet framing")
        if type(self.hdlc_flags) is not bool:
            raise ValueError("Invalid packet byte representation")
        if self.hdlc_flags and self.protocol != "ax25":
            raise ValueError("HDLC recorder flags require AX.25")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def packet_bytes(self, original: bytes) -> bytes:
        # Flags are a recorder convention for AX.25, never a byte-value guess
        # for CSP, CCSDS, GEOSCAN or LoRa application data.
        if self.hdlc_flags:
            return original.removeprefix(b"\x7e").removesuffix(b"\x7e")
        return original

    @classmethod
    def from_metadata(cls, metadata: dict[str, Any]) -> "ParseContext":
        if "parse_context" in metadata:
            saved = metadata["parse_context"]
            if not isinstance(saved, dict):
                raise ValueError("Invalid saved parsing context")
            try:
                return cls(**saved)
            except TypeError as exc:
                raise ValueError("Invalid saved parsing context") from exc
        config = metadata.get("decoder_config") or {}
        previous = metadata.get("telemetry") or {}
        decoder = metadata.get("decoder") or {}
        satellite = metadata.get("satellite") or {}
        if not all(isinstance(section, dict) for section in (config, previous, decoder, satellite)):
            raise ValueError("Invalid packet decoding metadata")
        framing = config.get("framing")
        if framing is not None and not isinstance(framing, str):
            raise ValueError("Invalid packet framing")
        # Known framing wins over historical payload_protocol mistakes (notably
        # FSK AX100/DOKA captures previously recorded as proprietary).
        protocol = payload_protocol_from_framing(framing, default="")
        if framing == "lora" or decoder.get("type") == "lora":
            protocol = "lora"
        candidate = protocol or config.get("payload_protocol") or previous.get("protocol")
        if not isinstance(candidate, str) or candidate not in PROTOCOLS - {"unknown"}:
            raise ValueError("Packet metadata does not identify a supported payload protocol")
        params = config.get("framing_params") or {}
        geoscan = config.get("geoscan") or {}
        if not isinstance(params, dict) or not isinstance(geoscan, dict):
            raise ValueError("Invalid packet framing parameters")
        version = config.get("csp_version", params.get("csp_version", 1))
        if type(version) is not int:
            raise ValueError("CSP version must be 1 or 2")
        return cls(
            protocol=candidate,
            framing=framing,
            satellite=satellite.get("name"),
            frame_size=config.get("frame_size")
            or params.get("frame_size")
            or geoscan.get("frame_size"),
            csp_version=version,
            hdlc_flags=candidate == "ax25" and (framing in AX25_FRAMINGS or framing is None),
        )
