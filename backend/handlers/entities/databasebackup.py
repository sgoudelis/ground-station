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

import asyncio
import html
import json
import re
from datetime import datetime
from typing import Any, Dict, List

from sqlalchemy import text

from db import AsyncSessionLocal
from db.models import Base


def _split_sql_statements(sql_content: str) -> List[str]:
    """Split SQL content into statements while respecting quoted string literals."""
    statements: List[str] = []
    current: List[str] = []
    in_single_quote = False
    i = 0

    while i < len(sql_content):
        char = sql_content[i]

        if char == "'":
            # SQLite escapes single quotes in strings using doubled single quotes ('')
            if in_single_quote and i + 1 < len(sql_content) and sql_content[i + 1] == "'":
                current.append("''")
                i += 2
                continue

            in_single_quote = not in_single_quote
            current.append(char)
            i += 1
            continue

        if char == ";" and not in_single_quote:
            statement = "".join(current).strip()
            if statement:
                statements.append(statement)
            current = []
            i += 1
            continue

        current.append(char)
        i += 1

    trailing = "".join(current).strip()
    if trailing:
        statements.append(trailing)

    return statements


def _parse_full_restore_sql(sql: str) -> Dict[str, Any]:
    """
    Parse a full-backup SQL payload into statement groups used by restore logic.

    This function is intentionally synchronous so it can run via asyncio.to_thread()
    and keep the main event loop responsive during large restore uploads.
    """
    # Decode HTML entities in the SQL content first.
    sql = html.unescape(sql)

    # Parse SQL into lines and remove comments/empty lines.
    lines = []
    for line in sql.split("\n"):
        stripped = line.strip()
        # Keep the line if it's not empty and not a comment.
        if stripped and not stripped.startswith("--"):
            lines.append(line)

    # Join multi-line statements.
    sql_content = "\n".join(lines)

    # Split statements safely to keep semicolons inside quoted text values.
    statements = _split_sql_statements(sql_content)

    # Separate CREATE (table/index) and INSERT statements.
    create_statements: List[str] = []
    index_statements: List[str] = []
    insert_statements: List[str] = []
    alembic_create = None
    alembic_inserts: List[str] = []

    for stmt in statements:
        stmt_upper = stmt.upper().strip()
        if stmt_upper.startswith("CREATE TABLE"):
            # Separate alembic_version CREATE statement.
            if "ALEMBIC_VERSION" in stmt_upper:
                alembic_create = stmt
            else:
                create_statements.append(stmt)
        elif stmt_upper.startswith("CREATE INDEX") or stmt_upper.startswith("CREATE UNIQUE INDEX"):
            # Keep index DDL so restored databases preserve lookup/uniqueness constraints.
            index_statements.append(stmt)
        elif stmt_upper.startswith("INSERT INTO"):
            # Separate alembic_version INSERT statements.
            if "ALEMBIC_VERSION" in stmt_upper:
                alembic_inserts.append(stmt)
            else:
                insert_statements.append(stmt)
        # Skip any other statements (like malformed content).

    if not create_statements and not alembic_create:
        raise ValueError("No CREATE TABLE statements found in backup file")

    # Validate that we only have safe statements.
    # Only process CREATE TABLE/INDEX and INSERT INTO statements, ignore others.
    valid_statements = (
        create_statements
        + index_statements
        + insert_statements
        + ([alembic_create] if alembic_create else [])
        + alembic_inserts
    )
    if len(valid_statements) == 0:
        raise ValueError(
            "No valid CREATE TABLE/INDEX or INSERT INTO statements found in backup file"
        )

    return {
        "create_statements": create_statements,
        "index_statements": index_statements,
        "insert_statements": insert_statements,
        "alembic_create": alembic_create,
        "alembic_inserts": alembic_inserts,
    }


