#!/usr/bin/env bash
# Regenerate telemetry/parsers/gen/*.py from telemetry/parsers/specs/*.ksy.
#
# Requires a JRE (11+) and the Kaitai Struct compiler; CI does not run this
# (generated modules are committed). Toolchain install example:
#   https://adoptium.net/ (Temurin JRE) and
#   https://github.com/kaitai-io/kaitai_struct_compiler/releases (zip)
# Point GS_JAVA at the java binary and GS_KSC at the compiler bin directory
# or the kaitai-struct-compiler launcher script.
set -euo pipefail

cd "$(dirname "$0")"
SPECS=telemetry/parsers/specs
GEN=telemetry/parsers/gen

resolve_java() {
    if [[ -n "${GS_JAVA:-}" && -x "${GS_JAVA}" && ! -d "${GS_JAVA}" ]]; then echo "$GS_JAVA"; return; fi
    if command -v java >/dev/null 2>&1; then command -v java; return; fi
    return 1
}

resolve_ksc() {
    if [[ -n "${GS_KSC:-}" ]]; then
        if [[ -x "$GS_KSC" && ! -d "$GS_KSC" ]]; then echo "$GS_KSC"; return; fi
        if [[ -x "$GS_KSC/kaitai-struct-compiler" ]]; then echo "$GS_KSC/kaitai-struct-compiler"; return; fi
    fi
    if command -v kaitai-struct-compiler >/dev/null 2>&1; then command -v kaitai-struct-compiler; return; fi
    return 1
}

if ! JAVA_BIN=$(resolve_java); then
    echo "ERROR: no java found. Install a JRE 11+ or set GS_JAVA=/path/to/java." >&2
    exit 1
fi
if ! KSC_BIN=$(resolve_ksc); then
    echo "ERROR: kaitai-struct-compiler not found. Download it from" >&2
    echo "  https://github.com/kaitai-io/kaitai_struct_compiler/releases" >&2
    echo "and set GS_KSC to its bin directory or launcher script." >&2
    exit 1
fi

# The compiler launcher script shells out to plain `java`; expose our choice.
export JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$JAVA_BIN")")}"
export PATH="$JAVA_HOME/bin:$PATH"

shopt -s nullglob
specs=("$SPECS"/*.ksy)
if (( ${#specs[@]} == 0 )); then
    echo "No specs found in $SPECS" >&2
    exit 1
fi

"$KSC_BIN" --target python --outdir "$GEN" "${specs[@]}"

echo "Generated ${#specs[@]} module(s) into $GEN"
echo "Run: ALEMBIC_CONTEXT=1 ./venv/bin/pytest -q tests/testkaitai.py  # then commit specs + gen"
