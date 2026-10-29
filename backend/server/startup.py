# Copyright (c) 2025 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

import asyncio
import concurrent.futures
import json
import os
import queue
import tempfile
import uuid
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Dict, Optional, Set
from urllib.parse import quote

import socketio
from engineio.payload import Payload
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.security import HTTPBearer
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select

from audio.audiobroadcaster import AudioBroadcaster
from audio.audiostreamer import WebAudioStreamer
from celestial.syncstate import hydrate_celestial_sync_state
from common import apitokens
from common import auth as authsvc
from common.arguments import arguments
from common.audio_queue_config import get_audio_queue_config
from common.events import Subscription, public_events, rig_status, rotator_status
from common.logger import logger
from crud.scheduledobservations import fetch_scheduled_observations
from db import AsyncSessionLocal, engine
from db.migrations import run_migrations
from db.models import (
    Locations,
    MonitoredSatellites,
    ObservationStatus,
    Rigs,
    Rotators,
    Satellites,
    ScheduledObservations,
    SDRs,
)
from handlers.entities.control import restore_full_backup_file
from library.inventory import get_inventory, publish_ready_artifacts
from observations import events as obs_events
from observations.bundle import prune_finalized_empty_observation_bundles
from observations.events import emit_scheduled_observations_changed as _emit
from observations.events import set_socketio_instance
from observations.executor import (
    RESTART_INTERRUPTION_REASON,
    SHUTDOWN_INTERRUPTION_REASON,
    ObservationExecutor,
)
from observations.sync import ObservationSchedulerSync
from pipeline.orchestration.processmanager import process_manager
from server import runtimestate, shutdown
from server.docs import get_themed_swagger_ui_html
from server.firsttime import first_time_initialization, run_initial_sync
from server.scheduler import (
    run_initial_observation_generation,
    schedule_celestial_sync_warmup_job,
    start_scheduler,
    stop_scheduler,
)
from server.schemas import (
    ARTIFACT_DOWNLOAD_DESCRIPTION,
    ARTIFACT_MEMBER_DESCRIPTION,
    JSON_EXAMPLES,
    JSON_ROUTE_EXAMPLES,
    PUBLIC_API_DESCRIPTION,
    RANGE_HEADER,
    SSE_DESCRIPTION,
    SSE_RESPONSE,
    binary_responses,
    json_example,
)
from server.sessionsnapshot import start_session_runtime_emitter
from server.spapaths import is_static_asset_request, resolve_static_asset_path
from server.systeminfo import start_system_info_emitter
from server.version import get_version_base
from tasks.manager import BackgroundTaskManager
from tasks.registry import get_task
from tlesync.persist import load_orbital_sync_state
from tlesync.state import sync_state_manager
from tracker.instances import emit_tracker_instances, restore_tracker_instances_from_db
from tracker.messages import handle_command_updates, handle_tracker_messages
from tracker.operations import OperationRegistry, operations
from tracker.runner import get_tracker_supervisor

# Increase payload limits to handle large waterfall PNG images and maintenance uploads.
Payload.max_decode_packets = 50
# Socket.IO is not used for full database restore uploads. Keep a bounded limit for
# realtime traffic such as waterfall images and smaller maintenance messages.
SOCKET_IO_MAX_PAYLOAD_BYTES = 384 * 1024 * 1024  # 384MB
# Long-running maintenance requests can keep a socket in-flight; allow longer heartbeat
# windows for the separate full-backup download operation.
SOCKET_IO_PING_INTERVAL_SECONDS = 25
SOCKET_IO_PING_TIMEOUT_SECONDS = 120
# Default is 100KB (100000 bytes), increase for large realtime payloads.
Payload.max_decode_packet_size = SOCKET_IO_MAX_PAYLOAD_BYTES
FULL_RESTORE_MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024  # 1GB
AUTH_COOKIE_MAX_AGE_DEFAULT_SECONDS = 15 * 24 * 60 * 60
AUTH_COOKIE_MAX_AGE_KEEP_ACTIVE_SECONDS = 365 * 24 * 60 * 60
EVENT_STREAM_CHECK_INTERVAL_SECONDS = 15

# At the top of the file, add a global to track background tasks
background_tasks: Set[asyncio.Task] = set()

# Module-level variable to track if initial sync is needed
_needs_initial_sync: bool = False

# Audio distribution system
# Demodulators write to audio_queue, AudioBroadcaster distributes to multiple consumers
audio_cfg = get_audio_queue_config()
audio_queue: queue.Queue = queue.Queue(maxsize=audio_cfg.global_audio_queue_size)
audio_broadcaster: AudioBroadcaster = AudioBroadcaster(audio_queue)
runtimestate.audio_queue = audio_queue

# Background task manager (initialized after sio is created)
background_task_manager: BackgroundTaskManager = None
runtimestate.process_manager = process_manager
_LIBRARY_RECONCILIATION_SECONDS = 60


async def _reconcile_library_periodically() -> None:
    """Repair the in-memory inventory after out-of-process filesystem changes."""
    inventory = get_inventory()
    try:
        while True:
            await asyncio.sleep(_LIBRARY_RECONCILIATION_SECONDS)
            previous_revision = inventory.revision
            revision = await asyncio.to_thread(inventory.rebuild)
            publish_ready_artifacts(inventory)
            if revision != previous_revision:
                await sio.emit(
                    "library.changed",
                    {"revision": revision, "changes": [{"operation": "reconciled", "id": "*"}]},
                    room=authsvc.AUTHENTICATED_SOCKET_ROOM,
                )
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Filesystem library reconciliation stopped unexpectedly")


