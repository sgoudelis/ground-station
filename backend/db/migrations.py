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


"""Database migration utilities using Alembic."""

import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import create_engine

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory

BACKUP_KEEP_COUNT = 5
BACKUP_SUFFIX = ".bak"
BACKUP_MARKER = ".pre-migration-"


def get_alembic_config() -> Config:
    """Get the Alembic configuration object."""
    # Get the backend directory
    backend_dir = Path(__file__).parent.parent
    alembic_ini = backend_dir / "alembic.ini"

    # Create Alembic config
    alembic_cfg = Config(str(alembic_ini))

    # Set the script location
    alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))

    return alembic_cfg


def _resolve_db_path() -> Path:
    """Resolve the sqlite database path used by migrations."""
    db_path = os.environ.get("GS_DB", "data/db/gs.db")
    path = Path(db_path)
    if path.is_absolute():
        return path

    backend_dir = Path(__file__).parent.parent
    cwd_candidate = (Path.cwd() / path).resolve()
    backend_candidate = (backend_dir / path).resolve()

    if cwd_candidate.exists():
        return cwd_candidate
    if backend_candidate.exists():
        return backend_candidate
    return cwd_candidate


def _has_pending_migrations(alembic_cfg: Config, db_path: Path) -> bool:
    """Return True when the target DB revision is behind migration head."""
    script = ScriptDirectory.from_config(alembic_cfg)
    heads = set(script.get_heads())
    if not heads:
        return False
    if not db_path.exists():
        return True

    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.connect() as connection:
            context = MigrationContext.configure(connection)
            current_revision = context.get_current_revision()
    finally:
        engine.dispose()

    return current_revision not in heads


def _make_backup_path(db_path: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_name = f"{db_path.name}{BACKUP_MARKER}{timestamp}{BACKUP_SUFFIX}"
    return db_path.parent / backup_name


def _rotate_migration_backups(db_path: Path, keep_count: int = BACKUP_KEEP_COUNT) -> None:
    pattern = f"{db_path.name}{BACKUP_MARKER}*{BACKUP_SUFFIX}"
    backups = sorted(
        db_path.parent.glob(pattern), key=lambda candidate: candidate.stat().st_mtime, reverse=True
    )
    for stale in backups[keep_count:]:
        try:
            stale.unlink()
        except FileNotFoundError:
            continue


def _backup_db_before_migration(db_path: Path) -> Path | None:
    if not db_path.exists():
        return None

    backup_path = _make_backup_path(db_path)
    shutil.copy2(db_path, backup_path)
    _rotate_migration_backups(db_path)
    return backup_path


def run_migrations():
    """Run all pending database migrations.

    This function should be called on application startup to ensure
    the database schema is up to date.
    """
    # Preserve the caller's context so later workers keep the same CLI behavior.
    previous_context = os.environ.get("ALEMBIC_CONTEXT")
    os.environ["ALEMBIC_CONTEXT"] = "1"

    try:
        alembic_cfg = get_alembic_config()
        db_path = _resolve_db_path()
        if _has_pending_migrations(alembic_cfg, db_path):
            backup_path = _backup_db_before_migration(db_path)
            if backup_path:
                print(f"Created pre-migration DB backup: {backup_path}", file=sys.stderr)

        # Run migrations to the latest revision
        # Alembic will use the runtime logging configuration from data/configs/log_config.yaml
        # because we skip fileConfig() in alembic/env.py when ALEMBIC_CONTEXT=1
        command.upgrade(alembic_cfg, "head")

        return True
    except Exception as e:
        print(f"Error running migrations: {e}", file=sys.stderr)
        raise
    finally:
        if previous_context is None:
            os.environ.pop("ALEMBIC_CONTEXT", None)
        else:
            os.environ["ALEMBIC_CONTEXT"] = previous_context


def get_current_revision() -> str:
    """Get the current database revision."""
    previous_context = os.environ.get("ALEMBIC_CONTEXT")
    os.environ["ALEMBIC_CONTEXT"] = "1"

    try:
        # Get alembic config (not used yet, but reserved for future implementation)
        _ = get_alembic_config()

        # This would require more complex inspection
        # For now, return a placeholder
        return "current"
    finally:
        if previous_context is None:
            os.environ.pop("ALEMBIC_CONTEXT", None)
        else:
            os.environ["ALEMBIC_CONTEXT"] = previous_context


def create_migration(message: str, autogenerate: bool = True):
    """Create a new migration revision.

    Args:
        message: Description of the migration
        autogenerate: Whether to auto-generate migration from model changes
    """
    previous_context = os.environ.get("ALEMBIC_CONTEXT")
    os.environ["ALEMBIC_CONTEXT"] = "1"

    try:
        alembic_cfg = get_alembic_config()

        if autogenerate:
            command.revision(alembic_cfg, message=message, autogenerate=True)
        else:
            command.revision(alembic_cfg, message=message)

        return True
    finally:
        if previous_context is None:
            os.environ.pop("ALEMBIC_CONTEXT", None)
        else:
            os.environ["ALEMBIC_CONTEXT"] = previous_context
