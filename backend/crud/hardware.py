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

import traceback
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Union

from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from common.common import logger, serialize_object
from db.models import Cameras, Rigs, Rotators, SDRs

VALID_AZIMUTH_MODES = {"0_360", "-180_180", "0_450"}
SUPPORTED_CAMERA_TYPES = {"hls", "mjpeg"}
MAX_ANTENNA_LABEL_LENGTH = 64


def _normalize_optional_float(value):
    if value is None:
        return None
    if isinstance(value, str) and value.strip() == "":
        return None
    return float(value)


def _normalize_camera_type(value: object) -> str:
    """Normalize and validate supported camera stream types."""
    normalized = str(value or "").strip().lower()
    if normalized not in SUPPORTED_CAMERA_TYPES:
        supported = ", ".join(sorted(SUPPORTED_CAMERA_TYPES))
        raise ValueError(f"camera type must be one of: {supported}")
    return normalized


def _normalize_antenna_labels(value: object) -> dict:
    """
    Normalize persisted user antenna labels.

    Stored shape (empty labels are allowed and preserved):
      {
        "rx": {"<internal_port_name>": "<user_label>"},
        "tx": {"<internal_port_name>": "<user_label>"}
      }
    """
    if not isinstance(value, dict):
        return {}

    normalized: dict = {}
    for direction in ("rx", "tx"):
        direction_labels = value.get(direction)
        if not isinstance(direction_labels, dict):
            continue

        cleaned_labels = {}
        for internal_name, user_label in direction_labels.items():
            port_name = str(internal_name).strip()
            if not port_name:
                continue

            # Keep empty labels so the persisted payload can represent all known ports.
            label = "" if user_label is None else str(user_label)
            cleaned_labels[port_name] = label[:MAX_ANTENNA_LABEL_LENGTH]

        if cleaned_labels:
            normalized[direction] = cleaned_labels

    return normalized


