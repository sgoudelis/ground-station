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

from collections import Counter

from sqlalchemy import select

from common.constants import SocketEvents
from common.logger import logger
from db import AsyncSessionLocal
from db.models import SDRs, TrackingState
from tracker.contracts import TRACKING_STATE_NAME_PREFIX
from tracker.runner import (
    assign_rotator_to_tracker,
    get_tracker_instances_payload,
    get_tracker_manager,
)


def _extract_tracker_id_from_state_name(name: str) -> str:
    prefix = f"{TRACKING_STATE_NAME_PREFIX}:"
    if not name or not name.startswith(prefix):
        return ""
    tracker_id = name[len(prefix) :].strip()
    if not tracker_id or tracker_id == "legacy-backup":
        return ""
    return tracker_id


def _is_observation_tracker_id(tracker_id: str) -> bool:
    return tracker_id.startswith("obs-")


async def restore_tracker_instances_from_db() -> list[str]:
    """Restore persistent tracker runtimes/assignments from tracker-scoped state rows."""
    restored_tracker_ids: list[str] = []
    skipped_observation_tracker_ids: list[str] = []
    restore_candidates: list[tuple[str, dict | None]] = []
    prefix = f"{TRACKING_STATE_NAME_PREFIX}:%"

    async with AsyncSessionLocal() as dbsession:
        stmt = select(TrackingState).where(TrackingState.name.like(prefix))
        result = await dbsession.execute(stmt)
        rows = result.scalars().all()

        candidate_rows = []
        for row in rows:
            tracker_id = _extract_tracker_id_from_state_name(getattr(row, "name", ""))
            if not tracker_id:
                continue

            if _is_observation_tracker_id(tracker_id):
                # Observation tracker slots are pass-scoped. If one is still persisted
                # during process startup, the observation executor no longer owns the
                # runtime context needed to stop it, so restoring it would create a
                # stale extra tracker process.
                await dbsession.delete(row)
                skipped_observation_tracker_ids.append(tracker_id)
                continue

            value = getattr(row, "value", {}) or {}
            restore_candidates.append((tracker_id, value if isinstance(value, dict) else None))
            candidate_rows.append(row)

        # Inspect the complete saved fleet before starting any producer. A
        # conflicting old assignment must not choose a winner by database order.
        sdr_ids = {str(identifier) for identifier in (await dbsession.scalars(select(SDRs.id)))}
        changed = False
        for kind in ("rotator", "rig"):
            claims = Counter(
                str(value[f"{kind}_id"])
                for _, value in restore_candidates
                if value
                and value.get(f"{kind}_id") not in (None, "", "none")
                and not (kind == "rig" and str(value[f"{kind}_id"]) in sdr_ids)
            )
            conflicts = {identifier for identifier, count in claims.items() if count > 1}
            for index, (tracker_id, value) in enumerate(restore_candidates):
                if value is None or str(value.get(f"{kind}_id")) not in conflicts:
                    continue
                logger.error(
                    "Clearing conflicting saved %s %s assignment from %s; reassign explicitly",
                    kind,
                    value[f"{kind}_id"],
                    tracker_id,
                )
                value = {**value, f"{kind}_id": "none", f"{kind}_state": "disconnected"}
                candidate_rows[index].value = value
                restore_candidates[index] = (tracker_id, value)
                changed = True

        if skipped_observation_tracker_ids or changed:
            await dbsession.commit()

    for tracker_id, value in restore_candidates:
        manager = get_tracker_manager(tracker_id)
        if value is not None:
            assign_rotator_to_tracker(tracker_id, value.get("rotator_id"))

        await manager.sync_tracking_state_from_db()
        restored_tracker_ids.append(tracker_id)

    if restored_tracker_ids:
        logger.info(
            "Restored %d tracker instance(s) from DB: %s",
            len(restored_tracker_ids),
            ", ".join(sorted(restored_tracker_ids)),
        )
    else:
        logger.info("No persisted tracker instances found to restore")

    if skipped_observation_tracker_ids:
        logger.info(
            "Removed %d stale observation tracker state row(s): %s",
            len(skipped_observation_tracker_ids),
            ", ".join(sorted(skipped_observation_tracker_ids)),
        )

    return restored_tracker_ids


async def emit_tracker_instances(sio) -> None:
    """Emit tracker instance/ownership snapshot to all connected clients."""
    await sio.emit(SocketEvents.TRACKER_INSTANCES, get_tracker_instances_payload())
