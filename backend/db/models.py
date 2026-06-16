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


import json
import uuid
from datetime import datetime, timezone
from enum import Enum as PyEnum

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    TypeDecorator,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import DeclarativeMeta

# Creates a base class for declarative models using SQLAlchemy.
Base: DeclarativeMeta = declarative_base()

# Creates a MetaData object that holds schema-level information such as tables, columns, and constraints.
metadata = MetaData()


class AwareDateTime(TypeDecorator):
    """
    A type that ensures timezone-aware datetimes by
    attaching UTC if the datetime is naive.
    """

    impl = DateTime(timezone=False)  # or True, but SQLite doesn't honor tz anyway
    cache_ok = False

    def process_result_value(self, value, dialect):
        """
        When reading from DB, if it's naive, attach UTC.
        """
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    def process_bind_param(self, value, dialect):
        """
        (Optional) When writing to DB, you can also
        enforce that all datetimes are stored in UTC.
        """
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value


class JsonField(TypeDecorator):
    """
    A type for handling JSON data by serializing/deserializing
    it during storage and retrieval.
    """

    impl = JSON
    cache_ok = True

    def process_result_value(self, value, dialect):
        """
        When reading from DB, deserialize JSON string to Python object.
        """
        # Some dialects/DB drivers already return JSON columns as Python
        # objects (dict/list). Only decode when we receive a JSON string.
        if isinstance(value, (str, bytes, bytearray)):
            return json.loads(value)
        return value

    def process_bind_param(self, value, dialect):
        """
        When writing to DB, serialize Python object to JSON string.
        """
        if value is not None:
            return json.dumps(value)
        return value


class CameraType(str, PyEnum):
    WEBRTC = "webrtc"
    HLS = "hls"
    MJPEG = "mjpeg"


class SatelliteGroupType(str, PyEnum):
    USER = "user"
    SYSTEM = "system"


class SDRType(str, PyEnum):
    RTLSDRUSBV3 = "rtlsdrusbv3"
    RTLSDRTCPV3 = "rtlsdrtcpv3"
    RTLSDRUSBV4 = "rtlsdrusbv4"
    RTLSDRTCPV4 = "rtlsdrtcpv4"
    SOAPYSDRLOCAL = "soapysdrlocal"
    SOAPYSDRREMOTE = "soapysdrremote"
    UHD = "uhd"
    SIGMFPLAYBACK = "sigmfplayback"


class UserRole(str, PyEnum):
    ADMIN = "admin"
    OPERATOR = "operator"


class PreferenceScope(str, PyEnum):
    USER = "user"
    SYSTEM = "system"
    BOOTSTRAP = "bootstrap"


class Satellites(Base):
    __tablename__ = "satellites"
    norad_id = Column(Integer, primary_key=True, nullable=False, unique=True)
    name = Column(String, nullable=False)
    source = Column(String, nullable=False, default="manual", server_default="manual")
    name_other = Column(String, nullable=True)
    alternative_name = Column(String, nullable=True)
    image = Column(String, nullable=True)
    sat_id = Column(String, nullable=True)
    tle1 = Column(String, nullable=False)
    tle2 = Column(String, nullable=False)
    status = Column(String, nullable=True)
    decayed = Column(AwareDateTime, nullable=True)
    launched = Column(AwareDateTime, nullable=True)
    deployed = Column(AwareDateTime, nullable=True)
    website = Column(String, nullable=True)
    operator = Column(String, nullable=True)
    countries = Column(String, nullable=True)
    citation = Column(String, nullable=True)
    is_frequency_violator = Column(Boolean, nullable=True, default=False)
    associated_satellites = Column(String, nullable=True)
    added = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated = Column(
        AwareDateTime,
        nullable=True,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )


