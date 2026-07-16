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
Tests for tracking/passes.py satellite pass calculation functions.
"""

import numpy as np
import pytest
from skyfield.api import EarthSatellite, load

from tracking.passes import (
    analyze_satellite_orbit,
    calculate_azimuth_path,
    calculate_next_events,
    classify_pass_geometry,
)


# Test fixtures with real TLE data
@pytest.fixture
def iss_tle():
    """ISS TLE data for testing."""
    return {
        "norad_id": 25544,
        "name": "ISS (ZARYA)",
        "tle1": "1 25544U 98067A   23109.65481637  .00012345  00000-0  21914-3 0  9997",
        "tle2": "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537",
        "line1": "1 25544U 98067A   23109.65481637  .00012345  00000-0  21914-3 0  9997",
        "line2": "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537",
    }


@pytest.fixture
def geo_satellite_tle():
    """Geostationary satellite TLE data for testing."""
    return {
        "norad_id": 41866,
        "name": "GOES-16",
        "tle1": "1 41866U 16071A   23109.50000000  .00000000  00000-0  00000-0 0  9990",
        "tle2": "2 41866   0.0500  75.3000 0000500 123.4000 236.6000  1.00271798 12345",
        "line1": "1 41866U 16071A   23109.50000000  .00000000  00000-0  00000-0 0  9990",
        "line2": "2 41866   0.0500  75.3000 0000500 123.4000 236.6000  1.00271798 12345",
    }


@pytest.fixture
def molniya_tle():
    """Molniya orbit satellite TLE for testing."""
    return {
        "norad_id": 12345,
        "name": "MOLNIYA",
        "tle1": "1 12345U 80123A   23109.50000000  .00000123  00000-0  12345-3 0  9999",
        "tle2": "2 12345  63.4000  90.0000 7200000 270.0000  30.0000  2.00617284123456",
        "line1": "1 12345U 80123A   23109.50000000  .00000123  00000-0  12345-3 0  9999",
        "line2": "2 12345  63.4000  90.0000 7200000 270.0000  30.0000  2.00617284123456",
    }


class TestAnalyzeSatelliteOrbit:
    """Test cases for analyze_satellite_orbit function."""

    def test_analyze_iss_orbit(self, iss_tle):
        """Test analyzing ISS orbit (LEO, not geostationary)."""
        ts = load.timescale()
        satellite = EarthSatellite(iss_tle["line1"], iss_tle["line2"], iss_tle["name"], ts)

        result = analyze_satellite_orbit(satellite)

        assert result is not None
        assert "is_geosynchronous" in result
        assert "is_geostationary" in result
        assert "orbital_period_minutes" in result
        assert "inclination" in result
        assert "eccentricity" in result

        # ISS should not be geosynchronous or geostationary
        assert result["is_geosynchronous"] == False
        assert result["is_geostationary"] == False

        # ISS orbital period should be around 90 minutes
        assert 80 < result["orbital_period_minutes"] < 100

        # ISS inclination should be around 51.6 degrees
        assert 50 < result["inclination"] < 53

    def test_analyze_geo_satellite_orbit(self, geo_satellite_tle):
        """Test analyzing geostationary satellite orbit."""
        ts = load.timescale()
        satellite = EarthSatellite(
            geo_satellite_tle["line1"], geo_satellite_tle["line2"], geo_satellite_tle["name"], ts
        )

        result = analyze_satellite_orbit(satellite)

        # Geostationary satellites should be detected
        assert result["is_geosynchronous"] == True
        assert result["is_geostationary"] == True

        # Period should be close to sidereal day (~1436 minutes)
        assert 1400 < result["orbital_period_minutes"] < 1470

        # Inclination should be very low for geostationary
        assert result["inclination"] < 5

        # Eccentricity should be very low
        assert result["eccentricity"] < 0.1

    def test_analyze_molniya_orbit(self, molniya_tle):
        """Test analyzing Molniya orbit (high eccentricity, high inclination)."""
        ts = load.timescale()
        satellite = EarthSatellite(
            molniya_tle["line1"], molniya_tle["line2"], molniya_tle["name"], ts
        )

        result = analyze_satellite_orbit(satellite)

        # Molniya orbit should not be geostationary
        assert result["is_geostationary"] == False

        # High inclination
        assert result["inclination"] > 60

        # High eccentricity
        assert result["eccentricity"] > 0.5

    def test_analyze_orbit_returns_correct_types(self, iss_tle):
        """Test that analyze_satellite_orbit returns correct data types."""
        ts = load.timescale()
        satellite = EarthSatellite(iss_tle["line1"], iss_tle["line2"], iss_tle["name"], ts)

        result = analyze_satellite_orbit(satellite)

        # Check that boolean values are truthy/falsy (works for both bool and np.bool_)
        assert result["is_geosynchronous"] in (True, False)
        assert result["is_geostationary"] in (True, False)
        assert isinstance(result["orbital_period_minutes"], (int, float, np.number))
        assert isinstance(result["inclination"], (int, float, np.number))
        assert isinstance(result["eccentricity"], (int, float, np.number))


class TestCalculateAzimuthPath:
    """Test cases for calculate_azimuth_path function."""

    def test_azimuth_path_clockwise_no_wrap(self):
        """Test counterclockwise azimuth increase (90 to 180)."""
        # Azimuth increases from 90° to 180° (counterclockwise in math, function swaps for display)
        azimuths = [90, 100, 110, 120, 130, 140, 150, 160, 170, 180]

        display_start, display_end, arc_angle = calculate_azimuth_path(azimuths)

        # Function detects counterclockwise (positive) movement and swaps
        assert display_start == 180
        assert display_end == 90
        # Arc from 180 clockwise to 90: 180-90 = 90 degrees
        assert arc_angle == 90

    def test_azimuth_path_counterclockwise_no_wrap(self):
        """Test clockwise azimuth decrease (180 to 90)."""
        # Azimuth decreases from 180° to 90° (clockwise, no swap)
        azimuths = [180, 170, 160, 150, 140, 130, 120, 110, 100, 90]

        display_start, display_end, arc_angle = calculate_azimuth_path(azimuths)

        # Function detects clockwise (negative) movement, keeps as-is
        assert display_start == 180
        assert display_end == 90
        # Arc from 180 clockwise to 90: 180-90 = 90 degrees
        assert arc_angle == 90

    def test_azimuth_path_crossing_north_clockwise(self):
        """Test azimuth increase crossing north (350 to 10)."""
        # Azimuth increases from 350° through 0° to 10° (counterclockwise, swaps)
        azimuths = [350, 355, 0, 5, 10]

        display_start, display_end, arc_angle = calculate_azimuth_path(azimuths)

        # Function swaps for counterclockwise movement
        assert display_start == 10
        assert display_end == 350
        assert arc_angle > 0
        assert arc_angle <= 360

    def test_azimuth_path_crossing_north_counterclockwise(self):
        """Test azimuth decrease crossing north (10 to 350)."""
        # Azimuth decreases from 10° through 0° to 350° (clockwise, no swap)
        azimuths = [10, 5, 0, 355, 350]

        display_start, display_end, arc_angle = calculate_azimuth_path(azimuths)

        # Function keeps clockwise movement as-is
        assert display_start == 10
        assert display_end == 350
        assert arc_angle > 0

    def test_azimuth_path_single_point(self):
        """Test with single azimuth point."""
        azimuths = [180]

        display_start, display_end, arc_angle = calculate_azimuth_path(azimuths)

        assert display_start == 0
        assert display_end == 0
        assert arc_angle == 0

    def test_azimuth_path_empty_list(self):
        """Test with empty azimuth list."""
        azimuths = []

        display_start, display_end, arc_angle = calculate_azimuth_path(azimuths)

        assert display_start == 0
        assert display_end == 0
        assert arc_angle == 0

    def test_azimuth_path_two_points(self):
        """Test with only two azimuth points."""
        azimuths = [45, 135]

        display_start, display_end, arc_angle = calculate_azimuth_path(azimuths)

        assert isinstance(display_start, (int, float))
        assert isinstance(display_end, (int, float))
        assert isinstance(arc_angle, (int, float))

    def test_azimuth_path_full_circle(self):
        """Test satellite making nearly full circle."""
        # Satellite moving almost full circle clockwise
        azimuths = list(range(0, 360, 10))

        display_start, display_end, arc_angle = calculate_azimuth_path(azimuths)

        assert 0 <= display_start < 360
        assert 0 <= display_end < 360
        assert 0 <= arc_angle <= 360

    def test_azimuth_path_values_above_360(self):
        """Test that azimuth values above 360 are normalized."""
        azimuths = [370, 380, 390, 400]  # Values above 360

        display_start, display_end, arc_angle = calculate_azimuth_path(azimuths)

        # All values should be normalized to 0-360 range
        assert 0 <= display_start < 360
        assert 0 <= display_end < 360
        assert 0 <= arc_angle <= 360

    def test_azimuth_path_values_negative(self):
        """Test that negative azimuth values are handled."""
        azimuths = [-10, -5, 0, 5, 10]

        display_start, display_end, arc_angle = calculate_azimuth_path(azimuths)

        # All output values should be in valid range
        assert 0 <= display_start < 360
        assert 0 <= display_end < 360
        assert 0 <= arc_angle <= 360

    def test_azimuth_path_realistic_pass_west_to_east(self):
        """Test realistic satellite pass from west to east."""
        # Typical pass: rise in west (270°), peak south (180°), set in east (90°)
        azimuths = [270, 250, 230, 210, 190, 180, 170, 150, 130, 110, 90]

        display_start, display_end, arc_angle = calculate_azimuth_path(azimuths)

        # Should represent the path correctly
        assert display_start == 270 or display_start == 90
        assert arc_angle > 0

    def test_azimuth_path_realistic_pass_east_to_west(self):
        """Test realistic satellite pass from east to west."""
        # Pass: rise in east (90°), peak south (180°), set in west (270°)
        azimuths = [90, 110, 130, 150, 170, 180, 190, 210, 230, 250, 270]

        display_start, display_end, arc_angle = calculate_azimuth_path(azimuths)

        assert display_start == 90 or display_start == 270
        assert arc_angle > 0

    def test_azimuth_path_north_crossing_subtle(self):
        """Test subtle north crossing (359° to 1°)."""
        azimuths = [359, 360, 1]

        display_start, display_end, arc_angle = calculate_azimuth_path(azimuths)

        # Should handle the wrap correctly
        assert 0 <= display_start < 360
        assert 0 <= display_end < 360

    def test_azimuth_path_stationary(self):
        """Test satellite appearing stationary in azimuth."""
        # Geostationary or similar - azimuth barely changes
        azimuths = [180, 180.1, 180.2, 180.1, 180]

        display_start, display_end, arc_angle = calculate_azimuth_path(azimuths)

        # Should have very small arc
        assert arc_angle < 10  # Less than 10 degrees of movement

    def test_azimuth_path_erratic_movement(self):
        """Test handling of erratic azimuth changes."""
        # Unrealistic but tests robustness
        azimuths = [0, 90, 45, 270, 180, 315]

        display_start, display_end, arc_angle = calculate_azimuth_path(azimuths)

        # Should still return valid values
        assert 0 <= display_start < 360
        assert 0 <= display_end < 360
        assert 0 <= arc_angle <= 360


class TestClassifyPassGeometry:
    """Test cases for classify_pass_geometry helper."""

    def test_detects_north_crossing(self):
        result = classify_pass_geometry(
            start_azimuth=350.0,
            peak_azimuth=0.0,
            end_azimuth=15.0,
            peak_altitude=42.0,
            azimuth_samples=[350.0, 355.0, 359.0, 1.0, 10.0, 15.0],
        )

        assert result["crosses_north"] is True
        assert "north_crossing" in result["pass_tags"]
        assert result["crosses_south"] is False
        assert result["pass_direction"] == "CCW"
        assert "direction_ccw" in result["pass_tags"]
        assert result["elevation_class"] == "medium"

    def test_detects_south_crossing(self):
        result = classify_pass_geometry(
            start_azimuth=120.0,
            peak_azimuth=180.0,
            end_azimuth=260.0,
            peak_altitude=25.0,
            azimuth_samples=[120.0, 150.0, 180.0, 210.0, 240.0, 260.0],
        )

        assert result["crosses_south"] is True
        assert "south_crossing" in result["pass_tags"]
        assert result["crosses_north"] is False
        assert result["pass_direction"] == "CCW"
        assert "direction_ccw" in result["pass_tags"]
        assert result["elevation_class"] == "low"

    def test_detects_overhead_elevation_tag(self):
        result = classify_pass_geometry(
            start_azimuth=280.0,
            peak_azimuth=180.0,
            end_azimuth=80.0,
            peak_altitude=84.5,
            azimuth_samples=[280.0, 240.0, 200.0, 160.0, 120.0, 80.0],
        )

        assert result["pass_direction"] == "CW"
        assert "direction_cw" in result["pass_tags"]
        assert result["elevation_class"] == "overhead"
        assert "elevation_overhead" in result["pass_tags"]

    def test_no_azimuth_trend_tags_emitted(self):
        result = classify_pass_geometry(
            start_azimuth=180.0,
            peak_azimuth=182.0,
            end_azimuth=181.0,
            peak_altitude=61.0,
            azimuth_samples=[180.0, 182.0, 181.0, 183.0, 181.0],
        )

        assert result["elevation_class"] == "high"
        assert result["pass_direction"] in {"CW", "CCW", "MIXED"}
        assert any(tag.startswith("direction_") for tag in result["pass_tags"])
        assert all(not tag.startswith("az_") for tag in result["pass_tags"])


class TestCalculateNextEventsIntegration:
    """Integration tests for calculate_next_events function.

    Note: These tests require Skyfield library and may take longer to run.
    They're marked as integration tests and can be run separately.
    """

    @pytest.mark.integration
    def test_calculate_next_events_single_satellite_dict(self, iss_tle):
        """Test calculating passes for a single satellite (dict format)."""
        home_location = {"lat": 37.7749, "lon": -122.4194}  # San Francisco

        result = calculate_next_events(
            satellite_data=iss_tle, home_location=home_location, hours=24, above_el=0
        )

        assert result["success"] is True
        assert "data" in result
        assert "parameters" in result
        assert result["parameters"]["satellite_count"] == 1
        assert result["parameters"]["hours"] == 24

    @pytest.mark.integration
    def test_calculate_next_events_multiple_satellites(self, iss_tle, molniya_tle):
        """Test calculating passes for multiple satellites."""
        satellite_list = [iss_tle, molniya_tle]
        home_location = {"lat": 37.7749, "lon": -122.4194}

        result = calculate_next_events(
            satellite_data=satellite_list, home_location=home_location, hours=6, above_el=10
        )

        assert result["success"] is True
        assert result["parameters"]["satellite_count"] == 2
        assert result["parameters"]["above_el"] == 10

    @pytest.mark.integration
    def test_calculate_next_events_invalid_location(self, iss_tle):
        """Test with invalid location data."""
        invalid_location = {"invalid": "data"}

        result = calculate_next_events(
            satellite_data=iss_tle, home_location=invalid_location, hours=6
        )

        assert result["success"] is False
        assert "error" in result

    @pytest.mark.integration
    def test_calculate_next_events_invalid_satellite_data(self):
        """Test with invalid satellite data."""
        home_location = {"lat": 37.7749, "lon": -122.4194}

        result = calculate_next_events(
            satellite_data="invalid", home_location=home_location, hours=6
        )

        assert result["success"] is False
        assert "error" in result

    @pytest.mark.integration
    def test_calculate_next_events_high_elevation_threshold(self, iss_tle):
        """Test with high elevation threshold (30 degrees)."""
        home_location = {"lat": 37.7749, "lon": -122.4194}

        result = calculate_next_events(
            satellite_data=iss_tle, home_location=home_location, hours=24, above_el=30
        )

        assert result["success"] is True
        # Higher elevation threshold should result in fewer or no passes
        if result["data"]:
            for event in result["data"]:
                assert event["peak_altitude"] >= 30

    @pytest.mark.integration
    def test_calculate_next_events_pass_structure(self, iss_tle):
        """Test that pass events have correct structure."""
        home_location = {"lat": 37.7749, "lon": -122.4194}

        result = calculate_next_events(
            satellite_data=iss_tle, home_location=home_location, hours=48, above_el=0
        )

        assert result["success"] is True

        if result["data"]:  # If there are any passes
            event = result["data"][0]

            # Check required fields
            required_fields = [
                "norad_id",
                "event_start",
                "event_end",
                "duration",
                "peak_altitude",
                "start_azimuth",
                "end_azimuth",
                "peak_azimuth",
                "crosses_north",
                "crosses_south",
                "pass_direction",
                "elevation_class",
                "pass_tags",
                "distance_at_start",
                "distance_at_end",
                "distance_at_peak",
                "is_geostationary",
                "is_geosynchronous",
            ]

            for field in required_fields:
                assert field in event, f"Missing required field: {field}"

            # Check value ranges
            assert 0 <= event["peak_altitude"] <= 90
            assert 0 <= event["start_azimuth"] < 360
            assert 0 <= event["end_azimuth"] < 360
            assert 0 <= event["peak_azimuth"] < 360
            assert event["distance_at_peak"] > 0
            assert isinstance(event["crosses_north"], bool)
            assert isinstance(event["crosses_south"], bool)
            assert event["pass_direction"] in {"CW", "CCW", "MIXED"}
            assert event["elevation_class"] in {"low", "medium", "high", "overhead"}
            assert isinstance(event["pass_tags"], list)