@asynccontextmanager
async def lifespan(fastapiapp: FastAPI):
    """Custom lifespan for FastAPI."""
    global background_task_manager

    logger.info("FastAPI lifespan startup...")
    # In an async context, prefer get_running_loop() (get_event_loop() is deprecated when no loop set)
    event_loop = asyncio.get_running_loop()

    # A previous process can finish SatDump after LOS has retained its bundle,
    # leaving only the manifest once the disposable IQ input is removed.
    try:
        removed_bundles = prune_finalized_empty_observation_bundles(Path(__file__).parents[1])
        if removed_bundles:
            logger.info(
                "Removed %s finalized empty observation bundle(s) at startup", removed_bundles
            )
    except Exception:
        # Observation cleanup must not prevent the station from starting.
        logger.exception("Failed to prune finalized empty observation bundles at startup")

    # The filesystem remains the durable library.  Build its process-local,
    # rebuildable query index after startup filesystem maintenance so browser
    # requests never need a cold scan or receive a stale pruned bundle.
    try:
        library_revision = await asyncio.to_thread(get_inventory().rebuild)
        logger.info("Filesystem library inventory ready at revision %s", library_revision)
    except Exception:
        logger.exception("Failed to build filesystem library inventory at startup")
    library_reconciler = asyncio.create_task(_reconcile_library_periodically())
    background_tasks.add(library_reconciler)

    # Set socketio instance for observations events
    set_socketio_instance(sio)

    # Initialize background task manager
    background_task_manager = BackgroundTaskManager(sio)
    runtimestate.background_task_manager = background_task_manager
    logger.info("BackgroundTaskManager initialized")

    # Hydrate last orbital sync snapshot so status survives process restarts.
    try:
        async with AsyncSessionLocal() as dbsession:
            persisted_sync_state = await load_orbital_sync_state(dbsession)
        if persisted_sync_state:
            sync_state_manager.set_state(persisted_sync_state, touch_timestamp=False)
    except Exception:
        logger.exception("Failed to hydrate orbital sync state at startup")

    # Hydrate the last whole celestial sync result for post-restart UI continuity.
    try:
        await hydrate_celestial_sync_state()
    except Exception:
        logger.exception("Failed to hydrate celestial ephemeris sync state at startup")

    # Trim stale auth-session history at startup. Active sessions are excluded by policy.
    try:
        trim_result = await authsvc.trim_inactive_auth_sessions(keep_last=300)
        logger.info(
            "Auth session history trim complete: deleted=%s, keep_last=%s",
            trim_result.get("deleted"),
            trim_result.get("kept"),
        )
    except Exception:
        # Startup should continue even if retention cleanup fails.
        logger.exception("Auth session history trim failed at startup")

    # Start audio broadcaster
    audio_broadcaster.start()
    shutdown.audio_broadcaster = audio_broadcaster

    # Subscribe consumers to broadcaster
    playback_queue = audio_broadcaster.subscribe(
        "playback", maxsize=audio_cfg.web_audio_playback_queue_size
    )
    shutdown.audio_consumer = WebAudioStreamer(playback_queue, sio, event_loop)
    shutdown.audio_consumer.start()
    runtimestate.audio_consumer = shutdown.audio_consumer

    # Initialize ProcessManager with event loop for TranscriptionManager
    process_manager.set_event_loop(event_loop)
    logger.info("ProcessManager initialized with event loop")

    # The command registry belongs to this process. Saved tracking state is
    # restored below, including hardware modes that should reconnect.
    operations.__dict__.update(OperationRegistry().__dict__)
    Path(arguments.db).with_suffix(".commands.json").unlink(missing_ok=True)
    asyncio.create_task(handle_command_updates(sio))
    asyncio.create_task(handle_tracker_messages(sio))
    await restore_tracker_instances_from_db()
    await emit_tracker_instances(sio)

    # SoapySDR discovery (runs as background tasks)
    if arguments.runonce_soapy_discovery:
        # Single discovery at startup
        logger.info("Starting one-time SoapySDR discovery at startup...")

        discovery_func = get_task("soapysdr_discovery")
        await background_task_manager.start_task(
            func=discovery_func, kwargs={"mode": "single"}, name="SoapySDR Discovery (startup)"
        )
    if arguments.enable_soapy_discovery:
        # Continuous monitoring mode
        logger.info("Starting continuous SoapySDR discovery monitoring...")

        discovery_func = get_task("soapysdr_discovery")
        await background_task_manager.start_task(
            func=discovery_func,
            kwargs={"mode": "monitor", "refresh_interval": 120},
            name="SoapySDR Discovery (monitor)",
        )

    # Schedule initial sync if needed.
    # During first-time setup we defer this background sync so the setup wizard
    # can explicitly start and display finalization status to the user.
    if _needs_initial_sync:
        setup_required = await authsvc.is_setup_required(force_refresh=True)
        if setup_required:
            logger.info("Deferring startup initial orbital sync because setup is still required.")
        else:
            asyncio.create_task(run_initial_sync(background_task_manager))

    # Start the background task scheduler
    scheduler = start_scheduler(sio, process_manager, background_task_manager)
    schedule_celestial_sync_warmup_job(background_task_manager, sio)

    # Initialize observation executor and scheduler sync
    observation_executor = ObservationExecutor(process_manager, sio)
    observation_sync = ObservationSchedulerSync(scheduler, observation_executor)

    # Store observation_sync globally for use in handlers
    obs_events.observation_sync = observation_sync

    # Runtime workers cannot be resumed safely after a process restart. Reconcile
    # durable RUNNING rows before generation and scheduler synchronization so
    # they cannot remain orphaned indefinitely.
    interruption_stats = await observation_executor.interrupt_running_observations(
        RESTART_INTERRUPTION_REASON
    )
    if interruption_stats["found"]:
        logger.warning(
            "Reconciled interrupted observations at startup: found=%s failed=%s "
            "timed_out=%s errors=%s",
            interruption_stats["found"],
            interruption_stats["failed"],
            interruption_stats["timed_out"],
            interruption_stats["errors"],
        )

    # Run initial observation generation
    asyncio.create_task(run_initial_observation_generation())

    # Sync all observations to APScheduler after a brief delay
    # (allows initial generation to complete first)
    async def sync_observations_after_delay():
        await asyncio.sleep(2)
        logger.info("Syncing scheduled observations to APScheduler...")
        result = await observation_sync.sync_all_observations()
        if result["success"]:
            stats = result.get("stats", {})
            logger.info(
                f"Observation sync complete: {stats.get('scheduled', 0)} scheduled, "
                f"{stats.get('skipped_disabled', 0)} disabled, "
                f"{stats.get('skipped_status', 0)} wrong status, "
                f"{stats.get('skipped_past', 0)} past events"
            )
        else:
            logger.error(f"Observation sync failed: {result.get('error')}")

    asyncio.create_task(sync_observations_after_delay())

    # Start performance monitoring
    process_manager.start_monitoring()
    logger.info("Performance monitoring started (metrics emission every 2s)")

    # Start live system-info emitter task (registers into background_tasks)
    start_system_info_emitter(sio, background_tasks)

    # Start session runtime snapshot emitter task (registers into background_tasks)
    start_session_runtime_emitter(sio, background_tasks)

    try:
        yield
    finally:
        logger.info("FastAPI lifespan cleanup...")
        # Prevent new scheduled work while active observations transition to a
        # durable failed state and release their runtime resources.
        try:
            scheduler.pause()
        except Exception:
            logger.exception("Failed to pause scheduler during shutdown")

        try:
            interruption_stats = await observation_executor.interrupt_running_observations(
                SHUTDOWN_INTERRUPTION_REASON
            )
            if interruption_stats["found"]:
                logger.info(
                    "Interrupted observations during shutdown: found=%s failed=%s "
                    "timed_out=%s errors=%s",
                    interruption_stats["found"],
                    interruption_stats["failed"],
                    interruption_stats["timed_out"],
                    interruption_stats["errors"],
                )
        except Exception:
            logger.exception("Failed to reconcile running observations during shutdown")

        # Shutdown background task manager
        if background_task_manager:
            await background_task_manager.shutdown()
        # Cancel background tasks we created
        for task in list(background_tasks):
            task.cancel()
        background_tasks.clear()
        await shutdown.cleanup_sessions()
        await shutdown.cleanup_sdr_processes()
        stop_scheduler()
        shutdown.cleanup_everything()
        process_manager.shutdown()


sio = socketio.AsyncServer(
    async_mode="asgi",
    # The default Engine.IO policy accepts only same-origin browser connections.
    logger=True,
    # Engine.IO packet logging includes complete payloads, including passwords.
    engineio_logger=False,
    binary=True,
    max_http_buffer_size=SOCKET_IO_MAX_PAYLOAD_BYTES,
    ping_interval=SOCKET_IO_PING_INTERVAL_SECONDS,
    ping_timeout=SOCKET_IO_PING_TIMEOUT_SECONDS,
)


async def emit_scheduled_observations_changed():
    """Emit event to all clients that scheduled observations have changed."""
    await _emit()


app = FastAPI(
    lifespan=lifespan,
    title="Ground Station API",
    description=PUBLIC_API_DESCRIPTION,
    version="1.0.0",
    docs_url=None,
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)


@app.get("/api/ready", include_in_schema=False)
async def api_ready(response: Response):
    """Report readiness after database and ASGI lifespan startup have completed."""
    response.headers["Cache-Control"] = "no-store"
    return {"ready": True}


@app.get("/api/docs", include_in_schema=False)
async def api_docs(request: Request):
    root_path = request.scope.get("root_path", "").rstrip("/")
    return get_themed_swagger_ui_html(
        openapi_url=f"{root_path}{app.openapi_url}", title=f"{app.title} - Swagger UI"
    )