async def fetch_rotators(
    session: AsyncSession, rotator_id: Optional[Union[uuid.UUID, str]] = None
) -> dict:
    """
    Fetch a single rotator by its UUID or all rotators if UUID is not provided.
    """
    try:
        if rotator_id == "none":
            return {"success": False, "data": None, "error": "'none' was given as rotator_id"}

        if rotator_id is not None:
            if isinstance(rotator_id, str):
                rotator_id = uuid.UUID(rotator_id)

            stmt = select(Rotators).filter(Rotators.id == rotator_id)
            result = await session.execute(stmt)
            rotators = result.scalar_one_or_none()
        else:
            stmt = select(Rotators)
            result = await session.execute(stmt)
            rotators = result.scalars().all()

        rotators = serialize_object(rotators)
        return {"success": True, "data": rotators, "error": None}

    except Exception as e:
        logger.error(f"Error fetching rotators: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def add_rotator(session: AsyncSession, data: dict) -> dict:
    """
    Create and add a new rotator record.
    """
    try:
        azimuth_mode = data.get("azimuth_mode", "0_360")
        assert (
            azimuth_mode in VALID_AZIMUTH_MODES
        ), "azimuth_mode must be one of: 0_360, -180_180, 0_450"
        parkaz = _normalize_optional_float(data.get("parkaz"))
        parkel = _normalize_optional_float(data.get("parkel"))
        assert (parkaz is None) == (
            parkel is None
        ), "parkaz and parkel must either both be set or both be null"

        new_id = uuid.uuid4()
        now = datetime.now(timezone.utc)
        stmt = (
            insert(Rotators)
            .values(
                id=new_id,
                name=data["name"],
                host=data["host"],
                port=data["port"],
                minaz=data["minaz"],
                maxaz=data["maxaz"],
                azimuth_mode=azimuth_mode,
                minel=data["minel"],
                maxel=data["maxel"],
                parkaz=parkaz,
                parkel=parkel,
                aztolerance=data.get("aztolerance", 2.0),
                eltolerance=data.get("eltolerance", 2.0),
                added=now,
                updated=now,
            )
            .returning(Rotators)
        )
        result = await session.execute(stmt)
        await session.commit()
        new_rotator = result.scalar_one()
        new_rotator = serialize_object(new_rotator)
        return {"success": True, "data": new_rotator, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error adding rotator: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def edit_rotator(session: AsyncSession, data: dict) -> dict:
    """
    Edit an existing rotator record by updating provided fields.
    """
    try:
        # Extract rotator_id from data
        rotator_id_raw = data.pop("id", None)
        if not rotator_id_raw:
            raise Exception("id is required.")
        rotator_id = uuid.UUID(rotator_id_raw)

        if "azimuth_mode" in data:
            azimuth_mode = data["azimuth_mode"]
            assert (
                azimuth_mode in VALID_AZIMUTH_MODES
            ), "azimuth_mode must be one of: 0_360, -180_180, 0_450"

        if "parkaz" in data:
            data["parkaz"] = _normalize_optional_float(data.get("parkaz"))
        if "parkel" in data:
            data["parkel"] = _normalize_optional_float(data.get("parkel"))

        data.pop("updated", None)
        data.pop("added", None)

        # Confirm the rotator exists
        stmt = select(Rotators).filter(Rotators.id == rotator_id)
        result = await session.execute(stmt)
        rotator = result.scalar_one_or_none()
        if not rotator:
            return {"success": False, "error": f"Rotator with id {rotator_id} not found."}

        effective_parkaz = data["parkaz"] if "parkaz" in data else rotator.parkaz
        effective_parkel = data["parkel"] if "parkel" in data else rotator.parkel
        assert (effective_parkaz is None) == (
            effective_parkel is None
        ), "parkaz and parkel must either both be set or both be null"

        # Add updated timestamp
        data["updated"] = datetime.now(timezone.utc)

        upd_stmt = (
            update(Rotators).where(Rotators.id == rotator_id).values(**data).returning(Rotators)
        )
        upd_result = await session.execute(upd_stmt)
        await session.commit()
        updated_rotator = upd_result.scalar_one_or_none()
        updated_rotator = serialize_object(updated_rotator)
        return {"success": True, "data": updated_rotator, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error editing rotator: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def delete_rotators(
    session: AsyncSession, rotator_ids: Union[List[Union[str, uuid.UUID]], dict]
) -> dict:
    """
    Delete multiple rotator records by their UUIDs or string representations of UUIDs.
    """
    try:
        rotator_ids = [
            uuid.UUID(rotator_id) if isinstance(rotator_id, str) else rotator_id
            for rotator_id in rotator_ids
        ]

        stmt = delete(Rotators).where(Rotators.id.in_(rotator_ids)).returning(Rotators)
        result = await session.execute(stmt)
        deleted = result.scalars().all()
        if not deleted:
            return {"success": False, "error": "No rotators with the provided IDs were found."}
        await session.commit()
        return {"success": True, "data": None, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error deleting rotators: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_rigs(
    session: AsyncSession, rig_id: Optional[Union[uuid.UUID, str, None]] = None
) -> dict:
    """
    Fetch a single rig by its UUID or all rigs if UUID is not provided.
    """
    try:
        if rig_id == "none":
            return {"success": False, "data": None, "error": "'none' was given as rig_id"}

        if rig_id is None:
            stmt = select(Rigs)
        else:
            if isinstance(rig_id, str):
                rig_id = uuid.UUID(rig_id)
            stmt = select(Rigs).filter(Rigs.id == rig_id)
        result = await session.execute(stmt)
        rigs = result.scalars().all() if rig_id is None else result.scalar_one_or_none()
        rigs = serialize_object(rigs)
        return {"success": True, "data": rigs, "error": None}

    except Exception as e:
        logger.error(f"Error fetching rigs: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def add_rig(session: AsyncSession, data: dict) -> dict:
    """
    Create and add a new rig record.
    """
    try:
        assert data.get("name", "") != "", "name is required"
        assert data.get("host", "") != "", "host is required"
        assert data.get("port", "") != "", "port is required"
        assert data.get("radiotype", "") != "", "radiotype is required"
        vfotype = data.get("vfotype", 0)
        radio_mode = data.get("radio_mode", "duplex")
        assert radio_mode in {
            "monitor",
            "uplink_only",
            "simplex",
            "duplex",
            "ptt_guarded",
        }, "radio_mode must be monitor, uplink_only, simplex, duplex, or ptt_guarded"
        tx_control_mode = data.get("tx_control_mode", "auto")
        assert tx_control_mode in {
            "auto",
            "vfo_switch",
            "split_tx_cmd",
            "vfo_explicit",
        }, "tx_control_mode must be auto, vfo_switch, split_tx_cmd, or vfo_explicit"
        retune_interval_ms = int(data.get("retune_interval_ms", 2000))
        assert (
            100 <= retune_interval_ms <= 60000
        ), "retune_interval_ms must be between 100 and 60000"
        follow_downlink_tuning = bool(data.get("follow_downlink_tuning", False))

        new_id = uuid.uuid4()
        now = datetime.now(timezone.utc)
        stmt = (
            insert(Rigs)
            .values(
                id=new_id,
                name=data["name"],
                host=data["host"],
                port=data["port"],
                radiotype=data["radiotype"],
                radio_mode=radio_mode,
                vfotype=vfotype,
                tx_control_mode=tx_control_mode,
                retune_interval_ms=retune_interval_ms,
                follow_downlink_tuning=follow_downlink_tuning,
                added=now,
                updated=now,
            )
            .returning(Rigs)
        )
        result = await session.execute(stmt)
        await session.commit()
        new_rig = result.scalar_one()
        new_rig = serialize_object(new_rig)
        return {"success": True, "data": new_rig, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error adding rigs: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def edit_rig(session: AsyncSession, data: dict) -> dict:
    """
    Edit an existing rig record by updating provided fields.
    """
    try:
        rig_id = data.get("id", None)
        if isinstance(rig_id, str):
            rig_id = uuid.UUID(rig_id)

        if "tx_control_mode" in data and data["tx_control_mode"] not in {
            "auto",
            "vfo_switch",
            "split_tx_cmd",
            "vfo_explicit",
        }:
            return {"success": False, "error": "Invalid tx_control_mode value."}
        if "retune_interval_ms" in data:
            try:
                retune_interval_ms = int(data["retune_interval_ms"])
            except (TypeError, ValueError):
                return {"success": False, "error": "retune_interval_ms must be an integer."}
            if not 100 <= retune_interval_ms <= 60000:
                return {
                    "success": False,
                    "error": "retune_interval_ms must be between 100 and 60000.",
                }
            data["retune_interval_ms"] = retune_interval_ms
        if "follow_downlink_tuning" in data:
            data["follow_downlink_tuning"] = bool(data["follow_downlink_tuning"])
        if "radio_mode" in data:
            if data["radio_mode"] not in {
                "monitor",
                "uplink_only",
                "simplex",
                "duplex",
                "ptt_guarded",
            }:
                return {"success": False, "error": "Invalid radio_mode value."}

        del data["added"]
        del data["updated"]
        del data["id"]

        # Optionally check if the record exists
        stmt = select(Rigs).filter(Rigs.id == rig_id)
        result = await session.execute(stmt)
        rig = result.scalar_one_or_none()

        if not rig:
            return {"success": False, "error": f"Rig with id {rig_id} not found."}

        # Update the updated timestamp.
        data["updated"] = datetime.now(timezone.utc)

        upd_stmt = update(Rigs).where(Rigs.id == rig_id).values(**data).returning(Rigs)
        upd_result = await session.execute(upd_stmt)
        await session.commit()
        updated_rig = upd_result.scalar_one_or_none()
        updated_rig = serialize_object(updated_rig)
        return {"success": True, "data": updated_rig, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error editing rig: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def delete_rig(
    session: AsyncSession, rig_ids: Union[List[uuid.UUID], List[str], dict]
) -> dict:
    """
    Delete multiple rig records by their UUIDs or string representations of UUIDs.
    """
    try:
        if isinstance(rig_ids, dict):
            rig_ids = rig_ids.get("ids", [])
        rig_ids = [uuid.UUID(rig_id) if isinstance(rig_id, str) else rig_id for rig_id in rig_ids]

        stmt = delete(Rigs).where(Rigs.id.in_(rig_ids)).returning(Rigs)
        result = await session.execute(stmt)
        deleted = result.scalars().all()
        if not deleted:
            return {"success": False, "error": "No rigs with the provided IDs were found."}
        await session.commit()
        return {"success": True, "data": None, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error deleting rigs: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_cameras(
    session: AsyncSession, camera_id: Optional[Union[uuid.UUID, str]] = None
) -> dict:
    """
    Fetch a single camera by its UUID or all cameras if UUID is not provided.
    """
    try:
        if camera_id is not None:
            if isinstance(camera_id, str):
                camera_id = uuid.UUID(camera_id)

            stmt = select(Cameras).filter(Cameras.id == camera_id)
            result = await session.execute(stmt)
            cameras = result.scalar_one_or_none()
        else:
            stmt = select(Cameras)
            result = await session.execute(stmt)
            cameras = result.scalars().all()

        cameras = serialize_object(cameras)
        return {"success": True, "data": cameras, "error": None}

    except Exception as e:
        logger.error(f"Error fetching cameras: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def add_camera(session: AsyncSession, data: dict) -> dict:
    """
    Create and add a new camera record.
    """
    try:
        camera_type = _normalize_camera_type(data.get("type", "mjpeg"))
        new_id = uuid.uuid4()
        now = datetime.now(timezone.utc)
        stmt = (
            insert(Cameras)
            .values(
                id=new_id,
                name=data["name"],
                url=data.get("url", ""),
                type=camera_type,
                added=now,
                updated=now,
            )
            .returning(Cameras)
        )
        result = await session.execute(stmt)
        await session.commit()
        new_camera = result.scalar_one()
        new_camera = serialize_object(new_camera)
        return {"success": True, "data": new_camera, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error adding camera: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def edit_camera(session: AsyncSession, data: dict) -> dict:
    """
    Edit an existing camera record by updating provided fields.
    """
    try:
        data = dict(data or {})
        # Extract camera_id from data
        camera_id = data.pop("id", None)
        camera_id = uuid.UUID(camera_id)

        if not camera_id:
            raise Exception("id is required.")

        del data["updated"]
        del data["added"]

        # Confirm the camera exists
        stmt = select(Cameras).filter(Cameras.id == camera_id)
        result = await session.execute(stmt)
        camera = result.scalar_one_or_none()
        if not camera:
            return {"success": False, "error": f"Camera with id {camera_id} not found."}

        if "type" in data:
            data["type"] = _normalize_camera_type(data["type"])

        # Add updated timestamp
        data["updated"] = datetime.now(timezone.utc)

        upd_stmt = update(Cameras).where(Cameras.id == camera_id).values(**data).returning(Cameras)
        upd_result = await session.execute(upd_stmt)
        await session.commit()
        updated_camera = upd_result.scalar_one_or_none()
        updated_camera = serialize_object(updated_camera)
        return {"success": True, "data": updated_camera, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error editing camera: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def delete_cameras(
    session: AsyncSession, camera_ids: Union[List[Union[str, uuid.UUID]], dict]
) -> dict:
    """
    Delete multiple camera records by their UUIDs or string representations of UUIDs.
    """
    try:
        camera_ids = [
            uuid.UUID(camera_id) if isinstance(camera_id, str) else camera_id
            for camera_id in camera_ids
        ]

        stmt = delete(Cameras).where(Cameras.id.in_(camera_ids)).returning(Cameras)
        result = await session.execute(stmt)
        deleted = result.scalars().all()
        if not deleted:
            return {"success": False, "error": "No cameras with the provided IDs were found."}
        await session.commit()
        return {"success": True, "data": None, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error deleting cameras: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_sdrs(session: AsyncSession) -> dict:
    """
    Fetches a list of SDRs from the database asynchronously and serializes their data.

    This function executes a database query to retrieve all SDRs in a sorted order.
    The SDR data is then serialized into a list of Python objects. If an error occurs
    during the process, it logs the issue and returns an error response.

    :param session: Async database session used to execute the query.
    :type session: AsyncSession
    :return: A dictionary containing the success status, serialized SDRs data if
        successful, and any error messages if applicable.
    :rtype: dict
    """

    try:
        stmt = select(SDRs).order_by(SDRs.name)
        result = await session.execute(stmt)
        sdrs = result.scalars().all()
        sdrs_list = [serialize_object(sdr) for sdr in sdrs]
        return {"success": True, "data": sdrs_list, "error": None}

    except Exception as e:
        logger.error(f"Error fetching SDRs: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_sdr(session: AsyncSession, sdr_id: Optional[Union[uuid.UUID, str]] = None) -> dict:
    """
    Fetches an SDR record from the database by its unique identifier
    and serializes it into a dictionary format. If the `sdr_id` is provided
    as a string, it is automatically converted into a UUID type. If no sdr_id
    is provided, returns all SDRs. The method handles potential exceptions by
    logging detailed error messages and returning an error response.

    :param session: The asynchronous database session used for executing queries.
    :type session: AsyncSession
    :param sdr_id: The unique identifier of the SDR record, either as a UUID
        or a string. If None, returns all SDRs.
    :type sdr_id: Optional[Union[uuid.UUID, str]]
    :return: A dictionary containing the result of the operation. Includes a
        boolean `success` key, a `data` key with the serialized SDR record(s)
        if successful, and an `error` key with an error message if any
        exception occurred.
    :rtype: dict
    """
    try:
        if sdr_id == "none":
            return {"success": False, "data": None, "error": "'none' was given as sdr_id"}

        if sdr_id is None:
            stmt = select(SDRs)
            result = await session.execute(stmt)
            sdr = result.scalars().all()
        else:
            # Convert string sdr_id to UUID if necessary
            if isinstance(sdr_id, str):
                sdr_id = uuid.UUID(sdr_id)

            stmt = select(SDRs).filter(SDRs.id == sdr_id)
            result = await session.execute(stmt)
            sdr = result.scalar_one_or_none()

        sdr = serialize_object(sdr)
        return {"success": True, "data": sdr, "error": None}

    except Exception as e:
        logger.error(f"Error fetching SDR by id {sdr_id}: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def add_sdr(session: AsyncSession, data: dict) -> dict:
    """
    Adds a Software-Defined Radio (SDR) to the database.

    This function creates and adds a new SDR record to the database session. It validates the
    mandatory fields defined in the ``required_fields`` list and ensures that all necessary
    attributes are provided before creating the SDR object. In case of any error during the
    process, the session is rolled back, and the error is logged and returned.

    :param session: Database session to manage the transaction asynchronously.
    :type session: AsyncSession
    :param data: Dictionary containing the SDR data to be stored. The dictionary
        must include required fields based on type - name and serial for USB type,
        name, host, and port for TCP type.
    :type data: dict
    :return: A dictionary with the operation's success status, either the serialized SDR
        data upon success or an error message upon failure.
    :rtype: dict
    """
    try:
        data = dict(data)

        # Name is always required
        if "name" not in data or data["name"] is None:
            raise AssertionError("Field 'name' is required")

        # Check type-specific required fields
        sdr_type = data.get("type")
        if sdr_type:
            if sdr_type.lower() in ["rtlsdrusbv3", "rtlsdrusbv4"]:
                if "serial" not in data or data["serial"] is None:
                    raise AssertionError("Field 'serial' is required for USB type SDRs")

            elif sdr_type.lower() in ["rtlsdrtcpv3", "rtlsdrtcpv4"]:
                if "host" not in data or data["host"] is None:
                    raise AssertionError("Field 'host' is required for TCP type SDRs")
                if "port" not in data or data["port"] is None:
                    raise AssertionError("Field 'port' is required for TCP type SDRs")

        data["antenna_labels"] = _normalize_antenna_labels(data.get("antenna_labels"))

        new_sdr = SDRs(**{key: value for key, value in data.items() if hasattr(SDRs, key)})

        session.add(new_sdr)
        await session.commit()

        # Return the newly created SDR
        return {"success": True, "data": serialize_object(new_sdr), "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error adding SDR: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def edit_sdr(session: AsyncSession, data: dict) -> dict:
    """
    Edits an existing SDR (System Data Record) in the database. The function retrieves
    the SDR identified by the provided `sdr_id`, updates its fields dynamically according
    to the key-value pairs provided in `sdr_data`, and commits the changes to the database.

    :param session: Async database session to be used for querying and updating the SDR.
    :type session: AsyncSession
    :param data: Dictionary containing the fields and their new values to update in
        the SDR, including the sdr_id. Only fields present in the dictionary and explicitly
        part of the SDR object will be updated.
    :type data: dict
    :return: A dictionary containing the success status, the updated SDR data if successful,
        and an error message if applicable. Keys:
        - "success" (bool): Indicates if the operation was successful.
        - "data" (dict or None): Serialized updated SDR data if the operation was successful.
        - "error" (str or None): Error description if the operation failed.
    :rtype: dict
    """
    try:
        data = dict(data)

        # Get sdr_id from data and convert to UUID if necessary
        sdr_id = data.pop("id")
        if isinstance(sdr_id, str):
            sdr_id = uuid.UUID(sdr_id)

        data.pop("updated", None)
        data.pop("added", None)
        if "antenna_labels" in data:
            data["antenna_labels"] = _normalize_antenna_labels(data.get("antenna_labels"))

        # Get the existing SDR
        stmt = select(SDRs).filter(SDRs.id == sdr_id)
        result = await session.execute(stmt)
        sdr = result.scalar_one_or_none()

        if not sdr:
            return {"success": False, "error": f"SDR with id {sdr_id} not found"}

        # Update fields dynamically from the input data
        for key, value in data.items():
            if hasattr(sdr, key) and value is not None:
                setattr(sdr, key, value)

        sdr.updated = datetime.now(timezone.utc)

        await session.commit()

        # Return the updated SDR
        return {"success": True, "data": serialize_object(sdr), "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error editing SDR {data}: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def delete_sdrs(session: AsyncSession, sdr_ids: List[Union[str, uuid.UUID]]) -> dict:
    """
    Deletes SDRs (Signal Detection Records) from the database based on the provided IDs.

    This function will attempt to convert any string-based IDs into UUIDs, verify the existence
    of the specified SDRs, and then delete them. If any error occurs during the process,
    the operation will roll back the transaction and log the error.

    :param session: An instance of AsyncSession for database transactions.
    :type session: AsyncSession
    :param sdr_ids: A list of SDR IDs, which can be a mix of strings or UUIDs,
        representing the records to be deleted.
    :type sdr_ids: list[Union[str, uuid.UUID]]
    :return: A dictionary containing the success status, any error messages,
        and additional data (if applicable).
    :rtype: dict
    """
    try:
        # Convert string IDs to UUIDs
        sdr_ids = [uuid.UUID(sdr_id) if isinstance(sdr_id, str) else sdr_id for sdr_id in sdr_ids]

        # Check if the SDRs exist
        stmt = select(SDRs).filter(SDRs.id.in_(sdr_ids))
        result = await session.execute(stmt)
        sdrs = result.scalars().all()

        if not sdrs:
            return {"success": False, "error": "No SDRs with the provided IDs were found"}

        # Delete the SDRs
        stmt = delete(SDRs).where(SDRs.id.in_(sdr_ids))
        await session.execute(stmt)
        await session.commit()

        return {"success": True, "data": None, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error deleting SDRs {sdr_ids}: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}
