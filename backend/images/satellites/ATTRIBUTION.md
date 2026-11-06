Source imagery for satellite icon assets under `full/` in this folder.

- `full/57172.png` (UMKA-1 icon source image)
  - Source URL: https://space.skyrocket.de/img_sat/umka-1__1.jpg
  - Description: UMKA-1 (Russian educational CubeSat)
  - Processing note: white background removed via color-key + edge-connected flood fill, then exported as transparent icon presets:
    - `64/57172.png`
    - `128/57172.png`
    - `256/57172.png`

- `full/25544.png` (ISS icon source image)
  - Source URL: https://upload.wikimedia.org/wikipedia/commons/f/f2/ISS_spacecraft_model_1.png
  - Description: International Space Station (ISS) spacecraft model render
  - Processing note: source transparency preserved, foreground trimmed and center-fitted, then exported as transparent icon presets:
    - `64/25544.png`
    - `128/25544.png`
    - `256/25544.png`

- `full/7530.png` (OSCAR 7 icon source image)
  - Source URL: https://en.wikipedia.org/wiki/AMSAT-OSCAR_7#/media/File:AMSAT-OSCAR_7.jpg (direct file: https://upload.wikimedia.org/wikipedia/en/a/ad/AMSAT-OSCAR_7.jpg)
  - Description: AMSAT-OSCAR 7 (AO-7) amateur radio satellite
  - Processing note: white background removed via edge-connected color-key extraction, foreground tight-trimmed and center-fitted, then exported as transparent icon presets:
    - `64/7530.png`
    - `128/7530.png`
    - `256/7530.png`