# Document Bearer authentication in OpenAPI while _require_api_token enforces
# the actual PAT and scope checks with consistent 401/403 responses.
api_bearer_scheme = HTTPBearer(auto_error=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

process_manager.set_sio(sio)


def _auth_cookie_secure(request: Request) -> bool:
    return str(request.url.scheme).lower() == "https"


def _set_auth_session_cookie(
    response: Response, request: Request, token: str, max_age_seconds: int
) -> None:
    response.set_cookie(
        key=authsvc.AUTH_SESSION_COOKIE_NAME,
        value=str(token),
        max_age=max(int(max_age_seconds), 1),
        httponly=True,
        samesite="strict",
        secure=_auth_cookie_secure(request),
        path="/",
    )


def _clear_auth_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        key=authsvc.AUTH_SESSION_COOKIE_NAME,
        path="/",
        samesite="strict",
        secure=_auth_cookie_secure(request),
    )


def _extract_request_token(request: Request, allow_cookie_token: bool = True) -> Optional[str]:
    auth_header = request.headers.get("authorization")
    token: Optional[str] = authsvc.extract_bearer_token(auth_header)
    if token:
        return token

    if not allow_cookie_token:
        return None

    cookie_token: Optional[str] = authsvc.extract_cookie_token(
        request.cookies.get(authsvc.AUTH_SESSION_COOKIE_NAME)
    )
    return cookie_token


def _client_ip_from_request(request: Request) -> Optional[str]:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return str(xff.split(",")[0].strip())
    if request.client:
        return str(request.client.host)
    return None


