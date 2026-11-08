# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

import copy
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import async_sessionmaker

from alembic import command
from common import auth
from common.continuous import Definition, UpdateDefinition, VersionedIdentity
from crud import continuous
from crud.hardware import delete_sdrs
from db import migrations
from db.models import ContinuousObservations, SDRs, SDRType
from handlers.entities import continuous as handlers
from handlers.routing.dispatcher import dispatch_request
from handlers.routing.registry import HandlerRegistry

pytestmark = pytest.mark.unit


@pytest.fixture
async def receiver(db_session):
    receiver = SDRs(
        id=uuid4(),
        name="VHF receiver",
        type=SDRType.RTLSDRUSBV3,
        frequency_min=24,
        frequency_max=1766,
    )
    db_session.add(receiver)
    await db_session.commit()
    return receiver


@pytest.fixture
async def payload(receiver):
    return {
        "id": str(uuid4()),
        "name": " VHF monitoring ",
        "auto_start": True,
        "sdr": {
            "id": str(receiver.id),
            "name": "Untrusted display name",
            "center_frequency": 146300000,
            "auto_center_frequency": True,
            "sample_rate": 2000000,
            "gain": 0,
            "antenna_port": "RX",
            "sdr_settings": {},
        },
        "vfos": [
            {
                "id": str(uuid4()),
                "frequency": 145800000,
                "bandwidth": 12500,
                "modulation": "fm",
                "decoder": "none",
                "decoder_parameters": {},
            }
        ],
    }


def editable(saved):
    return {key: value for key, value in saved.items() if key not in ("created_at", "updated_at")}


@pytest.mark.asyncio
async def test_durable_round_trip_and_server_metadata(db_session, db_engine, payload, receiver):
    saved = await continuous.create_definition(db_session, Definition.model_validate(payload))
    assert saved["name"] == "VHF monitoring"
    assert saved["config_version"] == 1
    assert saved["sdr"]["name"] == receiver.name
    assert datetime.fromisoformat(saved["updated_at"]).tzinfo is not None
    assert await continuous.list_definitions(db_session) == [saved]
    # A fresh session exercises serialization from storage, not the ORM identity map.
    async with async_sessionmaker(db_engine, expire_on_commit=False)() as other:
        assert await continuous.list_definitions(other, saved["id"]) == saved
        change = {
            **editable(saved),
            "name": "Updated",
            "auto_start": False,
            "expected_updated_at": saved["updated_at"],
        }
        updated = await continuous.update_definition(other, UpdateDefinition.model_validate(change))
    assert updated["created_at"] == saved["created_at"]
    assert updated["updated_at"] > saved["updated_at"]
    assert updated["name"] == "Updated"
    assert updated["auto_start"] is False
    async with async_sessionmaker(db_engine, expire_on_commit=False)() as other:
        await continuous.delete_definition(
            other, VersionedIdentity(id=saved["id"], expected_updated_at=updated["updated_at"])
        )
        assert await continuous.list_definitions(other) == []
        with pytest.raises(continuous.DefinitionError, match="not found"):
            await continuous.list_definitions(other, saved["id"])


@pytest.mark.asyncio
async def test_retries_are_idempotent_but_never_overwrite(db_session, payload):
    definition = Definition.model_validate(payload)
    saved = await continuous.create_definition(db_session, definition)
    assert await continuous.create_definition(db_session, definition) == saved
    definition.name = "A different definition"
    with pytest.raises(continuous.DefinitionError) as failure:
        await continuous.create_definition(db_session, definition)
    assert failure.value.code == "conflict"
    assert (await continuous.list_definitions(db_session))[0] == saved


@pytest.mark.asyncio
async def test_two_editors_cannot_overwrite_or_delete_newer_changes(db_session, db_engine, payload):
    saved = await continuous.create_definition(db_session, Definition.model_validate(payload))
    request = {
        **editable(saved),
        "name": "First editor",
        "expected_updated_at": saved["updated_at"],
    }
    async with async_sessionmaker(db_engine, expire_on_commit=False)() as first:
        updated = await continuous.update_definition(
            first, UpdateDefinition.model_validate(request)
        )
    async with async_sessionmaker(db_engine, expire_on_commit=False)() as stale:
        with pytest.raises(continuous.DefinitionError) as failure:
            await continuous.update_definition(
                stale, UpdateDefinition.model_validate({**request, "name": "Stale editor"})
            )
        assert failure.value.code == "conflict"
        with pytest.raises(continuous.DefinitionError):
            await continuous.delete_definition(
                stale, VersionedIdentity(id=saved["id"], expected_updated_at=saved["updated_at"])
            )
        assert await continuous.list_definitions(stale, saved["id"]) == updated


