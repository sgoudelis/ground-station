"""SatDump products nested in an automated observation's decoded directory."""

import json
from pathlib import Path
from typing import Any
from urllib.parse import quote

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}


def _read_metadata(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def observation_products(bundle_dir: Path) -> list[dict[str, Any]]:
    """Keep a complete dataset together while exposing its existing Meteor viewer."""
    products = []
    manifest = _read_metadata(bundle_dir / "manifest.json")
    owner_satellite = manifest.get("satellite", {}) if isinstance(manifest, dict) else {}
    for folder in sorted((bundle_dir / "decoded").glob("*.satdump_*")):
        if folder.is_symlink() or not folder.is_dir():
            continue
        relative = folder.relative_to(bundle_dir).as_posix()
        url = f"/observations/{quote(bundle_dir.name)}/{quote(relative)}"
        images = []
        total_size = 0
        for path in sorted(folder.rglob("*")):
            if path.is_symlink() or not path.is_file():
                continue
            size = path.stat().st_size
            total_size += size
            member = path.relative_to(folder)
            if (
                path.suffix.lower() not in IMAGE_EXTENSIONS
                or path.name == "thumbnail.jpg"
                or "thumbnails" in member.parent.parts
            ):
                continue
            images.append(
                {
                    "filename": path.name,
                    "path": member.as_posix(),
                    "size": size,
                    "url": f"{url}/{quote(member.as_posix())}",
                }
            )
        metadata = _read_metadata(folder / "dataset.json")
        if not isinstance(metadata, dict):
            metadata = {}
        telemetry = _read_metadata(folder / "telemetry.json")
        if isinstance(telemetry, list):
            telemetry = next(
                (
                    entry
                    for entry in telemetry
                    if isinstance(entry, dict) and "digital_tlm" in entry
                ),
                {},
            )
        satellite = metadata.get("satellite")
        satellite_name = satellite.get("name") if isinstance(satellite, dict) else satellite
        thumbnail = folder / "thumbnail.jpg"
        products.append(
            {
                "type": "decoded_folder",
                "name": folder.name,
                "foldername": folder.name,
                "path": relative,
                "observation_bundle": bundle_dir.name,
                "pipeline": folder.name.rsplit(".satdump_", 1)[1],
                "url": url,
                "download_url": (
                    f"/api/observations/{quote(bundle_dir.name)}/download"
                    f"?product={quote(relative, safe='')}"
                ),
                "size": total_size,
                "satellite_name": satellite_name or owner_satellite.get("name"),
                "products": metadata.get("products", []),
                "images": images,
                "image_count": len(images),
                "has_cadu": any(folder.glob("*.cadu")),
                "metadata": metadata,
                "telemetry": telemetry,
                "thumbnail_url": (
                    f"{url}/thumbnail.jpg?v={thumbnail.stat().st_mtime_ns}"
                    if thumbnail.is_file()
                    else None
                ),
            }
        )
    return products


def product_owner(relative: Path) -> str | None:
    """Identify members already represented by a dataset card."""
    if len(relative.parts) > 2 and relative.parts[0] == "decoded":
        if ".satdump_" in relative.parts[1]:
            return Path(*relative.parts[:2]).as_posix()
    return None
