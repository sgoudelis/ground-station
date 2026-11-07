# Copyright (c) 2026 Efstratios Goudelis

from queue import Empty


def report_configuration_failure(data_queue, config, status, message, offset=0, correction=1):
    """Report measured tuning after a failed setter, keeping its request identity."""
    measured = {}
    if status.get("frequency_hz") is not None:
        measured["center_freq"] = (status["frequency_hz"] - offset) / correction
    if status.get("sample_rate") is not None:
        measured["sample_rate"] = status["sample_rate"]
    data_queue.put(
        {
            "type": "config-failed",
            "config_revision": config.get("config_revision", 0),
            "message": message,
            "measured_config": measured,
            "receiver_status": status,
        }
    )


class ConfigurationInbox:
    """Merge queued settings without discarding ordered control messages."""

    def __init__(self, queue):
        self.queue = queue
        self.pending = None

    def get(self):
        update = self.pending
        self.pending = None
        if update is None:
            try:
                update = self.queue.get_nowait()
            except Empty:
                return None
        update = dict(update)
        if self._is_command(update):
            return update

        # Bound each drain so continuous control traffic cannot starve IQ reads.
        for _ in range(255):
            try:
                following = self.queue.get_nowait()
            except Empty:
                break
            if self._is_command(following):
                self.pending = following
                break
            # Settings dictionaries are complete snapshots; replacing them also
            # preserves intentional removals such as clearing per-element gains.
            update.update(following)
        return update

    @staticmethod
    def _is_command(update):
        return any(key in update for key in ("type", "response_queue", "seek_seconds"))