@pytest.mark.parametrize(
    "path,value",
    [
        (("id",), "invalid"),
        (("name",), " "),
        (("name",), "x" * 201),
        (("config_version",), True),
        (("auto_start",), 1),
        (("unexpected",), True),
        (("created_at",), "2000-01-01"),
        (("sdr", "sample_rate"), True),
        (("sdr", "sample_rate"), float("inf")),
        (("sdr", "gain"), float("nan")),
        (("sdr", "id"), "unknown"),
        (("sdr", "center_frequency"), 145800000.5),
        (("sdr", "sample_rate"), "2000000"),
        (("sdr", "sdr_settings"), {"worker_override": "bad"}),
        (("vfos",), []),
        (("vfos", 0, "bandwidth"), -1),
        (("vfos", 0, "decoder"), "arbitrary"),
        (("vfos", 0, "transmitter_id"), "tx"),
        (("vfos", 0, "decoder_parameters"), {"unsafe": True}),
    ],
)
def test_invalid_definitions(payload, path, value):
    invalid = copy.deepcopy(payload)
    target = invalid
    for part in path[:-1]:
        target = target[part]
    target[path[-1]] = value
    with pytest.raises(ValidationError):
        Definition.model_validate(invalid)


def test_unique_and_bounded_vfos(payload):
    invalid = copy.deepcopy(payload)
    invalid["vfos"] *= 2
    with pytest.raises(ValidationError, match="unique"):
        Definition.model_validate(invalid)
    invalid["vfos"] = [{**invalid["vfos"][0], "id": str(uuid4())} for _ in range(11)]
    with pytest.raises(ValidationError):
        Definition.model_validate(invalid)


@pytest.mark.parametrize(
    "decoder,params",
    [
        ("none", {}),
        ("apt", {}),
        ("sstv", {"sstv_mode": "auto"}),
        (
            "fsk",
            {
                "fsk_baudrate": 1234,
                "fsk_deviation": 563.5,
                "fsk_framing": "geoscan",
                "fsk_geoscan_frame_size": 66,
            },
        ),
        (
            "gfsk",
            {
                "gfsk_baudrate": 9600,
                "gfsk_deviation": None,
                "gfsk_framing": "ax25",
                "gfsk_geoscan_frame_size": 66,
            },
        ),
        (
            "gmsk",
            {
                "gmsk_baudrate": 9600,
                "gmsk_deviation": None,
                "gmsk_framing": "usp",
                "gmsk_geoscan_frame_size": 74,
            },
        ),
        ("bpsk", {"bpsk_baudrate": 1200, "bpsk_framing": "ax25", "bpsk_differential": False}),
        ("aprs", {"aprs_baudrate": 1200, "aprs_af_carrier": 1700, "aprs_deviation": 500}),
        (
            "geoscanimage",
            {
                "geoscanimage_baudrate": 9600,
                "geoscanimage_deviation": 5000,
                "geoscanimage_frame_size": 74,
                "geoscanimage_syncword_threshold": 4,
                "geoscanimage_satellite_id": 9,
            },
        ),
        (
            "radiosonde",
            {
                "radiosonde_type": "auto",
                "radiosonde_sample_rate": 48000,
                "radiosonde_save_interval": 5,
            },
        ),
        ("adsb", {"adsb_save_interval": 0, "adsb_capture_messages": False}),
        (
            "gnss",
            {
                "gnss_sample_rate": 4000000,
                "gnss_total_channels": 24,
                "gnss_output_rate_ms": 500,
                "gnss_doppler_max": 6000,
                **{
                    f"gnss_enable_{name}": name == "gps"
                    for name in ("gps", "galileo", "glonass", "beidou", "qzss")
                },
            },
        ),
        (
            "lora",
            {
                "lora_sf": 7,
                "lora_bw": 125000,
                "lora_cr": 1,
                "lora_sync_word": [18],
                "lora_preamble_len": 8,
                "lora_ldro_mode": 2,
                "lora_implicit_header": False,
                "lora_payload_length": 255,
                "lora_has_crc": True,
                "lora_invert_iq": False,
            },
        ),
    ],
)
def test_all_editor_decoder_profiles(payload, decoder, params):
    payload["vfos"][0].update(decoder=decoder, decoder_parameters=params)
    vfo = Definition.model_validate(payload).vfos[0]
    assert vfo.decoder_parameters == params
    assert vfo.modulation == ("fm" if decoder == "none" else "none")


