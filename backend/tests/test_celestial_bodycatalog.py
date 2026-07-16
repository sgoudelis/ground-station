from celestial.bodycatalog import get_celestial_body, list_celestial_bodies
from celestial.scene import BODY_HORIZONS_COMMANDS


def test_body_catalog_includes_sun():
    bodies = list_celestial_bodies()
    body_ids = {str(item.get("body_id") or "").strip().lower() for item in bodies}
    assert "sun" in body_ids
    for dwarf in ("ceres", "pluto", "haumea", "makemake", "eris"):
        assert dwarf in body_ids

    sun = get_celestial_body("sun")
    assert sun is not None
    assert sun.get("name") == "Sun"
    assert sun.get("body_type") == "star"

    pluto = get_celestial_body("pluto")
    assert pluto is not None
    assert pluto.get("body_type") == "dwarf"


def test_body_catalog_includes_uranus_neptune_and_pluto_moons():
    expected = {
        "miranda": ("uranus", "705"),
        "ariel": ("uranus", "701"),
        "umbriel": ("uranus", "702"),
        "titania": ("uranus", "703"),
        "oberon": ("uranus", "704"),
        "triton": ("neptune", "801"),
        "nereid": ("neptune", "802"),
        "proteus": ("neptune", "808"),
        "charon": ("pluto", "901"),
    }

    for body_id, (parent_body_id, horizons_command) in expected.items():
        entry = get_celestial_body(body_id)
        assert entry is not None
        assert entry.get("body_type") == "moon"
        assert entry.get("parent_body_id") == parent_body_id
        assert BODY_HORIZONS_COMMANDS.get(body_id) == horizons_command
