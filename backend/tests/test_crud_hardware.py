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

"""
Unit tests for hardware CRUD operations (rotators, rigs, cameras, SDRs).
"""

import uuid

import pytest

from crud.hardware import (
    add_camera,
    add_rig,
    add_rotator,
    add_sdr,
    delete_cameras,
    delete_rig,
    delete_rotators,
    delete_sdrs,
    edit_camera,
    edit_rig,
    edit_rotator,
    edit_sdr,
    fetch_cameras,
    fetch_rigs,
    fetch_rotators,
    fetch_sdr,
    fetch_sdrs,
)


@pytest.mark.asyncio
class TestRotatorsCRUD:
    """Test suite for rotator CRUD operations."""

    async def test_add_rotator_success(self, db_session):
        """Test successful rotator creation."""
        rotator_data = {
            "name": "Test Rotator",
            "host": "localhost",
            "port": 4533,
            "minaz": 0,
            "maxaz": 360,
            "minel": 0,
            "maxel": 90,
        }

        result = await add_rotator(db_session, rotator_data)

        assert result["success"] is True
        assert result["error"] is None
        assert result["data"]["name"] == "Test Rotator"
        assert result["data"]["host"] == "localhost"
        assert result["data"]["port"] == 4533
        assert result["data"]["azimuth_mode"] == "0_360"
        assert result["data"]["parkaz"] is None
        assert result["data"]["parkel"] is None
        assert "id" in result["data"]

    async def test_add_rotator_with_negative_azimuth_mode(self, db_session):
        """Test successful rotator creation with -180_180 azimuth mode."""
        rotator_data = {
            "name": "Mode Rotator",
            "host": "localhost",
            "port": 4533,
            "minaz": -180,
            "maxaz": 180,
            "minel": 0,
            "maxel": 90,
            "azimuth_mode": "-180_180",
        }

        result = await add_rotator(db_session, rotator_data)

        assert result["success"] is True
        assert result["data"]["azimuth_mode"] == "-180_180"

    async def test_add_rotator_with_overlap_azimuth_mode(self, db_session):
        """Test successful rotator creation with 0_450 azimuth mode."""
        rotator_data = {
            "name": "Overlap Rotator",
            "host": "localhost",
            "port": 4533,
            "minaz": 0,
            "maxaz": 450,
            "minel": 0,
            "maxel": 180,
            "azimuth_mode": "0_450",
        }

        result = await add_rotator(db_session, rotator_data)

        assert result["success"] is True
        assert result["data"]["azimuth_mode"] == "0_450"

    async def test_fetch_rotators_all(self, db_session):
        """Test fetching all rotators."""
        # Add two rotators
        await add_rotator(
            db_session,
            {
                "name": "Rotator 1",
                "host": "host1",
                "port": 4533,
                "minaz": 0,
                "maxaz": 360,
                "minel": 0,
                "maxel": 90,
            },
        )
        await add_rotator(
            db_session,
            {
                "name": "Rotator 2",
                "host": "host2",
                "port": 4534,
                "minaz": 0,
                "maxaz": 450,
                "minel": 0,
                "maxel": 180,
            },
        )

        result = await fetch_rotators(db_session)

        assert result["success"] is True
        assert len(result["data"]) == 2

    async def test_add_rotator_with_park_position(self, db_session):
        """Test successful rotator creation with explicit park position."""
        rotator_data = {
            "name": "Park Rotator",
            "host": "localhost",
            "port": 4533,
            "minaz": 0,
            "maxaz": 360,
            "minel": 0,
            "maxel": 90,
            "parkaz": 180.5,
            "parkel": 10.25,
        }

        result = await add_rotator(db_session, rotator_data)

        assert result["success"] is True
        assert result["data"]["parkaz"] == 180.5
        assert result["data"]["parkel"] == 10.25

    async def test_fetch_rotator_by_id(self, db_session):
        """Test fetching a single rotator by ID."""
        add_result = await add_rotator(
            db_session,
            {
                "name": "Test Rotator",
                "host": "localhost",
                "port": 4533,
                "minaz": 0,
                "maxaz": 360,
                "minel": 0,
                "maxel": 90,
            },
        )

        rotator_id = add_result["data"]["id"]
        result = await fetch_rotators(db_session, rotator_id=rotator_id)

        assert result["success"] is True
        assert result["data"]["id"] == rotator_id

    async def test_fetch_rotator_with_none_id(self, db_session):
        """Test fetching rotator with 'none' ID sentinel."""
        result = await fetch_rotators(db_session, rotator_id="none")
        assert result["success"] is False
        assert result["data"] is None
        assert result["error"] == "'none' was given as rotator_id"

    async def test_edit_rotator_success(self, db_session):
        """Test successful rotator editing."""
        add_result = await add_rotator(
            db_session,
            {
                "name": "Old Name",
                "host": "localhost",
                "port": 4533,
                "minaz": 0,
                "maxaz": 360,
                "minel": 0,
                "maxel": 90,
            },
        )

        rotator_id = add_result["data"]["id"]
        edit_data = {
            "id": rotator_id,
            "name": "New Name",
            "port": 4534,
            "added": "2024-01-01",  # Should be ignored
            "updated": "2024-01-01",  # Should be ignored
        }

        result = await edit_rotator(db_session, edit_data)

        assert result["success"] is True
        assert result["data"]["name"] == "New Name"
        assert result["data"]["port"] == 4534

    async def test_edit_rotator_can_unset_park_position(self, db_session):
        """Test unsetting park position by passing null values."""
        add_result = await add_rotator(
            db_session,
            {
                "name": "Parked Rotator",
                "host": "localhost",
                "port": 4533,
                "minaz": 0,
                "maxaz": 360,
                "minel": 0,
                "maxel": 90,
                "parkaz": 180,
                "parkel": 15,
            },
        )

        rotator_id = add_result["data"]["id"]
        edit_result = await edit_rotator(
            db_session,
            {
                "id": rotator_id,
                "parkaz": None,
                "parkel": None,
            },
        )

        assert edit_result["success"] is True
        assert edit_result["data"]["parkaz"] is None
        assert edit_result["data"]["parkel"] is None

    async def test_delete_rotators_success(self, db_session):
        """Test successful rotator deletion."""
        add_result = await add_rotator(
            db_session,
            {
                "name": "Test Rotator",
                "host": "localhost",
                "port": 4533,
                "minaz": 0,
                "maxaz": 360,
                "minel": 0,
                "maxel": 90,
            },
        )

        rotator_id = add_result["data"]["id"]
        result = await delete_rotators(db_session, [rotator_id])

        assert result["success"] is True

        # Verify deletion
        fetch_result = await fetch_rotators(db_session, rotator_id=rotator_id)
        assert fetch_result["data"] is None


