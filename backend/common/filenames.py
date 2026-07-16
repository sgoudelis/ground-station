from __future__ import annotations

import re
from pathlib import Path
from typing import Any, cast

from common.pathguard import ensure_path_in_allowed_roots

_UNSAFE_FILENAME_CHARS = re.compile(r"[^A-Za-z0-9._-]+")
_MULTI_UNDERSCORES = re.compile(r"_+")


def sanitize_filename_component(
    value: Any,
    *,
    default: str = "unknown",
    max_length: int = 120,
) -> str:
    """Normalize user-controlled text to a safe single filename component."""
    text = str(value or "").strip()
    if not text:
        text = default

    # Flatten separators and whitespace before character filtering.
    text = text.replace("/", "_").replace("\\", "_")
    text = re.sub(r"\s+", "_", text)
    text = _UNSAFE_FILENAME_CHARS.sub("_", text)
    text = _MULTI_UNDERSCORES.sub("_", text)

    # Avoid hidden/special filesystem entries and trim noisy edges.
    text = text.lstrip(".").strip("._-")
    if not text:
        text = default

    if len(text) > max_length:
        text = text[:max_length].rstrip("._-")
        if not text:
            text = default

    return text


def looks_like_path_input(value: Any) -> bool:
    """Detect path-like user input that should never be treated as a filename."""
    text = str(value or "").strip()
    if not text:
        return False
    return Path(text).is_absolute() or ".." in text or "/" in text or "\\" in text


def resolve_base_path_within_root(root_dir: str | Path, base_name: str) -> Path:
    """Return a resolved base path constrained to the provided root directory."""
    root = Path(root_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    # `ensure_path_in_allowed_roots` is fully typed, but mypy may treat imports
    # as `Any` depending on invocation scope; cast keeps this boundary explicit.
    return cast(Path, ensure_path_in_allowed_roots(root / base_name, [root]))
