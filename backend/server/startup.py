import asyncio
import concurrent.futures
import os
import queue
import tempfile
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, Optional, Set

import socketio
from engineio.payload import Payload
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from audio.audiobroadcaster import AudioBroadcaster
from audio.audiostreamer import WebAudioStreamer
from common import auth as authsvc
from common.arguments import arguments
from common.audio_queue_config import get_audio_queue_config
from common.logger import logger
from db import AsyncSessionLocal, engine
from db.migrations import run_migrations
from db.models import Locations
from observations import events as obs_events
from observations.events import emit_scheduled_observations_changed as _emit
from observations.events import set_socketio_instance
from observations.executor import ObservationExecutor
from observations.sync import ObservationSchedulerSync
from pipeline.orchestration.processmanager import process_manager
from server import runtimestate, shutdown
from server.firsttime import first_time_initialization, run_initial_sync
from server.scheduler import run_initial_observation_generation, start_scheduler, stop_scheduler
from server.sessionsnapshot import start_session_runtime_emitter
from server.spapaths import is_static_asset_request, resolve_static_asset_path
from server.systeminfo import start_system_info_emitter
from server.version import get_full_version_info, get_update_check
from tasks.manager import BackgroundTaskManager
from tasks.registry import get_task
from tracker.instances import emit_tracker_instances, restore_tracker_instances_from_db
from tracker.messages import handle_tracker_messages

# Increase payload limits to handle large waterfall PNG images and maintenance uploads.
Payload.max_decode_packets = 50
# Keep comfortably above the user-facing 300MB restore limit so JSON/Socket.IO escaping
# overhead does not reject requests near the configured cap.
SOCKET_IO_MAX_PAYLOAD_BYTES = 384 * 1024 * 1024  # 384MB
# Large setup restore payloads can keep a request in-flight for a while; allow longer
# heartbeat windows so transport is not dropped mid-restore.
SOCKET_IO_PING_INTERVAL_SECONDS = 25
SOCKET_IO_PING_TIMEOUT_SECONDS = 120
# Default is 100KB (100000 bytes), increase for large backup restore payloads.
Payload.max_decode_packet_size = SOCKET_IO_MAX_PAYLOAD_BYTES

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


@asynccontextmanager
async def lifespan(fastapiapp: FastAPI):
    """Custom lifespan for FastAPI."""
    global background_task_manager

    logger.info("FastAPI lifespan startup...")
    # In an async context, prefer get_running_loop() (get_event_loop() is deprecated when no loop set)
    event_loop = asyncio.get_running_loop()

    # Set socketio instance for observations events
    set_socketio_instance(sio)

    # Initialize background task manager
    background_task_manager = BackgroundTaskManager(sio)
    runtimestate.background_task_manager = background_task_manager
    logger.info("BackgroundTaskManager initialized")

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

    # Initialize observation executor and scheduler sync
    observation_executor = ObservationExecutor(process_manager, sio)
    observation_sync = ObservationSchedulerSync(scheduler, observation_executor)

    # Store observation_sync globally for use in handlers
    obs_events.observation_sync = observation_sync

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
        # Shutdown background task manager
        if background_task_manager:
            await background_task_manager.shutdown()
        # Cancel background tasks we created
        for task in list(background_tasks):
            task.cancel()
        background_tasks.clear()
        stop_scheduler()
        process_manager.shutdown()
        shutdown.cleanup_everything()


sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=True,
    engineio_logger=True,
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
    description="API for satellite tracking, SDR control, and radio communication",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

process_manager.set_sio(sio)


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
) -> Optional[Dict[str, Any]]:
    auth_header = request.headers.get("authorization")
    token = authsvc.extract_bearer_token(auth_header)
    auth_context = await authsvc.authenticate_token(token) if token else None

    if require_auth and not auth_context:
        raise HTTPException(status_code=401, detail="Authentication required.")

    if require_admin and not authsvc.is_admin_role((auth_context or {}).get("role")):
        raise HTTPException(status_code=403, detail="Admin access is required.")

    return auth_context


@app.get("/api/auth/status")
async def auth_status(request: Request):
    """Return setup/authentication status for frontend app bootstrapping."""
    setup_required = await authsvc.is_setup_required()
    station_identity = await _load_station_identity()
    auth_header = request.headers.get("authorization")
    token = authsvc.extract_bearer_token(auth_header)
    auth_context = await authsvc.authenticate_token(token, touch_last_seen=False) if token else None
    return {
        "setup_required": setup_required,
        "authenticated": bool(auth_context),
        "user": auth_context,
        "station": station_identity,
    }


@app.post("/api/auth/setup-admin")
async def setup_admin(request: Request):
    """One-time bootstrap endpoint to create the initial admin account."""
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
    return result


@app.post("/api/auth/login")
async def auth_login(request: Request):
    """Login endpoint that returns an opaque bearer token."""
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
    return result


@app.post("/api/auth/logout")
async def auth_logout(request: Request):
    """Revoke the current auth session token."""
    await _require_request_auth(request, require_auth=True, require_admin=False)
    auth_header = request.headers.get("authorization")
    token = authsvc.extract_bearer_token(auth_header)
    await authsvc.logout(token, reason="logout")
    return {"success": True}


@app.get("/api/auth/me")
async def auth_me(request: Request):
    """Return current user context from bearer token."""
    auth_context = await _require_request_auth(request, require_auth=True, require_admin=False)
    return {"success": True, "data": auth_context}


