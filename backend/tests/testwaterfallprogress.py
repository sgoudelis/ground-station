"""Waterfall progress reporting preserves logging state across task invocations."""

import logging
from queue import Queue
from types import SimpleNamespace

import pytest

from tasks import waterfallgenerator

pytestmark = pytest.mark.unit


@pytest.mark.parametrize("fail", [False, True])
def test_progress_survives_quiet_logging_and_does_not_leak_into_later_tasks(
    monkeypatch, tmp_path, fail
):
    task_logger = logging.getLogger("test-waterfall-progress")
    task_logger.setLevel(logging.ERROR)
    original_handlers = list(task_logger.handlers)
    progress = Queue()

    def generate(_path):
        task_logger.info("Progress: %.1f%%", 50.0)
        if fail:
            raise RuntimeError("generation failed")
        return True

    monkeypatch.setattr(waterfallgenerator, "HAS_SETPROCTITLE", False)
    monkeypatch.setattr(
        waterfallgenerator.multiprocessing, "current_process", lambda: SimpleNamespace(name="test")
    )
    monkeypatch.setattr(
        waterfallgenerator,
        "WaterfallGenerator",
        lambda _config: SimpleNamespace(logger=task_logger, generate_from_sigmf=generate),
    )
    if fail:
        with pytest.raises(RuntimeError, match="generation failed"):
            waterfallgenerator.generate_waterfall_task(
                str(tmp_path / "recording"), _progress_queue=progress
            )
    else:
        result = waterfallgenerator.generate_waterfall_task(
            str(tmp_path / "recording"), _progress_queue=progress
        )
        assert result["status"] == "completed"

    messages = []
    while not progress.empty():
        messages.append(progress.get_nowait())
    assert sum(message.get("progress") == 50 for message in messages) == 1
    assert task_logger.handlers == original_handlers
    assert task_logger.level == logging.ERROR
    task_logger.info("Progress: 75%%")
    assert progress.empty()
