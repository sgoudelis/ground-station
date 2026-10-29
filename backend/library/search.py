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

"""Search compact library summaries without reading artifact contents."""

from typing import Any, Dict, List, Optional

MAX_SEARCH_LENGTH = 512

# Only user-facing metadata belongs in search, never serialized metadata,
# internal paths, packet payloads, or transcript bodies.
SEARCH_FIELDS = (
    "name",
    "display_name",
    "filename",
    "foldername",
    "data_file",
    "meta_file",
    "type",
    "folder_kind",
    "file_type",
    "satellite_name",
    "satellite_norad_id",
    "decoder_type",
    "decoder_mode",
    "protocol",
    "pipeline",
    "demodulator_type",
    "source_callsign",
    "destination_callsign",
    "transmitter_description",
    "transmitter_mode",
    "description",
    "provider",
    "language",
    "translate_to",
    "translation_backend",
)


def normalize_search(value: Any) -> str:
    """Validate and normalize a query consistently for RPC and direct callers."""
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValueError("search must be a string")
    if len(value) > MAX_SEARCH_LENGTH:
        raise ValueError(f"search must be at most {MAX_SEARCH_LENGTH} characters")
    return " ".join(value.split())


def search_text(item: Dict[str, Any]) -> str:
    """Build a cached, explicit metadata index when the catalogue is rebuilt."""
    return "\n".join(
        str(item[field]).casefold()
        for field in SEARCH_FIELDS
        if isinstance(item.get(field), (str, int, float)) and not isinstance(item[field], bool)
    )


def match_search(item: Dict[str, Any], tokens: List[str]) -> Optional[List[str]]:
    """Return a few matched members, an empty list for a direct hit, or None.

    Words may match different parent fields or the same contained filename.
    Requiring one child to match the remaining words avoids unrelated files
    combining into an accidental folder hit.
    """
    remaining = [token for token in tokens if token not in item["_search_text"]]
    if not remaining:
        return []
    matches = []
    for name, normalized in item.get("_search_members", ()):
        if all(token in normalized for token in remaining):
            matches.append(name)
            # Match hints stay bounded even when a folder has many artifacts.
            if len(matches) == 3:
                break
    return matches or None
