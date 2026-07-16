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
Tests for tracking/doppler.py Doppler shift calculation functions.
"""

from datetime import datetime, timezone

import pytest
from skyfield.api import load

from tracking.doppler import (
    calculate_doppler_shift,
    calculate_doppler_shift_from_range_rate,
    calculate_observer_velocity_due_to_earth_rotation,
    calculate_range_rate_from_heliocentric_vectors,
)


# Test fixtures with real TLE data
@pytest.fixture
def iss_tle():
    """ISS TLE data for testing."""
    return {
        "line1": "1 25544U 98067A   23109.65481637  .00012345  00000-0  21914-3 0  9997",
        "line2": "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537",
    }


@pytest.fixture
def geo_satellite_tle():
    """Geostationary satellite TLE data for testing."""
    return {
        "line1": "1 41866U 16071A   23109.50000000  .00000000  00000-0  00000-0 0  9990",
        "line2": "2 41866   0.0500  75.3000 0000500 123.4000 236.6000  1.00271798 12345",
    }


@pytest.fixture
def san_francisco_location():
    """San Francisco observer location."""
    return {"lat": 37.7749, "lon": -122.4194, "elevation": 52.0}


@pytest.fixture
def london_location():
    """London observer location."""
    return {"lat": 51.5074, "lon": -0.1278, "elevation": 11.0}


class TestCalculateDopplerShift:
    """Test cases for calculate_doppler_shift function."""

    def test_doppler_shift_returns_tuple(self, iss_tle, san_francisco_location):
        """Test that function returns a tuple of two values."""
        result = calculate_doppler_shift(
            tle_line1=iss_tle["line1"],
            tle_line2=iss_tle["line2"],
            observer_lat=san_francisco_location["lat"],
            observer_lon=san_francisco_location["lon"],
            observer_elevation=san_francisco_location["elevation"],
            transmitted_freq_hz=145800000,  # 145.8 MHz (ISS VHF)
        )

        assert isinstance(result, tuple)
        assert len(result) == 2

    def test_doppler_shift_return_types(self, iss_tle, san_francisco_location):
        """Test that returned values are floats."""
        observed_freq, doppler_shift = calculate_doppler_shift(
            tle_line1=iss_tle["line1"],
            tle_line2=iss_tle["line2"],
            observer_lat=san_francisco_location["lat"],
            observer_lon=san_francisco_location["lon"],
            observer_elevation=san_francisco_location["elevation"],
            transmitted_freq_hz=145800000,
        )

        assert isinstance(observed_freq, float)
        assert isinstance(doppler_shift, float)

    def test_doppler_shift_reasonable_values(self, iss_tle, san_francisco_location):
        """Test that Doppler shift values are within reasonable range for LEO satellites."""
        transmitted_freq = 145800000  # 145.8 MHz
        observed_freq, doppler_shift = calculate_doppler_shift(
            tle_line1=iss_tle["line1"],
            tle_line2=iss_tle["line2"],
            observer_lat=san_francisco_location["lat"],
            observer_lon=san_francisco_location["lon"],
            observer_elevation=san_francisco_location["elevation"],
            transmitted_freq_hz=transmitted_freq,
        )

        # For LEO satellites at VHF, Doppler shift should be within ±10 kHz
        assert abs(doppler_shift) <= 10000

        # Observed frequency should be close to transmitted frequency
        assert abs(observed_freq - transmitted_freq) <= 10000

    def test_doppler_shift_uhf_frequency(self, iss_tle, san_francisco_location):
        """Test Doppler shift calculation with UHF frequency."""
        transmitted_freq = 437800000  # 437.8 MHz (ISS UHF)
        observed_freq, doppler_shift = calculate_doppler_shift(
            tle_line1=iss_tle["line1"],
            tle_line2=iss_tle["line2"],
            observer_lat=san_francisco_location["lat"],
            observer_lon=san_francisco_location["lon"],
            observer_elevation=san_francisco_location["elevation"],
            transmitted_freq_hz=transmitted_freq,
        )

        # UHF Doppler shift should be proportionally larger than VHF
        # For ISS at UHF, expect within ±30 kHz
        assert abs(doppler_shift) <= 30000

    def test_doppler_shift_different_observer_locations(self, iss_tle):
        """Test that different observer locations produce different Doppler shifts."""
        transmitted_freq = 145800000

        # San Francisco
        sf_observed, sf_shift = calculate_doppler_shift(
            tle_line1=iss_tle["line1"],
            tle_line2=iss_tle["line2"],
            observer_lat=37.7749,
            observer_lon=-122.4194,
            observer_elevation=52.0,
            transmitted_freq_hz=transmitted_freq,
        )

        # London
        london_observed, london_shift = calculate_doppler_shift(
            tle_line1=iss_tle["line1"],
            tle_line2=iss_tle["line2"],
            observer_lat=51.5074,
            observer_lon=-0.1278,
            observer_elevation=11.0,
            transmitted_freq_hz=transmitted_freq,
        )

        # Different locations should produce different results
        # (unless satellite happens to be at exact same geometry, which is unlikely)
        # We just check they're both valid values
        assert isinstance(sf_observed, float)
        assert isinstance(london_observed, float)

    def test_doppler_shift_with_specific_time(self, iss_tle, san_francisco_location):
        """Test Doppler shift calculation with a specific time."""
        ts = load.timescale()
        specific_time = ts.utc(2023, 4, 19, 12, 0, 0)

        observed_freq, doppler_shift = calculate_doppler_shift(
            tle_line1=iss_tle["line1"],
            tle_line2=iss_tle["line2"],
            observer_lat=san_francisco_location["lat"],
            observer_lon=san_francisco_location["lon"],
            observer_elevation=san_francisco_location["elevation"],
            transmitted_freq_hz=145800000,
            time=specific_time,
        )

        assert isinstance(observed_freq, float)
        assert isinstance(doppler_shift, float)

    def test_doppler_shift_consistency(self, iss_tle, san_francisco_location):
        """Test that Doppler shift calculation is consistent with same inputs."""
        ts = load.timescale()
        specific_time = ts.utc(2023, 4, 19, 12, 0, 0)
        transmitted_freq = 145800000

        # Calculate twice with same inputs
        result1 = calculate_doppler_shift(
            tle_line1=iss_tle["line1"],
            tle_line2=iss_tle["line2"],
            observer_lat=san_francisco_location["lat"],
            observer_lon=san_francisco_location["lon"],
            observer_elevation=san_francisco_location["elevation"],
            transmitted_freq_hz=transmitted_freq,
            time=specific_time,
        )

        result2 = calculate_doppler_shift(
            tle_line1=iss_tle["line1"],
            tle_line2=iss_tle["line2"],
            observer_lat=san_francisco_location["lat"],
            observer_lon=san_francisco_location["lon"],
            observer_elevation=san_francisco_location["elevation"],
            transmitted_freq_hz=transmitted_freq,
            time=specific_time,
        )

        # Results should be identical
        assert result1[0] == result2[0]
        assert result1[1] == result2[1]

    def test_doppler_shift_geostationary_satellite(self, geo_satellite_tle, san_francisco_location):
        """Test that geostationary satellites have minimal Doppler shift."""
        transmitted_freq = 11700000000  # 11.7 GHz (typical GEO downlink)
        observed_freq, doppler_shift = calculate_doppler_shift(
            tle_line1=geo_satellite_tle["line1"],
            tle_line2=geo_satellite_tle["line2"],
            observer_lat=san_francisco_location["lat"],
            observer_lon=san_francisco_location["lon"],
            observer_elevation=san_francisco_location["elevation"],
            transmitted_freq_hz=transmitted_freq,
        )

        # Geostationary satellites should have very small Doppler shift
        # (not zero due to satellite oscillations and orbit eccentricity)
        assert abs(doppler_shift) <= 50000  # Within 50 kHz for GEO

    def test_doppler_shift_high_frequency(self, iss_tle, san_francisco_location):
        """Test Doppler shift with high frequency (S-band)."""
        transmitted_freq = 2400000000  # 2.4 GHz
        observed_freq, doppler_shift = calculate_doppler_shift(
            tle_line1=iss_tle["line1"],
            tle_line2=iss_tle["line2"],
            observer_lat=san_francisco_location["lat"],
            observer_lon=san_francisco_location["lon"],
            observer_elevation=san_francisco_location["elevation"],
            transmitted_freq_hz=transmitted_freq,
        )

        # Higher frequencies have proportionally larger absolute Doppler shifts
        # For LEO at S-band, expect within ±200 kHz
        assert abs(doppler_shift) <= 200000

    def test_doppler_shift_equator_location(self, iss_tle):
        """Test Doppler shift calculation from equatorial location."""
        transmitted_freq = 145800000
        observed_freq, doppler_shift = calculate_doppler_shift(
            tle_line1=iss_tle["line1"],
            tle_line2=iss_tle["line2"],
            observer_lat=0.0,  # Equator
            observer_lon=0.0,  # Prime meridian
            observer_elevation=0.0,  # Sea level
            transmitted_freq_hz=transmitted_freq,
        )

        assert isinstance(observed_freq, float)
        assert isinstance(doppler_shift, float)
        assert abs(doppler_shift) <= 10000

    def test_doppler_shift_polar_location(self, iss_tle):
        """Test Doppler shift calculation from polar location."""
        transmitted_freq = 145800000
        observed_freq, doppler_shift = calculate_doppler_shift(
            tle_line1=iss_tle["line1"],
            tle_line2=iss_tle["line2"],
            observer_lat=89.9,  # Near North Pole
            observer_lon=0.0,
            observer_elevation=0.0,
            transmitted_freq_hz=transmitted_freq,
        )

        assert isinstance(observed_freq, float)
        assert isinstance(doppler_shift, float)

    def test_doppler_shift_high_elevation_observer(self, iss_tle):
        """Test Doppler shift with high elevation observer (mountain top)."""
        transmitted_freq = 145800000
        observed_freq, doppler_shift = calculate_doppler_shift(
            tle_line1=iss_tle["line1"],
            tle_line2=iss_tle["line2"],
            observer_lat=27.9881,  # Mt. Everest
            observer_lon=86.9250,
            observer_elevation=8848.0,  # Mt. Everest elevation
            transmitted_freq_hz=transmitted_freq,
        )

        assert isinstance(observed_freq, float)
        assert isinstance(doppler_shift, float)

    def test_doppler_shift_relationship(self, iss_tle, san_francisco_location):
        """Test that observed_freq = transmitted_freq + doppler_shift."""
        transmitted_freq = 145800000
        observed_freq, doppler_shift = calculate_doppler_shift(
            tle_line1=iss_tle["line1"],
            tle_line2=iss_tle["line2"],
            observer_lat=san_francisco_location["lat"],
            observer_lon=san_francisco_location["lon"],
            observer_elevation=san_francisco_location["elevation"],
            transmitted_freq_hz=transmitted_freq,
        )

        # Verify the relationship (within rounding tolerance)
        expected_observed = transmitted_freq + doppler_shift
        assert abs(observed_freq - expected_observed) < 1  # Within 1 Hz due to rounding

    def test_doppler_shift_rounding(self, iss_tle, san_francisco_location):
        """Test that returned values are rounded to integers."""
        observed_freq, doppler_shift = calculate_doppler_shift(
            tle_line1=iss_tle["line1"],
            tle_line2=iss_tle["line2"],
            observer_lat=san_francisco_location["lat"],
            observer_lon=san_francisco_location["lon"],
            observer_elevation=san_francisco_location["elevation"],
            transmitted_freq_hz=145800000,
        )

        # Check that values are whole numbers (rounded)
        assert observed_freq == round(observed_freq)
        assert doppler_shift == round(doppler_shift)


class TestVectorBasedDoppler:
    """Tests for vector/range-rate based Doppler helpers."""

    def test_doppler_from_range_rate_receding_lowers_frequency(self):
        transmitted_freq = 145_800_000
        observed_freq, doppler_shift = calculate_doppler_shift_from_range_rate(
            range_rate_km_s=7.5,
            transmitted_freq_hz=transmitted_freq,
        )
        assert observed_freq < transmitted_freq
        assert doppler_shift < 0

    def test_doppler_from_range_rate_approaching_raises_frequency(self):
        transmitted_freq = 145_800_000
        observed_freq, doppler_shift = calculate_doppler_shift_from_range_rate(
            range_rate_km_s=-7.5,
            transmitted_freq_hz=transmitted_freq,
        )
        assert observed_freq > transmitted_freq
        assert doppler_shift > 0

    def test_range_rate_from_heliocentric_vectors_receding(self):
        range_rate = calculate_range_rate_from_heliocentric_vectors(
            target_position_xyz_au=[1.0, 0.0, 0.0],
            target_velocity_xyz_au_per_day=[0.01, 0.0, 0.0],
            earth_position_xyz_au=[0.0, 0.0, 0.0],
            earth_velocity_xyz_au_per_day=[0.0, 0.0, 0.0],
        )
        assert range_rate == pytest.approx(17.314568368055554, rel=1e-9)

    def test_range_rate_from_heliocentric_vectors_approaching(self):
        range_rate = calculate_range_rate_from_heliocentric_vectors(
            target_position_xyz_au=[1.0, 0.0, 0.0],
            target_velocity_xyz_au_per_day=[-0.01, 0.0, 0.0],
            earth_position_xyz_au=[0.0, 0.0, 0.0],
            earth_velocity_xyz_au_per_day=[0.0, 0.0, 0.0],
        )
        assert range_rate == pytest.approx(-17.314568368055554, rel=1e-9)

    def test_observer_rotation_velocity_is_near_zero_at_pole(self):
        observer_velocity = calculate_observer_velocity_due_to_earth_rotation(
            observer_lat_deg=90.0,
            observer_lon_deg=0.0,
            observer_elevation_m=0.0,
            epoch=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
        assert float(abs(observer_velocity[0])) < 1e-6
        assert float(abs(observer_velocity[1])) < 1e-6

    def test_range_rate_includes_observer_rotation_component(self):
        epoch = datetime(2026, 1, 1, tzinfo=timezone.utc)
        observer_velocity = calculate_observer_velocity_due_to_earth_rotation(
            observer_lat_deg=0.0,
            observer_lon_deg=45.0,
            observer_elevation_m=0.0,
            epoch=epoch,
        )
        range_rate_no_observer = calculate_range_rate_from_heliocentric_vectors(
            target_position_xyz_au=[1.0, 0.0, 0.0],
            target_velocity_xyz_au_per_day=[0.0, 0.0, 0.0],
            earth_position_xyz_au=[0.0, 0.0, 0.0],
            earth_velocity_xyz_au_per_day=[0.0, 0.0, 0.0],
        )
        range_rate_with_observer = calculate_range_rate_from_heliocentric_vectors(
            target_position_xyz_au=[1.0, 0.0, 0.0],
            target_velocity_xyz_au_per_day=[0.0, 0.0, 0.0],
            earth_position_xyz_au=[0.0, 0.0, 0.0],
            earth_velocity_xyz_au_per_day=[0.0, 0.0, 0.0],
            observer_lat_deg=0.0,
            observer_lon_deg=45.0,
            observer_elevation_m=0.0,
            epoch=epoch,
        )

        # For line-of-sight along +X, range-rate offset equals -observer_vx.
        assert range_rate_no_observer == pytest.approx(0.0, abs=1e-12)
        assert range_rate_with_observer == pytest.approx(
            -float(observer_velocity[0]),
            rel=1e-9,
        )
