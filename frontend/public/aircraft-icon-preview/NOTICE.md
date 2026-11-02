# Aircraft icon preview

This standalone preview contains 92 tar1090 marker definitions (81 aviation
silhouettes and 11 ground, utility, fallback or novelty markers), plus three
supplementary Tabler icons. Ground Station's aircraft map uses this locally
bundled artwork, with model-specific icons and class/category fallbacks.
Novelty markers are available only in this gallery.

## tar1090

Source: https://github.com/wiedehopf/tar1090

Revision: `5d59b1ba2c5e30eb23f1161940367b7767f10ad5`

Original shape definitions:
https://github.com/wiedehopf/tar1090/blob/5d59b1ba2c5e30eb23f1161940367b7767f10ad5/html/markers.js

tar1090 is modified and developed by Matthias Wirth, based on FlightAware's
dump1090. The project is distributed under GPL version 2 or later; see
`LICENSE.tar1090.txt`. Retain that license and these notices when reusing the
artwork. Ground Station's preview renderer is GPL-3.0-or-later.

The original source specifically credits:

- **pimlie** for refined A320/B737-family SVGs and the E390 icon.
- **Peter Lowden** for the C130 silhouette, separately licensed under
  [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
  Original discussion:
  https://discussions.flightaware.com/ads-b-flight-tracking-f21/some-custom-svg-plane-icons-t37783.html
  The full license is included in `LICENSE.CC-BY-4.0.txt`.
- **alkissack** for the F-16/high-performance icon, with a reference to
  https://github.com/alkissack/Dump1090-OpenLayers3-html
- **bukadako** for the A400 icon:
  https://discussions.flightaware.com/t/some-custom-svg-plane-icons/18914/195

Adaptations: extracted the literal shape data without executing upstream code;
rendered it on the aircraft map and in a searchable gallery with descriptive
labels, adjustable size, heading, terrain and matching silhouette shadows.
The original path geometry,
accent paths, view boxes, aspect-ratio settings and fixed-rotation flags are
preserved. Colors and stroke styling are supplied by Ground Station. The map
normalizes each silhouette to a stable marker box while retaining upstream
relative model scaling and uses the same symbol for its ground shadow.

The bundled ICAO type-designator/description mappings are also extracted from
the pinned tar1090 source. Ground Station adds class/engine fallbacks, uses a
generic jet for an unidentified single-engine jet rather than inferring a
fighter, and maps ADS-B B3/B4/B7 to ultralight/parachutist/space-vehicle
categories respectively. Military flags do not select a silhouette.

## Tabler

Source: https://github.com/tabler/tabler-icons

Revision: `ed177a085b652fe04ec4f37ced867c94621e7840`

Supplementary outline icons: `rocket`, `parachute`, `drone`.

Copyright (c) 2020–2026 Paweł Kuna. Distributed under the MIT License, included
in `LICENSE.tabler.txt`. The preview preserves their original orientation;
these are UI illustrations rather than top-view aircraft silhouettes. The map
uses the parachute for an unidentified B4 parachutist and the rocket for B7
space vehicles, without rotating those illustrations with track heading.

## Reproducibility

`sources.json` records the pinned download URLs and SHA-256 hashes of the
upstream shape source, supplemental SVGs and license files. All preview assets
are bundled locally; neither the map nor this page downloads icons from external
servers. The canonical artwork and model mappings are in
`frontend/src/components/packetmap/icons/aircraft.json`; `icons.js` is the
standalone gallery snapshot of its `shapes` and `supplemental` fields.
