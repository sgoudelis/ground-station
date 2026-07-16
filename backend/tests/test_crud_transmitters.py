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
Unit tests for transmitter CRUD operations.
"""

import uuid

import pytest
from sqlalchemy import update

from crud.satellites import add_satellite
from crud.transmitters import (
    add_transmitter,
    delete_transmitter,
    edit_transmitter,
    fetch_transmitter,
    fetch_transmitters_for_satellite,
)
from db.models import Transmitters

# TLE templates for testing
TLE1_TEMPLATE = "1 {norad:05d}U 00000A   21001.00000000  .00000000  00000-0  00000-0 0  9990"
TLE2_TEMPLATE = "2 {norad:05d}  51.0000 000.0000 0000000   0.0000   0.0000 15.00000000000000"
SHORT_ID_ALPHABET = set("23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")


@pytest.mark.asyncio
class TestTransmittersCRUD:
    """Test suite for transmitter CRUD operations."""

    async def test_add_transmitter_success(self, db_session):
        """Test successful transmitter creation."""
        # Add satellite first (foreign key requirement)
        await add_satellite(
            db_session,
            {
                "name": "Test Satellite",
                "sat_id": "TEST-001",
                "norad_id": 25544,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=25544),
                "tle2": TLE2_TEMPLATE.format(norad=25544),
            },
        )

        transmitter_data = {
            "description": "VHF Downlink",
            "satelliteId": 25544,
            "alive": True,
            "type": "transmitter",
            "uplinkLow": 145800000,
            "uplinkHigh": 145990000,
            "downlinkLow": 437800000,
            "downlinkHigh": 437990000,
            "uplinkDrift": 0,
            "downlinkDrift": 0,
            "mode": "FM",
            "uplinkMode": "FM",
            "invert": False,
            "baud": 9600,
            "status": "active",
        }

        result = await add_transmitter(db_session, transmitter_data)

        assert result["success"] is True
        assert result["error"] is None
        assert result["data"]["description"] == "VHF Downlink"
        assert result["data"]["norad_cat_id"] == 25544
        assert result["data"]["uplink_low"] == 145800000
        assert result["data"]["downlink_low"] == 437800000
        assert "id" in result["data"]
        assert len(result["data"]["id"]) == 22
        assert set(result["data"]["id"]).issubset(SHORT_ID_ALPHABET)
        assert "added" in result["data"]

    async def test_add_transmitter_with_dash_values(self, db_session):
        """Test transmitter creation with '-' values converts to None."""
        # Add satellite first
        await add_satellite(
            db_session,
            {
                "name": "Test Satellite",
                "sat_id": "TEST-001",
                "norad_id": 25544,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=25544),
                "tle2": TLE2_TEMPLATE.format(norad=25544),
            },
        )

        transmitter_data = {
            "description": "Beacon Only",
            "satelliteId": 25544,
            "alive": True,
            "type": "transmitter",
            "uplinkLow": "-",  # Should convert to None
            "uplinkHigh": "-",
            "downlinkLow": 437800000,
            "downlinkHigh": 437990000,
            "uplinkDrift": "-",
            "downlinkDrift": "-",
            "mode": "CW",
            "uplinkMode": "-",
            "status": "active",
        }

        result = await add_transmitter(db_session, transmitter_data)

        assert result["success"] is True
        assert result["data"]["uplink_low"] is None
        assert result["data"]["uplink_high"] is None
        assert result["data"]["uplink_drift"] is None
        assert result["data"]["downlink_drift"] is None

    async def test_fetch_transmitter_by_id(self, db_session):
        """Test fetching a single transmitter by ID."""
        # Add satellite
        await add_satellite(
            db_session,
            {
                "name": "Test Satellite",
                "sat_id": "TEST-001",
                "norad_id": 25544,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=25544),
                "tle2": TLE2_TEMPLATE.format(norad=25544),
            },
        )

        # Add transmitter
        add_result = await add_transmitter(
            db_session,
            {
                "description": "Test Transmitter",
                "satelliteId": 25544,
                "alive": True,
                "type": "transmitter",
                "uplinkLow": "-",
                "uplinkHigh": "-",
                "downlinkLow": 437800000,
                "downlinkHigh": 437990000,
                "uplinkDrift": "-",
                "downlinkDrift": "-",
                "mode": "FM",
                "uplinkMode": "-",
                "status": "active",
            },
        )

        transmitter_id = add_result["data"]["id"]

        # Fetch by ID
        result = await fetch_transmitter(db_session, transmitter_id)

        assert result["success"] is True
        assert result["data"]["id"] == transmitter_id
        assert result["data"]["description"] == "Test Transmitter"

    async def test_fetch_transmitter_with_uuid(self, db_session):
        """Test fetching transmitter with UUID object."""
        # Add satellite
        await add_satellite(
            db_session,
            {
                "name": "Test Satellite",
                "sat_id": "TEST-001",
                "norad_id": 25544,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=25544),
                "tle2": TLE2_TEMPLATE.format(norad=25544),
            },
        )

        # Add transmitter
        add_result = await add_transmitter(
            db_session,
            {
                "description": "Test Transmitter",
                "satelliteId": 25544,
                "alive": True,
                "type": "transmitter",
                "uplinkLow": "-",
                "uplinkHigh": "-",
                "downlinkLow": 437800000,
                "downlinkHigh": 437990000,
                "uplinkDrift": "-",
                "downlinkDrift": "-",
                "mode": "FM",
                "uplinkMode": "-",
                "status": "active",
            },
        )

        transmitter_id_short = add_result["data"]["id"]
        transmitter_id_str = str(uuid.uuid4())
        await db_session.execute(
            update(Transmitters)
            .where(Transmitters.id == transmitter_id_short)
            .values(id=transmitter_id_str)
        )
        await db_session.commit()
        transmitter_id_uuid = uuid.UUID(transmitter_id_str)

        # Fetch by UUID (should convert to string)
        result = await fetch_transmitter(db_session, transmitter_id_uuid)

        assert result["success"] is True
        assert result["data"]["id"] == transmitter_id_str

    async def test_fetch_transmitter_not_found(self, db_session):
        """Test fetching non-existent transmitter."""
        fake_id = str(uuid.uuid4())
        result = await fetch_transmitter(db_session, fake_id)

        assert result["success"] is True
        assert result["data"] is None

    async def test_fetch_transmitters_for_satellite(self, db_session):
        """Test fetching all transmitters for a satellite."""
        # Add satellite
        await add_satellite(
            db_session,
            {
                "name": "Test Satellite",
                "sat_id": "TEST-001",
                "norad_id": 25544,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=25544),
                "tle2": TLE2_TEMPLATE.format(norad=25544),
            },
        )

        # Add multiple transmitters
        transmitter_base = {
            "satelliteId": 25544,
            "alive": True,
            "type": "transmitter",
            "uplinkLow": "-",
            "uplinkHigh": "-",
            "downlinkLow": 437800000,
            "downlinkHigh": 437990000,
            "uplinkDrift": "-",
            "downlinkDrift": "-",
            "mode": "FM",
            "uplinkMode": "-",
            "status": "active",
        }

        await add_transmitter(db_session, {**transmitter_base, "description": "VHF"})
        await add_transmitter(db_session, {**transmitter_base, "description": "UHF"})
        await add_transmitter(db_session, {**transmitter_base, "description": "S-Band"})

        # Fetch all transmitters for satellite
        result = await fetch_transmitters_for_satellite(db_session, 25544)

        assert result["success"] is True
        assert len(result["data"]) == 3
        descriptions = [t["description"] for t in result["data"]]
        assert "VHF" in descriptions
        assert "UHF" in descriptions
        assert "S-Band" in descriptions

    async def test_fetch_transmitters_for_satellite_no_results(self, db_session):
        """Test fetching transmitters for satellite with none."""
        result = await fetch_transmitters_for_satellite(db_session, 99999)

        assert result["success"] is True
        assert result["data"] == []

    async def test_edit_transmitter_success(self, db_session):
        """Test successful transmitter editing."""
        # Add satellite
        await add_satellite(
            db_session,
            {
                "name": "Test Satellite",
                "sat_id": "TEST-001",
                "norad_id": 25544,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=25544),
                "tle2": TLE2_TEMPLATE.format(norad=25544),
            },
        )

        # Add transmitter
        add_result = await add_transmitter(
            db_session,
            {
                "description": "Old Description",
                "satelliteId": 25544,
                "alive": True,
                "type": "transmitter",
                "uplinkLow": 145800000,
                "uplinkHigh": 145990000,
                "downlinkLow": 437800000,
                "downlinkHigh": 437990000,
                "uplinkDrift": 0,
                "downlinkDrift": 0,
                "mode": "FM",
                "uplinkMode": "FM",
                "status": "active",
            },
        )

        transmitter_id = add_result["data"]["id"]

        # Edit transmitter
        edit_data = {
            "id": transmitter_id,
            "description": "New Description",
            "satelliteId": 25544,
            "uplinkLow": 145900000,  # Changed
            "uplinkHigh": 145990000,
            "downlinkLow": 437900000,  # Changed
            "downlinkHigh": 437990000,
            "uplinkDrift": 0,
            "downlinkDrift": 0,
            "uplinkMode": "FM",
        }

        result = await edit_transmitter(db_session, edit_data)

        assert result["success"] is True
        assert result["data"]["description"] == "New Description"
        assert result["data"]["uplink_low"] == 145900000
        assert result["data"]["downlink_low"] == 437900000

    async def test_edit_transmitter_not_found(self, db_session):
        """Test editing non-existent transmitter."""
        edit_data = {
            "id": str(uuid.uuid4()),
            "description": "New Description",
            "satelliteId": 25544,
            "uplinkLow": "-",
            "uplinkHigh": "-",
            "downlinkLow": 437800000,
            "downlinkHigh": 437990000,
            "uplinkDrift": "-",
            "downlinkDrift": "-",
            "uplinkMode": "-",
        }

        result = await edit_transmitter(db_session, edit_data)

        assert result["success"] is False
        assert "not found" in result["error"]

    async def test_edit_transmitter_removes_timestamps(self, db_session):
        """Test that edit removes added/updated from data."""
        # Add satellite
        await add_satellite(
            db_session,
            {
                "name": "Test Satellite",
                "sat_id": "TEST-001",
                "norad_id": 25544,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=25544),
                "tle2": TLE2_TEMPLATE.format(norad=25544),
            },
        )

        # Add transmitter
        add_result = await add_transmitter(
            db_session,
            {
                "description": "Test",
                "satelliteId": 25544,
                "alive": True,
                "type": "transmitter",
                "uplinkLow": "-",
                "uplinkHigh": "-",
                "downlinkLow": 437800000,
                "downlinkHigh": 437990000,
                "uplinkDrift": "-",
                "downlinkDrift": "-",
                "mode": "FM",
                "uplinkMode": "-",
                "status": "active",
            },
        )

        transmitter_id = add_result["data"]["id"]

        # Try to edit with timestamps (should be ignored)
        edit_data = {
            "id": transmitter_id,
            "description": "Updated",
            "satelliteId": 25544,
            "uplinkLow": "-",
            "uplinkHigh": "-",
            "downlinkLow": 437800000,
            "downlinkHigh": 437990000,
            "uplinkDrift": "-",
            "downlinkDrift": "-",
            "uplinkMode": "-",
            "added": "2020-01-01",
            "updated": "2020-01-01",
        }

        result = await edit_transmitter(db_session, edit_data)

        assert result["success"] is True
        assert result["data"]["description"] == "Updated"

    async def test_delete_transmitter_success(self, db_session):
        """Test successful transmitter deletion."""
        # Add satellite
        await add_satellite(
            db_session,
            {
                "name": "Test Satellite",
                "sat_id": "TEST-001",
                "norad_id": 25544,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=25544),
                "tle2": TLE2_TEMPLATE.format(norad=25544),
            },
        )

        # Add transmitter
        add_result = await add_transmitter(
            db_session,
            {
                "description": "To Delete",
                "satelliteId": 25544,
                "alive": True,
                "type": "transmitter",
                "uplinkLow": "-",
                "uplinkHigh": "-",
                "downlinkLow": 437800000,
                "downlinkHigh": 437990000,
                "uplinkDrift": "-",
                "downlinkDrift": "-",
                "mode": "FM",
                "uplinkMode": "-",
                "status": "active",
            },
        )

        transmitter_id = add_result["data"]["id"]

        # Delete transmitter
        result = await delete_transmitter(db_session, transmitter_id)

        assert result["success"] is True

        # Verify deletion
        fetch_result = await fetch_transmitter(db_session, transmitter_id)
        assert fetch_result["data"] is None

    async def test_delete_transmitter_not_found(self, db_session):
        """Test deleting non-existent transmitter."""
        fake_id = str(uuid.uuid4())
        result = await delete_transmitter(db_session, fake_id)

        assert result["success"] is False
        assert "not found" in result["error"]

    async def test_transmitter_field_mapping(self, db_session):
        """Test that camelCase fields are mapped to snake_case."""
        # Add satellite
        await add_satellite(
            db_session,
            {
                "name": "Test Satellite",
                "sat_id": "TEST-001",
                "norad_id": 25544,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=25544),
                "tle2": TLE2_TEMPLATE.format(norad=25544),
            },
        )

        # Add transmitter with camelCase
        transmitter_data = {
            "description": "Field Mapping Test",
            "satelliteId": 25544,  # Maps to norad_cat_id
            "alive": True,
            "type": "transmitter",
            "uplinkLow": 145800000,  # Maps to uplink_low
            "uplinkHigh": 145990000,  # Maps to uplink_high
            "downlinkLow": 437800000,  # Maps to downlink_low
            "downlinkHigh": 437990000,  # Maps to downlink_high
            "uplinkDrift": 100,  # Maps to uplink_drift
            "downlinkDrift": 200,  # Maps to downlink_drift
            "mode": "FM",
            "uplinkMode": "FM",  # Maps to uplink_mode
            "status": "active",
        }

        result = await add_transmitter(db_session, transmitter_data)

        assert result["success"] is True
        # Verify snake_case field names in result
        assert result["data"]["norad_cat_id"] == 25544
        assert result["data"]["uplink_low"] == 145800000
        assert result["data"]["uplink_high"] == 145990000
        assert result["data"]["downlink_low"] == 437800000
        assert result["data"]["downlink_high"] == 437990000
        assert result["data"]["uplink_drift"] == 100
        assert result["data"]["downlink_drift"] == 200
        assert result["data"]["uplink_mode"] == "FM"

    async def test_transmitter_with_all_optional_fields(self, db_session):
        """Test transmitter with all optional fields populated."""
        # Add satellite
        await add_satellite(
            db_session,
            {
                "name": "Test Satellite",
                "sat_id": "TEST-001",
                "norad_id": 25544,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=25544),
                "tle2": TLE2_TEMPLATE.format(norad=25544),
            },
        )

        transmitter_data = {
            "description": "Full Transmitter",
            "satelliteId": 25544,
            "alive": True,
            "type": "transponder",
            "uplinkLow": 145800000,
            "uplinkHigh": 145990000,
            "downlinkLow": 437800000,
            "downlinkHigh": 437990000,
            "uplinkDrift": 100,
            "downlinkDrift": 200,
            "mode": "FM",
            "mode_id": 1,
            "uplinkMode": "FM",
            "invert": True,
            "baud": 9600,
            "sat_id": "SAT-001",
            "norad_follow_id": 25545,
            "status": "active",
            "citation": "Test Citation",
            "service": "Amateur",
            "source": "satnogs",
            "iaru_coordination": "Coordinated",
            "iaru_coordination_url": "http://example.com",
            "frequency_violation": False,
            "unconfirmed": False,
        }

        result = await add_transmitter(db_session, transmitter_data)

        assert result["success"] is True
        assert result["data"]["type"] == "transponder"
        assert result["data"]["mode_id"] == 1
        assert result["data"]["invert"] is True
        assert result["data"]["baud"] == 9600
        assert result["data"]["service"] == "Amateur"
        assert result["data"]["source"] == "satnogs"

    async def test_add_transmitter_preserves_false_and_zero_values(self, db_session):
        """Test normalization keeps valid false/zero values."""
        await add_satellite(
            db_session,
            {
                "name": "Test Satellite",
                "sat_id": "TEST-001",
                "norad_id": 25544,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=25544),
                "tle2": TLE2_TEMPLATE.format(norad=25544),
            },
        )

        transmitter_data = {
            "description": "Falsy values transmitter",
            "satelliteId": 25544,
            "alive": False,
            "type": "transmitter",
            "uplinkLow": 145800000,
            "uplinkHigh": 145900000,
            "downlinkLow": 437800000,
            "downlinkHigh": 437900000,
            "uplinkDrift": 0,
            "downlinkDrift": 0,
            "mode": "FM",
            "uplinkMode": "FM",
            "invert": False,
            "baud": 0,
            "status": "active",
        }

        result = await add_transmitter(db_session, transmitter_data)

        assert result["success"] is True
        assert result["data"]["alive"] is False
        assert result["data"]["invert"] is False
        assert result["data"]["uplink_drift"] == 0
        assert result["data"]["downlink_drift"] == 0
        assert result["data"]["baud"] == 0

    async def test_add_transmitter_coerces_numeric_strings(self, db_session):
        """Test normalization coerces numeric string inputs to ints."""
        await add_satellite(
            db_session,
            {
                "name": "Test Satellite",
                "sat_id": "TEST-001",
                "norad_id": 25544,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=25544),
                "tle2": TLE2_TEMPLATE.format(norad=25544),
            },
        )

        transmitter_data = {
            "description": "String values transmitter",
            "satelliteId": "25544",
            "alive": "false",
            "type": "transmitter",
            "uplinkLow": "145800000",
            "uplinkHigh": "145900000",
            "downlinkLow": "437800000",
            "downlinkHigh": "437900000",
            "uplinkDrift": "0",
            "downlinkDrift": "0",
            "mode": "FM",
            "uplinkMode": "FM",
            "invert": "true",
            "baud": "9600",
            "status": "active",
        }

        result = await add_transmitter(db_session, transmitter_data)

        assert result["success"] is True
        assert result["data"]["norad_cat_id"] == 25544
        assert result["data"]["uplink_low"] == 145800000
        assert result["data"]["downlink_low"] == 437800000
        assert result["data"]["baud"] == 9600
        assert result["data"]["alive"] is False
        assert result["data"]["invert"] is True

    async def test_add_transmitter_rejects_invalid_numeric_field(self, db_session):
        """Test normalization rejects invalid numeric values with a clear error."""
        await add_satellite(
            db_session,
            {
                "name": "Test Satellite",
                "sat_id": "TEST-001",
                "norad_id": 25544,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=25544),
                "tle2": TLE2_TEMPLATE.format(norad=25544),
            },
        )

        transmitter_data = {
            "description": "Invalid numeric transmitter",
            "satelliteId": 25544,
            "alive": True,
            "type": "transmitter",
            "uplinkLow": "not-a-number",
            "uplinkHigh": "-",
            "downlinkLow": 437800000,
            "downlinkHigh": "-",
            "uplinkDrift": "-",
            "downlinkDrift": "-",
            "mode": "FM",
            "uplinkMode": "-",
            "status": "active",
        }

        result = await add_transmitter(db_session, transmitter_data)

        assert result["success"] is False
        assert "uplinkLow must be an integer" in result["error"]

    async def test_add_transmitter_normalizes_itu_notification_json_string(self, db_session):
        """Test malformed quoted/escaped JSON gets normalized for itu_notification."""
        await add_satellite(
            db_session,
            {
                "name": "Test Satellite",
                "sat_id": "TEST-001",
                "norad_id": 25544,
                "status": "alive",
                "is_frequency_violator": False,
                "tle1": TLE1_TEMPLATE.format(norad=25544),
                "tle2": TLE2_TEMPLATE.format(norad=25544),
            },
        )

        transmitter_data = {
            "description": "ITU JSON normalize",
            "satelliteId": 25544,
            "alive": True,
            "type": "transmitter",
            "uplinkLow": "-",
            "uplinkHigh": "-",
            "downlinkLow": 437800000,
            "downlinkHigh": "-",
            "uplinkDrift": "-",
            "downlinkDrift": "-",
            "mode": "FM",
            "uplinkMode": "-",
            "status": "active",
            "itu_notification": '"{\\\\"urls\\\\": []}"',
        }

        result = await add_transmitter(db_session, transmitter_data)

        assert result["success"] is True
        assert result["data"]["itu_notification"] == {"urls": []}