@pytest.mark.parametrize(
    "params",
    [
        {"lora_sf": 99},
        {"lora_sync_word": [9999]},
        {"lora_sf": True},
        {"lora_has_crc": 1},
        {"lora_implicit_header": True, "lora_has_crc": True, "lora_payload_length": 1},
    ],
)
def test_invalid_lora_parameters(payload, params):
    payload["vfos"][0].update(decoder="lora", decoder_parameters=params)
    with pytest.raises(ValidationError):
        Definition.model_validate(payload)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case", ["unknown", "playback", "tuning", "channel_edge", "flat_filter", "uhd_filter"]
)
async def test_receiver_and_full_channel_validation(db_session, payload, receiver, case):
    if case == "unknown":
        payload["sdr"]["id"] = str(uuid4())
    elif case == "playback":
        receiver.type = SDRType.SIGMFPLAYBACK
    elif case == "tuning":
        payload["sdr"]["center_frequency"] = 1
    elif case == "channel_edge":
        payload["vfos"][0]["frequency"] = 147300000
    elif case == "flat_filter":
        payload["sdr"]["sdr_settings"] = {"bandwidth": 500000}
    else:
        receiver.type = SDRType.UHD
        payload["sdr"]["sdr_settings"] = {"bandwidth": 2000000, "uhd": {"bandwidth": 500000}}
    await db_session.commit()
    with pytest.raises(continuous.DefinitionError):
        await continuous.create_definition(db_session, Definition.model_validate(payload))
    assert await continuous.list_definitions(db_session) == []


@pytest.mark.asyncio
async def test_inactive_uhd_settings_do_not_change_flat_driver_bandwidth(db_session, payload):
    payload["sdr"]["sdr_settings"] = {"bandwidth": 2000000, "uhd": {"bandwidth": 100}}
    await continuous.create_definition(db_session, Definition.model_validate(payload))


@pytest.mark.asyncio
async def test_referenced_receiver_cannot_be_deleted(db_session, payload, receiver):
    saved = await continuous.create_definition(db_session, Definition.model_validate(payload))
    result = await delete_sdrs(db_session, [str(receiver.id)])
    assert result["success"] is False
    assert "continuous observation" in result["error"]
    assert await db_session.get(SDRs, receiver.id) is not None
    await continuous.delete_definition(
        db_session, VersionedIdentity(id=saved["id"], expected_updated_at=saved["updated_at"])
    )
    assert (await delete_sdrs(db_session, [str(receiver.id)]))["success"] is True


@pytest.mark.asyncio
async def test_api_authentication_validation_and_notifications(db_session, payload, monkeypatch):
    @asynccontextmanager
    async def session_factory():
        yield db_session

    monkeypatch.setattr(handlers, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(auth, "is_setup_required", AsyncMock(return_value=False))
    registry = HandlerRegistry()
    handlers.register_handlers(registry)
    sio = MagicMock(emit=AsyncMock())
    args = (sio, "continuous-observations.create", payload, MagicMock(), "sid", registry)
    denied = await dispatch_request(*args)
    assert denied["success"] is False
    assert await continuous.list_definitions(db_session) == []
    allowed = await dispatch_request(*args, auth_context={"role": "operator"})
    assert allowed["success"] is True
    sio.emit.assert_awaited_once_with("continuous-observations-changed", {"id": payload["id"]})
    assert allowed["data"]["name"] == "VHF monitoring"
    monkeypatch.setattr(auth, "is_setup_required", AsyncMock(return_value=True))
    denied = await dispatch_request(*args, auth_context={"role": "operator"})
    assert denied["success"] is False


@pytest.mark.asyncio
async def test_invalid_api_payloads_never_open_storage(monkeypatch):
    factory = MagicMock()
    monkeypatch.setattr(handlers, "AsyncSessionLocal", factory)
    for handler, payload in (
        (handlers.create_definition, {}),
        (handlers.get_definition, {"id": "bad"}),
        (handlers.update_definition, {}),
        (handlers.list_definitions, {"extra": 1}),
        (handlers.delete_definition, {"id": str(uuid4()), "expected_updated_at": "2026-01-01"}),
    ):
        reply = await handler(None, payload, MagicMock(), "sid")
        assert reply["success"] is False
        assert reply["code"] == "validation"
    factory.assert_not_called()


@pytest.mark.asyncio
async def test_broadcast_failure_does_not_report_committed_write_as_failed(
    db_session, payload, monkeypatch
):
    @asynccontextmanager
    async def session_factory():
        yield db_session

    monkeypatch.setattr(handlers, "AsyncSessionLocal", session_factory)
    sio = MagicMock(emit=AsyncMock(side_effect=RuntimeError("broadcast failed")))
    reply = await handlers.create_definition(sio, payload, MagicMock(), "sid")
    assert reply["success"] is True
    assert await db_session.get(ContinuousObservations, payload["id"]) is not None


@pytest.mark.asyncio
async def test_storage_errors_are_hidden(monkeypatch):
    factory = MagicMock(side_effect=RuntimeError("private database details"))
    monkeypatch.setattr(handlers, "AsyncSessionLocal", factory)
    logger = MagicMock()
    reply = await handlers.list_definitions(None, {}, logger, "sid")
    assert reply == {
        "success": False,
        "data": None,
        "error": "Unable to access continuous observations.",
        "code": "storage",
    }
    logger.exception.assert_called_once()


def test_migration_round_trip_preserves_existing_tables(monkeypatch, tmp_path):
    path = tmp_path / "continuous.db"
    monkeypatch.setenv("GS_DB", str(path))
    config = migrations.get_alembic_config()
    command.upgrade(config, "f6a8b1c3d5e7")
    with sqlite3.connect(path) as connection:
        connection.execute(
            "INSERT INTO sdrs (id, name, added, updated) VALUES (?, 'Existing radio', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            (uuid4().hex,),
        )
    command.upgrade(config, "a7c9e1b3d5f8")
    with sqlite3.connect(path) as connection:
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(continuous_observations)")
        }
        assert {"id", "sdr_config", "vfos", "config_version", "updated_at"} <= columns
        assert "status" not in columns
        assert (
            connection.execute("PRAGMA foreign_key_list(continuous_observations)").fetchone()[2]
            == "sdrs"
        )
    command.downgrade(config, "f6a8b1c3d5e7")
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT name FROM sdrs").fetchone() == ("Existing radio",)
        assert (
            connection.execute(
                "SELECT name FROM sqlite_master WHERE name='continuous_observations'"
            ).fetchone()
            is None
        )


