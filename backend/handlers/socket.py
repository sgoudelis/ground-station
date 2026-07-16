import time
from typing import Any, Dict, Optional

from common import auth as authsvc
from common.logger import logger
from handlers.entities import (
    appsettings,
    celestial,
    control,
    decoderconfig,
    filebrowser,
    groups,
    hardware,
    locations,
    orbitalsources,
    preferences,
    satellites,
    scheduler,
    sdr,
    sessions,
    setup,
    systeminfo,
    tracking,
    transmitters,
    vfo,
)
from handlers.routing import dispatch_request, handler_registry
from server import runtimestate
from session.service import session_service
from session.socketregistry import SESSIONS
from session.tracker import session_tracker


def _register_all_handlers():
    """Register all command handlers with the global registry."""
    appsettings.register_handlers(handler_registry)
    satellites.register_handlers(handler_registry)
    orbitalsources.register_handlers(handler_registry)
    groups.register_handlers(handler_registry)
    hardware.register_handlers(handler_registry)
    locations.register_handlers(handler_registry)
    preferences.register_handlers(handler_registry)
    setup.register_handlers(handler_registry)
    transmitters.register_handlers(handler_registry)
    tracking.register_handlers(handler_registry)
    vfo.register_handlers(handler_registry)
    systeminfo.register_handlers(handler_registry)
    sessions.register_handlers(handler_registry)
    scheduler.register_handlers(handler_registry)
    decoderconfig.register_handlers(handler_registry)
    celestial.register_handlers(handler_registry)
    sdr.register_handlers(handler_registry)
    filebrowser.register_handlers(handler_registry)
    control.register_handlers(handler_registry)


# Register all handlers at module load time.
_register_all_handlers()

# Auth context keyed by socket session id.
SOCKET_AUTH: Dict[str, Dict[str, Any]] = {}
# Raw session token keyed by socket session id (used for per-request revalidation).
SOCKET_TOKENS: Dict[str, str] = {}