@app.get("/api/auth/users")
async def auth_list_users(request: Request):
    """Admin endpoint: list all users."""
    await _require_request_auth(request, require_auth=True, require_admin=True)
    return await authsvc.list_users()


@app.post("/api/auth/users")
async def auth_create_user(request: Request):
    """Admin endpoint: create a new user account."""
    auth_context = await _require_request_auth(request, require_auth=True, require_admin=True)
    if auth_context is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    payload = await request.json()
    result = await authsvc.create_user(
        username=str(payload.get("username") or ""),
        password=str(payload.get("password") or ""),
        role=str(payload.get("role") or ""),
        actor_user_id=str(auth_context.get("user_id")),
    )
    if not result.get("success"):
        raise HTTPException(
            status_code=400, detail=str(result.get("error") or "Failed to create user.")
        )
    return result


@app.patch("/api/auth/users/{user_id}")
async def auth_update_user(user_id: str, request: Request):
    """Admin endpoint: update role and activation state for a user."""
    auth_context = await _require_request_auth(request, require_auth=True, require_admin=True)
    if auth_context is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    payload = await request.json()
    role = payload.get("role", None)
    is_active = payload.get("is_active", None)
    result = await authsvc.update_user(
        user_id=user_id,
        role=role,
        is_active=is_active,
        actor_user_id=str(auth_context.get("user_id")),
    )
    if not result.get("success"):
        raise HTTPException(
            status_code=400, detail=str(result.get("error") or "Failed to update user.")
        )
    return result


@app.post("/api/auth/users/{user_id}/reset-password")
async def auth_reset_user_password(user_id: str, request: Request):
    """Admin endpoint: reset a user password and revoke active sessions."""
    auth_context = await _require_request_auth(request, require_auth=True, require_admin=True)
    if auth_context is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    payload = await request.json()
    result = await authsvc.reset_user_password(
        user_id=user_id,
        new_password=str(payload.get("password") or ""),
        actor_user_id=str(auth_context.get("user_id")),
    )
    if not result.get("success"):
        raise HTTPException(
            status_code=400,
            detail=str(result.get("error") or "Failed to reset user password."),
        )
    return result


@app.delete("/api/auth/users/{user_id}")
async def auth_delete_user(user_id: str, request: Request):
    """Admin endpoint: delete a user account."""
    auth_context = await _require_request_auth(request, require_auth=True, require_admin=True)
    if auth_context is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    result = await authsvc.delete_user(
        user_id=user_id,
        actor_user_id=str(auth_context.get("user_id")),
    )
    if not result.get("success"):
        raise HTTPException(
            status_code=400, detail=str(result.get("error") or "Failed to delete user.")
        )
    return result


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

# Create directories if they don't exist
os.makedirs(satellites_dir, exist_ok=True)
os.makedirs(bodies_dir, exist_ok=True)
os.makedirs(missions_dir, exist_ok=True)
os.makedirs(recordings_dir, exist_ok=True)
os.makedirs(snapshots_dir, exist_ok=True)
os.makedirs(decoded_dir, exist_ok=True)
os.makedirs(audio_dir, exist_ok=True)
os.makedirs(transcriptions_dir, exist_ok=True)

# Use html=True to enable directory browsing
app.mount("/satimages", StaticFiles(directory=satellites_dir, html=True), name="satimages")
app.mount("/recordings", StaticFiles(directory=recordings_dir, html=True), name="recordings")
app.mount("/snapshots", StaticFiles(directory=snapshots_dir, html=True), name="snapshots")
app.mount("/decoded", StaticFiles(directory=decoded_dir, html=True), name="decoded")
app.mount("/audio", StaticFiles(directory=audio_dir, html=True), name="audio")
# Note: html=False for transcriptions to ensure .txt files are served with correct content-type
app.mount(
    "/transcriptions", StaticFiles(directory=transcriptions_dir, html=False), name="transcriptions"
)
app.mount("/body-icons", StaticFiles(directory=bodies_dir, html=True), name="body-icons")
app.mount("/mission-icons", StaticFiles(directory=missions_dir, html=True), name="mission-icons")


# Add the version API endpoint BEFORE the catch-all route
@app.get("/api/version")
async def get_version():
    """Return the current version information of the application."""
    try:
        version_info = get_full_version_info()
        return version_info
    except Exception as e:
        logger.error(f"Error retrieving version information: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to retrieve version information: {str(e)}"
        )


@app.get("/api/update-check")
async def update_check():
    """Return update availability based on GitHub releases."""
    try:
        return get_update_check()
    except Exception as e:
        logger.error(f"Error retrieving update information: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to retrieve update information: {str(e)}"
        )


def _resolve_decoded_folder(decoded_root: Path, foldername: str) -> Path:
    folder_path = (decoded_root / foldername).resolve()
    try:
        folder_path.relative_to(decoded_root)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid folder path")
    if not folder_path.exists() or not folder_path.is_dir():
        raise HTTPException(status_code=404, detail="Decoded folder not found")
    return folder_path


@app.get("/api/decoded/{foldername}/download")
async def download_decoded_folder(
    foldername: str, request: Request, background_tasks: BackgroundTasks
):
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


# This catch-all route comes AFTER specific API routes
@app.get("/{full_path:path}")
async def serve_spa(request: Request, full_path: str):
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