@pytest.mark.asyncio
async def test_equivalent_timezone_version_is_normalized(db_session, payload):
    saved = await continuous.create_definition(db_session, Definition.model_validate(payload))
    equivalent = datetime.fromisoformat(saved["updated_at"]).astimezone(
        timezone(timedelta(hours=2))
    )
    updated = await continuous.update_definition(
        db_session,
        UpdateDefinition.model_validate(
            {
                **editable(saved),
                "name": "Offset timestamp",
                "expected_updated_at": equivalent.isoformat(),
            }
        ),
    )
    assert updated["name"] == "Offset timestamp"


@pytest.mark.asyncio
@pytest.mark.parametrize("modulation", ["none", "fm", "am", "usb", "lsb", "cw"])
async def test_exclusive_audio_or_idle_mode_round_trip(db_session, payload, modulation):
    payload["vfos"][0]["modulation"] = modulation
    saved = await continuous.create_definition(db_session, Definition.model_validate(payload))
    assert saved["vfos"][0]["modulation"] == modulation
    assert saved["vfos"][0]["decoder"] == "none"


@pytest.mark.asyncio
async def test_legacy_decoder_modes_read_exclusively_and_allow_idempotent_import(
    db_session, payload
):
    payload["vfos"][0].update(decoder="aprs", decoder_parameters={"aprs_baudrate": 1200})
    definition = Definition.model_validate(payload)
    saved = await continuous.create_definition(db_session, definition)
    assert saved["vfos"][0]["modulation"] == "none"
    row = await db_session.get(ContinuousObservations, payload["id"])
    # Simulate the old UI's stored audio fallback, without silently migrating it.
    row.vfos = [{**vfo, "modulation": "fm"} for vfo in row.vfos]
    await db_session.commit()
    assert (await continuous.list_definitions(db_session, row.id))["vfos"][0][
        "modulation"
    ] == "none"
    retried = await continuous.create_definition(db_session, definition)
    assert retried["vfos"][0]["modulation"] == "none"
    assert retried["updated_at"] == row.updated_at.isoformat()
    assert row.vfos[0]["modulation"] == "fm"


@pytest.mark.asyncio
@pytest.mark.parametrize("center", [24000000, 145800000, 1766000000])
async def test_hardware_mhz_tuning_limits_accept_in_range_centers(db_session, payload, center):
    payload["sdr"]["center_frequency"] = center
    payload["vfos"][0]["frequency"] = center
    saved = await continuous.create_definition(db_session, Definition.model_validate(payload))
    assert saved["sdr"]["center_frequency"] == center


@pytest.mark.asyncio
@pytest.mark.parametrize("center", [23999999, 1766000001])
async def test_hardware_mhz_tuning_limits_reject_out_of_range_centers(db_session, payload, center):
    payload["sdr"]["center_frequency"] = center
    payload["vfos"][0]["frequency"] = center
    with pytest.raises(continuous.DefinitionError, match="tuning range"):
        await continuous.create_definition(db_session, Definition.model_validate(payload))


@pytest.mark.asyncio
async def test_fractional_mhz_tuning_limits(db_session, receiver, payload):
    receiver.frequency_min = 0.009
    receiver.frequency_max = 260
    await db_session.commit()
    payload["sdr"]["center_frequency"] = 9000
    payload["vfos"][0]["frequency"] = 9000
    saved = await continuous.create_definition(db_session, Definition.model_validate(payload))
    assert saved["sdr"]["center_frequency"] == 9000
