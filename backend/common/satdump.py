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


def resolve_satdump_bundle(bundle_dir: str | Path, backend_dir: Path) -> Path:
    """Accept only an existing observation bundle directly in the observations library."""
    root = (backend_dir / "data" / "observations").resolve()
    candidate = Path(bundle_dir)
    resolved = candidate.resolve()
    if (
        candidate.is_symlink()
        or resolved.parent != root
        or resolved.suffix != ".gsobs"
        or not (resolved / "manifest.json").is_file()
    ):
        raise ValueError("Invalid SatDump observation bundle.")
    return resolved


def resolve_satdump_output_dir(
    output_dir: str | Path, backend_dir: Path, observation_bundle: str | Path | None = None
) -> Path:
    """Constrain cleanup and output to shared decoded storage or an explicit owner."""
    if observation_bundle is None:
        decoded_root = (backend_dir / "data" / "decoded").resolve()
    else:
        bundle = resolve_satdump_bundle(observation_bundle, backend_dir)
        # A symlinked decoded directory must not redirect a bundle's products.
        decoded_root = bundle / "decoded"
        if decoded_root.resolve() != decoded_root:
            raise ValueError("Invalid SatDump output directory in observation bundle.")
    output_path = Path(output_dir)
    if not output_path.is_absolute() or output_path.is_relative_to("/decoded"):
        output_path = backend_dir / "data" / str(output_path).lstrip("/")

    try:
        output_path = ensure_path_in_allowed_roots(output_path, [decoded_root])
    except ValueError:
        raise ValueError("SatDump output directory must be within its decoded directory.") from None

    # Cleanup must never be able to remove the decoded library itself.
    if output_path == decoded_root:
        raise ValueError(
            "SatDump output directory must be a subdirectory of its decoded directory."
        )
    return output_path
