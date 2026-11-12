#!/usr/bin/env bash
# Start the local backend with one consistent GNU Radio installation.
#
# The backend venv contains regular Python dependencies and an older GNU Radio
# build.  Keep those dependencies, but make both GNU Radio's Python modules and
# their shared libraries come from the same /opt installation.

set -euo pipefail

# Development launches identify themselves without changing census consent.
export GS_FEEDBACK_ENVIRONMENT="${GS_FEEDBACK_ENVIRONMENT:-development}"

backend_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
venv_python="$backend_dir/venv/bin/python"
gnu_radio_prefix="${GNU_RADIO_PREFIX:-/opt/ground-station/gnuradio-3.10.12.0}"
volk_prefix="${GNU_RADIO_VOLK_PREFIX:-/opt/ground-station/volk-3.2.0}"

if [[ ! -x "$venv_python" ]]; then
    echo "Backend virtual-environment Python was not found: $venv_python" >&2
    exit 1
fi

python_version="$($venv_python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
gnu_radio_python="$gnu_radio_prefix/lib/python$python_version/site-packages"

if [[ ! -d "$gnu_radio_python/gnuradio" || ! -d "$gnu_radio_prefix/lib" ]]; then
    echo "GNU Radio installation is incomplete: $gnu_radio_prefix" >&2
    echo "Set GNU_RADIO_PREFIX to an installation matching Python $python_version." >&2
    exit 1
fi

# LD_LIBRARY_PATH has precedence over a binary's RUNPATH.  Put the matching
# /opt libraries first so a pre-existing venv/lib entry cannot load an older
# library with GNU Radio's identical SONAME.
library_paths=("$gnu_radio_prefix/lib")
if [[ -d "$volk_prefix/lib" ]]; then
    library_paths+=("$volk_prefix/lib")
fi
if [[ -n "${LD_LIBRARY_PATH:-}" ]]; then
    library_paths+=("$LD_LIBRARY_PATH")
fi
export LD_LIBRARY_PATH="$(IFS=:; echo "${library_paths[*]}")"

# This also works in a freshly created venv, before its optional .pth file has
# been configured.  Keep the venv on sys.path for all non-GNU-Radio packages.
export PYTHONPATH="$gnu_radio_python${PYTHONPATH:+:$PYTHONPATH}"
export PATH="$gnu_radio_prefix/bin:$PATH"
export GNU_RADIO_PREFIX="$gnu_radio_prefix"

cd "$backend_dir"

if [[ "${1:-}" == "--check-gnuradio" ]]; then
    if [[ "$#" -ne 1 ]]; then
        echo "--check-gnuradio does not accept backend arguments" >&2
        exit 2
    fi

    exec "$venv_python" - <<'PY'
import os
from pathlib import Path

from gnuradio import blocks, filter, gr
from demodulators.aprsdecoder import APRSDecoder
from demodulators.gfskdecoder import GFSKDecoder
from demodulators.bpskdecoder import BPSKDecoder
from pipeline.registries.decoderregistry import decoder_registry

prefix = Path(os.environ["GNU_RADIO_PREFIX"]).resolve()
module_paths = {"blocks": blocks.__file__, "filter": filter.__file__, "gr": gr.__file__}
for name, module_path in module_paths.items():
    if not Path(module_path).resolve().is_relative_to(prefix):
        raise RuntimeError(f"{name} was imported outside {prefix}: {module_path}")

known_core_library_names = {
    library.resolve().name
    for library in (prefix / "lib").glob("libgnuradio-*.so*")
    if library.is_file()
}
loaded_gnuradio_libraries = {
    Path(line.rsplit(maxsplit=1)[-1]).resolve()
    for line in Path("/proc/self/maps").read_text().splitlines()
    if "/libgnuradio-" in line
}
loaded_core_libraries = {
    library for library in loaded_gnuradio_libraries if library.name in known_core_library_names
}
if not any(library.name.startswith("libgnuradio-filter.so") for library in loaded_core_libraries):
    raise RuntimeError("GNU Radio filter library was not loaded")
if any(not library.is_relative_to(prefix) for library in loaded_core_libraries):
    raise RuntimeError(
        "GNU Radio core shared libraries were not all loaded from "
        f"{prefix}: {sorted(map(str, loaded_core_libraries))}"
    )

required = {"aprs", "gfsk", "bpsk"}
registered = set(decoder_registry.list_decoders())
missing = required - registered
if missing:
    raise RuntimeError(f"Missing decoder registrations: {', '.join(sorted(missing))}")

print("GNU Radio imports passed")
print("GNU Radio Python modules:", ", ".join(sorted(module_paths.values())))
print("GNU Radio core shared libraries:", ", ".join(sorted(map(str, loaded_core_libraries))))
print("Decoder imports passed:", APRSDecoder.__name__, GFSKDecoder.__name__, BPSKDecoder.__name__)
print("Registered decoders:", ", ".join(sorted(registered)))
PY
fi

exec "$venv_python" app.py "$@"
