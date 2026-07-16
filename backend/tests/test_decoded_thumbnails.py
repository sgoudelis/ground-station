from pathlib import Path

import pytest
from PIL import Image

from common.decoded_thumbnails import (
    THUMBNAIL_FILENAME,
    generate_decoded_thumbnail,
    get_decoded_thumbnail_url,
    select_decoded_thumbnail_source,
)
from common.thumbnails import get_image_thumbnail_path
from handlers.entities.filebrowser import build_recording_snapshot_info


def _write_png(path: Path, size=(1200, 700), color=(12, 34, 56)):
    path.parent.mkdir(parents=True, exist_ok=True)
    with Image.new("RGB", size, color=color) as image:
        image.save(path, format="PNG")


def test_select_decoded_thumbnail_source_uses_priority_order(tmp_path):
    folder = tmp_path / "METEOR-M2_3_20260114_185724.satdump_meteor_m2-x_lrpt"
    _write_png(folder / "products" / "quicklook_map.png")
    _write_png(folder / "products" / "rgb_preview.png")
    exact = folder / "products" / "rgb_msu_mr_rgb_avhrr_3a21_false_color_projected.png"
    _write_png(exact)

    selected = select_decoded_thumbnail_source(folder)

    assert selected == exact


def test_generate_decoded_thumbnail_creates_expected_file(tmp_path):
    folder = tmp_path / "NOAA-19_20260114_185724.satdump_noaa_apt"
    _write_png(folder / "result_projected.png", size=(1800, 900))

    thumb_path = generate_decoded_thumbnail(folder)

    assert thumb_path is not None
    assert thumb_path.exists()
    assert thumb_path.name == THUMBNAIL_FILENAME
    with Image.open(thumb_path) as thumb:
        assert thumb.size == (960, 540)


def test_select_decoded_thumbnail_source_prefers_filled_folder(tmp_path):
    folder = tmp_path / "METEOR-M2_4_20260114_185724.satdump_meteor_m2-x_lrpt"
    non_filled = folder / "products" / "quicklook_projected.png"
    filled = folder / "filled" / "quicklook_projected.png"
    _write_png(non_filled)
    _write_png(filled)

    selected = select_decoded_thumbnail_source(folder)

    assert selected == filled


def test_get_decoded_thumbnail_url_lazily_generates_thumbnail(tmp_path):
    folder = tmp_path / "METEOR-M2_4_20260114_185724.satdump_meteor_m2-x_lrpt"
    _write_png(folder / "result_map.png")

    thumbnail_url = get_decoded_thumbnail_url(folder, lazy_generate=True)

    assert thumbnail_url is not None
    assert thumbnail_url.startswith(f"/decoded/{folder.name}/{THUMBNAIL_FILENAME}?v=")
    assert (folder / THUMBNAIL_FILENAME).exists()


@pytest.mark.unit
def test_build_recording_snapshot_info_includes_thumbnail_file_metadata(tmp_path):
    source = tmp_path / "recording.png"
    _write_png(source, size=(800, 400))

    snapshot_info = build_recording_snapshot_info(source)

    assert snapshot_info is not None
    assert snapshot_info["filename"] == "recording.png"
    assert snapshot_info["url"] == "/recordings/recording.png"
    assert snapshot_info["size"] == source.stat().st_size
    assert snapshot_info["width"] == 800
    assert snapshot_info["height"] == 400
    assert snapshot_info["thumbnail_url"].startswith("/recordings/thumbnails/recording.jpg?v=")
    assert snapshot_info["thumbnail"]["filename"] == "recording.jpg"
    assert snapshot_info["thumbnail"]["url"] == snapshot_info["thumbnail_url"]
    assert snapshot_info["thumbnail"]["size"] == get_image_thumbnail_path(source).stat().st_size
    assert snapshot_info["thumbnail"]["width"] == 640
    assert snapshot_info["thumbnail"]["height"] == 360