async def _load_station_identity() -> Optional[Dict[str, Optional[str]]]:
    """Load a lightweight station identity payload for pre-auth UI surfaces."""
    try:
        async with AsyncSessionLocal() as session:
            # Mirror location ordering used across the app when a single "active" location is needed.
            location_row = (
                await session.execute(
                    select(Locations)
                    .order_by(Locations.updated.desc(), Locations.added.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if location_row is None:
                return None

            station_name = str(location_row.name or "").strip() or None
            callsign = str(location_row.callsign or "").strip().upper() or None
            return {
                "name": station_name,
                "callsign": callsign,
            }
    except Exception:
        # Pre-auth station identity is best-effort only; auth bootstrap must still work when unavailable.
        logger.debug("Failed to load station identity for auth status", exc_info=True)
        return None


async def _require_request_auth(
    request: Request,
    require_auth: bool = True,
    require_admin: bool = False,
    allow_cookie_token: bool = True,
    touch_last_seen: bool = True,
) -> Optional[Dict[str, Any]]:
    token = _extract_request_token(request, allow_cookie_token=allow_cookie_token)
    auth_context = (
        await authsvc.authenticate_token(token, touch_last_seen=touch_last_seen) if token else None
    )

    if require_auth and not auth_context:
        raise HTTPException(status_code=401, detail="Authentication required.")

    if require_admin and not authsvc.is_admin_role((auth_context or {}).get("role")):
        raise HTTPException(status_code=403, detail="Admin access is required.")

    return auth_context


async def _require_api_token(request: Request, scope: Optional[str] = None) -> Dict[str, Any]:
    raw_token = authsvc.extract_bearer_token(request.headers.get("authorization"))
    context = await apitokens.authenticate_token(raw_token)
    if not context:
        raise HTTPException(status_code=401, detail="Valid API token required.")
    if scope and scope not in context["scopes"]:
        raise HTTPException(status_code=403, detail=f"Scope {scope} required.")
    return dict(context)


class AuthenticatedStaticFiles:
    """Wrap StaticFiles and enforce runtime auth for sensitive data directories."""

    def __init__(self, directory: str, html: bool) -> None:
        self._static_files = StaticFiles(directory=directory, html=html)

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self._static_files(scope, receive, send)
            return

        request = Request(scope, receive=receive)
        try:
            # Browser media requests cannot set Authorization headers, so cookie auth is required.
            # Skip last-seen writes for asset requests to avoid a DB write on every image/audio fetch.
            await _require_request_auth(
                request,
                require_auth=True,
                require_admin=False,
                allow_cookie_token=True,
                touch_last_seen=False,
            )
        except HTTPException as exc:
            response = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
            await response(scope, receive, send)
            return

        await self._static_files(scope, receive, send)


# Browser-session routes remain available to the frontend but are not part of the
# personal-token API advertised to custom applications.
@app.get("/api/auth/status", summary="Check setup and sign-in status", include_in_schema=False)
async def auth_status(request: Request):
    """Show whether initial setup is needed, whether this browser is signed in, and the station identity."""
    setup_mode = await authsvc.resolve_setup_mode()
    setup_required = setup_mode != authsvc.SETUP_MODE_NONE
    station_identity = await _load_station_identity()
    auth_context = await _require_request_auth(
        request,
        require_auth=False,
        require_admin=False,
        allow_cookie_token=True,
        touch_last_seen=False,
    )
    return {
        "setup_required": setup_required,
        "setup_mode": setup_mode,
        "authenticated": bool(auth_context),
        "user": auth_context,
        "station": station_identity,
    }


@app.post(
    "/api/auth/setup-admin", summary="Create the first administrator", include_in_schema=False
)
async def setup_admin(request: Request, response: Response):
    """Complete one-time setup with a JSON body containing `username` and `password`. Sets a browser session cookie on success."""
    payload = await request.json()
    username = str(payload.get("username") or "")
    password = str(payload.get("password") or "")

    result = await authsvc.bootstrap_admin(
        username=username,
        password=password,
        client_ip=_client_ip_from_request(request),
        user_agent=request.headers.get("user-agent"),
    )
    if not result.get("success"):
        message = str(result.get("error") or "Failed to initialize admin account.")
        status_code = 409 if "already completed" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message)
    token = authsvc.extract_cookie_token(result.get("token"))
    if token:
        _set_auth_session_cookie(
            response=response,
            request=request,
            token=token,
            max_age_seconds=AUTH_COOKIE_MAX_AGE_DEFAULT_SECONDS,
        )

    return {
        "success": bool(result.get("success")),
        "user": result.get("user"),
    }


@app.post("/api/auth/login", summary="Sign in to the browser app", include_in_schema=False)
async def auth_login(request: Request, response: Response):
    """Send `username` and `password` as JSON to create a browser session. Set `keep_session_active` to extend its lifetime."""
    payload = await request.json()
    username = str(payload.get("username") or "")
    password = str(payload.get("password") or "")
    keep_session_active = authsvc.coerce_keep_session_active(
        payload.get("keep_session_active", payload.get("keepSessionActive"))
    )
    result = await authsvc.login(
        username=username,
        password=password,
        client_ip=_client_ip_from_request(request),
        user_agent=request.headers.get("user-agent"),
        keep_session_active=keep_session_active,
    )
    if not result.get("success"):
        raise HTTPException(status_code=401, detail=str(result.get("error") or "Login failed."))

    token = authsvc.extract_cookie_token(result.get("token"))
    if token:
        ttl_seconds = (
            AUTH_COOKIE_MAX_AGE_KEEP_ACTIVE_SECONDS
            if keep_session_active
            else AUTH_COOKIE_MAX_AGE_DEFAULT_SECONDS
        )
        _set_auth_session_cookie(
            response=response,
            request=request,
            token=token,
            max_age_seconds=ttl_seconds,
        )

    return {
        "success": bool(result.get("success")),
        "user": result.get("user"),
    }


@app.post("/api/auth/logout", summary="Sign out of the browser app", include_in_schema=False)
async def auth_logout(request: Request, response: Response):
    """Revoke the current browser session and clear its cookie."""
    token = _extract_request_token(request, allow_cookie_token=True)
    if token:
        await authsvc.logout(token, reason="logout")
    _clear_auth_session_cookie(response=response, request=request)
    return {"success": True}


@app.get("/api/auth/me", summary="Get the signed-in browser user", include_in_schema=False)
async def auth_me(request: Request):
    """Return the current user's session context. Requires a valid browser login."""
    auth_context = await _require_request_auth(request, require_auth=True, require_admin=False)
    return {"success": True, "data": auth_context}


@app.get(
    "/api/v1/me",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("me"),
    summary="Check an API token and its scopes",
)
async def api_me(request: Request):
    """Return the token owner's identity and granted scopes. Requires a personal API token."""
    return await _require_api_token(request)


@app.get(
    "/api/v1/station",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("station"),
    summary="Get station identity and software version",
)
async def api_station(request: Request):
    """Return the station name, callsign, software version, and API version. Requires `station:read`."""
    await _require_api_token(request, "station:read")
    return {
        "station": await _load_station_identity(),
        "version": get_version_base(),
        "api_version": "v1",
    }


async def _load_public_status() -> Dict[str, Any]:
    """Build the same status snapshot for REST polling and the event stream."""
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as session:
        active_count = await session.scalar(
            select(func.count())
            .select_from(ScheduledObservations)
            .where(ScheduledObservations.status == ObservationStatus.RUNNING)
        )
        next_start = await session.scalar(
            select(ScheduledObservations.event_start)
            .where(
                ScheduledObservations.enabled.is_(True),
                ScheduledObservations.status == ObservationStatus.SCHEDULED,
                ScheduledObservations.event_start >= now,
            )
            .order_by(ScheduledObservations.event_start)
            .limit(1)
        )
        monitored_count = await session.scalar(
            select(func.count())
            .select_from(MonitoredSatellites)
            .where(MonitoredSatellites.enabled.is_(True))
        )
    return {
        "server_time": now.isoformat(),
        "observation_state": "observing" if active_count else "idle",
        "active_observation_count": active_count or 0,
        "next_observation_at": next_start.isoformat() if next_start else None,
        "monitored_satellite_count": monitored_count or 0,
    }


@app.get(
    "/api/v1/status",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("status"),
    summary="Get current station activity",
)
async def api_status(request: Request):
    """Return activity, active observation count, next scheduled observation, and monitored satellite count. Useful for Home Assistant polling; manual radio activity may not change this state. Requires `station:read`."""
    await _require_api_token(request, "station:read")
    return await _load_public_status()


@app.get(
    "/api/v1/trackers/rotators",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("tracker_rotators"),
    summary="Get current tracker rotator states",
)
async def api_tracker_rotators(request: Request):
    """Return observed states for assigned rotators. Requires `station:read`."""
    await _require_api_token(request, "station:read")
    supervisor = get_tracker_supervisor()
    rows = []
    for instance in supervisor.get_instances_payload()["instances"]:
        tracker_id = instance["tracker_id"]
        device_id = instance.get("rotator_id") or instance.get("tracking_state", {}).get(
            "rotator_id"
        )
        if device_id in (None, "", "none"):
            continue
        snapshot = operations.observed.get(tracker_id)
        runtime = supervisor.get_runtime(tracker_id)
        # The worker PID fences out a previous process's last cached snapshot.
        current = (
            rotator_status(snapshot)
            if snapshot
            and runtime
            and runtime.process.is_alive()
            and snapshot.get("worker_pid") == runtime.process.pid
            else None
        )
        if current and current["device_id"] != str(device_id):
            # An assignment can change before its new worker telemetry arrives.
            current = None
        rows.append(
            {
                "tracker_id": tracker_id,
                "device_id": str(device_id),
                "state": current["state"] if current else "unavailable",
                "tracking_enabled": current["tracking_enabled"] if current else False,
                "observed_at": current["observed_at"] if current else None,
            }
        )
    return {"data": rows}


@app.get(
    "/api/v1/trackers/rigs",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("tracker_rigs"),
    summary="Get current tracker rig states",
)
async def api_tracker_rigs(request: Request):
    """Return observed states for assigned rigs. Requires `station:read`."""
    await _require_api_token(request, "station:read")
    supervisor = get_tracker_supervisor()
    rows = []
    for instance in supervisor.get_instances_payload()["instances"]:
        tracker_id = instance["tracker_id"]
        device_id = instance.get("rig_id") or instance.get("tracking_state", {}).get("rig_id")
        if device_id in (None, "", "none"):
            continue
        snapshot = operations.observed.get(tracker_id)
        runtime = supervisor.get_runtime(tracker_id)
        # An old worker's last snapshot must not describe the current assignment.
        current = (
            rig_status(snapshot)
            if snapshot
            and runtime
            and runtime.process.is_alive()
            and snapshot.get("worker_pid") == runtime.process.pid
            else None
        )
        if current and current["device_id"] != str(device_id):
            current = None
        rows.append(
            {
                "tracker_id": tracker_id,
                "device_id": str(device_id),
                "state": current["state"] if current else "unavailable",
                "tracking_enabled": current["tracking_enabled"] if current else False,
                "observed_at": current["observed_at"] if current else None,
            }
        )
    return {"data": rows}


def _sse_event(name: str, data: Dict[str, Any]) -> str:
    return f"event: {name}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


def _status_values(status: Dict[str, Any]) -> Dict[str, Any]:
    # server_time changes on every read; it is not itself a station change.
    return {key: value for key, value in status.items() if key != "server_time"}


async def _stream_api_events(
    raw_token: str, token_id: str, subscription: Subscription
) -> AsyncIterator[str]:
    loop = asyncio.get_running_loop()
    last_auth_check = loop.time()
    last_status: Optional[Dict[str, Any]] = None
    try:
        # No event IDs are sent: this process-local stream does not promise replay.
        yield "retry: 3000\n\n"
        yield _sse_event("connected", {"replay": False})
        if "station:read" in subscription.scopes:
            status = await _load_public_status()
            last_status = _status_values(status)
            yield _sse_event("station.status", status)

        while True:
            try:
                remaining = max(
                    0.0, EVENT_STREAM_CHECK_INTERVAL_SECONDS - (loop.time() - last_auth_check)
                )
                item = await asyncio.wait_for(subscription.queue.get(), timeout=remaining)
            except asyncio.TimeoutError:
                item = ("_heartbeat", {})

            if loop.time() - last_auth_check >= EVENT_STREAM_CHECK_INTERVAL_SECONDS:
                # Revocation, password reset, and account disablement close open streams.
                context = await apitokens.authenticate_token(raw_token)
                if not context or context["token_id"] != token_id:
                    return
                last_auth_check = loop.time()
                if "station:read" in subscription.scopes:
                    status = await _load_public_status()
                    current = _status_values(status)
                    if current != last_status:
                        last_status = current
                        yield _sse_event("station.status", status)
                yield ": keepalive\n\n"

            if item is None:
                return
            name, data = item
            if name == "_status_dirty":
                status = await _load_public_status()
                current = _status_values(status)
                if current != last_status:
                    last_status = current
                    yield _sse_event("station.status", status)
            elif name in {
                "observations.changed",
                "target.changed",
                "target.slot.created",
                "target.slot.deleted",
                "target.visible",
                "target.below_horizon",
                "tracker.hardware.changed",
                "tracker.rotator.state.changed",
                "tracker.rig.state.changed",
                "artifact.ready",
                "sdr.streaming.started",
                "sdr.streaming.stopped",
            }:
                yield _sse_event(name, data)
    finally:
        public_events.unsubscribe(subscription)


@app.get(
    "/api/v1/events",
    dependencies=[Depends(api_bearer_scheme)],
    response_class=StreamingResponse,
    responses=SSE_RESPONSE,
    summary="Stream station, target, SDR, artifact, and observation events",
    description=SSE_DESCRIPTION,
)
async def api_events(request: Request):
    """Stream station, target, SDR, and tracker hardware events (`station:read`), observation changes (`observations:read`), and artifact readiness (`artifacts:read`). An initial `connected` event advises clients to refresh available REST state; missed events are not replayed. Requires a Bearer API token with at least one of those scopes."""
    context = await _require_api_token(request)
    if not {"station:read", "observations:read", "artifacts:read"}.intersection(context["scopes"]):
        raise HTTPException(
            status_code=403, detail="Station, observations, or artifacts read scope required."
        )
    try:
        subscription = public_events.subscribe(context["token_id"], context["scopes"])
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    raw_token = authsvc.extract_bearer_token(request.headers.get("authorization"))
    return StreamingResponse(
        _stream_api_events(raw_token, context["token_id"], subscription),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@app.get(
    "/api/v1/observations",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("observations"),
    summary="List scheduled observations",
)
async def api_observations(request: Request):
    """Return the full scheduled observation records for custom applications. Requires `observations:read`."""
    await _require_api_token(request, "observations:read")
    async with AsyncSessionLocal() as session:
        result = await fetch_scheduled_observations(session)
    if not result.get("success"):
        raise HTTPException(status_code=500, detail="Could not load observations.")
    return {"data": result.get("data", [])}


@app.get(
    "/api/v1/observations/upcoming",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("upcoming_observations"),
    summary="List upcoming scheduled observations",
)
async def api_upcoming_observations(
    request: Request,
    hours: int = Query(default=24, ge=1, le=168),
    limit: int = Query(default=25, ge=1, le=100),
    norad_id: Optional[int] = Query(default=None, gt=0),
):
    """Return compact scheduled jobs within the requested time window, optionally filtered by satellite. These are scheduled observations, not every predicted pass. Requires `observations:read`."""
    await _require_api_token(request, "observations:read")
    now = datetime.now(timezone.utc)
    conditions = [
        ScheduledObservations.enabled.is_(True),
        ScheduledObservations.status == ObservationStatus.SCHEDULED,
        ScheduledObservations.event_end >= now,
        ScheduledObservations.event_start <= now + timedelta(hours=hours),
    ]
    if norad_id is not None:
        conditions.append(ScheduledObservations.norad_id == norad_id)
    async with AsyncSessionLocal() as session:
        rows = (
            (
                await session.execute(
                    select(ScheduledObservations)
                    .where(*conditions)
                    .order_by(ScheduledObservations.event_start, ScheduledObservations.id)
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
    return {
        "data": [
            {
                "id": row.id,
                "name": row.name,
                "status": row.status.value,
                "norad_id": row.norad_id,
                "satellite_name": (row.satellite_config or {}).get("name"),
                "event_start": row.event_start.isoformat(),
                "event_end": row.event_end.isoformat(),
                "peak_altitude": (row.pass_config or {}).get("peak_altitude"),
            }
            for row in rows
        ]
    }


@app.get(
    "/api/v1/observations/{observation_id}",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("observation", not_found=True),
    summary="Get a scheduled observation",
)
async def api_observation(observation_id: str, request: Request):
    """Return the full record for one scheduled observation by ID. Requires `observations:read`."""
    await _require_api_token(request, "observations:read")
    async with AsyncSessionLocal() as session:
        result = await fetch_scheduled_observations(session, observation_id)
    if not result.get("success"):
        raise HTTPException(status_code=500, detail="Could not load observation.")
    if result.get("data") is None:
        raise HTTPException(status_code=404, detail="Observation not found.")
    return {"data": result["data"]}


_SIGMF_PLAYBACK_SDR = {
    "id": "sigmf-playback",
    "name": "SigMF Playback",
    "type": "sigmfplayback",
    "antenna_labels": {},
    "frequency_min": None,
    "frequency_max": None,
}


def _sdr_api_metadata(row: SDRs) -> Dict[str, Any]:
    """Expose device identity and capabilities without connection settings."""
    return {
        "id": str(row.id),
        "name": row.name,
        "type": getattr(row.type, "value", row.type),
        "antenna_labels": row.antenna_labels or {},
        "frequency_min": row.frequency_min,
        "frequency_max": row.frequency_max,
    }


def _rotator_api_metadata(row: Rotators) -> Dict[str, Any]:
    """Expose pointing limits and park position without connection settings."""
    return {
        "id": str(row.id),
        "name": row.name,
        "azimuth_mode": row.azimuth_mode,
        "minaz": row.minaz,
        "maxaz": row.maxaz,
        "minel": row.minel,
        "maxel": row.maxel,
        "parkaz": row.parkaz,
        "parkel": row.parkel,
    }


def _rig_api_metadata(row: Rigs) -> Dict[str, Any]:
    """Expose radio configuration without network connection details."""
    return {
        "id": str(row.id),
        "name": row.name,
        "radiotype": row.radiotype,
        "radio_mode": row.radio_mode,
        "vfotype": row.vfotype,
        "tx_control_mode": row.tx_control_mode,
        "retune_interval_ms": row.retune_interval_ms,
        "follow_downlink_tuning": row.follow_downlink_tuning,
    }


def _device_uuid(value: str) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


@app.get(
    "/api/v1/sdrs",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("sdrs"),
    summary="List SDR device metadata",
)
async def api_sdrs(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """List configured SDRs and the built-in SigMF playback device. Requires `sdrs:read`."""
    await _require_api_token(request, "sdrs:read")
    # The playback source has a stable ID but no database row. Keep it first
    # so its detail URL and pagination remain consistent with SSE events.
    include_playback = offset == 0
    row_offset = max(0, offset - 1)
    row_limit = limit - int(include_playback)
    async with AsyncSessionLocal() as session:
        total = await session.scalar(select(func.count()).select_from(SDRs))
        rows = (
            (
                await session.execute(
                    select(SDRs).order_by(SDRs.name, SDRs.id).offset(row_offset).limit(row_limit)
                )
            )
            .scalars()
            .all()
            if row_limit
            else []
        )
    data = ([dict(_SIGMF_PLAYBACK_SDR)] if include_playback else []) + [
        _sdr_api_metadata(row) for row in rows
    ]
    return {
        "data": data,
        "pagination": {"limit": limit, "offset": offset, "total": (total or 0) + 1},
    }


@app.get(
    "/api/v1/sdrs/{sdr_id}",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("sdr", not_found=True),
    summary="Get SDR device metadata",
)
async def api_sdr(sdr_id: str, request: Request):
    """Resolve an SDR streaming event's device ID. Requires `sdrs:read`."""
    await _require_api_token(request, "sdrs:read")
    if sdr_id == _SIGMF_PLAYBACK_SDR["id"]:
        return {"data": dict(_SIGMF_PLAYBACK_SDR)}
    device_id = _device_uuid(sdr_id)
    if device_id is None:
        raise HTTPException(status_code=404, detail="SDR not found.")
    async with AsyncSessionLocal() as session:
        row = await session.get(SDRs, device_id)
    if row is None:
        raise HTTPException(status_code=404, detail="SDR not found.")
    return {"data": _sdr_api_metadata(row)}


@app.get(
    "/api/v1/rotators",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("rotators"),
    summary="List rotator device metadata",
)
async def api_rotators(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """List configured rotators and their motion limits. Requires `rotators:read`."""
    await _require_api_token(request, "rotators:read")
    async with AsyncSessionLocal() as session:
        total = await session.scalar(select(func.count()).select_from(Rotators))
        rows = (
            (
                await session.execute(
                    select(Rotators)
                    .order_by(Rotators.name, Rotators.id)
                    .offset(offset)
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
    return {
        "data": [_rotator_api_metadata(row) for row in rows],
        "pagination": {"limit": limit, "offset": offset, "total": total or 0},
    }


@app.get(
    "/api/v1/rotators/{rotator_id}",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("rotator", not_found=True),
    summary="Get rotator device metadata",
)
async def api_rotator(rotator_id: str, request: Request):
    """Resolve a tracker hardware event's rotator ID. Requires `rotators:read`."""
    await _require_api_token(request, "rotators:read")
    device_id = _device_uuid(rotator_id)
    if device_id is None:
        raise HTTPException(status_code=404, detail="Rotator not found.")
    async with AsyncSessionLocal() as session:
        row = await session.get(Rotators, device_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Rotator not found.")
    return {"data": _rotator_api_metadata(row)}


@app.get(
    "/api/v1/rigs",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("rigs"),
    summary="List rig device metadata",
)
async def api_rigs(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """List configured radios and operating modes. Requires `rigs:read`."""
    await _require_api_token(request, "rigs:read")
    async with AsyncSessionLocal() as session:
        total = await session.scalar(select(func.count()).select_from(Rigs))
        rows = (
            (
                await session.execute(
                    select(Rigs).order_by(Rigs.name, Rigs.id).offset(offset).limit(limit)
                )
            )
            .scalars()
            .all()
        )
    return {
        "data": [_rig_api_metadata(row) for row in rows],
        "pagination": {"limit": limit, "offset": offset, "total": total or 0},
    }


@app.get(
    "/api/v1/rigs/{rig_id}",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("rig", not_found=True),
    summary="Get rig device metadata",
)
async def api_rig(rig_id: str, request: Request):
    """Resolve a tracker rig event's device ID. Requires `rigs:read`."""
    await _require_api_token(request, "rigs:read")
    device_id = _device_uuid(rig_id)
    if device_id is None:
        raise HTTPException(status_code=404, detail="Rig not found.")
    async with AsyncSessionLocal() as session:
        row = await session.get(Rigs, device_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Rig not found.")
    return {"data": _rig_api_metadata(row)}


@app.get(
    "/api/v1/satellites",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("satellites"),
    summary="Search the satellite catalog",
)
async def api_satellites(
    request: Request,
    query: Optional[str] = Query(default=None, min_length=1, max_length=80),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """Search satellite names and page through catalog summaries. The response includes the total match count but no orbit payloads. Requires `satellites:read`."""
    await _require_api_token(request, "satellites:read")
    # Treat user search text literally; SQL LIKE wildcards should not expand the result set.
    escaped_query = (
        query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") if query else None
    )
    conditions = [Satellites.name.ilike(f"%{escaped_query}%", escape="\\")] if query else []
    async with AsyncSessionLocal() as session:
        total = await session.scalar(
            select(func.count()).select_from(Satellites).where(*conditions)
        )
        rows = (
            (
                await session.execute(
                    select(Satellites)
                    .where(*conditions)
                    .order_by(Satellites.name, Satellites.norad_id)
                    .offset(offset)
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
    return {
        "data": [
            {"norad_id": row.norad_id, "name": row.name, "status": row.status} for row in rows
        ],
        "pagination": {"limit": limit, "offset": offset, "total": total or 0},
    }


@app.get(
    "/api/v1/satellites/monitored",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("monitored_satellites"),
    summary="List monitored satellites",
)
async def api_monitored_satellites(
    request: Request,
    enabled_only: bool = True,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """List satellites configured for observation generation. By default, only enabled entries are returned; use `enabled_only=false` to include disabled entries. Requires `satellites:read`."""
    await _require_api_token(request, "satellites:read")
    conditions = [MonitoredSatellites.enabled.is_(True)] if enabled_only else []
    async with AsyncSessionLocal() as session:
        total = await session.scalar(
            select(func.count()).select_from(MonitoredSatellites).where(*conditions)
        )
        rows = (
            (
                await session.execute(
                    select(MonitoredSatellites)
                    .where(*conditions)
                    .order_by(MonitoredSatellites.norad_id)
                    .offset(offset)
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
    return {
        "data": [
            {
                "id": row.id,
                "norad_id": row.norad_id,
                "name": (row.satellite_config or {}).get("name"),
                "enabled": row.enabled,
                "min_elevation": (row.generation_config or {}).get("min_elevation"),
            }
            for row in rows
        ],
        "pagination": {"limit": limit, "offset": offset, "total": total or 0},
    }


@app.get(
    "/api/v1/satellites/{norad_id}",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("satellite", not_found=True),
    summary="Get a satellite's catalog details",
)
async def api_satellite(norad_id: int, request: Request):
    """Return a satellite's name, status, operator, countries, and launch date by NORAD ID. Requires `satellites:read`."""
    await _require_api_token(request, "satellites:read")
    async with AsyncSessionLocal() as session:
        row = await session.get(Satellites, norad_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Satellite not found.")
    return {
        "data": {
            "norad_id": row.norad_id,
            "name": row.name,
            "status": row.status,
            "operator": row.operator,
            "countries": row.countries,
            "launched": row.launched.isoformat() if row.launched else None,
        }
    }


@app.get(
    "/api/v1/artifacts",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("artifacts"),
    summary="Browse artifact metadata",
)
async def api_artifacts(
    request: Request,
    page: int = Query(default=1, description="1-based page number; values below 1 use page 1."),
    page_size: int = Query(default=25, description="Items per page, clamped to 1–100."),
):
    """Page through captured-artifact metadata. Download links require `artifacts:download`. Requires `artifacts:read`."""
    await _require_api_token(request, "artifacts:read")
    result = await asyncio.to_thread(get_inventory().query, page=page, page_size=page_size)
    return {**result, "items": [_api_artifact_links(item) for item in result["items"]]}


@app.get(
    "/api/v1/artifacts/{artifact_id}",
    dependencies=[Depends(api_bearer_scheme)],
    responses=json_example("artifact", not_found=True),
    summary="Get artifact metadata",
)
async def api_artifact(artifact_id: str, request: Request):
    """Return metadata and download links for one captured artifact by ID. Requires `artifacts:read`; following download links requires `artifacts:download`."""
    await _require_api_token(request, "artifacts:read")
    item = await asyncio.to_thread(get_inventory().detail, artifact_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Artifact not found.")
    return {"data": _api_artifact_links(item)}


def _api_artifact_url(artifact_id: str, member: Optional[str] = None) -> str:
    base = f"/api/v1/artifacts/{quote(artifact_id, safe='')}"
    if member is not None:
        return f"{base}/files/{quote(member, safe='/')}"
    return f"{base}/download"


def _api_artifact_links(item: Dict[str, Any]) -> Dict[str, Any]:
    """Add PAT download links without replacing browser-session library URLs."""
    linked = dict(item)
    artifact_id = str(item["id"])
    base = _api_artifact_url(artifact_id)
    linked["api_download_url"] = base
    item_type = item.get("type")
    if item_type == "recording":
        parts = {"data": base, "meta": f"{base}?part=meta"}
        snapshot = item.get("snapshot")
        if snapshot:
            parts["snapshot"] = f"{base}?part=snapshot"
            if snapshot.get("thumbnail_url"):
                parts["thumbnail"] = f"{base}?part=thumbnail"
        linked["api_download_urls"] = parts
    elif item_type == "snapshot" and item.get("thumbnail_url"):
        linked["api_download_urls"] = {
            "image": base,
            "thumbnail": f"{base}?part=thumbnail",
        }
    elif item_type in {"decoded", "audio"} and item.get("file_count", 1) > 1:
        linked["api_download_urls"] = {"content": base, "metadata": f"{base}?part=metadata"}

    # Folder details already list nested files. Point those entries at the
    # member route so clients can fetch one product without downloading the ZIP.
    for key in ("images", "artifacts"):
        if key in item:
            linked[key] = [
                {**entry, "api_download_url": _api_artifact_url(artifact_id, entry["path"])}
                for entry in item[key]
            ]
    if "recordings" in item:
        linked["recordings"] = [
            {
                **recording,
                "api_download_urls": {
                    "data": _api_artifact_url(artifact_id, f"recordings/{recording['data_file']}"),
                    "meta": _api_artifact_url(artifact_id, f"recordings/{recording['meta_file']}"),
                },
            }
            for recording in item["recordings"]
        ]
    return linked


def _zip_api_artifact(folder: Path) -> str:
    """Build a temporary archive from an inventory-approved folder."""
    temp_zip = tempfile.NamedTemporaryFile(prefix="gs-artifact-", suffix=".zip", delete=False)
    temp_zip.close()
    try:
        with zipfile.ZipFile(temp_zip.name, "w", zipfile.ZIP_DEFLATED) as archive:
            for file_path in folder.rglob("*"):
                # Local symlinks must not pull files from outside the indexed folder.
                if file_path.is_symlink() or not file_path.is_file():
                    continue
                try:
                    file_path.resolve().relative_to(folder)
                except ValueError:
                    continue
                archive.write(file_path, file_path.relative_to(folder).as_posix())
    except Exception:
        os.remove(temp_zip.name)
        raise
    return temp_zip.name


@app.get(
    "/api/v1/artifacts/{artifact_id}/download",
    dependencies=[Depends(api_bearer_scheme)],
    response_class=FileResponse,
    responses=binary_responses(allow_zip=True),
    openapi_extra=RANGE_HEADER,
    summary="Download a library artifact",
    description=ARTIFACT_DOWNLOAD_DESCRIPTION,
)
async def api_artifact_download(
    artifact_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    part: Optional[str] = Query(default=None),
):
    """Download a file or a ZIP of a folder by inventory ID. Use `part` for a recording's `meta`, `snapshot`, or `thumbnail`, a snapshot's `thumbnail`, or a decoded/audio `metadata`. Supports byte ranges for direct files. Requires `artifacts:download`."""
    await _require_api_token(request, "artifacts:download")
    path = await asyncio.to_thread(get_inventory().resolve_download, artifact_id, part=part)
    if path is None:
        raise HTTPException(status_code=404, detail="Artifact file not found.")
    if path.is_dir():
        archive_path = await asyncio.to_thread(_zip_api_artifact, path)
        background_tasks.add_task(os.remove, archive_path)
        return FileResponse(
            archive_path,
            filename=f"{path.name}.zip",
            background=background_tasks,
            headers={"Cache-Control": "private, no-store"},
        )
    return FileResponse(path, filename=path.name, headers={"Cache-Control": "private, no-store"})


@app.get(
    "/api/v1/artifacts/{artifact_id}/files/{file_path:path}",
    dependencies=[Depends(api_bearer_scheme)],
    response_class=FileResponse,
    responses=binary_responses(allow_zip=False),
    openapi_extra=RANGE_HEADER,
    summary="Download one file from a library folder",
    description=ARTIFACT_MEMBER_DESCRIPTION,
)
async def api_artifact_file(artifact_id: str, file_path: str, request: Request):
    """Download one member of an indexed decoded folder or observation bundle. Supports byte ranges. Requires `artifacts:download`."""
    await _require_api_token(request, "artifacts:download")
    path = await asyncio.to_thread(get_inventory().resolve_download, artifact_id, member=file_path)
    if path is None:
        raise HTTPException(status_code=404, detail="Artifact file not found.")
    return FileResponse(path, filename=path.name, headers={"Cache-Control": "private, no-store"})


@app.post(
    "/api/database/restore", summary="Restore a database from SQL backup", include_in_schema=False
)
async def restore_database_backup(request: Request):
    """Stream a raw SQL backup in the request body (up to 1 GB). Requires an administrator browser session. Tables are dropped before restore by default; set `drop_tables=false` to retain them."""
    await _require_request_auth(request, require_auth=True, require_admin=True)
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            declared_size = int(content_length)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid backup upload size.") from exc
        if declared_size > FULL_RESTORE_MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=413, detail="Backup file exceeds the 1GB restore limit."
            )

    drop_tables = str(request.query_params.get("drop_tables", "true")).lower() not in {
        "0",
        "false",
        "no",
    }
    temp_file = tempfile.NamedTemporaryFile(prefix="gs-restore-", suffix=".sql", delete=False)
    temp_path = Path(temp_file.name)
    bytes_received = 0

    try:
        async for chunk in request.stream():
            bytes_received += len(chunk)
            if bytes_received > FULL_RESTORE_MAX_FILE_SIZE_BYTES:
                raise HTTPException(
                    status_code=413, detail="Backup file exceeds the 1GB restore limit."
                )
            await asyncio.to_thread(temp_file.write, chunk)
        await asyncio.to_thread(temp_file.close)

        if bytes_received == 0:
            raise HTTPException(status_code=400, detail="Backup file is empty.")

        restore_reply = await restore_full_backup_file(sio, temp_path, drop_tables, logger)
        if not restore_reply.get("success"):
            raise HTTPException(
                status_code=400,
                detail=str(restore_reply.get("error") or "Failed to restore database backup."),
            )
        return restore_reply
    finally:
        if not temp_file.closed:
            temp_file.close()
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            logger.warning("Failed to remove temporary database restore upload: %s", temp_path)


# Mount data directories for recordings, snapshots, decoded data (SSTV, AFSK, Morse, etc.), and audio
# Ensure these directories exist before mounting
backend_dir = os.path.dirname(os.path.abspath(__file__))
satellites_dir = os.path.join(backend_dir, "..", "images", "satellites")
bodies_dir = os.path.join(backend_dir, "..", "images", "bodies")
missions_dir = os.path.join(backend_dir, "..", "images", "missions")
recordings_dir = os.path.join(backend_dir, "..", "data", "recordings")
snapshots_dir = os.path.join(backend_dir, "..", "data", "snapshots")
decoded_dir = os.path.join(backend_dir, "..", "data", "decoded")
audio_dir = os.path.join(backend_dir, "..", "data", "audio")
transcriptions_dir = os.path.join(backend_dir, "..", "data", "transcriptions")
observations_dir = os.path.join(backend_dir, "..", "data", "observations")

# Create directories if they don't exist
os.makedirs(satellites_dir, exist_ok=True)
os.makedirs(bodies_dir, exist_ok=True)
os.makedirs(missions_dir, exist_ok=True)
os.makedirs(recordings_dir, exist_ok=True)
os.makedirs(snapshots_dir, exist_ok=True)
os.makedirs(decoded_dir, exist_ok=True)
os.makedirs(audio_dir, exist_ok=True)
os.makedirs(transcriptions_dir, exist_ok=True)
os.makedirs(observations_dir, exist_ok=True)

# Use html=True to enable directory browsing
app.mount("/satimages", StaticFiles(directory=satellites_dir, html=True), name="satimages")
app.mount(
    "/recordings", AuthenticatedStaticFiles(directory=recordings_dir, html=True), name="recordings"
)
app.mount(
    "/observations",
    AuthenticatedStaticFiles(directory=observations_dir, html=False),
    name="observations",
)
app.mount(
    "/snapshots", AuthenticatedStaticFiles(directory=snapshots_dir, html=True), name="snapshots"
)
app.mount("/decoded", AuthenticatedStaticFiles(directory=decoded_dir, html=True), name="decoded")
app.mount("/audio", AuthenticatedStaticFiles(directory=audio_dir, html=True), name="audio")
# Note: html=False for transcriptions to ensure .txt files are served with correct content-type
app.mount(
    "/transcriptions",
    AuthenticatedStaticFiles(directory=transcriptions_dir, html=False),
    name="transcriptions",
)
app.mount("/body-icons", StaticFiles(directory=bodies_dir, html=True), name="body-icons")
app.mount("/mission-icons", StaticFiles(directory=missions_dir, html=True), name="mission-icons")


def _resolve_decoded_folder(decoded_root: Path, foldername: str) -> Path:
    folder_path = (decoded_root / foldername).resolve()
    try:
        folder_path.relative_to(decoded_root)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid folder path")
    if not folder_path.exists() or not folder_path.is_dir():
        raise HTTPException(status_code=404, detail="Decoded folder not found")
    return folder_path


def _resolve_observation_bundle(observations_root: Path, foldername: str) -> Path:
    """Resolve a .gsobs directory without allowing a path outside the bundle root."""
    if not foldername.endswith(".gsobs"):
        raise HTTPException(status_code=400, detail="Invalid observation bundle")
    folder_path = (observations_root / foldername).resolve()
    try:
        folder_path.relative_to(observations_root)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid observation bundle path")
    if not folder_path.exists() or not folder_path.is_dir():
        raise HTTPException(status_code=404, detail="Observation bundle not found")
    return folder_path


@app.get(
    "/api/decoded/{foldername}/download",
    summary="Download decoded files as ZIP",
    include_in_schema=False,
)
async def download_decoded_folder(
    foldername: str, request: Request, background_tasks: BackgroundTasks
):
    """Package one decoded-output folder into a ZIP download. Requires a browser session."""
    await _require_request_auth(request, require_auth=True, require_admin=False)
    decoded_root = Path(decoded_dir).resolve()
    folder_path = _resolve_decoded_folder(decoded_root, foldername)
    temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    temp_zip.close()

    try:
        with zipfile.ZipFile(temp_zip.name, "w", zipfile.ZIP_DEFLATED) as archive:
            for file_path in folder_path.rglob("*"):
                if file_path.is_file():
                    archive.write(file_path, file_path.relative_to(folder_path).as_posix())
    except Exception as exc:
        if os.path.exists(temp_zip.name):
            os.remove(temp_zip.name)
        raise HTTPException(status_code=500, detail=f"Failed to create archive: {exc}")

    background_tasks.add_task(os.remove, temp_zip.name)
    return FileResponse(
        temp_zip.name,
        media_type="application/zip",
        filename=f"{foldername}.zip",
        background=background_tasks,
    )


@app.get(
    "/api/observations/{foldername}/download",
    summary="Download an observation bundle as ZIP",
    include_in_schema=False,
)
async def download_observation_bundle(
    foldername: str, request: Request, background_tasks: BackgroundTasks
):
    """Package a `.gsobs` automated-observation bundle into a ZIP download. Requires a browser session."""
    await _require_request_auth(request, require_auth=True, require_admin=False)
    bundle_path = _resolve_observation_bundle(Path(observations_dir).resolve(), foldername)
    temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    temp_zip.close()
    try:
        with zipfile.ZipFile(temp_zip.name, "w", zipfile.ZIP_DEFLATED) as archive:
            for file_path in bundle_path.rglob("*"):
                if file_path.is_file():
                    archive.write(file_path, file_path.relative_to(bundle_path).as_posix())
    except Exception as exc:
        if os.path.exists(temp_zip.name):
            os.remove(temp_zip.name)
        raise HTTPException(status_code=500, detail=f"Failed to create archive: {exc}")

    background_tasks.add_task(os.remove, temp_zip.name)
    return FileResponse(
        temp_zip.name,
        media_type="application/zip",
        filename=f"{foldername}.zip",
        background=background_tasks,
    )


# This catch-all route comes AFTER specific API routes
@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa(request: Request, full_path: str):
    # Unknown API URLs must fail as API calls rather than return the SPA HTML.
    if full_path == "api" or full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API endpoint not found.")

    static_files_dir = os.environ.get("STATIC_FILES_DIR", "../../frontend/dist")
    base_dir = Path(static_files_dir).resolve()

    if is_static_asset_request(full_path):
        # Normalize and enforce containment to prevent path traversal.
        try:
            file_path = resolve_static_asset_path(base_dir, full_path)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid path")
        return FileResponse(str(file_path))

    return FileResponse(str(base_dir / "index.html"))


async def init_db():
    """Initialize database and run migrations."""
    global _needs_initial_sync

    logger.info("Initializing database...")

    # Ensure required data directories exist
    logger.info("Ensuring data directories exist...")
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dirs = [
        os.path.join(backend_dir, "data", "db"),
        os.path.join(backend_dir, "data", "recordings"),
        os.path.join(backend_dir, "data", "snapshots"),
        os.path.join(
            backend_dir, "data", "decoded"
        ),  # For SSTV images, AFSK packets, Morse audio, etc.
        os.path.join(backend_dir, "data", "audio"),  # For audio recordings
        os.path.join(backend_dir, "data", "configs"),  # For satellite decoder configurations
        os.path.join(backend_dir, "data", "uhd_images"),  # For UHD FPGA images
        os.path.join(backend_dir, "data", "uhd_config"),  # For UHD configuration files
        os.path.join(backend_dir, "data", "transcriptions"),  # For transcription text files
    ]
    for directory in data_dirs:
        os.makedirs(directory, exist_ok=True)
        logger.debug(f"Ensured directory exists: {directory}")

    # Check if database exists by trying to query metadata
    database_existed = False
    try:
        async with engine.begin() as conn:
            # Try to get table names - if this succeeds, database exists
            result = await conn.run_sync(
                lambda sync_conn: engine.dialect.get_table_names(sync_conn)
            )
            database_existed = len(result) > 0
    except Exception:
        # Database doesn't exist or is empty
        database_existed = False

    # Run Alembic migrations to ensure schema is up to date
    try:
        # Run migrations in a thread pool to avoid event loop conflicts
        # Use the currently running loop (compatible with Python 3.12+)
        loop = asyncio.get_running_loop()
        with concurrent.futures.ThreadPoolExecutor() as executor:
            await loop.run_in_executor(executor, run_migrations)

    except Exception as e:
        logger.error(f"Error running database migrations: {e}")
        logger.exception(e)
        raise

    # If database didn't exist before, populate with initial data
    if not database_existed:
        logger.info("Database initialized (new, populated with initial data)")
        await first_time_initialization()
        _needs_initial_sync = True
    else:
        logger.info("Database initialized (existing, migrations applied)")


_default_openapi = app.openapi


def _public_openapi():
    """Keep explicit nulls in examples; FastAPI otherwise drops them from OpenAPI."""
    schema = _default_openapi()
    for path, example_name in JSON_ROUTE_EXAMPLES.items():
        schema["paths"][path]["get"]["responses"]["200"]["content"]["application/json"][
            "example"
        ] = JSON_EXAMPLES[example_name]
    return schema


app.openapi = _public_openapi
