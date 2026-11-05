"""Interactive API reference and schema routes."""

import json

import httpx
import pytest

from server import schemas
from server.startup import app


@pytest.mark.unit
@pytest.mark.asyncio
async def test_api_docs_theme_and_schema_routes():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        docs = await client.get("/api/docs")
        schema = await client.get("/api/openapi.json")
        redoc = await client.get("/api/redoc")

    assert docs.status_code == 200
    assert 'id="docs-theme-toggle"' in docs.text
    assert 'data-docs-theme="dark"' in docs.text
    assert "ground-station-api-docs-theme" in docs.text
    assert "/api/openapi.json" in docs.text
    assert schema.status_code == 200
    assert "Authorization: Bearer YOUR_TOKEN" in schema.json()["info"]["description"]
    operations = schema.json()["paths"]
    assert set(operations) == {
        "/api/v1/me",
        "/api/v1/station",
        "/api/v1/status",
        "/api/v1/hardware",
        "/api/v1/trackers/rotators",
        "/api/v1/trackers/rigs",
        "/api/v1/events",
        "/api/v1/sdrs",
        "/api/v1/sdrs/{sdr_id}",
        "/api/v1/rotators",
        "/api/v1/rotators/{rotator_id}",
        "/api/v1/rigs",
        "/api/v1/rigs/{rig_id}",
        "/api/v1/observations",
        "/api/v1/observations/upcoming",
        "/api/v1/observations/{observation_id}",
        "/api/v1/satellites",
        "/api/v1/satellites/monitored",
        "/api/v1/satellites/{norad_id}",
        "/api/v1/artifacts",
        "/api/v1/artifacts/{artifact_id}",
        "/api/v1/artifacts/{artifact_id}/download",
        "/api/v1/artifacts/{artifact_id}/files/{file_path}",
    }
    for methods in operations.values():
        for operation in methods.values():
            assert operation["summary"]
            assert operation["description"]
            assert {"HTTPBearer": []} in operation["security"]

    json_routes = schemas.JSON_ROUTE_EXAMPLES
    assert set(json_routes) == set(operations) - {
        "/api/v1/events",
        "/api/v1/artifacts/{artifact_id}/download",
        "/api/v1/artifacts/{artifact_id}/files/{file_path}",
    }
    for path, name in json_routes.items():
        content = operations[path]["get"]["responses"]["200"]["content"]["application/json"]
        assert content["schema"]["properties"]
        assert content["example"] == schemas.JSON_EXAMPLES[name]
        schemas.JSON_MODELS[name].model_validate(content["example"])
        assert "401" in operations[path]["get"]["responses"]
        if name == "me":
            assert "403" not in operations[path]["get"]["responses"]
        else:
            assert (
                operations[path]["get"]["responses"]["403"]["content"]["application/json"][
                    "example"
                ]["detail"]
                == f"Scope {schemas.JSON_SCOPES[name]} required."
            )

    stream = operations["/api/v1/events"]["get"]
    assert "curl -N" in stream["description"]
    assert "text/event-stream" in stream["responses"]["200"]["content"]
    stream_response = stream["responses"]["200"]
    event_names = {event["event"] for event in stream_response["x-sse-events"]}
    assert event_names == {
        "connected",
        "station.status",
        "observations.changed",
        "target.changed",
        "target.slot.created",
        "target.slot.deleted",
        "target.visible",
        "target.below_horizon",
        "tracker.hardware.changed",
        "tracker.rotator.state.changed",
        "tracker.rig.state.changed",
        "artifact.ready",
        "sdr.streaming.started",
        "sdr.streaming.stopped",
    }
    stream_examples = stream_response["content"]["text/event-stream"]["examples"]
    for event_name in event_names - {"connected"}:
        assert stream_examples[event_name]["value"].startswith(f"event: {event_name}\ndata: ")
        assert stream_examples[event_name]["value"].endswith("\n\n")
    for name, _scope, model, sample, _description in schemas._SSE_EVENTS:
        model.model_validate(sample)
        if name != "connected":
            frame_data = stream_examples[name]["value"].split("data: ", 1)[1].strip()
            assert json.loads(frame_data) == sample
    assert stream_examples["connection"]["value"].startswith("retry: 3000\n\n")
    assert stream_examples["heartbeat"]["value"] == ": keepalive\n\n"
    assert all(event["payload_schema"]["properties"] for event in stream_response["x-sse-events"])

    for path in (
        "/api/v1/artifacts/{artifact_id}/download",
        "/api/v1/artifacts/{artifact_id}/files/{file_path}",
    ):
        response = operations[path]["get"]["responses"]
        assert any(
            media["schema"].get("format") == "binary"
            for media in response["200"]["content"].values()
        )
        assert "206" in response
        assert "401" in response and "403" in response and "404" in response
        assert any(
            parameter["name"] == "Range" and parameter["in"] == "header"
            for parameter in operations[path]["get"]["parameters"]
        )
    assert redoc.status_code == 200

    # Hidden browser routes still exist; they simply do not appear in the public schema.
    route_paths = {route.path for route in app.routes}
    assert "/api/auth/login" in route_paths
    assert "/api/database/restore" in route_paths
    assert "/api/decoded/{foldername}/download" in route_paths
