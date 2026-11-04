"""Build independent recorded tracks without bridging runs or reception gaps."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any

GAP_SECONDS = 15 * 60
POINT_BUDGET = 5000


def build_flight_paths(points: list[dict[str, Any]]) -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for point in points:
        grouped[point["_run"]].append(point)
    flights: list[dict[str, Any]] = []
    all_segments: list[list[dict[str, Any]]] = []
    for run, fixes in sorted(grouped.items()):
        fixes.sort(key=lambda point: (point["captured_at"], point["id"]))
        segments: list[list[dict[str, Any]]] = []
        previous = None
        for point in fixes:
            stamp = datetime.fromisoformat(point["captured_at"])
            # Split before sampling: sparse display points must not create gaps,
            # and a date-line crossing must not draw a line across the globe.
            if previous is None or (
                (stamp - previous[0]).total_seconds() > GAP_SECONDS
                or abs(point["longitude"] - previous[1]) > 180
            ):
                segments.append([])
            segments[-1].append(point)
            previous = (stamp, point["longitude"])
        flights.append({"run": run, "point_count": len(fixes), "segments": segments})
        all_segments.extend(segments)

    total = len(points)
    minimum = [min(2, len(segment)) for segment in all_segments]
    capacity = [len(segment) - count for segment, count in zip(all_segments, minimum)]
    # Keep every segment's endpoints even when a very fragmented capture needs
    # more than the usual budget. Never silently omit a flight or join gaps.
    remaining = min(total, max(POINT_BUDGET, sum(minimum))) - sum(minimum)
    spare = sum(capacity)
    extra = [remaining * count // spare if spare else 0 for count in capacity]
    remainders = sorted(
        range(len(extra)),
        key=lambda index: (remaining * capacity[index] % spare) if spare else 0,
        reverse=True,
    )
    for index in remainders[: remaining - sum(extra)]:
        extra[index] += 1
    allocations = iter(base + count for base, count in zip(minimum, extra))
    displayed = 0
    for flight in flights:
        sampled = []
        for segment in flight["segments"]:
            count = next(allocations)
            indices = (
                [round(index * (len(segment) - 1) / (count - 1)) for index in range(count)]
                if count > 1
                else [0]
            )
            sampled.append(
                [
                    {
                        key: segment[index].get(key)
                        for key in ("latitude", "longitude", "captured_at", "altitude")
                    }
                    for index in indices
                ]
            )
            displayed += count
        flight["segments"] = sampled
    return {
        "flights": flights,
        "point_count": total,
        "displayed_points": displayed,
        "sampled": displayed < total,
    }
