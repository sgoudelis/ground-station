import asyncio
import multiprocessing
import os
import signal
import sys
import threading

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import uvicorn  # noqa: E402

from common.arguments import arguments  # noqa: E402
from common.logger import get_logger_config, logger  # noqa: E402
from handlers.socket import register_socketio_handlers  # noqa: E402
from server.shmmonitor import start_cleanup_thread  # noqa: E402
from server.shutdown import cleanup_everything, signal_handler  # noqa: E402
from server.startup import (  # noqa: E402
    SOCKET_IO_MAX_PAYLOAD_BYTES,
    SOCKET_IO_PING_INTERVAL_SECONDS,
    SOCKET_IO_PING_TIMEOUT_SECONDS,
    init_db,
    sio,
    socket_app,
)
from server.version import get_version_base  # noqa: E402

try:
    import setproctitle

    HAS_SETPROCTITLE = True
except ImportError:
    HAS_SETPROCTITLE = False


def print_banner():
    """Print ASCII art banner with version."""
    version = get_version_base()
    print(
        f"""
   ██████╗ ██████╗  ██████╗ ██╗   ██╗███╗   ██╗██████╗
  ██╔════╝ ██╔══██╗██╔═══██╗██║   ██║████╗  ██║██╔══██╗
  ██║  ███╗██████╔╝██║   ██║██║   ██║██╔██╗ ██║██║  ██║
  ██║   ██║██╔══██╗██║   ██║██║   ██║██║╚██╗██║██║  ██║
  ╚██████╔╝██║  ██║╚██████╔╝╚██████╔╝██║ ╚████║██████╔╝
   ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚═════╝

  ███████╗████████╗ █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
  ██╔════╝╚══██╔══╝██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
  ███████╗   ██║   ███████║   ██║   ██║██║   ██║██╔██╗ ██║
  ╚════██║   ██║   ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
  ███████║   ██║   ██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
  ╚══════╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝

                            v{version}
    """
    )


# Set process and thread names
def configure_process_names():
    if HAS_SETPROCTITLE:
        setproctitle.setproctitle("Ground Station - Main Thread")
    multiprocessing.current_process().name = "Ground Station - Main"
    threading.current_thread().name = "Ground Station - Main Thread"


def main() -> None:
    print_banner()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    configure_process_names()

    # Start shared memory monitor thread (for GNU Radio segment tracking)
    logger.info("Starting shared memory monitor thread...")
    start_cleanup_thread(monitor_interval=30)

    # Register Socket.IO handlers
    register_socketio_handlers(sio)

    logger.info("Configuring database connection...")
    if arguments.temp_db:
        logger.info(f"Temporary database enabled, using {arguments.db}")
    # Use asyncio.run to create/manage a temporary event loop (Python 3.12+ friendly)
    asyncio.run(init_db())

    # Note: Static files and API routes are already configured in startup.py

    logger.info(f"Starting Ground Station server with parameters {arguments}")
    try:
        uvicorn.run(
            socket_app,
            host=arguments.host,
            port=arguments.port,
            # Keep Uvicorn WebSocket frame size aligned with Socket.IO/Engine.IO
            # payload limits configured in server.startup, otherwise large setup
            # restore uploads can be disconnected before the backend handler runs.
            ws_max_size=SOCKET_IO_MAX_PAYLOAD_BYTES,
            # Align transport ping settings with Socket.IO server heartbeat settings
            # for long-running restore operations.
            ws_ping_interval=SOCKET_IO_PING_INTERVAL_SECONDS,
            ws_ping_timeout=SOCKET_IO_PING_TIMEOUT_SECONDS,
            log_config=get_logger_config(arguments),
        )
    except KeyboardInterrupt:
        logger.info("KeyboardInterrupt in main")
        cleanup_everything()
        os._exit(0)
    except Exception as e:  # pragma: no cover - startup errors
        logger.error(f"Error starting Ground Station server: {str(e)}")
        logger.exception(e)
        cleanup_everything()
        os._exit(1)


if __name__ == "__main__":
    main()
