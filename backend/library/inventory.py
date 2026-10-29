# Copyright (c) 2026 Efstratios Goudelis
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

"""Rebuildable in-memory catalogue for user-visible filesystem artifacts.

The catalogue deliberately has no persistence layer.  It is reconstructed
from ``data/`` at startup and after storage mutations, leaving the filesystem
as the only durable source of truth.
"""

from __future__ import annotations

import json
import shutil
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import quote

from common.events import public_events
from library.search import match_search, normalize_search, search_text

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}
DECODED_PATTERNS = ("*.png", "*.jpg", "*.jpeg", "*.txt", "*.bin")

# Maps an inventory item to the category the purge dialog groups it under.
# ``decoded_folder`` items with the observation marker are automated
# observation bundles; every other decoded folder is a SatDump product.
PURGE_CATEGORIES = (
    "observation",
    "decoded_folder",
    "recording",
    "snapshot",
    "decoded",
    "audio",
    "transcription",
)


def _iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def _versioned_image_url(path: Path, url: str) -> str:
    """Change an image URL whenever its on-disk content is replaced."""
    return f"{url}?v={path.stat().st_mtime_ns}"


def _parse_cutoff(value: Any) -> datetime:
    """Parse a purge cutoff ISO string; naive timestamps are read as UTC."""
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("cutoff must be a valid ISO datetime") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _purge_category(item: Dict[str, Any]) -> Optional[str]:
    item_type = str(item.get("type") or "")
    if item_type == "decoded_folder":
        return "observation" if item.get("folder_kind") == "observation" else "decoded_folder"
    return item_type if item_type in PURGE_CATEGORIES else None


def _is_in_progress(item: Dict[str, Any]) -> bool:
    """Active recordings and still-running observation bundles are protected."""
    return bool(item.get("recording_in_progress") or item.get("observation_in_progress"))


def _activity_time(item: Dict[str, Any]) -> Optional[datetime]:
    """Parse the item's last-activity timestamp (content mtime when known)."""
    raw = item.get("latest_activity") or item.get("modified") or item.get("created")
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _object(value: Any) -> Dict[str, Any]:
    """Treat missing or malformed optional metadata sections as absent metadata."""
    return value if isinstance(value, dict) else {}


def _sigmf_summary(path: Path) -> Dict[str, Any]:
    metadata = _read_json(path)
    global_meta = metadata.get("global")
    global_meta = global_meta if isinstance(global_meta, dict) else {}
    captures = metadata.get("captures")
    first_capture = captures[0] if isinstance(captures, list) and captures else {}
    first_capture = first_capture if isinstance(first_capture, dict) else {}
    return {
        "datatype": global_meta.get("core:datatype"),
        "sample_rate": global_meta.get("core:sample_rate"),
        "description": global_meta.get("core:description"),
        "recorder": global_meta.get("core:recorder"),
        "recording_in_progress": bool(global_meta.get("gs:recording_in_progress", False)),
        "start_time": global_meta.get("gs:start_time"),
        "finalized_time": global_meta.get("gs:finalized_time"),
        "session_id": global_meta.get("gs:session_id"),
        "observation_id": global_meta.get("gs:observation_id"),
        "target_satellite_norad_id": global_meta.get("gs:target_satellite_norad_id"),
        "target_satellite_name": global_meta.get("gs:target_satellite_name"),
        "center_frequency": first_capture.get("core:frequency"),
    }


def _transcription_summary(path: Path) -> Dict[str, Any]:
    """Read only the comment header; transcript bodies never enter the index."""
    result: Dict[str, Any] = {}
    try:
        with path.open("r", encoding="utf-8") as file:
            for line in file:
                line = line.strip()
                if not line.startswith("#"):
                    break
                if line.startswith("# Provider:"):
                    result["provider"] = line.split(":", 1)[1].strip()
                elif line.startswith("# Session:"):
                    result["session_id"] = line.split(":", 1)[1].strip()
                elif line.startswith("# Satellite:"):
                    satellite = line.split(":", 1)[1].strip()
                    name, separator, norad = satellite.rpartition(" (NORAD:")
                    if not separator:
                        name, norad = satellite, ""
                    if name and name != "Unknown":
                        result["satellite_name"] = name
                    norad = norad.rstrip(")").strip()
                    if norad.isdigit():
                        result["satellite_norad_id"] = int(norad)
                        # Existing transcription views use this older field name.
                        result["satellite_norad"] = norad
                elif line.startswith("# Transmitter:"):
                    value = line.split(":", 1)[1].strip()
                    if value != "Unknown":
                        result["transmitter_description"] = value
                elif line.startswith("# Transmitter Mode:"):
                    value = line.split(":", 1)[1].strip()
                    if value != "N/A":
                        result["transmitter_mode"] = value
                elif line.startswith("# Language:"):
                    result["language"] = line.split(":", 1)[1].strip()
                elif line.startswith("# Translate To:"):
                    result["translate_to"] = line.split(":", 1)[1].strip()
                elif line.startswith("# Translation Backend:"):
                    result["translation_backend"] = line.split(":", 1)[1].strip()
    except (OSError, UnicodeError):
        return {}
    return result


@dataclass(frozen=True)
class LibraryRoots:
    """Storage roots owned by the application library."""

    backend: Path

    @property
    def data(self) -> Path:
        return self.backend / "data"

    @property
    def recordings(self) -> Path:
        return self.data / "recordings"

    @property
    def snapshots(self) -> Path:
        return self.data / "snapshots"

    @property
    def decoded(self) -> Path:
        return self.data / "decoded"

    @property
    def audio(self) -> Path:
        return self.data / "audio"

    @property
    def transcriptions(self) -> Path:
        return self.data / "transcriptions"

    @property
    def observations(self) -> Path:
        return self.data / "observations"


