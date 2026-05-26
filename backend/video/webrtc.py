"""WebRTC helper models and routes."""

import json
import os
from typing import Dict, Optional
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException, WebSocket
from pydantic import BaseModel

from common.logger import logger

# Allowlist of permitted go2rtc base URLs.  Override via the GO2RTC_ALLOWED_HOSTS
# environment variable (comma-separated list of "host:port" entries).
_DEFAULT_ALLOWED_HOSTS = {"localhost:1984", "127.0.0.1:1984"}

def _allowed_hosts() -> set:
    env = os.environ.get("GO2RTC_ALLOWED_HOSTS")
    if env:
        return {h.strip() for h in env.split(",") if h.strip()}
    return _DEFAULT_ALLOWED_HOSTS


def _validate_source_url(url: str) -> None:
    """Raise HTTPException if *url* does not point to an allowed go2rtc host."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Invalid source_url scheme")
    host = parsed.hostname or ""
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    netloc = f"{host}:{port}"
    if netloc not in _allowed_hosts():
        raise HTTPException(
            status_code=400,
            detail="source_url host is not in the allowed go2rtc hosts list",
        )


class RTCSessionDescription(BaseModel):
    type: str
    sdp: str


class IceCandidate(BaseModel):
    candidate: str
    sdpMid: str
    sdpMLineIndex: int


class CameraSource(BaseModel):
    source_url: str
    camera_id: Optional[str] = None


class WebRTCRequest(BaseModel):
    source_url: str
    camera_id: Optional[str] = None
    type: str
    sdp: str


# Store active connections
active_connections: Dict[str, WebSocket] = {}


def register_webrtc_routes(app: FastAPI) -> None:
    """Register WebRTC routes on the given FastAPI app."""

    @app.post("/api/webrtc/offer")
    async def create_webrtc_session(request: WebRTCRequest):
        """Relay WebRTC offer to go2rtc and return an answer."""
        _validate_source_url(request.source_url)
        try:
            base_url = request.source_url.split("/stream.html")[0]
            webrtc_url = f"{base_url}/api/webrtc"
            camera_id = request.camera_id
            if not camera_id and "src=" in request.source_url:
                camera_id = request.source_url.split("src=")[1].split("&")[0]
            logger.info(f"Creating WebRTC session for camera: {camera_id}")
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    webrtc_url,
                    json={"type": request.type, "sdp": request.sdp},
                    params={"src": camera_id} if camera_id else None,
                )
                if response.status_code != 200:
                    logger.error(f"Error from go2rtc: {response.status_code} - {response.text}")
                    raise HTTPException(
                        status_code=response.status_code,
                        detail="Failed to create WebRTC session",
                    )
                answer_data = response.json()
                return RTCSessionDescription(type=answer_data["type"], sdp=answer_data["sdp"])
        except HTTPException:
            raise
        except Exception as e:  # pragma: no cover - network errors
            logger.error(f"Error creating WebRTC session: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail=f"Error creating WebRTC session: {str(e)}",
            )

    @app.websocket("/ws/webrtc/{client_id}")
    async def webrtc_websocket(websocket: WebSocket, client_id: str):
        """WebSocket endpoint for ICE candidate exchange."""
        await websocket.accept()
        active_connections[client_id] = websocket
        try:
            while True:
                data = await websocket.receive_text()
                message = json.loads(data)
                if message.get("type") == "ice-candidate":
                    # Placeholder for forwarding ICE candidates if supported
                    pass
                await websocket.send_text(json.dumps({"type": "echo", "data": message}))
        except Exception as e:  # pragma: no cover - network errors
            logger.error(f"WebSocket error: {str(e)}")
        finally:
            if client_id in active_connections:
                del active_connections[client_id]
