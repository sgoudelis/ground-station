"""
Shared image thumbnail helpers for file-browser previews.
"""

from pathlib import Path
from typing import Optional, Tuple

from PIL import Image

THUMBNAIL_DIRECTORY = "thumbnails"
THUMBNAIL_EXTENSION = ".jpg"
DEFAULT_THUMBNAIL_SIZE = (640, 360)
DEFAULT_THUMBNAIL_QUALITY = 82


def get_image_thumbnail_path(source_path: Path) -> Path:
    """Return the deterministic cached thumbnail path for an image."""
    return source_path.parent / THUMBNAIL_DIRECTORY / f"{source_path.stem}{THUMBNAIL_EXTENSION}"


def generate_image_thumbnail(
    source_path: Path,
    target_size: Tuple[int, int] = DEFAULT_THUMBNAIL_SIZE,
    quality: int = DEFAULT_THUMBNAIL_QUALITY,
    force: bool = False,
) -> Optional[Path]:
    """Create or reuse a lightweight JPEG thumbnail for an image."""
    if not source_path.exists() or not source_path.is_file():
        return None

    thumb_path = get_image_thumbnail_path(source_path)
    if thumb_path.exists() and thumb_path.is_file() and not force:
        try:
            if thumb_path.stat().st_mtime >= source_path.stat().st_mtime:
                return thumb_path
        except OSError:
            pass

    thumb_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_thumb_path = thumb_path.with_name(f".{thumb_path.name}.tmp")

    try:
        with Image.open(source_path) as image:
            target_w, target_h = target_size
            rgb = image.convert("RGB")
            rgb.thumbnail((target_w, target_h), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (target_w, target_h), color=(10, 10, 10))
            x_offset = (target_w - rgb.width) // 2
            y_offset = (target_h - rgb.height) // 2
            canvas.paste(rgb, (x_offset, y_offset))
            canvas.save(
                tmp_thumb_path,
                format="JPEG",
                quality=quality,
                optimize=True,
            )

        # Atomic replace keeps concurrent lazy generation from serving partial files.
        tmp_thumb_path.replace(thumb_path)
        return thumb_path
    except Exception:
        try:
            if tmp_thumb_path.exists():
                tmp_thumb_path.unlink()
        except Exception:
            pass
        return None


def get_image_thumbnail_url(
    source_path: Path,
    mount_path: str,
    lazy_generate: bool = True,
) -> Optional[str]:
    """Return a cache-busted static URL for an image thumbnail."""
    thumb_path = (
        generate_image_thumbnail(source_path)
        if lazy_generate
        else get_image_thumbnail_path(source_path)
    )
    if not thumb_path or not thumb_path.exists() or not thumb_path.is_file():
        return None

    try:
        relative_thumb = thumb_path.relative_to(source_path.parent).as_posix()
    except ValueError:
        return None

    thumb_version = int(thumb_path.stat().st_mtime)
    return f"{mount_path.rstrip('/')}/{relative_thumb}?v={thumb_version}"


def delete_image_thumbnail(source_path: Path) -> Optional[Path]:
    """Delete the cached thumbnail for an image when it exists."""
    thumb_path = get_image_thumbnail_path(source_path)
    if not thumb_path.exists() or not thumb_path.is_file():
        return None

    thumb_path.unlink()
    return thumb_path