class SatelliteOrbits(Base):
    __tablename__ = "satellite_orbits"

    satellite_norad_id = Column(
        Integer,
        ForeignKey("satellites.norad_id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    central_body = Column(
        String, primary_key=True, nullable=False, default="earth", server_default="earth"
    )
    model_kind = Column(String, nullable=False, default="tle", server_default="tle", index=True)
    epoch = Column(AwareDateTime, nullable=True)
    tle1 = Column(String, nullable=True)
    tle2 = Column(String, nullable=True)
    omm_payload = Column(JSON, nullable=True)
    source_id = Column(
        UUID(as_uuid=True), ForeignKey("orbital_sources.id"), nullable=True, index=True
    )
    source_object_id = Column(String, nullable=True)
    source_updated_at = Column(AwareDateTime, nullable=True)
    added = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated = Column(
        AwareDateTime,
        nullable=False,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint(
            "central_body IN ('earth', 'moon', 'mars')",
            name="ck_satellite_orbits_central_body",
        ),
        CheckConstraint(
            "model_kind IN ('tle', 'omm')",
            name="ck_satellite_orbits_model_kind",
        ),
        CheckConstraint(
            "(model_kind != 'tle') OR (tle1 IS NOT NULL AND tle2 IS NOT NULL)",
            name="ck_satellite_orbits_tle_required_for_tle_model",
        ),
        CheckConstraint(
            "(model_kind != 'omm') OR (omm_payload IS NOT NULL)",
            name="ck_satellite_orbits_omm_payload_required_for_omm_model",
        ),
    )


class Transmitters(Base):
    __tablename__ = "transmitters"
    id = Column(String, nullable=False, primary_key=True, unique=True)
    description = Column(String, nullable=True)
    alive = Column(Boolean, nullable=True)
    type = Column(String, nullable=True)
    uplink_low = Column(Integer, nullable=True)
    uplink_high = Column(Integer, nullable=True)
    uplink_drift = Column(Integer, nullable=True)
    downlink_low = Column(Integer, nullable=True)
    downlink_high = Column(Integer, nullable=True)
    downlink_drift = Column(Integer, nullable=True)
    mode = Column(String, nullable=True)
    mode_id = Column(Integer, nullable=True)
    uplink_mode = Column(String, nullable=True)
    invert = Column(Boolean, nullable=True)
    baud = Column(Integer, nullable=True)
    sat_id = Column(String, nullable=True)
    norad_cat_id = Column(Integer, ForeignKey("satellites.norad_id"), nullable=False)
    norad_follow_id = Column(Integer, nullable=True)
    status = Column(String, nullable=False)
    citation = Column(String, nullable=True)
    service = Column(String, nullable=True)
    source = Column(String, nullable=True)
    iaru_coordination = Column(String, nullable=True)
    iaru_coordination_url = Column(String, nullable=True)
    itu_notification = Column(JSON, nullable=True)
    frequency_violation = Column(Boolean, nullable=True, default=False)
    unconfirmed = Column(Boolean, nullable=True, default=False)
    added = Column(AwareDateTime, nullable=True, default=datetime.now(timezone.utc))
    updated = Column(
        AwareDateTime,
        nullable=True,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )


class Rigs(Base):
    __tablename__ = "rigs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    name = Column(String, nullable=False)
    host = Column(String, nullable=False)
    port = Column(Integer, nullable=False)
    radiotype = Column(String, nullable=False)
    radio_mode = Column(String, nullable=False, default="duplex", server_default="duplex")
    vfotype = Column(Integer, nullable=False)
    tx_control_mode = Column(String, nullable=False, default="auto", server_default="auto")
    retune_interval_ms = Column(Integer, nullable=False, default=2000, server_default="2000")
    follow_downlink_tuning = Column(Boolean, nullable=False, default=False, server_default="0")
    added = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated = Column(
        AwareDateTime,
        nullable=False,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )


class SDRs(Base):
    __tablename__ = "sdrs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    name = Column(String, nullable=False)
    serial = Column(String, nullable=True)
    host = Column(String, nullable=True)
    port = Column(Integer, nullable=True)
    type = Column(Enum(SDRType), nullable=True)
    driver = Column(String, nullable=True)
    frequency_min = Column(Integer, nullable=True)
    frequency_max = Column(Integer, nullable=True)
    added = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated = Column(
        AwareDateTime,
        nullable=False,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )


class Rotators(Base):
    __tablename__ = "rotators"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    name = Column(String, nullable=False)
    host = Column(String, nullable=False)
    port = Column(Integer, nullable=False)
    minaz = Column(Integer, nullable=False)
    maxaz = Column(Integer, nullable=False)
    azimuth_mode = Column(String, nullable=False, default="0_360")
    minel = Column(Integer, nullable=False)
    maxel = Column(Integer, nullable=False)
    parkaz = Column(Float, nullable=True)
    parkel = Column(Float, nullable=True)
    aztolerance = Column(Float, nullable=False, default=2.0)
    eltolerance = Column(Float, nullable=False, default=2.0)
    added = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated = Column(
        AwareDateTime,
        nullable=False,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )


class Locations(Base):
    __tablename__ = "locations"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    name = Column(String, nullable=False)
    callsign = Column(String, nullable=True)
    station_type = Column(String, nullable=False, default="stationary", server_default="stationary")
    horizon_mask = Column(Float, nullable=False, default=0.0, server_default="0")
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    alt = Column(Integer, nullable=False)
    added = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated = Column(
        AwareDateTime,
        nullable=True,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )


class Preferences(Base):
    __tablename__ = "preferences"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    scope = Column(
        String,
        nullable=False,
        default=PreferenceScope.BOOTSTRAP.value,
        server_default=PreferenceScope.BOOTSTRAP.value,
    )
    name = Column(String, nullable=False)
    value = Column(String, nullable=False)
    added = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated = Column(
        AwareDateTime,
        nullable=True,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint(
            "scope IN ('user', 'system', 'bootstrap')",
            name="ck_preferences_scope",
        ),
        CheckConstraint(
            "(scope = 'user' AND user_id IS NOT NULL) OR "
            "(scope IN ('system', 'bootstrap') AND user_id IS NULL)",
            name="ck_preferences_scope_user_id",
        ),
        # User scoped keys are unique per user account.
        Index(
            "uq_preferences_user_name",
            "user_id",
            "name",
            unique=True,
            sqlite_where=text("scope = 'user'"),
            postgresql_where=text("scope = 'user'"),
        ),
        # System scoped keys are global singletons.
        Index(
            "uq_preferences_system_name",
            "name",
            unique=True,
            sqlite_where=text("scope = 'system'"),
            postgresql_where=text("scope = 'system'"),
        ),
        # Bootstrap keys exist only before first admin setup and are key-unique.
        Index(
            "uq_preferences_bootstrap_name",
            "name",
            unique=True,
            sqlite_where=text("scope = 'bootstrap'"),
            postgresql_where=text("scope = 'bootstrap'"),
        ),
    )


class OrbitalSources(Base):
    __tablename__ = "orbital_sources"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    name = Column(String, nullable=False)
    identifier = Column(String, nullable=False)
    url = Column(String, nullable=False)
    format = Column(String, nullable=False, default="3le")
    group_id = Column(UUID(as_uuid=True), ForeignKey("groups.id"), nullable=True, index=True)
    norad_ids = Column(JSON, nullable=True)
    query_mode = Column(String, nullable=False, default="url", server_default="url")
    provider = Column(String, nullable=False, default="generic_http", server_default="generic_http")
    adapter = Column(String, nullable=False, default="http_3le", server_default="http_3le")
    enabled = Column(Boolean, nullable=False, default=True, server_default="1")
    priority = Column(Integer, nullable=False, default=100, server_default="100")
    central_body = Column(String, nullable=False, default="earth", server_default="earth")
    auth_type = Column(String, nullable=False, default="none", server_default="none")
    username = Column(String, nullable=True)
    password = Column(String, nullable=True)
    config = Column(JSON, nullable=True)
    added = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated = Column(
        AwareDateTime,
        nullable=False,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint(
            "central_body IN ('earth', 'moon', 'mars')",
            name="ck_orbital_sources_central_body",
        ),
        CheckConstraint(
            "auth_type IN ('none', 'basic', 'token')",
            name="ck_orbital_sources_auth_type",
        ),
        CheckConstraint(
            "query_mode IN ('url', 'group_norad')",
            name="ck_orbital_sources_query_mode",
        ),
    )


# Backward compatibility alias for older imports.
TLESources = OrbitalSources


class Groups(Base):
    __tablename__ = "groups"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    name = Column(String, nullable=False)
    identifier = Column(String, nullable=True)
    type = Column(Enum(SatelliteGroupType), nullable=False, default=SatelliteGroupType.USER)
    satellite_ids = Column(JsonField, nullable=True)
    added = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated = Column(
        AwareDateTime,
        nullable=False,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )


class TrackingState(Base):
    __tablename__ = "tracking_state"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    name = Column(String, index=True, unique=True)
    value = Column(JSON, index=True)
    added = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated = Column(
        AwareDateTime,
        nullable=True,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )


class Cameras(Base):
    __tablename__ = "cameras"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    name = Column(String, nullable=False)
    url = Column(String, nullable=True)
    type = Column(Enum(CameraType), nullable=False)
    status = Column(Enum("active", "inactive"), nullable=False, default="active")
    added = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated = Column(
        AwareDateTime,
        nullable=False,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )


class MonitoredCelestial(Base):
    """User-managed list of Horizons targets to track in the celestial page."""

    __tablename__ = "monitored_celestial"

    id = Column(String, primary_key=True, nullable=False)
    display_name = Column(String, nullable=False)
    target_type = Column(
        String, nullable=False, default="mission", server_default="mission", index=True
    )
    command = Column(String, nullable=True, index=True)
    body_id = Column(String, nullable=True, index=True)
    color = Column(String, nullable=True)
    enabled = Column(Boolean, nullable=False, default=True, index=True)
    last_refresh_at = Column(AwareDateTime, nullable=True)
    last_error = Column(String, nullable=True)
    created_at = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated_at = Column(
        AwareDateTime,
        nullable=False,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )


class CelestialTargets(Base):
    """Normalized celestial targets for missions and solar-system bodies."""

    __tablename__ = "celestial_targets"

    id = Column(String, primary_key=True, nullable=False)
    target_type = Column(String, nullable=False, index=True)  # mission | body
    body_class = Column(String, nullable=True, index=True)  # star | planet | moon
    display_name = Column(String, nullable=False)
    horizons_command = Column(String, nullable=True, index=True)
    body_id = Column(String, nullable=True, index=True)
    parent_body_id = Column(String, nullable=True, index=True)
    always_in_scene = Column(Boolean, nullable=False, default=False, index=True)
    enabled = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated_at = Column(
        AwareDateTime,
        nullable=False,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )


class CelestialVectorSnapshots(Base):
    """Horizons vectors snapshots keyed by target and projection window."""

    __tablename__ = "celestial_vector_snapshots"

    id = Column(String, primary_key=True, nullable=False)
    target_id = Column(String, ForeignKey("celestial_targets.id"), nullable=False, index=True)
    epoch_bucket_utc = Column(AwareDateTime, nullable=False, index=True)
    past_hours = Column(Integer, nullable=False)
    future_hours = Column(Integer, nullable=False)
    step_minutes = Column(Integer, nullable=False)
    frame = Column(
        String,
        nullable=False,
        default="heliocentric-ecliptic",
        server_default="heliocentric-ecliptic",
    )
    center = Column(String, nullable=False, default="sun", server_default="sun")
    position_xyz_au = Column(JsonField, nullable=False)
    velocity_xyz_au_per_day = Column(JsonField, nullable=False)
    orbit_samples_xyz_au = Column(JsonField, nullable=False)
    orbit_sample_times_utc = Column(JsonField, nullable=False)
    horizons_signature = Column(JsonField, nullable=True)
    source = Column(String, nullable=False, default="horizons", server_default="horizons")
    error = Column(String, nullable=True)
    fetched_at = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    expires_at = Column(AwareDateTime, nullable=False, index=True)
    created_at = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated_at = Column(
        AwareDateTime,
        nullable=False,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )

    __table_args__ = (
        # Keep lookup uniqueness in model metadata so schema bootstrap/restore paths
        # can recreate this constraint when the DB is rebuilt from SQL dumps.
        Index(
            "ix_celestial_vector_snapshots_lookup",
            "target_id",
            "epoch_bucket_utc",
            "past_hours",
            "future_hours",
            "step_minutes",
            "frame",
            "center",
            unique=True,
        ),
    )


class ObservationStatus(str, PyEnum):
    SCHEDULED = "scheduled"
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"
    MISSED = "missed"


class MonitoredSatellites(Base):
    """
    Satellites monitored for automatic observation generation.
    Stores configuration templates used to generate scheduled observations.
    """

    __tablename__ = "monitored_satellites"

    # Identity & Query Keys
    id = Column(String, primary_key=True, nullable=False)
    enabled = Column(Boolean, nullable=False, default=True, index=True)
    norad_id = Column(
        Integer,
        ForeignKey("satellites.norad_id"),
        nullable=False,
        unique=True,
        index=True,
    )

    # Hardware FKs (for referential integrity & "what's using this hardware?")
    sdr_id = Column(UUID(as_uuid=True), ForeignKey("sdrs.id"), nullable=True)
    rotator_id = Column(UUID(as_uuid=True), ForeignKey("rotators.id"), nullable=True)
    rig_id = Column(UUID(as_uuid=True), ForeignKey("rigs.id"), nullable=True)

    # Grouped config as JSON (flexible, maps to frontend structure)
    satellite_config = Column(JSON, nullable=False)  # {"name": "ISS (ZARYA)", "group_id": "..."}
    hardware_config = Column(JSON, nullable=False)  # {"rotator": {...}, "rig": {...}}
    generation_config = Column(JSON, nullable=False)  # {"min_elevation": 20, "lookahead_hours": 24}
    sessions = Column(
        JSON, nullable=False
    )  # [{"sdr": {...}, "tasks": [{"type": "iq_recording", "config": {}}]}]

    # Metadata
    created_at = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated_at = Column(
        AwareDateTime,
        nullable=False,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )


class ScheduledObservations(Base):
    """
    Individual scheduled observations for specific satellite passes.
    Can be created manually or auto-generated from MonitoredSatellites.
    """

    __tablename__ = "scheduled_observations"

    # Identity & Query Keys
    id = Column(String, primary_key=True, nullable=False)
    name = Column(String, nullable=False)
    enabled = Column(Boolean, nullable=False, default=True, index=True)
    status = Column(
        Enum(ObservationStatus),
        nullable=False,
        default=ObservationStatus.SCHEDULED,
        index=True,
    )
    norad_id = Column(Integer, ForeignKey("satellites.norad_id"), nullable=False, index=True)

    # Pass timing (critical for scheduling queries)
    event_start = Column(AwareDateTime, nullable=False, index=True)  # AOS - horizon crossing
    event_end = Column(AwareDateTime, nullable=False)  # LOS - horizon crossing
    task_start = Column(
        AwareDateTime, nullable=True, index=True
    )  # When tasks actually start (at elevation threshold)
    task_end = Column(
        AwareDateTime, nullable=True
    )  # When tasks actually end (usually same as event_end)

    # Hardware FKs
    sdr_id = Column(UUID(as_uuid=True), ForeignKey("sdrs.id"), nullable=True)
    rotator_id = Column(UUID(as_uuid=True), ForeignKey("rotators.id"), nullable=True)
    rig_id = Column(UUID(as_uuid=True), ForeignKey("rigs.id"), nullable=True)

    # Grouped config as JSON
    satellite_config = Column(JSON, nullable=False)  # {"name": "ISS (ZARYA)", "group_id": "..."}
    pass_config = Column(JSON, nullable=False)  # {"peak_altitude": 22.268358}
    hardware_config = Column(
        JSON, nullable=False
    )  # {"rotator": {...}, "rig": {...}, "transmitter": {...}}
    sessions = Column(
        JSON, nullable=False
    )  # [{"sdr": {...}, "tasks": [{"type": "iq_recording", "config": {}}]}]

    # Auto-generation tracking (nullable if manually created)
    monitored_satellite_id = Column(
        String,
        ForeignKey("monitored_satellites.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    generated_at = Column(AwareDateTime, nullable=True)

    # Error tracking
    error_message = Column(String, nullable=True)  # Last error message
    error_count = Column(Integer, nullable=False, default=0)  # Number of errors encountered
    last_error_time = Column(AwareDateTime, nullable=True)  # When last error occurred

    # Execution metadata
    actual_start_time = Column(AwareDateTime, nullable=True)  # When execution actually started
    actual_end_time = Column(AwareDateTime, nullable=True)  # When execution actually ended
    execution_log = Column(JSON, nullable=True)  # Array of timestamped events/errors

    # Metadata
    created_at = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated_at = Column(
        AwareDateTime,
        nullable=False,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )


class Users(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    username = Column(String, nullable=False)
    username_norm = Column(String, nullable=False, unique=True, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(
        String, nullable=False, default=UserRole.OPERATOR.value, server_default="operator"
    )
    is_active = Column(Boolean, nullable=False, default=True, server_default="1")
    last_login_at = Column(AwareDateTime, nullable=True)
    failed_login_count = Column(Integer, nullable=False, default=0, server_default="0")
    locked_until = Column(AwareDateTime, nullable=True)
    created_by_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated_at = Column(
        AwareDateTime,
        nullable=False,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint(
            "role IN ('admin', 'operator')",
            name="ck_users_role",
        ),
    )


class AuthSessions(Base):
    __tablename__ = "auth_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash = Column(String, nullable=False, unique=True, index=True)
    expires_at = Column(AwareDateTime, nullable=False, index=True)
    revoked_at = Column(AwareDateTime, nullable=True, index=True)
    revoke_reason = Column(String, nullable=True)
    last_seen_at = Column(AwareDateTime, nullable=True)
    created_ip = Column(String, nullable=True)
    created_user_agent = Column(String, nullable=True)
    created_at = Column(AwareDateTime, nullable=False, default=datetime.now(timezone.utc))
    updated_at = Column(
        AwareDateTime,
        nullable=False,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )
