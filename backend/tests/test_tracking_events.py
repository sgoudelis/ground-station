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
Tests for tracking/events.py satellite pass event calculation and caching.
"""

import hashlib
import json
import multiprocessing

import pytest

from orbits import CentralBody, get_propagation_input
from tracking.events import _generate_cache_key, _orbit_cache_identity
from tracking.passpool import _named_worker_init


# Module-level functions for multiprocessing tests (must be picklable)
def _worker_test_func():
    """Worker function to test process naming."""
    _named_worker_init()
    return multiprocessing.current_process().name


def _dummy_task_func(x):
    """Simple task for testing."""
    return x * 2


def test_omm_forecast_cache_key_changes_with_canonical_elements():
    from tests.testommtracking import OMM_PAYLOAD

    satellite = {
        "norad_id": 100000,
        "orbit_format": "omm",
        "orbit_payload": OMM_PAYLOAD,
    }
    changed = {
        **satellite,
        "orbit_payload": {**OMM_PAYLOAD, "INCLINATION": "52.0"},
    }

    def forecast_key(record):
        propagation = get_propagation_input(record, central_body=CentralBody.EARTH)
        identity = _orbit_cache_identity(record, propagation)
        return _generate_cache_key([identity], 37.98, 23.72, 24, 0, 1)

    assert forecast_key(satellite) != forecast_key(changed)


class TestGenerateCacheKey:
    """Test suite for _generate_cache_key function."""

    def test_cache_key_generation_basic(self):
        """Test basic cache key generation."""
        tle_groups = [[25544, "line1", "line2"]]
        homelat = 40.7128
        homelon = -74.0060
        hours = 6.0
        above_el = 0
        step_minutes = 1

        key = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes)

        # Should return a valid MD5 hash (32 hex characters)
        assert isinstance(key, str)
        assert len(key) == 32
        assert all(c in "0123456789abcdef" for c in key)

    def test_cache_key_deterministic(self):
        """Test that cache key generation is deterministic."""
        tle_groups = [[25544, "line1", "line2"]]
        homelat = 40.7128
        homelon = -74.0060
        hours = 6.0
        above_el = 0
        step_minutes = 1

        key1 = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes)
        key2 = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes)

        # Same inputs should produce same key
        assert key1 == key2

    def test_cache_key_different_tle_groups(self):
        """Test that different TLE groups produce different keys."""
        tle_groups1 = [[25544, "line1", "line2"]]
        tle_groups2 = [[25545, "line1", "line2"]]
        homelat = 40.7128
        homelon = -74.0060
        hours = 6.0
        above_el = 0
        step_minutes = 1

        key1 = _generate_cache_key(tle_groups1, homelat, homelon, hours, above_el, step_minutes)
        key2 = _generate_cache_key(tle_groups2, homelat, homelon, hours, above_el, step_minutes)

        # Different TLE groups should produce different keys
        assert key1 != key2

    def test_cache_key_different_location(self):
        """Test that different locations produce different keys."""
        tle_groups = [[25544, "line1", "line2"]]
        homelat1 = 40.7128
        homelon1 = -74.0060
        homelat2 = 51.5074
        homelon2 = -0.1278
        hours = 6.0
        above_el = 0
        step_minutes = 1

        key1 = _generate_cache_key(tle_groups, homelat1, homelon1, hours, above_el, step_minutes)
        key2 = _generate_cache_key(tle_groups, homelat2, homelon2, hours, above_el, step_minutes)

        # Different locations should produce different keys
        assert key1 != key2

    def test_cache_key_different_above_el(self):
        """Test that different elevation thresholds produce different keys."""
        tle_groups = [[25544, "line1", "line2"]]
        homelat = 40.7128
        homelon = -74.0060
        hours = 6.0
        above_el1 = 0
        above_el2 = 10
        step_minutes = 1

        key1 = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el1, step_minutes)
        key2 = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el2, step_minutes)

        # Different elevation thresholds should produce different keys
        assert key1 != key2

    def test_cache_key_different_step_minutes(self):
        """Test that different step minutes produce different keys."""
        tle_groups = [[25544, "line1", "line2"]]
        homelat = 40.7128
        homelon = -74.0060
        hours = 6.0
        above_el = 0
        step_minutes1 = 1
        step_minutes2 = 5

        key1 = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes1)
        key2 = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes2)

        # Different step minutes should produce different keys
        assert key1 != key2

    def test_cache_key_multiple_satellites(self):
        """Test cache key generation with multiple satellites."""
        tle_groups = [
            [25544, "line1a", "line2a"],
            [25545, "line1b", "line2b"],
            [25546, "line1c", "line2c"],
        ]
        homelat = 40.7128
        homelon = -74.0060
        hours = 6.0
        above_el = 0
        step_minutes = 1

        key = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes)

        # Should generate valid key for multiple satellites
        assert isinstance(key, str)
        assert len(key) == 32

    def test_cache_key_order_matters(self):
        """Test that order of satellites in TLE groups matters."""
        tle_groups1 = [
            [25544, "line1a", "line2a"],
            [25545, "line1b", "line2b"],
        ]
        tle_groups2 = [
            [25545, "line1b", "line2b"],
            [25544, "line1a", "line2a"],
        ]
        homelat = 40.7128
        homelon = -74.0060
        hours = 6.0
        above_el = 0
        step_minutes = 1

        key1 = _generate_cache_key(tle_groups1, homelat, homelon, hours, above_el, step_minutes)
        key2 = _generate_cache_key(tle_groups2, homelat, homelon, hours, above_el, step_minutes)

        # Different order should produce different keys
        # (because JSON doesn't sort list items, only dict keys)
        assert key1 != key2

    def test_cache_key_with_floats(self):
        """Test cache key generation with floating point precision."""
        tle_groups = [[25544, "line1", "line2"]]
        homelat = 40.71280000
        homelon = -74.00600000
        hours = 6.0
        above_el = 0
        step_minutes = 1

        key1 = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes)
        key2 = _generate_cache_key(tle_groups, 40.7128, -74.0060, hours, above_el, step_minutes)

        # Same values with different precision should produce same key
        assert key1 == key2

    def test_cache_key_negative_coordinates(self):
        """Test cache key generation with negative coordinates."""
        tle_groups = [[25544, "line1", "line2"]]
        homelat = -33.8688
        homelon = 151.2093
        hours = 6.0
        above_el = 0
        step_minutes = 1

        key = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes)

        # Should handle negative coordinates
        assert isinstance(key, str)
        assert len(key) == 32

    def test_cache_key_empty_tle_groups(self):
        """Test cache key generation with empty TLE groups."""
        tle_groups = []
        homelat = 40.7128
        homelon = -74.0060
        hours = 6.0
        above_el = 0
        step_minutes = 1

        key = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes)

        # Should still generate a valid key
        assert isinstance(key, str)
        assert len(key) == 32

    def test_cache_key_hash_consistency(self):
        """Test that cache key matches expected MD5 hash of parameters."""
        tle_groups = [[25544, "line1", "line2"]]
        homelat = 40.7128
        homelon = -74.0060
        hours = 6.0
        above_el = 0
        step_minutes = 1

        # Generate key using function
        key = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes)

        # Generate expected hash manually
        params_str = json.dumps(
            {
                "tle_groups": tle_groups,
                "homelat": homelat,
                "homelon": homelon,
                "above_el": above_el,
                "step_minutes": step_minutes,
            },
            sort_keys=True,
        )
        expected_hash = hashlib.md5(params_str.encode()).hexdigest()

        # Should match
        assert key == expected_hash


class TestNamedWorkerInit:
    """Test suite for _named_worker_init function."""

    def test_named_worker_init_sets_process_name(self):
        """Test that worker init sets process name."""
        # Create a pool and run the worker
        with multiprocessing.Pool(processes=1) as pool:
            result = pool.apply(_worker_test_func)

        # Check that process name was set
        assert result == "Ground Station - SatellitePassWorker"

    def test_named_worker_init_no_errors(self):
        """Test that worker init completes without errors."""
        # Should not raise any exceptions
        try:
            _named_worker_init()
        except Exception as e:
            pytest.fail(f"_named_worker_init() raised {e}")

    def test_named_worker_init_in_pool(self):
        """Test worker init as pool initializer."""
        # Create pool with named worker init
        with multiprocessing.Pool(processes=2, initializer=_named_worker_init) as pool:
            results = pool.map(_dummy_task_func, [1, 2, 3, 4])

        # Pool should work normally
        assert results == [2, 4, 6, 8]

    def test_named_worker_init_multiple_calls(self):
        """Test that multiple calls to worker init don't cause issues."""
        # Should be idempotent
        try:
            _named_worker_init()
            _named_worker_init()
            _named_worker_init()
        except Exception as e:
            pytest.fail(f"Multiple calls to _named_worker_init() raised {e}")