@pytest.mark.asyncio
class TestRigsCRUD:
    """Test suite for rig CRUD operations."""

    async def test_add_rig_success(self, db_session):
        """Test successful rig creation."""
        rig_data = {
            "name": "Test Rig",
            "host": "localhost",
            "port": 4532,
            "radiotype": "IC-9700",
            "vfotype": "VFOA",
        }

        result = await add_rig(db_session, rig_data)

        assert result["success"] is True
        assert result["data"]["name"] == "Test Rig"
        assert result["data"]["radiotype"] == "IC-9700"

    async def test_add_rig_missing_required_field(self, db_session):
        """Test rig creation fails without required fields."""
        rig_data = {
            "name": "Test Rig",
            "host": "localhost",
            # Missing other required fields
        }

        result = await add_rig(db_session, rig_data)

        assert result["success"] is False
        assert "required" in result["error"].lower()

    async def test_fetch_rigs_all(self, db_session):
        """Test fetching all rigs."""
        await add_rig(
            db_session,
            {
                "name": "Rig 1",
                "host": "host1",
                "port": 4532,
                "radiotype": "IC-9700",
                "vfotype": "VFOA",
            },
        )
        await add_rig(
            db_session,
            {
                "name": "Rig 2",
                "host": "host2",
                "port": 4533,
                "radiotype": "FT-991A",
                "vfotype": "VFOB",
            },
        )

        result = await fetch_rigs(db_session)

        assert result["success"] is True
        assert len(result["data"]) == 2

    async def test_fetch_rig_none_string(self, db_session):
        """Test fetching rig with 'none' string returns error."""
        result = await fetch_rigs(db_session, rig_id="none")

        assert result["success"] is False
        assert "'none' was given" in result["error"]

    async def test_edit_rig_success(self, db_session):
        """Test successful rig editing."""
        add_result = await add_rig(
            db_session,
            {
                "name": "Old Rig",
                "host": "localhost",
                "port": 4532,
                "radiotype": "IC-9700",
                "vfotype": "VFOA",
            },
        )

        rig_id = add_result["data"]["id"]
        edit_data = {
            "id": rig_id,
            "name": "New Rig",
            "radiotype": "FT-991A",
            "added": "2024-01-01",
            "updated": "2024-01-01",
        }

        result = await edit_rig(db_session, edit_data)

        assert result["success"] is True
        assert result["data"]["name"] == "New Rig"
        assert result["data"]["radiotype"] == "FT-991A"

    async def test_delete_rig_success(self, db_session):
        """Test successful rig deletion."""
        add_result = await add_rig(
            db_session,
            {
                "name": "Test Rig",
                "host": "localhost",
                "port": 4532,
                "radiotype": "IC-9700",
                "vfotype": "VFOA",
            },
        )

        rig_id = add_result["data"]["id"]
        result = await delete_rig(db_session, [rig_id])

        assert result["success"] is True


