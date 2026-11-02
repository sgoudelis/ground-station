# Copyright (c) 2026 Efstratios Goudelis

import json

from common import appconfig, appsettings
from common import arguments as arguments_module


def _write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, indent=2)
        file.write("\n")


def _read_json(path):
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def _build_service(tmp_path):
    service = appsettings.AppSettingsService()
    service.config_path = tmp_path / "app_config.json"
    return service


def test_get_payload_marks_cli_override_and_file_source(tmp_path, monkeypatch):
    service = _build_service(tmp_path)
    _write_json(
        service.config_path,
        {
            "host": "127.0.0.1",
            "port": 5050,
        },
    )

    monkeypatch.setattr(appsettings.arguments, "host", "127.0.0.1", raising=False)
    monkeypatch.setattr(appsettings.arguments, "port", 5050, raising=False)
    monkeypatch.setattr(appsettings, "app_config_cli_overrides", {"host"})

    payload = service.get_payload()

    assert payload["locked"]["host"] is True
    assert payload["source"]["host"] == "cli"
    assert payload["source"]["port"] == "file"
    assert payload["defined_in_file"]["host"] is True
    assert payload["defined_in_file"]["port"] is True


def test_update_rejects_unknown_settings(tmp_path):
    service = _build_service(tmp_path)

    result = service.update({"not_a_setting": 1})

    assert result["success"] is False
    assert "Unknown settings" in result["error"]


def test_legacy_secret_key_is_preserved_without_being_exposed(tmp_path):
    service = _build_service(tmp_path)
    _write_json(service.config_path, {"secret_key": "legacy-value", "log_level": "INFO"})

    assert appconfig.load_app_config(service.config_path)["secret_key"] == "legacy-value"
    payload = service.get_payload()
    assert "secret_key" not in payload["values"]
    assert "secret_key" not in {field["key"] for field in payload["fields"]}

    result = service.update({"log_level": "DEBUG"})
    assert result["success"] is True
    assert _read_json(service.config_path)["secret_key"] == "legacy-value"
    assert service.update({"secret_key": "replacement"})["success"] is False


def test_new_configs_omit_secret_key_but_legacy_cli_flag_is_accepted(tmp_path):
    config_path = tmp_path / "new_app_config.json"

    appconfig.load_app_config(config_path)

    assert "secret_key" not in _read_json(config_path)
    assert (
        arguments_module.parser.parse_args(["--secret-key", "legacy-value"]).secret_key
        == "legacy-value"
    )
    assert not hasattr(arguments_module.arguments, "secret_key")


def test_update_returns_validation_errors(tmp_path):
    service = _build_service(tmp_path)

    result = service.update({"port": 99999})

    assert result["success"] is False
    assert result["error"] == "One or more settings are invalid"
    assert "port" in result["data"]["validation_errors"]


def test_update_rejects_cli_controlled_port_without_writing_config(tmp_path, monkeypatch):
    service = _build_service(tmp_path)
    _write_json(service.config_path, {"port": 5000})
    monkeypatch.setattr(appsettings, "app_config_cli_overrides", {"port"})

    result = service.update({"port": 8080})

    assert result["success"] is False
    assert "startup command" in result["data"]["validation_errors"]["port"]
    assert _read_json(service.config_path)["port"] == 5000


def test_update_hot_apply_updates_runtime_and_removes_legacy_alias(tmp_path, monkeypatch):
    service = _build_service(tmp_path)
    _write_json(
        service.config_path,
        {
            "tle_sync_transmitter_urls": ["https://legacy.example.com/transmitters.json"],
        },
    )
    monkeypatch.setattr(
        appsettings.arguments,
        "orbital_sync_transmitter_urls",
        ["https://legacy.example.com/transmitters.json"],
        raising=False,
    )
    monkeypatch.setattr(
        appsettings.arguments,
        "tle_sync_transmitter_urls",
        ["https://legacy.example.com/transmitters.json"],
        raising=False,
    )

    result = service.update(
        {"orbital_sync_transmitter_urls": ["https://new.example.com/transmitters.json"]}
    )

    assert result["success"] is True
    data = result["data"]
    assert data["changed_hot_keys"] == ["orbital_sync_transmitter_urls"]
    assert data["changed_restart_keys"] == []
    assert data["restart_required"] is False
    assert appsettings.arguments.orbital_sync_transmitter_urls == [
        "https://new.example.com/transmitters.json"
    ]
    assert appsettings.arguments.tle_sync_transmitter_urls == [
        "https://new.example.com/transmitters.json"
    ]

    written = _read_json(service.config_path)
    assert written["orbital_sync_transmitter_urls"] == ["https://new.example.com/transmitters.json"]
    assert "tle_sync_transmitter_urls" not in written


