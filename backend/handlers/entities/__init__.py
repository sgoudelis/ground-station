# Copyright (c) 2025 Efstratios Goudelis
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

"""Entity-based handlers for Socket.IO requests.

This package exposes each entity module so callers can import them via
`from handlers.entities import <module>` and have module-level registration
run as expected.
"""

from . import orbitalsources  # noqa: F401
from . import tlesources  # noqa: F401
from . import (
    appsettings,
    celestial,
    control,
    filebrowser,
    groups,
    hardware,
    locations,
    preferences,
    satellites,
    sdr,
    sessions,
    setup,
    systeminfo,
    tracking,
    transmitters,
    vfo,
)

__all__ = [
    "appsettings",
    "satellites",
    "orbitalsources",
    "tlesources",
    "groups",
    "hardware",
    "locations",
    "preferences",
    "setup",
    "transmitters",
    "tracking",
    "filebrowser",
    "sdr",
    "vfo",
    "systeminfo",
    "sessions",
    "celestial",
    "control",
]