@pytest.mark.asyncio
class TestCamerasCRUD:
    """Test suite for camera CRUD operations."""

    async def test_add_camera_success(self, db_session):
        """Test successful camera creation."""
        camera_data = {
            "name": "Test Camera",
            "url": "http://localhost:1984/stream.html",
            "type": "mjpeg",
        }

        result = await add_camera(db_session, camera_data)

        assert result["success"] is True
        assert result["data"]["name"] == "Test Camera"
        assert result["data"]["type"] == "mjpeg"

    async def test_fetch_cameras_all(self, db_session):
        """Test fetching all cameras."""
        await add_camera(db_session, {"name": "Camera 1", "url": "url1"})
        await add_camera(db_session, {"name": "Camera 2", "url": "url2"})

        result = await fetch_cameras(db_session)

        assert result["success"] is True
        assert len(result["data"]) == 2

    async def test_edit_camera_success(self, db_session):
        """Test successful camera editing."""
        add_result = await add_camera(db_session, {"name": "Old Camera", "url": "old_url"})

        camera_id = add_result["data"]["id"]
        edit_data = {
            "id": camera_id,
            "name": "New Camera",
            "url": "new_url",
            "added": "2024-01-01",
            "updated": "2024-01-01",
        }

        result = await edit_camera(db_session, edit_data)

        assert result["success"] is True
        assert result["data"]["name"] == "New Camera"

    async def test_delete_cameras_success(self, db_session):
        """Test successful camera deletion."""
        add_result = await add_camera(db_session, {"name": "Test Camera", "url": "url"})

        camera_id = add_result["data"]["id"]
        result = await delete_cameras(db_session, [camera_id])

        assert result["success"] is True


