"""Install the licensed Mictronics snapshot for readsb and aircraft enrichment.

Uses only the standard library so the same installer runs in native and Docker builds.
"""

import argparse
import gzip
import hashlib
import io
import json
import os
import re
import tempfile
import urllib.request
import zipfile
from pathlib import Path

SOURCE = "https://github.com/Mictronics/aircraft-database"
REVISION = "52d05bb6c8dcb01d2f96a3144afa94bd3d00438e"
SNAPSHOT_DATE = "2026-11-01"
ARCHIVES = {
    "indexedDB.zip": "88bddea94d78a65e047164fb950cc6fc16661e8251f6949e8ed978c06fbadc22",
    "indexedDB_old.zip": "7a2808f232a9060dd685219f30975a09025db9586bce85c962e55a6e0d59953b",
}


def download(name):
    url = f"https://raw.githubusercontent.com/Mictronics/aircraft-database/{REVISION}/{name}"
    with urllib.request.urlopen(url, timeout=60) as response:
        content = response.read()
    if hashlib.sha256(content).hexdigest() != ARCHIVES[name]:
        raise ValueError(f"Checksum mismatch for {name}")
    return zipfile.ZipFile(io.BytesIO(content))


def csv_value(value):
    # readsb's parser uses literal semicolons, without CSV quoting/escaping.
    # Its JSON writer copies these descriptions verbatim, so remove JSON delimiters too.
    replacements: dict[str, str | int | None] = {
        ";": ",",
        '"': "'",
        "\\": "/",
        "\r": " ",
        "\n": " ",
    }
    return str(value or "").translate(str.maketrans(replacements))


def install(output, compact, detailed):
    aircraft = json.loads(detailed.read("aircrafts.json"))
    types = json.loads(compact.read("types.json"))
    operators = json.loads(compact.read("operators.json"))
    version = json.loads(compact.read("dbversion.json"))["version"]
    if version != json.loads(detailed.read("dbversion.json"))["version"]:
        raise ValueError("Mictronics export versions do not match")
    if compact.read("LICENSE") != detailed.read("LICENSE"):
        raise ValueError("Mictronics export licenses do not match")
    metadata = {
        "database": {
            "name": "Mictronics Aircraft Database",
            "version": version,
            "date": SNAPSHOT_DATE,
            "revision": REVISION,
            "url": SOURCE,
            "license": "ODC-By-1.0",
            "license_url": f"{SOURCE}/blob/{REVISION}/LICENSE",
        },
        "types": types,
        "operators": operators,
    }
    output.mkdir(parents=True, exist_ok=True)
    # Stage the complete snapshot before publishing files. A failed download or
    # conversion leaves the installed database untouched. Replace the CSV last.
    with tempfile.TemporaryDirectory(prefix=".aircraft-", dir=output) as temporary:
        staging = Path(temporary)
        with (staging / "aircraft.csv.gz").open("wb") as stream:
            with gzip.GzipFile(fileobj=stream, mode="wb", mtime=0, filename="") as compressed:
                for address, record in sorted(aircraft.items()):
                    if not re.fullmatch(r"[0-9A-Fa-f]{6}", address):
                        raise ValueError(f"Invalid ICAO address: {address}")
                    flags = record.get("f", "00")
                    if not re.fullmatch(r"[01]{2}", flags):
                        raise ValueError(f"Invalid aircraft flags: {address}")
                    model = record.get("d") or types.get(record.get("t"), [""])[0]
                    # Flags are least-significant-bit first: '10' means military.
                    fields = [address, record.get("r"), record.get("t"), flags, model, "", "", ""]
                    compressed.write(
                        (";".join(csv_value(value) for value in fields) + "\n").encode()
                    )
        (staging / "metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False), encoding="utf-8"
        )
        (staging / "LICENSE").write_bytes(compact.read("LICENSE"))
        (staging / "NOTICE").write_text(
            f"Contains information from the Mictronics Aircraft Database ({SOURCE}), "
            "which is made available under the ODC Attribution License.\n"
            f"License: {metadata['database']['license_url']}\n"
            f"Snapshot: {SNAPSHOT_DATE}; revision: {REVISION}; database version: {version}.\n"
            "Ground Station converts the aircraft records to readsb CSV format and retains "
            "type and operator lookup tables. See LICENSE in this directory.\n",
            encoding="utf-8",
        )
        for name in ("metadata.json", "LICENSE", "NOTICE", "aircraft.csv.gz"):
            os.replace(staging / name, output / name)
    return len(aircraft)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "adsb"
    )
    args = parser.parse_args()
    with download("indexedDB.zip") as compact, download("indexedDB_old.zip") as detailed:
        count = install(args.output, compact, detailed)
    print(f"Installed {count:,} aircraft in {args.output.resolve()}")


if __name__ == "__main__":
    main()
