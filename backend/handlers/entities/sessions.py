"""
Session runtime/snapshot handlers.

Exposes read-only commands for authenticated users to retrieve:
- A merged runtime snapshot of sessions and SDR workers (process/consumers)
- A per-session view merging relationships and configuration

Commands (api.call):
- "fetch_runtime_snapshot":
    Input (optional): { "session_id"?: str, "sdr_id"?: str }
    Output: { success: bool, data?: { sessions: {}, sdrs: {} }, error?: str }

- "fetch_session_view":
    Input: { "session_id": str }
    Output: { success: bool, data?: { session_id, sdr_id, rig_id, vfo, config }, error?: str }
"""

from typing import Any, Dict, Optional

from pipeline.orchestration.processmanager import process_manager
from session.service import session_service
from session.tracker import session_tracker


async def fetch_runtime_snapshot(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """
    Return a JSON-safe merged snapshot of current sessions and SDR runtime state.

    Optional filters:
      - session_id: return only that session in sessions{} and limit sdrs{} to entries
        that include that session in their clients/consumers.
      - sdr_id: return only that SDR entry in sdrs{} and sessions bound to it.
    """
    del sio, sid
    try:
        session_filter: Optional[str] = (data or {}).get("session_id") if data else None
        sdr_filter: Optional[str] = (data or {}).get("sdr_id") if data else None

        # Prefer going through the service (facade) if available.
        try:
            snapshot: Dict[str, Any] = session_service.get_runtime_snapshot()
        except Exception:
            # Fallback to tracker's method using the live process_manager.
            snapshot = session_tracker.get_runtime_snapshot(process_manager)

        if not isinstance(snapshot, dict):
            return {"success": False, "error": "Snapshot unavailable"}

        sessions = dict(snapshot.get("sessions", {}))
        sdrs = dict(snapshot.get("sdrs", {}))

        # Enrich sessions with IP address from tracker if missing.
        try:
            for snapshot_sid, entry in sessions.items():
                if isinstance(entry, dict) and "ip" not in entry:
                    entry["ip"] = session_tracker.get_session_ip(snapshot_sid)
        except Exception:
            # Best-effort enrichment.
            pass

        # Apply sdr_id filter first if provided.
        if sdr_filter:
            sdrs = {key: value for key, value in sdrs.items() if key == sdr_filter}
            # Trim sessions to only those associated with this SDR if possible.
            sessions = {
                key: value for key, value in sessions.items() if value.get("sdr_id") == sdr_filter
            }

        # Apply session_id filter if provided.
        if session_filter:
            sessions = {key: value for key, value in sessions.items() if key == session_filter}

            # Additionally, reduce sdrs to entries that reference this session.
            filtered_sdrs: Dict[str, Any] = {}
            for sdr_id, entry in sdrs.items():
                clients = set(entry.get("clients", []) or [])
                has_in_clients = session_filter in clients
                has_in_demods = session_filter in (entry.get("demodulators", {}) or {})
                has_in_recorders = session_filter in (entry.get("recorders", {}) or {})
                has_in_decoders = session_filter in (entry.get("decoders", {}) or {})
                if has_in_clients or has_in_demods or has_in_recorders or has_in_decoders:
                    filtered_sdrs[sdr_id] = entry
            sdrs = filtered_sdrs

        return {"success": True, "data": {"sessions": sessions, "sdrs": sdrs}}
    except Exception as exc:
        logger.error(f"Error fetching runtime snapshot: {exc}")
        logger.exception(exc)
        return {"success": False, "error": str(exc)}


async def fetch_session_view(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """
    Return a merged view for a single session:
      { session_id, sdr_id, rig_id, vfo, config }
    """
    del sio, sid
    try:
        if not data or not data.get("session_id"):
            return {"success": False, "error": "Missing session_id"}

        session_id: str = data["session_id"]

        sdr_id = session_tracker.get_session_sdr(session_id)
        rig_id = session_tracker.get_session_rig(session_id)
        vfo = session_tracker.get_session_vfo_int(session_id)
        cfg = None
        try:
            cfg = session_service.get_session_config(session_id)
        except Exception:
            cfg = None

        view = {
            "session_id": session_id,
            "sdr_id": sdr_id,
            "rig_id": rig_id,
            "vfo": vfo,
            "ip": session_tracker.get_session_ip(session_id),
            "config": cfg or {},
        }
        return {"success": True, "data": view}
    except Exception as exc:
        logger.error(f"Error fetching session view: {exc}")
        logger.exception(exc)
        return {"success": False, "error": str(exc)}


def register_handlers(registry):
    """Register session snapshot handlers with the command registry."""
    registry.register_batch(
        {
            "fetch_runtime_snapshot": (fetch_runtime_snapshot, "api_call"),
            "fetch_session_view": (fetch_session_view, "api_call"),
        }
    )