@pytest.mark.asyncio
class TestSDRsCRUD:
    """Test suite for SDR CRUD operations."""

    async def test_add_sdr_usb_success(self, db_session):
        """Test successful USB SDR creation."""
        sdr_data = {"name": "RTL-SDR USB", "type": "rtlsdrusbv3", "serial": "12345678"}

        result = await add_sdr(db_session, sdr_data)

        assert result["success"] is True
        assert result["data"]["name"] == "RTL-SDR USB"
        assert result["data"]["serial"] == "12345678"

    async def test_add_sdr_tcp_success(self, db_session):
        """Test successful TCP SDR creation."""
        sdr_data = {
            "name": "RTL-SDR TCP",
            "type": "rtlsdrtcpv3",
            "host": "192.168.1.100",
            "port": 1234,
        }

        result = await add_sdr(db_session, sdr_data)

        assert result["success"] is True
        assert result["data"]["name"] == "RTL-SDR TCP"
        assert result["data"]["host"] == "192.168.1.100"

    async def test_add_sdr_airspy_success(self, db_session):
        """Test successful native Airspy SDR creation."""
        sdr_data = {
            "name": "Airspy R2",
            "type": "airspy",
            "driver": "airspy",
            "serial": "B58069DC394C1413",
            "frequency_min": 24,
            "frequency_max": 1750,
        }

        result = await add_sdr(db_session, sdr_data)

        assert result["success"] is True
        assert str(result["data"]["type"]).lower() == "airspy"
        assert result["data"]["driver"] == "airspy"
        assert result["data"]["serial"] == "B58069DC394C1413"

    async def test_add_sdr_airspyhf_success(self, db_session):
        """Test successful native Airspy HF+ SDR creation."""
        sdr_data = {
            "name": "Airspy HF+ Discovery",
            "type": "airspyhf",
            "driver": "airspyhf",
            "serial": "A000000000000001",
            "frequency_min": 0,
            "frequency_max": 260,
        }

        result = await add_sdr(db_session, sdr_data)

        assert result["success"] is True
        assert str(result["data"]["type"]).lower() == "airspyhf"
        assert result["data"]["driver"] == "airspyhf"
        assert result["data"]["serial"] == "A000000000000001"

    async def test_add_sdr_missing_name(self, db_session):
        """Test SDR creation fails without name."""
        sdr_data = {"type": "rtlsdrusbv3", "serial": "12345678"}

        result = await add_sdr(db_session, sdr_data)

        assert result["success"] is False
        assert "name" in result["error"].lower()

    async def test_add_sdr_usb_missing_serial(self, db_session):
        """Test USB SDR creation fails without serial."""
        sdr_data = {"name": "RTL-SDR USB", "type": "rtlsdrusbv3"}

        result = await add_sdr(db_session, sdr_data)

        assert result["success"] is False
        assert "serial" in result["error"].lower()

    async def test_add_sdr_tcp_missing_host(self, db_session):
        """Test TCP SDR creation fails without host."""
        sdr_data = {"name": "RTL-SDR TCP", "type": "rtlsdrtcpv3", "port": 1234}

        result = await add_sdr(db_session, sdr_data)

        assert result["success"] is False
        assert "host" in result["error"].lower()

    async def test_fetch_sdrs_all(self, db_session):
        """Test fetching all SDRs."""
        await add_sdr(db_session, {"name": "SDR 1", "type": "rtlsdrusbv3", "serial": "111"})
        await add_sdr(db_session, {"name": "SDR 2", "type": "rtlsdrusbv4", "serial": "222"})

        result = await fetch_sdrs(db_session)

        assert result["success"] is True
        assert len(result["data"]) == 2

    async def test_fetch_sdr_by_id(self, db_session):
        """Test fetching a single SDR by ID."""
        add_result = await add_sdr(
            db_session, {"name": "Test SDR", "type": "rtlsdrusbv3", "serial": "12345"}
        )

        sdr_id = add_result["data"]["id"]
        result = await fetch_sdr(db_session, sdr_id=sdr_id)

        assert result["success"] is True
        assert result["data"]["id"] == sdr_id

    async def test_fetch_sdr_none_string(self, db_session):
        """Test fetching SDR with 'none' string returns error."""
        result = await fetch_sdr(db_session, sdr_id="none")

        assert result["success"] is False
        assert "'none' was given" in result["error"]

    async def test_edit_sdr_success(self, db_session):
        """Test successful SDR editing."""
        add_result = await add_sdr(
            db_session, {"name": "Old SDR", "type": "rtlsdrusbv3", "serial": "12345"}
        )

        sdr_id = add_result["data"]["id"]
        edit_data = {"id": sdr_id, "name": "New SDR", "serial": "67890"}

        result = await edit_sdr(db_session, edit_data)

        assert result["success"] is True
        assert result["data"]["name"] == "New SDR"
        assert result["data"]["serial"] == "67890"

    async def test_delete_sdrs_success(self, db_session):
        """Test successful SDR deletion."""
        add_result = await add_sdr(
            db_session, {"name": "Test SDR", "type": "rtlsdrusbv3", "serial": "12345"}
        )

        sdr_id = add_result["data"]["id"]
        result = await delete_sdrs(db_session, [sdr_id])

        assert result["success"] is True

        # Verify deletion
        fetch_result = await fetch_sdr(db_session, sdr_id=sdr_id)
        assert fetch_result["data"] is None

    async def test_delete_sdrs_not_found(self, db_session):
        """Test deleting non-existent SDR."""
        fake_id = uuid.uuid4()

        result = await delete_sdrs(db_session, [fake_id])

        assert result["success"] is False
        assert "No SDRs" in result["error"]
