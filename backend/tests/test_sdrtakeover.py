from handlers.entities import sdr as sdrhandlers


def test_lists_other_clients():
    original_processes = sdrhandlers.process_manager.processes
    sdrhandlers.process_manager.processes = {
        "sdr-a": {
            "clients": {"caller-session", "other-session", "internal:obs-123"},
        }
    }
    try:
        other_clients = sdrhandlers._list_other_sdr_clients("sdr-a", "caller-session")
    finally:
        sdrhandlers.process_manager.processes = original_processes

    assert other_clients == ["internal:obs-123", "other-session"]


def test_detects_center_frequency_change():
    original_processes = sdrhandlers.process_manager.processes
    sdrhandlers.process_manager.processes = {
        "sdr-a": {
            "config": {
                "center_freq": 145_800_000,
            }
        }
    }
    try:
        same_center = sdrhandlers._is_center_frequency_change("sdr-a", 145_800_000)
        changed_center = sdrhandlers._is_center_frequency_change("sdr-a", 145_810_000)
    finally:
        sdrhandlers.process_manager.processes = original_processes

    assert same_center is False
    assert changed_center is True


def test_builds_conflict_payload_with_internal_flag(monkeypatch):
    monkeypatch.setattr(
        sdrhandlers.session_tracker,
        "get_session_metadata",
        lambda sid: {"username": "observer"} if sid == "other-session" else {},
    )

    conflict = sdrhandlers._build_sdr_in_use_conflict(
        "sdr-a",
        ["internal:obs-123", "other-session"],
        operation="start-streaming",
    )

    assert conflict["error_code"] == sdrhandlers.SDR_IN_USE_CONFLICT_CODE
    assert conflict["sdr_id"] == "sdr-a"
    assert conflict["other_session_count"] == 2
    assert conflict["includes_internal_observation"] is True
    assert any(
        session.get("session_id") == "other-session" and session.get("username") == "observer"
        for session in conflict["other_sessions"]
    )
