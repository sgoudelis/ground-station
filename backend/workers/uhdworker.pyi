"""Public entry point for the UHD worker, whose native bindings are untyped."""

from typing import Any

def uhd_worker_process(
    config_queue: Any,
    data_queue: Any,
    stop_event: Any,
    iq_queue_fft: Any = None,
    iq_queue_demod: Any = None,
) -> None: ...
