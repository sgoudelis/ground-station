These radiosonde PNG markers were supplied by the project maintainer for use in
Ground Station:

- `balloon.png`: `radiosonde_balloon_icon_128.png`, used during ascent or when the flight phase is unknown.
- `parachute.png`: `radiosonde_parachute_icon_128.png`, used during descent.

Both transparent images are resized directly from the original 128 × 128 files
to 80 × 80 pixels and displayed at 80 × 80 CSS pixels on the map. Their colors are
preserved, with the map adding the altitude lift and ground shadow.

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