def register_socketio_handlers(sio):
    """Register Socket.IO event handlers."""

    async def _sync_authenticated_room(sid: str, auth_context: Optional[Dict[str, Any]]) -> None:
        """Keep authenticated broadcast-room membership aligned with live auth state."""
        is_authenticated = bool(auth_context)
        try:
            if is_authenticated:
                await sio.enter_room(sid, authsvc.AUTHENTICATED_SOCKET_ROOM)
            else:
                await sio.leave_room(sid, authsvc.AUTHENTICATED_SOCKET_ROOM)
        except Exception:
            logger.debug("Failed to sync authenticated room for sid=%s", sid, exc_info=True)

    @sio.on("connect")
    async def connect(sid, environ, auth=None):
        # Prefer reverse-proxy header if present, else fall back to REMOTE_ADDR.
        xff = environ.get("HTTP_X_FORWARDED_FOR") or environ.get("X-Forwarded-For")
        if xff:
            # Take the first IP in the comma-separated list.
            client_ip = xff.split(",")[0].strip()
        else:
            client_ip = environ.get("REMOTE_ADDR")

        # Extract additional client metadata from HTTP headers.
        user_agent = environ.get("HTTP_USER_AGENT")
        origin = environ.get("HTTP_ORIGIN")
        referer = environ.get("HTTP_REFERER")

        logger.info(f"Client {sid} from {client_ip} connected")

        setup_required = await authsvc.is_setup_required()
        token = authsvc.extract_socket_token(auth)
        if not token:
            # Browser clients now rely on HttpOnly auth cookies and cannot pass session tokens via JS.
            token = authsvc.extract_session_cookie_token(environ.get("HTTP_COOKIE"))
        auth_context = await authsvc.authenticate_token(token)
        if not setup_required and auth_context is None:
            logger.warning(f"Rejecting unauthenticated socket connection sid={sid}")
            return False

        if auth_context:
            # Keep token cache only for sessions that have been successfully authenticated.
            # Setup-mode sockets can arrive with stale cookies from deleted users; retaining
            # those invalid tokens would cause forced disconnects once setup completes.
            if token:
                SOCKET_TOKENS[sid] = token
            else:
                SOCKET_TOKENS.pop(sid, None)
            SOCKET_AUTH[sid] = auth_context
            logger.info(
                "Authenticated socket sid=%s as user=%s role=%s",
                sid,
                auth_context.get("username"),
                auth_context.get("role"),
            )
        else:
            # No valid auth context for this socket session.
            SOCKET_TOKENS.pop(sid, None)
            # Setup mode allows temporary unauthenticated access for onboarding-only commands.
            SOCKET_AUTH[sid] = {}

        SESSIONS[sid] = environ

        # Keep session owner identity in tracker metadata for runtime auditing/diagnostics.
        auth_user_id = str((auth_context or {}).get("user_id") or "").strip() or None
        auth_username = str((auth_context or {}).get("username") or "").strip() or None
        auth_role = str((auth_context or {}).get("role") or "").strip() or None

        # Persist client metadata in SessionTracker for operational diagnostics.
        try:
            session_tracker.set_session_metadata(
                sid,
                ip_address=client_ip,
                user_agent=user_agent,
                origin=origin,
                referer=referer,
                connected_at=time.time(),
                user_id=auth_user_id,
                username=auth_username,
                role=auth_role,
            )
        except Exception:
            logger.debug("Failed to set session metadata in tracker", exc_info=True)

        # Restrict runtime snapshot broadcasts to authenticated sockets only.
        await _sync_authenticated_room(sid, auth_context)

        # Send current running tasks to newly connected client.
        if runtimestate.background_task_manager:
            running_tasks = runtimestate.background_task_manager.get_running_tasks()
            if running_tasks:
                await sio.emit("background_task:list", {"tasks": running_tasks}, to=sid)

    @sio.on("disconnect")
    async def disconnect(sid, environ):
        del environ
        session_env = SESSIONS.pop(sid, {})
        SOCKET_AUTH.pop(sid, None)
        SOCKET_TOKENS.pop(sid, None)
        remote_addr = session_env.get("REMOTE_ADDR", "unknown")
        logger.info(f"Client {sid} from {remote_addr} disconnected")
        # Clean up session via SessionService (stops processes and clears tracker including metadata).
        await session_service.cleanup_session(sid)

    @sio.on("api.call")
    async def handle_api_call(sid: str, payload: Optional[Dict[str, Any]] = None):
        """Unified command ingress for all frontend-initiated backend actions."""
        if not isinstance(payload, dict):
            return {"success": False, "data": None, "error": "Invalid payload: expected object"}

        cmd = payload.get("cmd")
        data = payload.get("data")
        if not isinstance(cmd, str) or not cmd.strip():
            return {"success": False, "data": None, "error": "Invalid payload: missing cmd"}

        normalized_cmd = cmd.strip()
        logger.debug(f"Received api.call from sid={sid}, cmd={normalized_cmd}")
        setup_required = await authsvc.is_setup_required()

        # Re-authenticate on every RPC so logout/disable/role changes apply immediately.
        socket_token = SOCKET_TOKENS.get(sid)
        auth_context = None
        if socket_token:
            auth_context = await authsvc.authenticate_token(socket_token)
            if auth_context:
                SOCKET_AUTH[sid] = auth_context
            else:
                SOCKET_AUTH.pop(sid, None)

        if not setup_required and auth_context is None:
            # Re-authenticated sessions that became invalid (logout/revoke/disable) should be
            # disconnected immediately so stale authenticated sockets cannot continue.
            #
            # Setup-mode sockets have no token by design; they may still be connected when setup
            # flips to completed. For those sockets, return auth required without disconnecting so
            # setup UI can proceed to explicit login.
            if socket_token:
                logger.warning(
                    "Disconnecting socket sid=%s due to invalid session during api.call cmd=%s",
                    sid,
                    normalized_cmd,
                )
                SOCKET_AUTH.pop(sid, None)
                SOCKET_TOKENS.pop(sid, None)
                try:
                    await sio.disconnect(sid)
                except Exception:
                    logger.debug(
                        "Failed to disconnect sid=%s after auth invalidation", sid, exc_info=True
                    )
            return {"success": False, "data": None, "error": "Authentication required."}

        # Re-authentication can update role/identity; mirror those in session metadata.
        if auth_context:
            try:
                session_tracker.set_session_metadata(
                    sid,
                    user_id=str(auth_context.get("user_id") or "").strip() or None,
                    username=str(auth_context.get("username") or "").strip() or None,
                    role=str(auth_context.get("role") or "").strip() or None,
                )
            except Exception:
                logger.debug("Failed to refresh session owner metadata", exc_info=True)

        # Keep stream room membership synchronized with token revalidation outcomes.
        await _sync_authenticated_room(sid, auth_context)

        reply = await dispatch_request(
            sio,
            normalized_cmd,
            data,
            logger,
            sid,
            handler_registry,
            auth_context=auth_context,
        )
        return reply

    return SESSIONS
