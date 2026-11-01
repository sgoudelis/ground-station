"""Small process-local live-aircraft cache shared by the socket handlers."""

import time
from typing import Any

ROOM = "adsb-live"
MAX_AIRCRAFT = 1000
aircraft: dict[str, dict[str, Any]] = {}


def update(records):
    for record in records:
        previous = aircraft.get(record["icao"])
        if previous is None or record["timestamp"] >= previous["timestamp"]:
            aircraft[record["icao"]] = record
    return snapshot()


def snapshot():
    cutoff = time.time() - 60
    for address, record in list(aircraft.items()):
        if record["timestamp"] < cutoff:
            del aircraft[address]
    if len(aircraft) > MAX_AIRCRAFT:
        oldest = sorted(aircraft, key=lambda address: aircraft[address]["timestamp"])
        for address in oldest[: len(aircraft) - MAX_AIRCRAFT]:
            del aircraft[address]
    return list(aircraft.values())
