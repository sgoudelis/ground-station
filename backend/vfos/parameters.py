"""User decoder overrides shared by VFO handlers and receiving-session lifecycle."""

from typing import Any, Dict

decoder_parameter_overrides: Dict[str, Dict[str, Any]] = {}


def clear_session_parameters(session_id: str) -> None:
    for key in list(decoder_parameter_overrides):
        if key.startswith(f"{session_id}_"):
            del decoder_parameter_overrides[key]
