from types import SimpleNamespace

from observations.tasks.decoderhandler import (
    DecoderHandler,
    VFOManager,
    decoder_registry,
    map_scheduler_decoder_parameters,
)


def test_maps_radiosonde_scheduler_parameters_to_decoder_overrides():
    assert map_scheduler_decoder_parameters(
        "radiosonde",
        {"radiosonde_type": "dfm", "radiosonde_sample_rate": 96000, "radiosonde_save_interval": 0},
    ) == {
        "radiosonde_sample_rate": 96000,
        "radiosonde_type": "dfm",
        "radiosonde_save_interval": 0,
    }


def test_maps_aprs_scheduler_parameters_to_decoder_overrides():
    parameters = {
        "aprs_baudrate": 1240,
        "aprs_af_carrier": 1810,
        "aprs_deviation": 565,
    }
    assert map_scheduler_decoder_parameters("aprs", parameters) == {
        "baudrate": 1240,
        "af_carrier": 1810,
        "deviation": 565,
    }


def test_maps_geoscan_image_scheduler_parameters_to_decoder_overrides():
    assert map_scheduler_decoder_parameters(
        "geoscanimage",
        {
            "geoscanimage_baudrate": 9600,
            "geoscanimage_deviation": 5000,
            "geoscanimage_frame_size": 74,
            "geoscanimage_syncword_threshold": 4,
            "geoscanimage_satellite_id": 9,
        },
    ) == {
        "baudrate": 9600,
        "deviation": 5000,
        "framing_params": {"frame_size": 74, "syncword_threshold": 4, "satellite_id": 9},
    }


def test_preserves_false_values_and_accepts_normalized_parameters():
    parameters = {
        "bpsk_baudrate": 1200,
        "bpsk_differential": False,
        "framing": "ax25",
    }

    assert map_scheduler_decoder_parameters("bpsk", parameters) == {
        "baudrate": 1200,
        "differential": False,
        "framing": "ax25",
    }


def test_nests_scheduler_geoscan_frame_size():
    parameters = {
        "fsk_baudrate": 9600,
        "fsk_framing": "geoscan",
        "fsk_geoscan_frame_size": 74,
    }

    assert map_scheduler_decoder_parameters("fsk", parameters) == {
        "baudrate": 9600,
        "framing": "geoscan",
        "framing_params": {"frame_size": 74},
    }


def test_ignores_invalid_scheduler_parameter_containers():
    assert map_scheduler_decoder_parameters("aprs", None) == {}
    assert map_scheduler_decoder_parameters("aprs", []) == {}


def test_maps_forced_sstv_mode_to_decoder_override():
    assert map_scheduler_decoder_parameters("sstv", {"sstv_mode": "scottie_s2"}) == {
        "sstv_mode": "scottie_s2"
    }


async def test_scheduled_aprs_parameters_reach_process_manager(monkeypatch):
    captured_kwargs = {}

    class ProcessManagerStub:
        processes = {"sdr-1": {"data_queue": object()}}

        @staticmethod
        def start_decoder(**kwargs):
            captured_kwargs.update(kwargs)
            return True

    monkeypatch.setattr(decoder_registry, "get_decoder_class", lambda _decoder: object)
    monkeypatch.setattr(decoder_registry, "supports_transmitter_config", lambda _decoder: False)
    monkeypatch.setattr(VFOManager, "configure_internal_vfo", lambda _manager, **_kwargs: None)

    handler = DecoderHandler(ProcessManagerStub())
    success = await handler.start_decoder_task(
        observation_id="observation-1",
        session_id="session-1",
        sdr_id="sdr-1",
        sdr_config={"center_freq": 144_800_000},
        task_config={
            "decoder_type": "aprs",
            "parameters": {
                "aprs_baudrate": 1240,
                "aprs_af_carrier": 1810,
                "aprs_deviation": 565,
            },
        },
        vfo_number=1,
    )

    assert success is True
    assert captured_kwargs["decoder_param_overrides"] == {
        "baudrate": 1240,
        "af_carrier": 1810,
        "deviation": 565,
    }


async def test_scheduled_radiosonde_uses_channel_default_and_bundle_directory(
    monkeypatch, tmp_path
):
    configured = {}
    started = {}
    manager = SimpleNamespace(
        processes={"sdr-1": {"data_queue": object()}},
        start_decoder=lambda **kwargs: started.update(kwargs) or True,
    )
    monkeypatch.setattr(
        VFOManager,
        "configure_internal_vfo",
        lambda _manager, **kwargs: configured.update(kwargs),
    )
    assert await DecoderHandler(manager).start_decoder_task(
        observation_id="sonde-1",
        session_id="session-1",
        sdr_id="sdr-1",
        sdr_config={"center_freq": 403_000_000},
        task_config={
            "decoder_type": "radiosonde",
            "parameters": {
                "radiosonde_type": "auto",
                "radiosonde_sample_rate": 96000,
                "radiosonde_save_interval": 10,
            },
        },
        vfo_number=2,
        bundle_dir=tmp_path,
    )
    assert configured["bandwidth"] == 20000
    assert configured["decoder"] == "radiosonde"
    assert started["decoder_param_overrides"] == {
        "radiosonde_type": "auto",
        "radiosonde_sample_rate": 96000,
        "radiosonde_save_interval": 10,
    }
    assert started["output_dir"] == str(tmp_path / "decoded")


def test_maps_complete_lora_scheduler_parameters():
    values = {
        "sf": 8,
        "bw": 125000,
        "cr": 5,
        "sync_word": [52],
        "preamble_len": 9,
        "ldro_mode": 0,
        "implicit_header": True,
        "payload_length": 107,
        "has_crc": False,
        "invert_iq": False,
    }
    assert (
        map_scheduler_decoder_parameters(
            "lora", {f"lora_{key}": value for key, value in values.items()}
        )
        == values
    )
    assert map_scheduler_decoder_parameters("lora", values) == values