def _normalize_optional_json(value):
    if value in {None, "", "-"}:
        return None

    parsed = value
    for _ in range(4):
        if isinstance(parsed, (dict, list, bool, int, float)) or parsed is None:
            return parsed
        if not isinstance(parsed, str):
            return None

        candidate = parsed.strip()
        if candidate.lower() in {"", "-", "null", "none"}:
            return None

        try:
            parsed = json.loads(candidate)
            continue
        except json.JSONDecodeError:
            if candidate.startswith('"') and candidate.endswith('"'):
                parsed = candidate[1:-1].replace('\\"', '"')
                continue
            if '\\"' in candidate:
                parsed = candidate.replace('\\"', '"')
                continue
            return None

    return None


async def _normalize_transmitters_itu_notification(session) -> int:
    table_exists = await session.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name='transmitters'")
    )
    if table_exists.scalar_one_or_none() is None:
        return 0

    invalid_rows = await session.execute(
        text(
            """
            SELECT id, itu_notification
            FROM transmitters
            WHERE itu_notification IS NOT NULL
              AND json_valid(CAST(itu_notification AS TEXT)) = 0
            """
        )
    )

    fixed_count = 0
    for row in invalid_rows.fetchall():
        normalized = _normalize_optional_json(row.itu_notification)
        await session.execute(
            text("UPDATE transmitters SET itu_notification = :val WHERE id = :id"),
            {"id": row.id, "val": json.dumps(normalized) if normalized is not None else None},
        )
        fixed_count += 1

    return fixed_count


async def list_tables() -> Dict[str, Any]:
    """List all database tables with their row counts."""
    try:
        async with AsyncSessionLocal() as session:
            # Get all table names from the Base metadata
            table_names = [table.name for table in Base.metadata.sorted_tables]

            tables = []
            for table_name in table_names:
                # Get row count for each table
                result = await session.execute(text(f"SELECT COUNT(*) FROM {table_name}"))
                row_count = result.scalar()
                tables.append({"name": table_name, "row_count": row_count})

            return {"success": True, "tables": tables}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def backup_table(table_name: str) -> Dict[str, Any]:
    """Generate SQL INSERT statements for a specific table."""
    try:
        # Validate table name to prevent SQL injection
        if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", table_name):
            return {"success": False, "error": "Invalid table name"}

        # Check if table exists in our models (alembic_version is a special case)
        table_names = [table.name for table in Base.metadata.sorted_tables]
        if table_name not in table_names and table_name != "alembic_version":
            return {"success": False, "error": f"Table {table_name} not found"}

        async with AsyncSessionLocal() as session:
            # Get column names using PRAGMA for SQLite (works with async)
            result = await session.execute(text(f"PRAGMA table_info({table_name})"))
            pragma_result = result.fetchall()
            column_names = [row[1] for row in pragma_result]  # Column name is at index 1

            # Fetch all rows
            result = await session.execute(text(f"SELECT * FROM {table_name}"))
            rows = result.fetchall()

            # Generate SQL INSERT statements
            sql_statements = []
            sql_statements.append(f"-- Backup of table {table_name}")
            sql_statements.append(f"-- Generated at: {datetime.now()}")
            sql_statements.append(f"-- Total rows: {len(rows)}\n")

            for row in rows:
                # Convert row to dictionary
                row_dict = dict(zip(column_names, row))

                # Build INSERT statement
                columns_str = ", ".join(column_names)
                values = []
                for col_name in column_names:
                    value = row_dict[col_name]
                    if value is None:
                        values.append("NULL")
                    elif isinstance(value, str):
                        # Escape single quotes and handle special characters
                        escaped_value = value.replace("'", "''")
                        values.append(f"'{escaped_value}'")
                    elif isinstance(value, (int, float)):
                        values.append(str(value))
                    elif isinstance(value, bool):
                        values.append(str(int(value)))
                    else:
                        # For other types, convert to string
                        escaped_value = str(value).replace("'", "''")
                        values.append(f"'{escaped_value}'")

                values_str = ", ".join(values)
                sql_statements.append(
                    f"INSERT INTO {table_name} ({columns_str}) VALUES ({values_str});"
                )

            sql = "\n".join(sql_statements)
            return {"success": True, "sql": sql, "row_count": len(rows)}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def restore_table(table_name: str, sql: str, delete_first: bool = True) -> Dict[str, Any]:
    """Restore table from SQL INSERT statements."""
    try:
        # Validate table name
        if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", table_name):
            return {"success": False, "error": "Invalid table name"}

        # Check if table exists
        table_names = [table.name for table in Base.metadata.sorted_tables]
        if table_name not in table_names:
            return {"success": False, "error": f"Table {table_name} not found"}

        # Validate SQL contains only INSERT statements (security check)
        # Remove comments and empty lines
        sql_lines = [
            line.strip()
            for line in sql.split("\n")
            if line.strip() and not line.strip().startswith("--")
        ]

        # Check that all statements are INSERT statements for the correct table
        for line in sql_lines:
            if not re.match(
                rf"^INSERT\s+INTO\s+{table_name}\s+\(.*\)\s+VALUES\s+\(.*\);$", line, re.IGNORECASE
            ):
                return {
                    "success": False,
                    "error": f"Invalid SQL statement detected. Only INSERT statements for {table_name} are allowed.",
                }

        async with AsyncSessionLocal() as session:
            try:
                # Delete all rows if requested
                if delete_first:
                    await session.execute(text(f"DELETE FROM {table_name}"))

                # Execute INSERT statements
                rows_inserted = 0
                for line in sql_lines:
                    await (await session.connection()).exec_driver_sql(line)
                    rows_inserted += 1

                await session.commit()
                return {"success": True, "rows_inserted": rows_inserted}
            except Exception as e:
                await session.rollback()
                raise e

    except Exception as e:
        return {"success": False, "error": str(e)}