def test_update_restart_required_setting_persists_but_does_not_hot_apply(tmp_path, monkeypatch):
    service = _build_service(tmp_path)
    _write_json(
        service.config_path,
        {
            "host": "0.0.0.0",
        },
    )
    monkeypatch.setattr(appsettings.arguments, "host", "0.0.0.0", raising=False)

    result = service.update({"host": "127.0.0.1"})

    assert result["success"] is True
    data = result["data"]
    assert data["changed_keys"] == ["host"]
    assert data["changed_hot_keys"] == []
    assert data["changed_restart_keys"] == ["host"]
    assert data["restart_required"] is True
    # restart_required settings should not mutate runtime arguments until restart.
    assert appsettings.arguments.host == "0.0.0.0"

    written = _read_json(service.config_path)
    assert written["host"] == "127.0.0.1"


def test_parakeet_url_hot_applies_and_rejects_invalid_urls(tmp_path, monkeypatch):
    service = _build_service(tmp_path)
    assert appsettings.DEFAULT_APP_CONFIG["parakeet_url"] == ""
    monkeypatch.setattr(
        appsettings.arguments,
        "parakeet_url",
        appsettings.DEFAULT_APP_CONFIG["parakeet_url"],
        raising=False,
    )

    for invalid_url in ("file:///etc/passwd", "http://user@host", "http://host:bad"):
        invalid = service.update({"parakeet_url": invalid_url})
        assert invalid["success"] is False
        assert "parakeet_url" in invalid["data"]["validation_errors"]

    result = service.update({"parakeet_url": "https://new.example.test/parakeet"})
    assert result["success"] is True
    assert result["data"]["changed_hot_keys"] == ["parakeet_url"]
    assert result["data"]["restart_required"] is False
    assert appsettings.arguments.parakeet_url == "https://new.example.test/parakeet"
    assert _read_json(service.config_path)["parakeet_url"] == "https://new.example.test/parakeet"

    cleared = service.update({"parakeet_url": ""})
    assert cleared["success"] is True
    assert cleared["data"]["changed_hot_keys"] == ["parakeet_url"]
    assert appsettings.arguments.parakeet_url == ""
    assert _read_json(service.config_path)["parakeet_url"] == ""


def test_libretranslate_url_is_empty_by_default_and_hot_applied(tmp_path, monkeypatch):
    service = _build_service(tmp_path)
    assert appsettings.DEFAULT_APP_CONFIG["libretranslate_url"] == ""
    monkeypatch.setattr(appsettings.arguments, "libretranslate_url", "", raising=False)

    invalid = service.update({"libretranslate_url": "http://user@localhost"})
    assert invalid["success"] is False
    assert "libretranslate_url" in invalid["data"]["validation_errors"]

    updated = service.update({"libretranslate_url": "https://translate.example.org/"})
    assert updated["success"] is True
    assert updated["data"]["changed_hot_keys"] == ["libretranslate_url"]
    assert appsettings.arguments.libretranslate_url == "https://translate.example.org/"

    cleared = service.update({"libretranslate_url": ""})
    assert cleared["success"] is True
    assert appsettings.arguments.libretranslate_url == ""


def test_soapy_discovery_defaults_to_manual_and_migrates_legacy_config_once(tmp_path):
    config_path = tmp_path / "app_config.json"
    fresh = appconfig.load_app_config(config_path)
    assert fresh["runonce_soapy_discovery"] is False
    assert fresh["enable_soapy_discovery"] is False

    _write_json(config_path, {"runonce_soapy_discovery": True, "port": 5050, "secret_key": "keep"})
    upgraded = appconfig.load_app_config(config_path)
    assert upgraded["runonce_soapy_discovery"] is False
    assert upgraded["port"] == 5050
    assert _read_json(config_path)["secret_key"] == "keep"

    # After migration, an explicit opt-in must survive subsequent restarts.
    explicit = _read_json(config_path)
    explicit["runonce_soapy_discovery"] = True
    _write_json(config_path, explicit)
    assert appconfig.load_app_config(config_path)["runonce_soapy_discovery"] is True
