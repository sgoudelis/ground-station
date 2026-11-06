"""Shared SatDump input and output boundaries for scheduler and worker code."""

import re
from pathlib import Path

from common.pathguard import ensure_path_in_allowed_roots

SATDUMP_PIPELINES = frozenset(
    {
        "meteor_m2-x_lrpt",
        "meteor_m2-x_lrpt_80k",
        "meteor_hrpt",
        "elektro_lrit",
        "elektro_hrit",
    }
)


def validate_satdump_pipeline(pipeline: object) -> str:
    """Only accept supported identifiers, never paths or command-line options."""
    if not isinstance(pipeline, str) or re.fullmatch(r"[a-z0-9][a-z0-9_-]*", pipeline) is None:
        raise ValueError("Invalid SatDump pipeline identifier.")
    if pipeline not in SATDUMP_PIPELINES:
        raise ValueError("Unsupported SatDump pipeline.")
    return pipeline


def resolve_satdump_output_dir(output_dir: str | Path, backend_dir: Path) -> Path:
    """Resolve output beneath data/decoded, including existing symlink targets."""
    decoded_root = (backend_dir / "data" / "decoded").resolve()
    output_path = Path(output_dir)
    if not output_path.is_absolute() or output_path.is_relative_to("/decoded"):
        output_path = backend_dir / "data" / str(output_path).lstrip("/")

    try:
        output_path = ensure_path_in_allowed_roots(output_path, [decoded_root])
    except ValueError:
        raise ValueError("SatDump output directory must be within data/decoded.") from None

    # Cleanup must never be able to remove the decoded library itself.
    if output_path == decoded_root:
        raise ValueError("SatDump output directory must be a subdirectory of data/decoded.")
    return output_path
