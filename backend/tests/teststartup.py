# Copyright (c) 2026 Efstratios Goudelis

from pathlib import Path

import pytest
from fastapi import Request

from server import startup


def _streaming_request(body: bytes) -> Request:
    """Build a minimal ASGI request whose body is delivered as one upload chunk."""
    consumed = False

    async def receive():
        nonlocal consumed
        if consumed:
            return {"type": "http.disconnect"}
        consumed = True
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "http",
            "path": "/api/database/restore",
            "query_string": b"drop_tables=false",
            "headers": [],
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
        },
        receive=receive,
    )


@pytest.mark.asyncio
async def test_database_restore_streams_upload_to_temporary_file(monkeypatch):
    observed = {}

    async def _require_admin(request, **kwargs):
        del request
        observed["auth"] = kwargs
        return {"role": "admin"}

    async def _restore_from_file(sio, sql_path: Path, drop_tables, logger):
        del sio, logger
        observed["path"] = sql_path
        observed["content"] = sql_path.read_text()
        observed["drop_tables"] = drop_tables
        return {"success": True, "tables_created": 1, "rows_inserted": 1}

    monkeypatch.setattr(startup, "_require_request_auth", _require_admin)
    monkeypatch.setattr(startup, "restore_full_backup_file", _restore_from_file)

    response = await startup.restore_database_backup(
        _streaming_request(b"CREATE TABLE example (id INTEGER);")
    )

    assert response["success"] is True
    assert observed["auth"] == {"require_auth": True, "require_admin": True}
    assert observed["content"] == "CREATE TABLE example (id INTEGER);"
    assert observed["drop_tables"] is False
    assert not observed["path"].exists()
