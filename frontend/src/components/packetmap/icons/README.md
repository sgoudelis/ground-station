These radiosonde PNG markers were supplied by the project maintainer for use in
Ground Station:

- `balloon.png`: `radiosonde_balloon_icon_128.png`, used during ascent or when the flight phase is unknown.
- `parachute.png`: `radiosonde_parachute_icon_128.png`, used during descent.

Both transparent images are resized directly from the original 128 × 128 files
to 80 × 80 pixels and displayed at 80 × 80 CSS pixels on the map. Their colors are
preserved, with the map adding the altitude lift and ground shadow.

`meshtastic.png` was supplied by the project maintainer as
`Meshtastic-Style Green Map Pin Icon.png`. The transparent artwork is cropped to
the visible pin and resized to 96 × 125 pixels, preserving its original colors.
`meshtastic-shadow.png` precomposes the APRS/radiosonde shadows at 2× resolution:
a zero-offset, 2px blur at 56% black, followed by a 2px downward-offset, 4px blur
at 45.5% black, with 20 CSS pixels of transparent padding on each side.
Meshtastic nodes share one Leaflet canvas renderer and decoded shadow sprite.
The pin is displayed at 28 × 36.5 CSS pixels with the tip anchored to the reported
coordinates. Permanent callsign labels are drawn on the canvas above each pin;
the selected node retains the shared crosshair, with its label raised above it.
Text metrics are cached, and no per-frame shadow filters or tooltips are added.

The ten transparent APRS pins in `aprs/` were supplied by the project maintainer
in `Colorful Map Pin Icon Collection.png`. They were split from the sheet,
cleaned of detached background speckles, and fitted into 256 × 288 RGBA PNGs:

- `fixed.png`: fixed/home stations.
- `mobile.png`: land vehicles.
- `portable.png`: portable stations and people.
- `marine.png`: ships and sailboats.
- `airborne.png`: aircraft and other airborne symbols.
- `weather.png`: weather stations and weather symbols.
- `telemetry.png`: telemetry and computer stations.
- `digipeater.png`: digipeaters and repeaters.
- `igate.png`: gateways and satellite network stations.
- `object.png`: objects/items, emergency markers, and points of interest.

The map displays these pins at 40 × 45 CSS pixels, with the bottom tip anchored
to the reported coordinates. APRS balloons keep the existing balloon/parachute
markers and flight-phase behavior. Callsign labels and symbol overlays remain
separate from the supplied artwork.

Aircraft use `aircraft.json`: locally bundled tar1090 silhouettes and 382 ICAO
type-designator mappings, plus three supplementary Tabler icons. Known models
take priority, followed by aircraft class, engine configuration/wake category,
and the ADS-B emitter category. Unknown aircraft keep a generic plane icon.
Military flags alone never select a fighter silhouette.

The C130 silhouette is CC BY 4.0 (Peter Lowden), the other tar1090 artwork and
mappings are GPL-2.0-or-later, and Tabler icons are MIT (Paweł Kuna). See the
[full notices](../../../../public/aircraft-icon-preview/NOTICE.md) for pinned
sources, upstream contributors, license texts and adaptation notes.

The standalone gallery's `icons.js` is a generated snapshot of the same
`shapes` and `supplemental` data in `aircraft.json`. Keep it in sync when
updating artwork. Both the map and gallery render icons entirely locally;
the gallery also includes utility and novelty artwork that the aircraft map
does not select for aircraft.