- `full/43700.png` (Es'hail 2 icon source image)
  - Source URL: https://www.aerospace-technology.com/projects/eshail-2-communication-satellite (official Es'hailSat / Mitsubishi Electric orbit render, image credit Mitsubishi Electric Corporation)
  - Description: Es'hail 2 / QO-100 geostationary satellite (Mitsubishi DS2000 bus) orbit render, full spacecraft over starfield
  - Processing note: replaced 2026-11-06 (previous sources extracted incomplete: horizon cut lost the lower array, glow-keyed floods left atmospheric-glow blobs). Solar arrays keyed by saturated blue, bus/rims by bright non-warm luminance, golden nebula glow dropped as warm-bright background, dark antenna dishes and bus side kept via explicit shapes; star specks dropped by component size, enclosed panel gaps and dish interiors hole-filled, flare remnants cut manually; master capped at 256x256, then exported as transparent icon presets:
    - `64/43700.png`
    - `128/43700.png`
    - `256/43700.png`

- `full/965.png` (OPS 6582 / TRANSIT 5B-5 icon source image)
  - Source URL: https://commons.wikimedia.org/wiki/File:Navigational_Satellite%2C_Transit_5-A_-_DPLA_-_199a8ed1caff1623440a9c0725f12558.jpg (direct file: https://upload.wikimedia.org/wikipedia/commons/8/8d/Navigational_Satellite%2C_Transit_5-A_-_DPLA_-_199a8ed1caff1623440a9c0725f12558.jpg)
  - Description: Transit-family navigation satellite silhouette image used as improved visual source for NORAD 965 icon assets
  - Processing note: white background removed via edge-connected extraction, foreground tight-trimmed and center-fitted, then exported as transparent icon presets:
    - `64/965.png`
    - `128/965.png`
    - `256/965.png`

## Batch added 2026-11-06 (missing icons from production 404 log)

- `full/19548.png`, `full/21639.png` (TDRS 3 / TDRS 5 icon source image)
  - Source URL: https://commons.wikimedia.org/wiki/File:TDRS_gen1.jpg (direct file: https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/TDRS_gen1.jpg/1920px-TDRS_gen1.jpg)
  - Description: TDRS Block B tracking and data-relay satellite in orbit
  - Processing note: source pre-cropped to the satellite (Earth limb and clouds excluded), background removed via edge-connected extraction with largest-blob cleanup, then exported as transparent icon presets:
    - `64/19548.png`, `64/21639.png`
    - `128/19548.png`, `128/21639.png`
    - `256/19548.png`, `256/21639.png`

- `full/22563.png`, `full/22787.png`, `full/23467.png`, `full/25967.png`, `full/28117.png`, `full/32711.png` (GPS Block II / IIR icon source image)
  - Source URL: https://commons.wikimedia.org/wiki/File:GPS-24_satellite.png (direct file: https://upload.wikimedia.org/wikipedia/commons/4/42/GPS-24_satellite.png)
  - Description: GPS-24 (Block II) Navstar navigation satellite, NASA Goddard public-domain photo
  - Processing note: white background removed via edge-connected extraction, foreground tight-trimmed and center-fitted, then exported as transparent icon presets for the UFO/Navstar IDs listed above.

- `full/23839.png` (Inmarsat 3-F1 icon source image)
  - Source URL: https://space.skyrocket.de/img_sat/inmarsat-3__1.jpg
  - Description: Inmarsat-3 maritime communications satellite
  - Processing note: background removed via edge-connected extraction with largest-blob cleanup, then exported as transparent icon presets (`64/`, `128/`, `256/`).

- `full/25924.png`, `full/27825.png`, `full/28526.png`, `full/28786.png` (Boeing 702-class GEO comsat icon source image)
  - Source URL: https://space.skyrocket.de/img_sat/nss-9__1.jpg
  - Description: NSS-9 (Boeing 702 bus) spacecraft render
  - Processing note: used as the bus-accurate proxy for Boeing-702-class GEO comsats NSS-10, ABS-6, Thuraya-2 and Thaicom 4; background removed via edge-connected extraction with largest-blob cleanup, then exported as transparent icon presets (`64/`, `128/`, `256/`).

- `full/28485.png` (Swift Observatory icon source image)
  - Source URL: https://commons.wikimedia.org/wiki/File:Swift_Observatory_spacecraft_model.png (direct file: https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Swift_Observatory_spacecraft_model.png/1920px-Swift_Observatory_spacecraft_model.png)
  - Description: Swift Gamma-Ray Burst Observatory spacecraft model
  - Processing note: background removed via edge-connected extraction, then exported as transparent icon presets (`64/`, `128/`, `256/`).

- `full/40296.png`, `full/45254.png` (Meridian 7 / Meridian 9 icon source image)
  - Source URL: https://space.skyrocket.de/img_sat/meridian__3.jpg
  - Description: Meridian (14F112) military communications satellite
  - Processing note: background removed via edge-connected extraction with largest-blob cleanup, then exported as transparent icon presets (`64/`, `128/`, `256/`).

- `full/40374.png`, `full/40887.png` (MUOS-3 / MUOS-4 icon source image)
  - Source URL: https://commons.wikimedia.org/wiki/File:MUOS_new.jpg (direct file: https://upload.wikimedia.org/wikipedia/commons/0/09/MUOS_new.jpg)
  - Description: MUOS (Mobile User Objective System) spacecraft render
  - Processing note: background removed via edge-connected extraction keeping the largest blob (floor reflection dropped), then exported as transparent icon presets (`64/`, `128/`, `256/`).

- `full/43432.png` (COSMOS 2526 / Blagovest icon source image)
  - Source URL: https://space.skyrocket.de/img_sat/express__1.jpg
  - Description: Express-1000 platform render (COSMOS 2526 is a Blagovest signals-comsat on the Express-1000 bus; the large deployable reflector is the platform's antenna)
  - Processing note: background removed via edge-connected extraction with largest-blob cleanup, then exported as transparent icon presets (`64/`, `128/`, `256/`).

- `full/59481.png` (WSF-M icon source image)
  - Source URL: https://space.skyrocket.de/img_sat/wsf-m__1.jpg
  - Description: WSF-M (Weather System Follow-on – Microwave) satellite
  - Processing note: background removed via edge-connected extraction with largest-blob cleanup, then exported as transparent icon presets (`64/`, `128/`, `256/`).

- `full/100744.png` (COSMOS 2620 / GLONASS-K1 icon source image)
  - Source URL: https://commons.wikimedia.org/wiki/File:Glonass_K_model_at_Cebit_2011_Satellite,_sideview_1.jpg (direct file: https://upload.wikimedia.org/wikipedia/commons/4/4f/Glonass_K_model_at_Cebit_2011_Satellite%2C_sideview_1.jpg)
  - Description: GLONASS-K satellite model at CeBIT 2011
  - Processing note: source pre-cropped to the model (crowd and exhibition banner excluded), background removed via edge-connected extraction keeping the largest blob, then exported as transparent icon presets (`64/`, `128/`, `256/`).

- `full/59909.png`, `full/59910.png`, `full/61195.png`, `full/61196.png`, `full/61197.png`, `full/61198.png`, `full/62365.png`, `full/62366.png`, `full/62367.png`, `full/62368.png`, `full/64058.png`, `full/64059.png`, `full/64060.png`, `full/64061.png`, `full/67476.png`, `full/67479.png` (Tianqi constellation icon source image)
  - Source URL: https://space.skyrocket.de/img_sat/tianqi-1__2.jpg
  - Description: Tianqi (天启) LEO NB-IoT satellite
  - Processing note: background removed via edge-connected extraction with largest-blob cleanup, then exported as transparent icon presets (`64/`, `128/`, `256/`) for the Tianqi IDs listed above.

- `full/60478.png` (WREN-1 icon source image)
  - Source URL: https://space.skyrocket.de/img_sat/wren-1__1.jpg
  - Description: WREN-1 (Surrey Space Centre) technology demonstrator satellite
  - Processing note: background removed via edge-connected extraction with largest-blob cleanup, then exported as transparent icon presets (`64/`, `128/`, `256/`).

- `full/62686.png`, `full/64536.png`, `full/66788.png` (FOSSASat icon source image)
  - Source URL: https://space.skyrocket.de/img_sat/fossasat-2__1.jpg
  - Description: FOSSASat-2 CubeSat render
  - Processing note: background removed via edge-connected extraction, teal render shadow removed via color-key plus largest-blob cleanup, then exported as transparent icon presets (`64/`, `128/`, `256/`) for the FOSSASat IDs listed above.

- `full/67264.png` (KOSAR 1.5 icon source image)
  - Source URL: https://space.skyrocket.de/img_sat/kowsar__1.jpg
  - Description: Kosar/Kowsar Earth-observation satellite
  - Processing note: background removed via edge-connected extraction with largest-blob cleanup, then exported as transparent icon presets (`64/`, `128/`, `256/`).

- `full/101228.png` (NVS-01 icon source image)
  - Source URL: https://commons.wikimedia.org/wiki/File:GSLV-F12,_NVS-01_-_Second-generation_navigation_satellite_NVS-01(aka_IRNSS-1J)_for_NavIC_01.webp
  - Description: NVS-01 (IRNSS-1J) second-generation NavIC navigation satellite before encapsulation
  - Processing note: source pre-cropped to the satellite, background removed via edge-connected extraction, then exported as transparent icon presets (`64/`, `128/`, `256/`).

- `full/101257.png` (QPS-SAR-20 icon source image)
  - Source URL: https://space.skyrocket.de/img_sat/qps-sar-1__1.jpg
  - Description: QPS-SAR synthetic-aperture-radar smallsat
  - Processing note: background removed via edge-connected extraction with largest-blob cleanup, then exported as transparent icon presets (`64/`, `128/`, `256/`).

- `full/100948.png`, `full/101227.png` (Planet Flock icon source image)
  - Source URL: https://space.skyrocket.de/img_sat/flock-1__2.jpg
  - Description: Planet Labs Flock/Dove Earth-imaging satellite render
  - Processing note: background removed via edge-connected extraction with largest-blob cleanup, then exported as transparent icon presets (`64/`, `128/`, `256/`) for the Flock 4j IDs listed above.

- Existing-master reuses (same bus / same constellation, icon copied from an existing master in `full/`):
  - `full/52704.png` <- `full/44716.png` (STARLINK-3999 from Starlink v1.5)
  - `full/66177.png` <- `full/53043.png` (STARLINK from Starlink v2-mini)
  - `full/62695.png`, `full/64534.png`, `full/64555.png`, `full/67402.png` <- `full/60472.png` (Connecta IOT)
  - `full/57166.png`, `full/59051.png` <- `full/40069.png` (Meteor-M2 3/4 from Meteor-M 2)
  - `full/23455.png` <- `full/15427.png` (NOAA 14 from NOAA 9, TIROS-N bus)
  - `full/66661.png` <- `full/52899.png` (SNUGLITE-III from SNUGLITE-II)

- `full/27848.png` reused as the neutral generic-CubeSat icon for unidentified objects and missions without public imagery:
  - NORAD 57037, 57179, 57202, 61775, 64627, 64882, 64894, 67261, 67262, 67277, 67280, 67281, 67286, 67290, 68980, 69794, 69925, 43786, 100089, 100965, 101095, 101098
  - Processing note: existing transparent master reused unchanged, presets regenerated for each ID via `64/`, `128/`, `256/` center-fit.