class TestCacheKeyEdgeCases:
    """Test edge cases and special scenarios for cache key generation."""

    def test_cache_key_unicode_in_tle(self):
        """Test cache key with unicode characters in TLE data."""
        tle_groups = [[25544, "line1_ü", "line2_ñ"]]
        homelat = 40.7128
        homelon = -74.0060
        hours = 6.0
        above_el = 0
        step_minutes = 1

        key = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes)

        # Should handle unicode gracefully
        assert isinstance(key, str)
        assert len(key) == 32

    def test_cache_key_extreme_coordinates(self):
        """Test cache key with extreme coordinate values."""
        tle_groups = [[25544, "line1", "line2"]]
        homelat = 89.999  # Near North Pole
        homelon = 179.999  # Near dateline
        hours = 6.0
        above_el = 0
        step_minutes = 1

        key = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes)

        assert isinstance(key, str)
        assert len(key) == 32

    def test_cache_key_zero_values(self):
        """Test cache key with zero values."""
        tle_groups = [[25544, "line1", "line2"]]
        homelat = 0.0
        homelon = 0.0
        hours = 6.0
        above_el = 0
        step_minutes = 1

        key = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes)

        assert isinstance(key, str)
        assert len(key) == 32

    def test_cache_key_large_numbers(self):
        """Test cache key with large NORAD IDs."""
        tle_groups = [[99999999, "line1", "line2"]]
        homelat = 40.7128
        homelon = -74.0060
        hours = 6.0
        above_el = 0
        step_minutes = 1

        key = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes)

        assert isinstance(key, str)
        assert len(key) == 32

    def test_cache_key_high_precision_floats(self):
        """Test cache key with high precision floating point numbers."""
        tle_groups = [[25544, "line1", "line2"]]
        homelat = 40.71283847392847
        homelon = -74.00602983746293
        hours = 6.0
        above_el = 0
        step_minutes = 1

        key = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes)

        assert isinstance(key, str)
        assert len(key) == 32

    def test_cache_key_negative_elevation(self):
        """Test cache key with negative elevation threshold."""
        tle_groups = [[25544, "line1", "line2"]]
        homelat = 40.7128
        homelon = -74.0060
        hours = 6.0
        above_el = -10  # Below horizon
        step_minutes = 1

        key = _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes)

        assert isinstance(key, str)
        assert len(key) == 32
