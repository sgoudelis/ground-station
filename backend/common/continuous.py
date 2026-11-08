# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Validation for durable continuous definitions; never opens hardware or workers."""

from datetime import datetime, timezone
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    TypeAdapter,
    field_validator,
    model_validator,
)

from demodulators.loraconfig import LORA_DEFAULTS, normalize_lora

PositiveInt = Annotated[int, Field(gt=0, le=1_000_000_000_000)]
PositiveRate = Annotated[float, Field(gt=0, le=1_000_000_000, allow_inf_nan=False)]
FiniteNumber = Annotated[float, Field(allow_inf_nan=False)]
PortName = Annotated[str, Field(min_length=1, max_length=128)]
Bandwidth = PositiveRate | Literal["auto", "driver"] | None
Decoder = Literal[
    "none",
    "fsk",
    "gmsk",
    "gfsk",
    "bpsk",
    "aprs",
    "sstv",
    "apt",
    "geoscanimage",
    "radiosonde",
    "lora",
    "adsb",
    "gnss",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", strict=True, str_strip_whitespace=True, allow_inf_nan=False
    )


class Identity(StrictModel):
    id: str

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        return str(UUID(value))


class VersionedIdentity(Identity):
    expected_updated_at: str = Field(max_length=64)

    @field_validator("expected_updated_at")
    @classmethod
    def valid_timestamp(cls, value: str) -> str:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("An update timestamp with timezone is required.")
        return parsed.astimezone(timezone.utc).isoformat()


class UhdSettings(StrictModel):
    bandwidth: Bandwidth = None
    clockSource: PortName | None = None
    timeSource: PortName | None = None


class ReceiverSettings(UhdSettings):
    gains: dict[Annotated[str, Field(min_length=1, max_length=128)], FiniteNumber | None] = Field(
        default_factory=dict, max_length=32
    )
    bitpack: bool | None = None
    uhd: UhdSettings | None = None


class Receiver(Identity):
    name: str = Field(default="", max_length=200)
    center_frequency: PositiveInt
    sample_rate: PositiveRate
    gain: FiniteNumber
    antenna_port: PortName
    auto_center_frequency: bool = True
    bias_t: bool = False
    tuner_agc: bool = False
    rtl_agc: bool = False
    soapy_agc: bool = False
    sdr_settings: ReceiverSettings = Field(default_factory=ReceiverSettings)


# Flat, prefixed keys are the existing editor format. Reject unsupported fields
# instead of accepting arbitrary worker overrides in a persisted definition.
PARAMETERS: dict[str, dict[str, Any]] = {}
for _decoder in ("fsk", "gfsk", "gmsk", "bpsk"):
    PARAMETERS[_decoder] = {
        "baudrate": Annotated[int, Field(gt=0, le=10_000_000)],
        "framing": Literal["ax25", "usp", "geoscan", "doka", "ax100_asm", "ax100_rs"],
    }
    if _decoder != "bpsk":
        PARAMETERS[_decoder].update(
            deviation=FiniteNumber | None, geoscan_frame_size=Literal[66, 74]
        )
    else:
        PARAMETERS[_decoder]["differential"] = bool
PARAMETERS.update(
    {
        "none": {},
        "apt": {},
        "aprs": {
            "baudrate": Annotated[int, Field(gt=0, le=10_000_000)],
            "af_carrier": PositiveRate,
            "deviation": PositiveRate,
        },
        "sstv": {
            "mode": Literal[
                "auto",
                "robot36",
                "martin_m1",
                "martin_m2",
                "scottie_s1",
                "scottie_s2",
                "scottie_dx",
                "wraase_sc2_180",
            ]
        },
        "geoscanimage": {
            "baudrate": PositiveInt,
            "deviation": FiniteNumber,
            "frame_size": Literal[66, 74],
            "syncword_threshold": Annotated[int, Field(ge=0, le=32)],
            "satellite_id": Annotated[int, Field(ge=0, le=255)],
        },
        "radiosonde": {
            "type": Literal["auto", "rs41", "dfm", "m10m20"],
            "sample_rate": Literal[48000, 96000],
            "save_interval": Annotated[int, Field(ge=0, le=3600)],
        },
        "adsb": {"save_interval": Annotated[int, Field(ge=0, le=3600)], "capture_messages": bool},
        "gnss": {
            "sample_rate": PositiveInt,
            "total_channels": Annotated[int, Field(ge=1, le=128)],
            "output_rate_ms": Annotated[int, Field(ge=1, le=60000)],
            "doppler_max": Annotated[int, Field(ge=1, le=100000)],
            **{
                f"enable_{system}": bool
                for system in ("gps", "galileo", "glonass", "beidou", "qzss")
            },
        },
        "lora": {
            key: (
                bool
                if isinstance(default, bool)
                else (
                    Annotated[list[Annotated[int, Field(ge=0, le=4095)]], Field(max_length=2)]
                    if isinstance(default, list)
                    else int
                )
            )
            for key, default in LORA_DEFAULTS.items()
        },
    }
)
PARAMETER_ADAPTERS = {
    decoder: {f"{decoder}_{key}": TypeAdapter(value) for key, value in rules.items()}
    for decoder, rules in PARAMETERS.items()
}


def normalize_vfo_mode(vfo: dict[str, Any]) -> dict[str, Any]:
    """Interpret older stored audio fallbacks as inactive beside a decoder."""
    return {**vfo, "modulation": "none"} if vfo.get("decoder", "none") != "none" else vfo


class Vfo(Identity):
    frequency: PositiveInt
    bandwidth: PositiveRate
    modulation: Literal["none", "fm", "am", "usb", "lsb", "cw"]
    decoder: Decoder
    decoder_parameters: dict[str, JsonValue] = Field(default_factory=dict, max_length=32)

    @model_validator(mode="after")
    def valid_parameters(self) -> Self:
        # Accept older definitions with an audio fallback, but persist only the
        # effective decoder mode, matching the waterfall's exclusive controls.
        if self.decoder != "none":
            self.modulation = "none"
        adapters = PARAMETER_ADAPTERS[self.decoder]
        for key, value in self.decoder_parameters.items():
            if key not in adapters:
                raise ValueError(f"Unsupported {self.decoder} parameter: {key}")
            rule = PARAMETERS[self.decoder][key.removeprefix(f"{self.decoder}_")]
            if isinstance(value, bool) and rule is not bool:
                raise ValueError(f"{key} requires a number, not a boolean.")
            adapters[key].validate_python(value, strict=True)
        if self.decoder == "lora":
            normalize_lora(
                {key.removeprefix("lora_"): value for key, value in self.decoder_parameters.items()}
            )
        return self


class Definition(Identity):
    name: str = Field(min_length=1, max_length=200)
    auto_start: bool = True
    config_version: Literal[1] = 1
    sdr: Receiver
    vfos: list[Vfo] = Field(min_length=1, max_length=10)

    @field_validator("config_version", mode="before")
    @classmethod
    def valid_config_version(cls, value: Any) -> Any:
        if type(value) is not int:
            raise ValueError("Config version must be an integer.")
        return value

    @model_validator(mode="after")
    def valid_channels(self) -> Self:
        if len({vfo.id for vfo in self.vfos}) != len(self.vfos):
            raise ValueError("VFO identifiers must be unique within a definition.")
        return self


class UpdateDefinition(Definition, VersionedIdentity):
    pass
