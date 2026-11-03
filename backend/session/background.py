"""Receiving-session ownership, independent of the lifetime of a browser socket.

The receiving session ID stays on workers, queues, and decoder processes. A new
controller subscribes to that session's Socket.IO room and resolves commands to
its ID; adoption never rebuilds or renames a running consumer.
"""

from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional
from uuid import uuid4

from vfos.parameters import decoder_parameter_overrides
from vfos.state import VFOManager


@dataclass
class ReceivingSession:
    session_id: str
    sdr_id: str
    controller: Optional[str]
    enabled: bool = True


class BackgroundSessions:
    def __init__(self) -> None:
        self.sessions: Dict[str, ReceivingSession] = {}
        self.controllers: Dict[str, str] = {}

    def resolve(self, socket_id: str) -> str:
        return self.controllers.get(socket_id, socket_id)

    def socket_for(self, session_id: str) -> Optional[str]:
        session = self.sessions.get(session_id)
        return session.controller if session else session_id

    def start(self, socket_id: str, sdr_id: str) -> ReceivingSession:
        """Reserve a consumer identity distinct from the browser's private room."""
        session = self.sessions.get(self.resolve(socket_id))
        if session is None or session.controller != socket_id:
            # IQ subscription keys use ':' to separate the session and VFO.
            session = ReceivingSession(f"receiving-{uuid4().hex}", sdr_id, socket_id, enabled=False)
            self.sessions[session.session_id] = session
            self.controllers[socket_id] = session.session_id
        session.sdr_id = sdr_id
        return session

    def set_enabled(self, socket_id: str, sdr_id: str, enabled: bool) -> ReceivingSession:
        session_id = self.resolve(socket_id)
        session = self.sessions.get(session_id)
        if session is None:
            session = ReceivingSession(session_id, sdr_id, socket_id)
            self.sessions[session_id] = session
            self.controllers[socket_id] = session_id
        session.enabled = enabled
        return session

    def claim(self, sdr_id: str, socket_id: str) -> Optional[ReceivingSession]:
        current = self.sessions.get(self.resolve(socket_id))
        if (
            current
            and current.enabled
            and current.sdr_id == sdr_id
            and current.controller == socket_id
        ):
            return current
        # Reserve synchronously before any room/consumer awaits. Concurrent JOINs
        # on the event loop can never acquire the same unattended observation.
        for session in self.sessions.values():
            if session.sdr_id == sdr_id and session.enabled and session.controller is None:
                session.controller = socket_id
                self.controllers[socket_id] = session.session_id
                return session
        return None

    def detach(self, socket_id: str, process_info: Dict[str, Any]) -> bool:
        session_id = self.resolve(socket_id)
        session = self.sessions.get(session_id)
        if session is None or session.controller != socket_id or not session.enabled:
            return False
        session.controller = None
        self.controllers.pop(socket_id, None)

        # Freeze the frequency and the effective decoder parameters in place.
        # Clearing a transmitter lock through the VFO RPC would restart decoders.
        for number, state in VFOManager().get_all_vfo_states(session_id).items():
            entry = process_info.get("decoders", {}).get(session_id, {}).get(number, {})
            config = entry.get("config")
            if config is not None:
                decoder_parameter_overrides[f"{session_id}_{number}"] = {
                    key: value for key, value in asdict(config).items() if value is not None
                }
            VFOManager().update_vfo_state(
                session_id, number, locked_transmitter_id="none", doppler_status="idle"
            )
        return True

    def remove(self, session_id: str) -> None:
        self.sessions.pop(session_id, None)
        for socket_id, receiving_id in list(self.controllers.items()):
            if receiving_id == session_id:
                del self.controllers[socket_id]

    def describe(self, session: ReceivingSession, process_info: Dict[str, Any]) -> Dict[str, Any]:
        """Snapshot live state without asking running consumers to restart or emit."""
        session_id = session.session_id
        vfos = {}
        statuses = []
        recorder = process_info.get("recorders", {}).get(session_id, {}).get("instance")
        for number, state in VFOManager().get_all_vfo_states(session_id).items():
            entry = process_info.get("decoders", {}).get(session_id, {}).get(number, {})
            config = entry.get("config")
            parameters = asdict(config) if config is not None else {}
            vfos[number] = {
                **asdict(state),
                "decoder_parameters": parameters,
                "decoder_overrides": decoder_parameter_overrides.get(f"{session_id}_{number}", {}),
            }
            if entry:
                instance = entry.get("instance")
                statuses.append(
                    entry.get("status")
                    or {
                        "session_id": session_id,
                        "vfo": number,
                        "decoder_type": state.decoder,
                        "status": "running",
                        "decoder_id": getattr(instance, "decoder_id", None),
                    }
                )
        return {
            "session_id": session_id,
            "sdr_id": session.sdr_id,
            "enabled": session.enabled,
            "controller_connected": session.controller is not None,
            "vfos": vfos,
            "decoder_statuses": statuses,
            "is_recording": session_id in process_info.get("recorders", {}),
            "recording_start_time": getattr(recorder, "start_time_iso", None),
            "audio_recordings": list(process_info.get("audio_recorders", {}).get(session_id, {})),
            "audio_recording_durations": {
                number: (
                    getattr(entry.get("instance"), "total_samples", 0)
                    / (getattr(entry.get("instance"), "sample_rate", 0) or 1)
                )
                for number, entry in process_info.get("audio_recorders", {})
                .get(session_id, {})
                .items()
            },
        }


background_sessions = BackgroundSessions()