class LibraryInventory:
    """A thread-safe, rebuildable catalogue of compact library summaries."""

    def __init__(self, backend_dir: Path):
        self.roots = LibraryRoots(Path(backend_dir).resolve())
        self._items: Dict[str, Dict[str, Any]] = {}
        self._pending_ready: set[str] = set()
        self._revision = 0
        self._ready = False
        self._lock = threading.RLock()

    @property
    def revision(self) -> int:
        with self._lock:
            return self._revision

    def rebuild(self) -> int:
        """Reconcile the process-local catalogue with the filesystem."""
        items: Dict[str, Dict[str, Any]] = {}
        self._scan_recordings(items)
        self._scan_snapshots(items)
        self._scan_decoded(items)
        self._scan_audio(items)
        self._scan_transcriptions(items)
        self._scan_observations(items)
        with self._lock:
            if self._ready:
                for item_id, item in items.items():
                    previous = self._items.get(item_id)
                    if not _is_in_progress(item) and (
                        previous is None or _is_in_progress(previous)
                    ):
                        self._pending_ready.add(item_id)
            if not self._ready or items != self._items:
                self._items = items
                self._revision += 1
            self._ready = True
            return self._revision

    def take_ready(self) -> list[Dict[str, str]]:
        """Drain items that became complete since the initial inventory build."""
        with self._lock:
            ready = []
            for item_id in sorted(self._pending_ready):
                item = self._items.get(item_id)
                if item and not _is_in_progress(item):
                    ready.append(
                        {
                            "id": item_id,
                            "type": str(item.get("type") or ""),
                            "name": str(item.get("display_name") or item.get("name") or item_id),
                        }
                    )
            self._pending_ready.clear()
            return ready

    def query(
        self,
        filters: Optional[Dict[str, bool]] = None,
        sort_by: str = "created",
        sort_order: str = "desc",
        page: int = 1,
        page_size: int = 25,
        session_id: Optional[str] = None,
        observation_id: Optional[str] = None,
        search: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Return one compact, sorted page without touching the filesystem."""
        tokens = normalize_search(search).casefold().split()
        if not self._ready:
            self.rebuild()
        page = max(1, int(page))
        page_size = max(1, min(int(page_size), 100))
        with self._lock:
            items = []
            for item in self._items.values():
                if not self._matches(item, filters, session_id, observation_id):
                    continue
                matched_files = match_search(item, tokens)
                if matched_files is None:
                    continue
                summary = self._public(item)
                if matched_files:
                    summary["matched_files"] = matched_files
                items.append(summary)
            revision = self._revision
        allowed_sorts = {"name", "size", "created", "modified", "sample_rate"}
        sort_by = sort_by if sort_by in allowed_sorts else "created"
        reverse = sort_order != "asc"

        def key(item: Dict[str, Any]) -> Any:
            if sort_by == "name":
                return str(item.get("display_name") or item.get("name") or "").casefold()
            if sort_by == "size":
                return item.get("data_size") or item.get("size") or 0
            if sort_by == "sample_rate":
                return item.get("metadata", {}).get("sample_rate") or item.get("sample_rate") or 0
            return item.get(sort_by) or ""

        items.sort(key=key, reverse=reverse)
        total = len(items)
        last_page = max(1, (total + page_size - 1) // page_size)
        page = min(page, last_page)
        start = (page - 1) * page_size
        return {
            "items": items[start : start + page_size],
            "total": total,
            "page": page,
            "page_size": page_size,
            "revision": revision,
            "has_more": start + page_size < total,
            "diskUsage": self._disk_usage(),
        }

    def get(self, item_id: str) -> Optional[Dict[str, Any]]:
        if not self._ready:
            self.rebuild()
        with self._lock:
            item = self._items.get(item_id)
            return self._public(item) if item else None

    def detail(self, item_id: str) -> Optional[Dict[str, Any]]:
        """Build heavyweight detail only after a user opens an item."""
        if not self._ready:
            self.rebuild()
        with self._lock:
            item = self._items.get(item_id)
            internal = dict(item) if item else None
        if not internal:
            return None
        path = Path(str(internal["_path"]))
        if internal.get("folder_kind") == "observation":
            return self._observation_detail(self._public(internal), path)
        if internal.get("type") == "decoded_folder":
            return self._decoded_folder_detail(self._public(internal), path)
        return self._public(internal)

    def resolve_download(
        self, item_id: str, *, part: Optional[str] = None, member: Optional[str] = None
    ) -> Optional[Path]:
        """Resolve an indexed artifact or one of its owned files for a download."""
        if not self._ready:
            self.rebuild()
        with self._lock:
            item = self._items.get(item_id)
            if item is None:
                return None
            indexed_path = Path(str(item["_path"]))
            item_type = str(item.get("type"))
            storage_root = (
                self.roots.observations
                if item.get("folder_kind") == "observation"
                else {
                    "recording": self.roots.recordings,
                    "snapshot": self.roots.snapshots,
                    "decoded": self.roots.decoded,
                    "decoded_folder": self.roots.decoded,
                    "audio": self.roots.audio,
                    "transcription": self.roots.transcriptions,
                }.get(item_type)
            )
        if storage_root is None:
            return None

        candidate: Optional[Path]
        if member is not None:
            if part is not None or not member or Path(member).is_absolute():
                return None
            candidate = indexed_path / member
        elif part is None or (item_type == "recording" and part == "data"):
            candidate = indexed_path
        elif item_type == "recording":
            waterfall_thumbnail = indexed_path.with_name(f"{indexed_path.stem}_waterfall_thumb.png")
            jpeg_thumbnail = indexed_path.parent / "thumbnails" / f"{indexed_path.stem}.jpg"
            candidates = {
                "meta": indexed_path.with_suffix(".sigmf-meta"),
                "snapshot": indexed_path.with_suffix(".png"),
                "thumbnail": (
                    waterfall_thumbnail if waterfall_thumbnail.is_file() else jpeg_thumbnail
                ),
            }
            candidate = candidates.get(part)
        elif item_type == "snapshot" and part == "thumbnail":
            candidate = indexed_path.parent / "thumbnails" / f"{indexed_path.stem}.jpg"
        elif item_type in {"decoded", "audio"} and part == "metadata":
            candidate = indexed_path.with_suffix(".json")
        else:
            return None
        if candidate is None:
            return None

        try:
            root = storage_root.resolve(strict=True)
            indexed = indexed_path.resolve(strict=True)
            resolved = candidate.resolve(strict=True)
            # Inventory entries and nested members must stay under their own
            # library root even if a symlink appears after a catalogue rebuild.
            indexed.relative_to(root)
            resolved.relative_to(indexed if member is not None else root)
        except (OSError, RuntimeError, ValueError):
            return None
        if member is not None and not indexed.is_dir():
            return None
        if not resolved.is_file() and not (member is None and part is None and resolved.is_dir()):
            return None
        return resolved

    def delete(self, item_ids: Iterable[str]) -> Dict[str, Any]:
        """Delete indexed items, then rebuild once to guarantee consistency."""
        if not self._ready:
            self.rebuild()
        results: List[Dict[str, Any]] = []
        with self._lock:
            requested = [(item_id, self._items.get(item_id)) for item_id in item_ids]
        for item_id, item in requested:
            if not item:
                results.append({"id": item_id, "success": False, "error": "Item not found"})
                continue
            try:
                self._delete_item(item)
                results.append({"id": item_id, "success": True})
            except OSError as exc:
                results.append({"id": item_id, "success": False, "error": str(exc)})
        revision = self.rebuild() if any(result["success"] for result in results) else self.revision
        return {"results": results, "revision": revision}

    def _purge_candidates(self, deadline: datetime) -> List[tuple]:
        """Items older than the deadline, oldest first, minus in-progress work."""
        with self._lock:
            snapshot = list(self._items.values())
        candidates: List[tuple] = []
        for item in snapshot:
            if _purge_category(item) is None:
                continue
            if _is_in_progress(item):
                continue
            activity = _activity_time(item)
            if activity is None or activity >= deadline:
                continue
            candidates.append((activity, item))
        candidates.sort(key=lambda pair: pair[0])
        return candidates

    def purge_preview(self, cutoff: str) -> Dict[str, Any]:
        """Aggregate what a purge at the cutoff would remove, without deleting."""
        deadline = _parse_cutoff(cutoff)
        # The preview is a deletion promise, so read current filesystem state.
        self.rebuild()
        with self._lock:
            snapshot = list(self._items.values())
        candidates = self._purge_candidates(deadline)
        categories: Dict[str, Dict[str, int]] = {
            category: {"items": 0, "files": 0, "bytes": 0} for category in PURGE_CATEGORIES
        }
        total_files = 0
        total_bytes = 0
        for _activity, item in candidates:
            category = _purge_category(item)
            if category is None:
                continue
            files = int(item.get("file_count") or 1)
            byte_size = int(
                item.get("purge_bytes") or item.get("size") or item.get("data_size") or 0
            )
            total_files += files
            total_bytes += byte_size
            bucket = categories[category]
            bucket["items"] += 1
            bucket["files"] += files
            bucket["bytes"] += byte_size
        # Only active items inside the chosen age range would otherwise be deleted.
        skipped = sum(
            1
            for item in snapshot
            if _is_in_progress(item)
            and _purge_category(item)
            and (activity := _activity_time(item)) is not None
            and activity < deadline
        )
        activities = [
            activity for activity in (_activity_time(item) for item in snapshot) if activity
        ]
        return {
            "cutoff": deadline.isoformat(),
            "items": len(candidates),
            "files": total_files,
            "bytes": total_bytes,
            "skippedInProgress": skipped,
            "categories": categories,
            "oldest": min(activities).isoformat() if activities else None,
            "newest": max(activities).isoformat() if activities else None,
        }

    def purge(self, cutoff: str, progress_callback: Optional[Any] = None) -> Dict[str, Any]:
        """Delete every eligible item older than the cutoff, oldest first.

        The candidate set is recomputed at execution time so the caller cannot
        smuggle arbitrary IDs through the cutoff protocol. The callback receives
        compact progress dictionaries so long multi-GB sweeps can stream to the UI.
        """
        deadline = _parse_cutoff(cutoff)
        # A recording or bundle may have become active since the last index refresh.
        self.rebuild()
        candidates = self._purge_candidates(deadline)
        total = len(candidates)
        deleted = 0
        files = 0
        bytes_freed = 0
        failed: List[Dict[str, str]] = []

        def report(done: int, current: Optional[str]) -> None:
            if progress_callback is not None:
                progress_callback(
                    {
                        "done": done,
                        "total": total,
                        "deleted": deleted,
                        "files": files,
                        "bytesFreed": bytes_freed,
                        "current": current,
                    }
                )

        report(0, None)
        for index, (_activity, item) in enumerate(candidates):
            name = str(item.get("display_name") or item.get("name") or item.get("id") or "")
            report(index, name)
            try:
                # A worker may start writing after the initial rebuild. Check
                # status and content mtimes immediately before each deletion.
                if not self._purge_item_is_eligible(item, deadline):
                    continue
                self._delete_item(item)
                deleted += 1
                files += int(item.get("file_count") or 1)
                bytes_freed += int(
                    item.get("purge_bytes") or item.get("size") or item.get("data_size") or 0
                )
            except OSError as exc:
                failed.append({"id": str(item.get("id")), "error": str(exc)})
        revision = self.rebuild() if deleted else self.revision
        report(total, None)
        return {
            "deleted": deleted,
            "files": files,
            "bytesFreed": bytes_freed,
            "failed": failed,
            "revision": revision,
        }

    def _purge_item_is_eligible(self, item: Dict[str, Any], deadline: datetime) -> bool:
        """Recheck live status and the newest owned file before deletion."""
        path = Path(str(item["_path"]))
        if not path.exists():
            return False
        owned: Iterable[Path]
        if item.get("type") == "recording":
            if _sigmf_summary(path.with_suffix(".sigmf-meta"))["recording_in_progress"]:
                return False
            base = path.with_suffix("")
            owned = (
                path,
                base.with_suffix(".sigmf-meta"),
                base.with_suffix(".png"),
                base.parent / "thumbnails" / f"{base.name}.jpg",
            )
        elif item.get("folder_kind") == "observation":
            if _read_json(path / "manifest.json").get("in_progress"):
                return False
            owned = path.rglob("*")
        elif path.is_dir():
            owned = path.rglob("*")
        elif item.get("type") == "snapshot":
            owned = (
                path,
                path.with_suffix(".json"),
                path.parent / "thumbnails" / f"{path.stem}.jpg",
            )
        elif item.get("type") in {"decoded", "audio"}:
            owned = (path, path.with_suffix(".json"))
        else:
            owned = (path,)

        latest: float | None = None
        for owned_path in owned:
            if owned_path.is_file():
                mtime = owned_path.stat().st_mtime
                latest = mtime if latest is None else max(latest, mtime)
        if latest is None:
            latest = path.stat().st_mtime
        return latest < deadline.timestamp()

    def _matches(
        self,
        item: Dict[str, Any],
        filters: Optional[Dict[str, bool]],
        session_id: Optional[str],
        observation_id: Optional[str],
    ) -> bool:
        if session_id or observation_id:
            identifiers = (str(item.get("name") or ""), str(item.get("filename") or ""))
            matches_session = bool(session_id and item.get("session_id") == session_id)
            matches_observation = bool(
                observation_id
                and (
                    item.get("observation_id") == observation_id
                    or any(observation_id in identifier for identifier in identifiers)
                )
            )
            if not matches_session and not matches_observation:
                return False
        if not filters:
            return True
        enabled = {
            "recording": filters.get("showRecordings", True),
            "snapshot": filters.get("showSnapshots", True),
            "decoded": filters.get("showDecoded", True),
            # Older clients only sent showDecoded, which also covered
            # observation bundles before they had their own filter.
            "decoded_folder": (
                filters.get("showObservations", filters.get("showDecoded", True))
                if item.get("folder_kind") == "observation"
                else filters.get("showDecoded", True)
            ),
            "audio": filters.get("showAudio", True),
            "transcription": filters.get("showTranscriptions", True),
        }
        return enabled.get(str(item.get("type")), True)

    def _disk_usage(self) -> Dict[str, int]:
        try:
            usage = shutil.disk_usage(self.roots.data)
            return {"total": usage.total, "used": usage.used, "available": usage.free}
        except OSError:
            return {"total": 0, "used": 0, "available": 0}

    def _add(self, items: Dict[str, Dict[str, Any]], item: Dict[str, Any], path: Path) -> None:
        item["_path"] = str(path)
        item["_search_text"] = search_text(item)
        # Stable ordering prevents harmless directory traversal order changes
        # from advancing the inventory revision or changing search hints.
        members = sorted(item.pop("_member_names", ()))
        if members:
            item["_search_members"] = tuple((name, name.casefold()) for name in members)
        items[str(item["id"])] = item

    @staticmethod
    def _public(item: Dict[str, Any]) -> Dict[str, Any]:
        """Never expose implementation paths outside the storage service."""
        return {key: value for key, value in item.items() if not key.startswith("_")}

    def _scan_recordings(self, items: Dict[str, Dict[str, Any]]) -> None:
        root = self.roots.recordings
        if not root.is_dir():
            return
        for meta in root.glob("*.sigmf-meta"):
            data = meta.with_suffix(".sigmf-data")
            if not data.is_file():
                continue
            stat = data.stat()
            meta_stat = meta.stat()
            metadata = _sigmf_summary(meta)
            name = meta.stem
            snapshot = root / f"{name}.png"
            thumbnail = root / "thumbnails" / f"{name}.jpg"
            snapshot_stat = snapshot.stat() if snapshot.is_file() else None
            thumbnail_stat = thumbnail.stat() if thumbnail.is_file() else None
            self._add(
                items,
                {
                    "id": f"recording:{name}",
                    "type": "recording",
                    "name": name,
                    "display_name": name,
                    "data_file": data.name,
                    "meta_file": meta.name,
                    "data_size": stat.st_size,
                    "meta_size": meta_stat.st_size,
                    "created": _iso(stat.st_ctime),
                    "modified": _iso(stat.st_mtime),
                    "latest_activity": _iso(
                        max(
                            stat.st_mtime,
                            meta_stat.st_mtime,
                            snapshot_stat.st_mtime if snapshot_stat else 0,
                            thumbnail_stat.st_mtime if thumbnail_stat else 0,
                        )
                    ),
                    "file_count": 2
                    + int(snapshot_stat is not None)
                    + int(thumbnail_stat is not None),
                    # A purge removes data, meta, waterfall, and cached preview too.
                    "purge_bytes": (
                        stat.st_size
                        + meta_stat.st_size
                        + (snapshot_stat.st_size if snapshot_stat else 0)
                        + (thumbnail_stat.st_size if thumbnail_stat else 0)
                    ),
                    "metadata": metadata,
                    "satellite_name": metadata.get("target_satellite_name"),
                    "satellite_norad_id": metadata.get("target_satellite_norad_id"),
                    "description": metadata.get("description"),
                    "session_id": metadata.get("session_id"),
                    "recording_in_progress": metadata.get("recording_in_progress", False),
                    "snapshot": self._snapshot_info(snapshot, "/recordings", thumbnail),
                    "download_urls": {
                        "data": f"/recordings/{quote(data.name)}",
                        "meta": f"/recordings/{quote(meta.name)}",
                    },
                },
                data,
            )

    def _scan_snapshots(self, items: Dict[str, Dict[str, Any]]) -> None:
        root = self.roots.snapshots
        if not root.is_dir():
            return
        for path in root.glob("*.png"):
            stat = path.stat()
            metadata_path = path.with_suffix(".json")
            metadata_stat = metadata_path.stat() if metadata_path.is_file() else None
            metadata = _read_json(metadata_path)
            thumbnail = root / "thumbnails" / f"{path.stem}.jpg"
            thumbnail_stat = thumbnail.stat() if thumbnail.is_file() else None
            self._add(
                items,
                {
                    "id": f"snapshot:{path.name}",
                    "type": "snapshot",
                    "name": path.stem,
                    "display_name": path.stem,
                    "filename": path.name,
                    "size": stat.st_size,
                    "created": _iso(stat.st_ctime),
                    "modified": _iso(stat.st_mtime),
                    "latest_activity": _iso(
                        max(
                            stat.st_mtime,
                            metadata_stat.st_mtime if metadata_stat else 0,
                            thumbnail_stat.st_mtime if thumbnail_stat else 0,
                        )
                    ),
                    "file_count": 1
                    + int(metadata_stat is not None)
                    + int(thumbnail_stat is not None),
                    "purge_bytes": stat.st_size
                    + (metadata_stat.st_size if metadata_stat else 0)
                    + (thumbnail_stat.st_size if thumbnail_stat else 0),
                    "satellite_name": metadata.get("target_satellite_name"),
                    "satellite_norad_id": metadata.get("target_satellite_norad_id"),
                    "session_id": metadata.get("session_id"),
                    "url": f"/snapshots/{quote(path.name)}",
                    "thumbnail_url": (
                        f"/snapshots/thumbnails/{quote(thumbnail.name)}"
                        if thumbnail.is_file()
                        else None
                    ),
                },
                path,
            )

    def _scan_decoded(self, items: Dict[str, Dict[str, Any]]) -> None:
        root = self.roots.decoded
        if not root.is_dir():
            return
        for folder in root.iterdir():
            if not folder.is_dir() or ".satdump_" not in folder.name:
                continue
            stat = folder.stat()
            # The card needs an image count before the detail view is opened.
            # Count images while walking nested output files for the size total.
            # The same walk yields the purge metadata: every file counts toward
            # the group's file total and its newest mtime is the last activity.
            total_size = 0
            image_count = 0
            file_count = 0
            member_names = []
            # Content mtimes only: a directory's own mtime shifts on unrelated
            # entry churn, which would wrongly keep old folders out of purges.
            latest_mtime: float | None = None
            for path in folder.rglob("*"):
                if path.is_symlink() or not path.is_file():
                    continue
                file_stat = path.stat()
                total_size += file_stat.st_size
                latest_mtime = (
                    file_stat.st_mtime
                    if latest_mtime is None
                    else max(latest_mtime, file_stat.st_mtime)
                )
                file_count += 1
                relative = path.relative_to(folder)
                # Metadata and cached previews are implementation details.
                if (
                    path.suffix.lower() != ".json"
                    and path.name != "thumbnail.jpg"
                    and "thumbnails" not in relative.parent.parts
                ):
                    member_names.append(relative.as_posix())
                if path.suffix.lower() in IMAGE_EXTENSIONS:
                    image_count += 1
            # An empty folder falls back to its own mtime.
            if latest_mtime is None:
                latest_mtime = stat.st_mtime
            dataset = _read_json(folder / "dataset.json")
            satellite = _object(dataset.get("satellite"))
            folder_parts = folder.name.split(".")
            pipeline = folder_parts[1].replace("satdump_", "") if len(folder_parts) > 1 else None
            self._add(
                items,
                {
                    "id": f"decoded_folder:{folder.name}",
                    "type": "decoded_folder",
                    "name": folder.stem,
                    "display_name": folder.stem,
                    "foldername": folder.name,
                    "size": total_size,
                    "created": _iso(stat.st_ctime),
                    "modified": _iso(stat.st_mtime),
                    "latest_activity": _iso(latest_mtime),
                    "file_count": file_count,
                    "purge_bytes": total_size,
                    "url": f"/decoded/{quote(folder.name)}",
                    "thumbnail_url": (
                        f"/decoded/{quote(folder.name)}/thumbnail.jpg"
                        if (folder / "thumbnail.jpg").is_file()
                        else None
                    ),
                    "satellite_name": satellite.get("name")
                    or (
                        dataset.get("satellite")
                        if isinstance(dataset.get("satellite"), str)
                        else None
                    )
                    or "Unknown",
                    "satellite_norad_id": satellite.get("norad_id") or dataset.get("norad_id"),
                    "pipeline": pipeline,
                    "products": dataset.get("products", []),
                    "image_count": image_count,
                    "metadata": dataset,
                    "_member_names": member_names,
                },
                folder,
            )
        for pattern in DECODED_PATTERNS:
            for path in root.glob(pattern):
                if not path.is_file():
                    continue
                stat = path.stat()
                metadata_path = path.with_suffix(".json")
                metadata_stat = metadata_path.stat() if metadata_path.is_file() else None
                metadata = _read_json(metadata_path)
                decoder = _object(metadata.get("decoder"))
                satellite = _object(metadata.get("satellite"))
                transmitter = _object(metadata.get("transmitter"))
                ax25 = _object(metadata.get("ax25"))
                decoder_config = _object(metadata.get("decoder_config"))
                self._add(
                    items,
                    {
                        "id": f"decoded:{path.name}",
                        "type": "decoded",
                        "name": path.stem,
                        "display_name": path.stem,
                        "filename": path.name,
                        "size": stat.st_size,
                        "created": _iso(stat.st_ctime),
                        "modified": _iso(stat.st_mtime),
                        "latest_activity": _iso(
                            max(stat.st_mtime, metadata_stat.st_mtime if metadata_stat else 0)
                        ),
                        "file_count": 1 + int(metadata_stat is not None),
                        "purge_bytes": stat.st_size
                        + (metadata_stat.st_size if metadata_stat else 0),
                        "url": f"/decoded/{quote(path.name)}",
                        "file_type": path.suffix.lower(),
                        "decoder_type": str(decoder.get("type") or "").upper() or None,
                        "decoder_mode": decoder.get("mode"),
                        "protocol": decoder_config.get("payload_protocol"),
                        # A callsign identifies a station, including terrestrial
                        # APRS stations; never promote it to satellite identity.
                        "source_callsign": ax25.get("from_callsign"),
                        "destination_callsign": ax25.get("to_callsign"),
                        "transmitter_description": transmitter.get("description"),
                        "transmitter_mode": transmitter.get("mode"),
                        "satellite_name": satellite.get("name"),
                        "satellite_norad_id": satellite.get("norad_id"),
                        "session_id": decoder.get("session_id"),
                        "observation_id": metadata.get("observation_id"),
                    },
                    path,
                )

    def _scan_audio(self, items: Dict[str, Dict[str, Any]]) -> None:
        root = self.roots.audio
        if not root.is_dir():
            return
        for path in root.glob("*.wav"):
            stat = path.stat()
            metadata_path = path.with_suffix(".json")
            metadata_stat = metadata_path.stat() if metadata_path.is_file() else None
            metadata = _read_json(metadata_path)
            self._add(
                items,
                {
                    "id": f"audio:{path.name}",
                    "type": "audio",
                    "name": path.stem,
                    "display_name": path.stem,
                    "filename": path.name,
                    "size": stat.st_size,
                    "created": _iso(stat.st_ctime),
                    "modified": _iso(stat.st_mtime),
                    "latest_activity": _iso(
                        max(stat.st_mtime, metadata_stat.st_mtime if metadata_stat else 0)
                    ),
                    "file_count": 2 if metadata_stat else 1,
                    # Deleting audio also unlinks its metadata.
                    "purge_bytes": stat.st_size + (metadata_stat.st_size if metadata_stat else 0),
                    "url": f"/audio/{quote(path.name)}",
                    "file_type": ".wav",
                    "vfo_number": metadata.get("vfo_number"),
                    "demodulator_type": metadata.get("demodulator_type", ""),
                    "satellite_name": metadata.get("target_satellite_name"),
                    "satellite_norad_id": metadata.get("target_satellite_norad_id"),
                    "duration_seconds": metadata.get("duration_seconds"),
                    "sample_rate": metadata.get("sample_rate"),
                    "status": metadata.get("status", "unknown"),
                    "session_id": metadata.get("session_id"),
                    "observation_id": metadata.get("observation_id"),
                    "metadata": metadata,
                },
                path,
            )

    def _scan_transcriptions(self, items: Dict[str, Dict[str, Any]]) -> None:
        root = self.roots.transcriptions
        if not root.is_dir():
            return
        for path in root.glob("*.txt"):
            stat = path.stat()
            metadata = _transcription_summary(path)
            self._add(
                items,
                {
                    "id": f"transcription:{path.name}",
                    "type": "transcription",
                    "name": path.stem,
                    "display_name": path.stem,
                    "filename": path.name,
                    "size": stat.st_size,
                    "created": _iso(stat.st_ctime),
                    "modified": _iso(stat.st_mtime),
                    "latest_activity": _iso(stat.st_mtime),
                    "file_count": 1,
                    "purge_bytes": stat.st_size,
                    "url": f"/transcriptions/{quote(path.name)}",
                    "file_type": ".txt",
                    **metadata,
                },
                path,
            )

    def _scan_observations(self, items: Dict[str, Dict[str, Any]]) -> None:
        root = self.roots.observations
        if not root.is_dir():
            return
        for folder in root.glob("*.gsobs"):
            if not folder.is_dir():
                continue
            stat = folder.stat()
            manifest = _read_json(folder / "manifest.json")
            satellite: Dict[str, Any] = {}
            satellite_value = manifest.get("satellite")
            if isinstance(satellite_value, dict):
                satellite = satellite_value
            thumbnail = next(
                (path for path in (folder / "recordings").glob("*_waterfall_thumb.png")), None
            )
            # Count and size only files the dialog presents as artifacts;
            # manifests, metadata, and thumbnails are implementation metadata.
            # This traversal already powers the artifact count, so including
            # byte totals here gives cards an accurate size without a second walk.
            manifest_path = folder / "manifest.json"
            artifact_count = 0
            total_size = 0
            member_names = []
            # ``total_size`` only covers dialog-visible artifacts, while a purge
            # also frees manifests, metadata, and thumbnails. Track both.
            disk_size = 0
            file_count = 0
            # Content mtimes only, same as the decoded folder scan.
            latest_mtime: float | None = None
            for path in folder.rglob("*"):
                if path.is_symlink() or not path.is_file():
                    continue
                file_stat = path.stat()
                file_count += 1
                disk_size += file_stat.st_size
                latest_mtime = (
                    file_stat.st_mtime
                    if latest_mtime is None
                    else max(latest_mtime, file_stat.st_mtime)
                )
                if (
                    path == manifest_path
                    or path.suffix.lower() == ".json"
                    or "thumbnails" in path.relative_to(folder).parent.parts
                ):
                    continue
                artifact_count += 1
                total_size += file_stat.st_size
                if not path.name.endswith("_waterfall_thumb.png"):
                    member_names.append(path.relative_to(folder).as_posix())
            if latest_mtime is None:
                latest_mtime = stat.st_mtime
            self._add(
                items,
                {
                    "id": f"observation:{folder.name}",
                    "type": "decoded_folder",
                    "folder_kind": "observation",
                    "name": folder.stem,
                    "display_name": folder.stem,
                    "foldername": folder.name,
                    "size": total_size,
                    "created": _iso(stat.st_ctime),
                    "modified": _iso(stat.st_mtime),
                    "latest_activity": _iso(latest_mtime),
                    "file_count": file_count,
                    "purge_bytes": disk_size,
                    "url": f"/observations/{quote(folder.name)}",
                    "download_url": f"/api/observations/{quote(folder.name)}/download",
                    "thumbnail_url": (
                        _versioned_image_url(
                            thumbnail,
                            f"/observations/{quote(folder.name)}/recordings/{quote(thumbnail.name)}",
                        )
                        if thumbnail
                        else None
                    ),
                    "satellite_name": satellite.get("name", "Unknown"),
                    "satellite_id": satellite.get("norad_id"),
                    "satellite_norad_id": satellite.get("norad_id"),
                    "observation_status": manifest.get("status", "unknown"),
                    "observation_in_progress": bool(manifest.get("in_progress", False)),
                    "artifact_count": artifact_count,
                    "_member_names": member_names,
                },
                folder,
            )

    def _snapshot_info(self, path: Path, mount: str, thumbnail: Path) -> Optional[Dict[str, Any]]:
        if not path.is_file():
            return None

        # WaterfallGenerator writes this preview beside the full-resolution
        # waterfall. Prefer it because older observation bundles do not have a
        # generated JPEG cache, and falling back to ``path`` would make the UI
        # decode the original multi-megapixel PNG just to fill a small card.
        waterfall_thumbnail = path.with_name(f"{path.stem}_waterfall_thumb.png")
        if waterfall_thumbnail.is_file():
            thumbnail_url = _versioned_image_url(
                waterfall_thumbnail, f"{mount}/{quote(waterfall_thumbnail.name)}"
            )
        elif thumbnail.is_file():
            thumbnail_url = _versioned_image_url(
                thumbnail, f"{mount}/thumbnails/{quote(thumbnail.name)}"
            )
        else:
            thumbnail_url = None

        return {
            "filename": path.name,
            "url": _versioned_image_url(path, f"{mount}/{quote(path.name)}"),
            "thumbnail_url": thumbnail_url,
            "size": path.stat().st_size,
        }

    def _decoded_folder_detail(self, item: Dict[str, Any], folder: Path) -> Dict[str, Any]:
        """Expand a decoded folder's images and metadata when it is opened."""
        images: List[Dict[str, Any]] = []
        total_size = 0
        for path in folder.rglob("*"):
            if path.is_symlink() or not path.is_file():
                continue
            stat = path.stat()
            total_size += stat.st_size
            if path.suffix.lower() in IMAGE_EXTENSIONS:
                relative = path.relative_to(folder).as_posix()
                images.append(
                    {
                        "filename": path.name,
                        "path": relative,
                        "size": stat.st_size,
                        "url": f"/decoded/{quote(folder.name)}/{quote(relative)}",
                    }
                )
        item.update(
            {
                "size": total_size,
                "images": images,
                "image_count": len(images),
                "metadata": _read_json(folder / "dataset.json"),
                "telemetry": _read_json(folder / "telemetry.json"),
            }
        )
        return item

    def _observation_detail(self, item: Dict[str, Any], folder: Path) -> Dict[str, Any]:
        """Expand an observation bundle only when its details dialog opens."""
        manifest_path = folder / "manifest.json"
        artifacts: List[Dict[str, Any]] = []
        images: List[Dict[str, Any]] = []
        total_size = 0
        recording_root = folder / "recordings"
        recording_owner_by_path: Dict[str, str] = {}

        # Recordings are represented by one card each. Keep their individual
        # data, metadata, waterfall, and waterfall preview out of the generic
        # artifact/image grids, where the full waterfall would otherwise be
        # requested and decoded a second time during dialog scrolling.
        if recording_root.is_dir():
            for meta in recording_root.glob("*.sigmf-meta"):
                data = meta.with_suffix(".sigmf-data")
                if not data.is_file():
                    continue
                name = meta.stem
                for member in (
                    data,
                    meta,
                    recording_root / f"{name}.png",
                    recording_root / f"{name}_waterfall_thumb.png",
                ):
                    if member.is_file():
                        recording_owner_by_path[member.relative_to(folder).as_posix()] = name

        for path in folder.rglob("*"):
            if (
                path.is_symlink()
                or not path.is_file()
                or path == manifest_path
                or path.suffix.lower() == ".json"
            ):
                continue
            relative = path.relative_to(folder)
            if "thumbnails" in relative.parent.parts:
                continue
            stat = path.stat()
            relative_path = relative.as_posix()
            generated_thumbnail = path.parent / "thumbnails" / f"{path.stem}.jpg"
            artifact = {
                "name": path.name,
                "path": relative_path,
                "url": (
                    _versioned_image_url(
                        path, f"/observations/{quote(folder.name)}/{quote(relative_path)}"
                    )
                    if path.suffix.lower() in IMAGE_EXTENSIONS
                    else f"/observations/{quote(folder.name)}/{quote(relative_path)}"
                ),
                "size": stat.st_size,
                "kind": relative.parts[0] if relative.parts else "file",
                "file_type": path.suffix.lower(),
                "recording_name": recording_owner_by_path.get(relative_path),
            }
            if path.suffix.lower() in IMAGE_EXTENSIONS and generated_thumbnail.is_file():
                thumbnail_relative = generated_thumbnail.relative_to(folder).as_posix()
                artifact["thumbnail_url"] = _versioned_image_url(
                    generated_thumbnail,
                    f"/observations/{quote(folder.name)}/{quote(thumbnail_relative)}",
                )
            artifacts.append(artifact)
            total_size += stat.st_size
            if path.suffix.lower() in IMAGE_EXTENSIONS:
                images.append(artifact)

        recordings: List[Dict[str, Any]] = []
        if recording_root.is_dir():
            for meta in recording_root.glob("*.sigmf-meta"):
                data = meta.with_suffix(".sigmf-data")
                if not data.is_file():
                    continue
                stat = data.stat()
                name = meta.stem
                metadata = _sigmf_summary(meta)
                recordings.append(
                    {
                        "type": "recording",
                        "name": name,
                        "observation_bundle": folder.name,
                        "data_file": data.name,
                        "meta_file": meta.name,
                        "data_size": stat.st_size,
                        "meta_size": meta.stat().st_size,
                        "created": _iso(stat.st_ctime),
                        "modified": _iso(stat.st_mtime),
                        "metadata": metadata,
                        "recording_in_progress": metadata.get("recording_in_progress", False),
                        "snapshot": self._snapshot_info(
                            recording_root / f"{name}.png",
                            f"/observations/{quote(folder.name)}/recordings",
                            recording_root / "thumbnails" / f"{name}.jpg",
                        ),
                        "download_urls": {
                            "data": f"/observations/{quote(folder.name)}/recordings/{quote(data.name)}",
                            "meta": f"/observations/{quote(folder.name)}/recordings/{quote(meta.name)}",
                        },
                    }
                )
        item.update(
            {
                "size": total_size,
                "images": images,
                "artifacts": artifacts,
                "artifact_count": len(artifacts),
                "image_count": len(images),
                "recordings": recordings,
                "recording_count": len(recordings),
                "metadata": _read_json(manifest_path),
            }
        )
        return item

    def _delete_item(self, item: Dict[str, Any]) -> None:
        path = Path(str(item["_path"])).resolve()
        item_type = str(item.get("type"))
        allowed_roots = {
            "recording": self.roots.recordings,
            "snapshot": self.roots.snapshots,
            "decoded": self.roots.decoded,
            "decoded_folder": self.roots.decoded,
            "audio": self.roots.audio,
            "transcription": self.roots.transcriptions,
        }
        root = (
            self.roots.observations
            if item.get("folder_kind") == "observation"
            else allowed_roots.get(item_type)
        )
        if root is None:
            raise OSError("Unsupported library item")
        try:
            path.relative_to(root.resolve())
        except ValueError as exc:
            raise OSError("Refusing to delete a path outside the library") from exc
        if not path.exists():
            raise OSError("Item not found")
        if item_type == "recording":
            base = path.with_suffix("")
            for associated in (
                base.with_suffix(".sigmf-data"),
                base.with_suffix(".sigmf-meta"),
                base.with_suffix(".png"),
                base.parent / "thumbnails" / f"{base.name}.jpg",
            ):
                if associated.is_file():
                    associated.unlink()
            return
        if path.is_dir():
            shutil.rmtree(path)
        elif path.is_file():
            path.unlink()
            if item_type in {"audio", "decoded", "snapshot"}:
                metadata_path = path.with_suffix(".json")
                if metadata_path.is_file():
                    metadata_path.unlink()
            if item_type == "snapshot":
                thumbnail = path.parent / "thumbnails" / f"{path.stem}.jpg"
                if thumbnail.is_file():
                    thumbnail.unlink()


_inventories: Dict[Path, LibraryInventory] = {}
_inventories_lock = threading.Lock()


def get_inventory(backend_dir: Optional[Path] = None) -> LibraryInventory:
    """Return the process-local inventory for a backend root."""
    root = (backend_dir or Path(__file__).resolve().parents[1]).resolve()
    with _inventories_lock:
        inventory = _inventories.get(root)
        if inventory is None:
            inventory = LibraryInventory(root)
            _inventories[root] = inventory
        return inventory


def publish_ready_artifacts(inventory: LibraryInventory) -> None:
    """Publish after a worker-thread rebuild returns to the server event loop."""
    for item in inventory.take_ready():
        public_events.artifact_ready(item["id"], item["type"], item["name"])