async def full_backup() -> Dict[str, Any]:
    """Generate a full database backup including schema and all data."""
    try:
        sql_statements = []
        sql_statements.append("-- Full Database Backup")
        sql_statements.append(f"-- Generated at: {datetime.now()}")
        sql_statements.append("")

        # Get CREATE TABLE statements
        sql_statements.append("-- ========================================")
        sql_statements.append("-- DATABASE SCHEMA")
        sql_statements.append("-- ========================================")
        sql_statements.append("")

        async with AsyncSessionLocal() as session:
            # For SQLite, we can get schema from sqlite_master
            result = await session.execute(
                text(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                )
            )
            schemas = result.fetchall()

            for schema in schemas:
                if schema[0]:
                    sql_statements.append(schema[0] + ";")
                    sql_statements.append("")

            # Include explicit CREATE INDEX statements. SQLite stores most indexes
            # outside CREATE TABLE SQL and omitting them can break ON CONFLICT upserts
            # after restore when uniqueness constraints are index-backed.
            index_result = await session.execute(
                text(
                    """
                    SELECT sql
                    FROM sqlite_master
                    WHERE type='index'
                      AND name NOT LIKE 'sqlite_%'
                      AND tbl_name NOT LIKE 'sqlite_%'
                      AND sql IS NOT NULL
                    ORDER BY name
                    """
                )
            )
            index_schemas = index_result.fetchall()
            if index_schemas:
                sql_statements.append("-- ========================================")
                sql_statements.append("-- DATABASE INDEXES")
                sql_statements.append("-- ========================================")
                sql_statements.append("")
                for schema in index_schemas:
                    if schema[0]:
                        sql_statements.append(schema[0] + ";")
                        sql_statements.append("")

            sql_statements.append("-- ========================================")
            sql_statements.append("-- TABLE DATA")
            sql_statements.append("-- ========================================")
            sql_statements.append("")

        # Get all table names in the correct order (respecting foreign keys)
        table_names = [table.name for table in Base.metadata.sorted_tables]

        # Also include alembic_version table (not in Base.metadata but essential for migrations)
        if "alembic_version" not in table_names:
            table_names.append("alembic_version")

        # Backup each table
        for table_name in table_names:
            result = await backup_table(table_name)
            if result["success"]:
                sql_statements.append(f"\n-- Table: {table_name} ({result['row_count']} rows)")
                sql_statements.append(result["sql"])
                sql_statements.append("")
            else:
                sql_statements.append(
                    f"\n-- Error backing up table {table_name}: {result['error']}"
                )

        sql = "\n".join(sql_statements)
        return {"success": True, "sql": sql}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def full_restore(sql: str, drop_tables: bool = True) -> Dict[str, Any]:
    """
    Restore full database from SQL backup file.

    Args:
        sql: Full SQL backup content (schema + data)
        drop_tables: Whether to drop existing tables before restore (default: True)

    Returns:
        Dict with success status and statistics
    """
    try:
        # Parse the uploaded SQL off the main event loop so large restores do not
        # starve Socket.IO heartbeats and drop the client connection mid-restore.
        parsed_restore = await asyncio.to_thread(_parse_full_restore_sql, sql)
        create_statements = parsed_restore["create_statements"]
        index_statements = parsed_restore["index_statements"]
        insert_statements = parsed_restore["insert_statements"]
        alembic_create = parsed_restore["alembic_create"]
        alembic_inserts = parsed_restore["alembic_inserts"]

        async with AsyncSessionLocal() as session:
            try:
                # Disable foreign key constraints temporarily for SQLite
                await session.execute(text("PRAGMA foreign_keys = OFF"))

                # Drop existing tables if requested
                if drop_tables:
                    # Get all existing table names from database (including alembic_version)
                    result = await session.execute(
                        text(
                            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                        )
                    )
                    existing_tables = [row[0] for row in result.fetchall()]

                    # Drop all existing tables in reverse order
                    for table_name in reversed(existing_tables):
                        try:
                            await session.execute(text(f"DROP TABLE IF EXISTS {table_name}"))
                        except Exception:
                            # Continue even if drop fails
                            pass

                    # Commit the drops before creating new tables
                    await session.commit()

                # Execute CREATE TABLE statements (excluding alembic_version)
                tables_created = 0
                for stmt in create_statements:
                    await (await session.connection()).exec_driver_sql(stmt)
                    tables_created += 1

                # Commit after creating tables
                await session.commit()

                # Execute INSERT statements (excluding alembic_version)
                rows_inserted = 0
                for stmt in insert_statements:
                    await (await session.connection()).exec_driver_sql(stmt)
                    rows_inserted += 1

                # Commit data inserts before handling alembic_version
                await session.commit()

                # Now handle alembic_version table LAST to ensure it's created only if everything else succeeded
                if alembic_create:
                    await (await session.connection()).exec_driver_sql(alembic_create)
                    tables_created += 1
                    await session.commit()

                # Insert alembic_version data LAST
                for stmt in alembic_inserts:
                    await (await session.connection()).exec_driver_sql(stmt)
                    rows_inserted += 1

                # Recreate indexes after data import for faster restore and to ensure
                # unique lookup constraints required by ON CONFLICT upserts.
                indexes_created = 0
                for stmt in index_statements:
                    await (await session.connection()).exec_driver_sql(stmt)
                    indexes_created += 1

                # Normalize malformed legacy JSON payloads that can break ORM deserialization.
                normalized_rows = await _normalize_transmitters_itu_notification(session)

                # Re-enable foreign key constraints
                await session.execute(text("PRAGMA foreign_keys = ON"))

                # Final commit with alembic_version
                await session.commit()

                return {
                    "success": True,
                    "tables_created": tables_created,
                    "indexes_created": indexes_created,
                    "rows_inserted": rows_inserted,
                    "rows_normalized": normalized_rows,
                }

            except Exception as e:
                # Rollback on any error
                await session.rollback()
                # Re-enable foreign keys even on error
                try:
                    await session.execute(text("PRAGMA foreign_keys = ON"))
                    await session.commit()
                except Exception:
                    pass
                raise e

    except Exception as e:
        return {"success": False, "error": str(e)}


def register_handlers(registry):
    """Register database backup handlers."""
    # Database backup handlers don't use the standard registry pattern
    # They are handled directly in socket.py via database_backup event
    pass
