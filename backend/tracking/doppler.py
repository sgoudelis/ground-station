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

import math
from datetime import datetime, timezone

import numpy as np
from skyfield.api import EarthSatellite, Topos, load

AU_IN_KM = 149597870.7
SECONDS_PER_DAY = 86400.0
SPEED_OF_LIGHT_KM_PER_S = 299792.458
EARTH_ROTATION_RATE_RAD_PER_S = 7.2921150e-5
EARTH_EQUATORIAL_RADIUS_KM = 6378.137
EARTH_FLATTENING = 1 / 298.257223563
J2000_JD = 2451545.0
EARTH_OBLIQUITY_DEG = 23.439291


def _normalize_degrees(value: float) -> float:
    return value % 360.0


def _julian_date(epoch: datetime) -> float:
    utc_epoch = epoch.astimezone(timezone.utc)
    year = utc_epoch.year
    month = utc_epoch.month
    day = utc_epoch.day
    frac_day = (
        utc_epoch.hour / 24.0
        + utc_epoch.minute / 1440.0
        + (utc_epoch.second + utc_epoch.microsecond / 1_000_000.0) / 86400.0
    )
    if month <= 2:
        year -= 1
        month += 12
    a = year // 100
    b = 2 - a + (a // 4)
    return (
        math.floor(365.25 * (year + 4716))
        + math.floor(30.6001 * (month + 1))
        + day
        + frac_day
        + b
        - 1524.5
    )


def _gmst_rad(epoch: datetime) -> float:
    jd = _julian_date(epoch)
    t = (jd - J2000_JD) / 36525.0
    gmst_deg = (
        280.46061837
        + 360.98564736629 * (jd - J2000_JD)
        + 0.000387933 * (t * t)
        - (t * t * t) / 38710000.0
    )
    return math.radians(_normalize_degrees(gmst_deg))


def _ecliptic_to_equatorial(vector_xyz):
    eps_rad = math.radians(EARTH_OBLIQUITY_DEG)
    cos_eps = math.cos(eps_rad)
    sin_eps = math.sin(eps_rad)
    x_val, y_val, z_val = [float(component) for component in vector_xyz[:3]]
    return np.array(
        [
            x_val,
            (y_val * cos_eps) - (z_val * sin_eps),
            (y_val * sin_eps) + (z_val * cos_eps),
        ],
        dtype=float,
    )


def _velocity_au_per_day_to_km_per_s(vector_xyz):
    scale = AU_IN_KM / SECONDS_PER_DAY
    return np.array([float(component) for component in vector_xyz[:3]], dtype=float) * scale


def calculate_observer_velocity_due_to_earth_rotation(
    observer_lat_deg,
    observer_lon_deg,
    observer_elevation_m,
    epoch: datetime,
):
    """Return observer rotational velocity vector (ECI/equatorial frame) in km/s."""
    latitude_rad = math.radians(float(observer_lat_deg))
    longitude_rad = math.radians(float(observer_lon_deg))
    elevation_km = float(observer_elevation_m) / 1000.0

    # WGS84 ellipsoid geodetic -> ECEF.
    eccentricity_sq = 2 * EARTH_FLATTENING - (EARTH_FLATTENING * EARTH_FLATTENING)
    sin_lat = math.sin(latitude_rad)
    cos_lat = math.cos(latitude_rad)
    prime_vertical_radius = EARTH_EQUATORIAL_RADIUS_KM / math.sqrt(
        1 - (eccentricity_sq * sin_lat * sin_lat)
    )

    x_ecef = (prime_vertical_radius + elevation_km) * cos_lat * math.cos(longitude_rad)
    y_ecef = (prime_vertical_radius + elevation_km) * cos_lat * math.sin(longitude_rad)
    z_ecef = ((1 - eccentricity_sq) * prime_vertical_radius + elevation_km) * sin_lat

    theta = _gmst_rad(epoch)
    cos_theta = math.cos(theta)
    sin_theta = math.sin(theta)
    x_eci = (cos_theta * x_ecef) - (sin_theta * y_ecef)
    y_eci = (sin_theta * x_ecef) + (cos_theta * y_ecef)
    z_eci = z_ecef
    _ = z_eci

    # v = omega x r, omega = [0, 0, EARTH_ROTATION_RATE_RAD_PER_S]
    return np.array(
        [
            -EARTH_ROTATION_RATE_RAD_PER_S * y_eci,
            EARTH_ROTATION_RATE_RAD_PER_S * x_eci,
            0.0,
        ],
        dtype=float,
    )


def calculate_doppler_shift_from_range_rate(range_rate_km_s, transmitted_freq_hz):
    """Calculate Doppler-adjusted frequency from radial range rate in km/s.

    Positive range rate means target is receding from observer.
    Negative range rate means target is approaching observer.
    """
    try:
        frequency_hz = float(transmitted_freq_hz)
    except (TypeError, ValueError):
        return 0.0, 0.0

    if frequency_hz <= 0.0:
        return 0.0, 0.0

    try:
        radial_velocity_km_s = float(range_rate_km_s)
    except (TypeError, ValueError):
        radial_velocity_km_s = 0.0

    doppler_factor = 1.0 - (radial_velocity_km_s / SPEED_OF_LIGHT_KM_PER_S)
    observed_freq_hz = frequency_hz * doppler_factor
    doppler_shift_hz = observed_freq_hz - frequency_hz

    return round(float(observed_freq_hz), 0), round(float(doppler_shift_hz), 0)


def calculate_range_rate_from_heliocentric_vectors(
    target_position_xyz_au,
    target_velocity_xyz_au_per_day,
    earth_position_xyz_au,
    earth_velocity_xyz_au_per_day,
    observer_lat_deg=None,
    observer_lon_deg=None,
    observer_elevation_m=0.0,
    epoch: datetime | None = None,
):
    """Calculate geocentric radial velocity from heliocentric position/velocity vectors.

    All vectors are expected in AU and AU/day. Returns radial velocity in km/s where
    positive values indicate receding motion from the observer frame centered at Earth.
    """
    try:
        target_pos = np.array(target_position_xyz_au[:3], dtype=float)
        target_vel = np.array(target_velocity_xyz_au_per_day[:3], dtype=float)
        earth_pos = np.array(earth_position_xyz_au[:3], dtype=float)
        earth_vel = np.array(earth_velocity_xyz_au_per_day[:3], dtype=float)
    except (TypeError, ValueError, IndexError):
        return None

    geocentric_position_ecl = target_pos - earth_pos
    geocentric_velocity_ecl = target_vel - earth_vel
    geocentric_position_eq = _ecliptic_to_equatorial(geocentric_position_ecl)
    geocentric_velocity_eq_km_s = _velocity_au_per_day_to_km_per_s(
        _ecliptic_to_equatorial(geocentric_velocity_ecl)
    )

    range_km = float(np.linalg.norm(geocentric_position_eq * AU_IN_KM))
    if range_km <= 0.0:
        return None

    line_of_sight_unit = geocentric_position_eq / np.linalg.norm(geocentric_position_eq)
    target_radial_velocity_km_s = float(np.dot(line_of_sight_unit, geocentric_velocity_eq_km_s))

    include_observer_rotation = (
        observer_lat_deg is not None and observer_lon_deg is not None and epoch is not None
    )
    if not include_observer_rotation:
        return target_radial_velocity_km_s
    if epoch is None:
        return target_radial_velocity_km_s

    try:
        observer_velocity_km_s = calculate_observer_velocity_due_to_earth_rotation(
            observer_lat_deg=observer_lat_deg,
            observer_lon_deg=observer_lon_deg,
            observer_elevation_m=observer_elevation_m,
            epoch=epoch,
        )
        observer_radial_velocity_km_s = float(np.dot(line_of_sight_unit, observer_velocity_km_s))
    except (TypeError, ValueError):
        observer_radial_velocity_km_s = 0.0

    return target_radial_velocity_km_s - observer_radial_velocity_km_s


def calculate_doppler_shift(
    tle_line1,
    tle_line2,
    observer_lat,
    observer_lon,
    observer_elevation,
    transmitted_freq_hz,
    time=None,
):
    """
    Calculate the Doppler shift for a satellite at a given time.

    Parameters:
    -----------
    tle_line1, tle_line2 : str
        The two-line element set for the satellite
    observer_lat, observer_lon : float
        Observer's latitude and longitude in degrees
    observer_elevation : float
        Observer's elevation in meters
    transmitted_freq_mhz : float
        Transmitted frequency in MHz
    time : skyfield.timelib.Time, optional
        Time of observation, defaults to current time

    Returns:
    --------
    observed_freq_mhz : float
        The Doppler-shifted frequency in MHz
    doppler_shift_hz : float
        The Doppler shift in Hz
    """
    # Load the timescale
    ts = load.timescale()

    # Set the time (now if not specified)
    if time is None:
        time = ts.now()

    # Create satellite object from TLEs
    satellite = EarthSatellite(tle_line1, tle_line2, name="Satellite", ts=ts)

    # Define the ground station
    topos = Topos(
        latitude_degrees=observer_lat,
        longitude_degrees=observer_lon,
        elevation_m=observer_elevation,
    )

    # Get the difference directly using the observation from the topos
    difference = satellite - topos

    # Calculate position at the specified time
    topocentric = difference.at(time)

    # Get the range rate (radial velocity) in km/s
    # The radial_velocity needs to be accessed from the velocity property
    # First, get the position and velocity vectors
    pos, vel = topocentric.position.km, topocentric.velocity.km_per_s

    # Calculate the radial velocity (component of velocity along the line of sight)
    # This is done by taking the dot product of the unit position vector and velocity vector
    pos_unit = pos / np.sqrt(np.sum(pos**2))  # Normalize position to get unit vector
    range_rate = np.dot(pos_unit, vel)  # Dot product gives radial component

    # Speed of light in km/s
    c = 299792.458  # speed of light in km/s

    # Calculate Doppler shift
    doppler_factor = 1.0 - (range_rate / c)

    # Calculate observed frequency
    observed_freq_hz = transmitted_freq_hz * doppler_factor

    # Calculate the shift in Hz
    doppler_shift_hz = observed_freq_hz - transmitted_freq_hz

    return round(float(observed_freq_hz), 0), round(float(doppler_shift_hz), 0)
