from datetime import datetime, timezone

import pytest

from celestial import horizons

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "uncertainties",
    [
        "n.a., n.a., n.a., n.a., n.a., n.a.,",
        "1.0E-08, 2.0E-08, 3.0E-08, 4.0E-10, 5.0E-10, 6.0E-10,",
    ],
)
def test_vector_fetch_uses_csv_table_with_state_columns(monkeypatch, uncertainties):
    # These state vectors were captured from Horizons on rfbox5. Major bodies
    # return n.a. uncertainties; targets with covariance data can return numbers.
    lines = [
        "2461354.704166667, A.D. 2026-Nov-10 04:54:00.0000,"
        " -4.090804856935994E-01, 1.550383461345186E+00, 4.252096370460780E-02,"
        " -1.300079767945632E-02, -2.381457419255458E-03, 2.688684231888029E-04,",
        "2461354.745833333, A.D. 2026-Nov-10 05:54:00.0000,"
        " -4.096221601310583E-01, 1.550284137456213E+00, 4.253216390862828E-02,"
        " -1.299957506348840E-02, -2.386089139016947E-03, 2.687413652470329E-04,",
        "2461354.787500000, A.D. 2026-Nov-10 06:54:00.0000,"
        " -4.101637835943632E-01, 1.550184620593021E+00, 4.254335881803086E-02,"
        " -1.299835092163185E-02, -2.390720180938902E-03, 2.686142822921597E-04,",
    ]

    class Response:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {
                "result": "\n".join(
                    ["$$SOE", *(f"{line} {uncertainties}" for line in lines), "$$EOE"]
                ),
                "signature": {"version": "1.2", "source": "NASA/JPL Horizons API"},
            }

    def request(url, *, params, timeout):
        assert url == horizons.HORIZONS_API_URL
        # Plain table 2 currently returns timestamps alone despite HTTP 200.
        assert params["VEC_TABLE"] == "'2x'"
        assert params["CSV_FORMAT"] == "YES"
        return Response()

    monkeypatch.setattr(horizons.requests, "get", request)
    horizons.reset_horizons_circuit()
    try:
        result = horizons.fetch_celestial_vectors(
            "499",
            datetime(2026, 11, 10, 6, 54, tzinfo=timezone.utc),
            past_hours=2,
            future_hours=72,
            step_minutes=60,
        )
    finally:
        horizons.reset_horizons_circuit()

    assert result["position_xyz_au"] == pytest.approx(
        [-0.4101637835943632, 1.550184620593021, 0.04254335881803086]
    )
    assert result["velocity_xyz_au_per_day"] == pytest.approx(
        [-0.01299835092163185, -0.002390720180938902, 0.0002686142822921597]
    )
    assert len(result["orbit_samples_xyz_au"]) == 3
    assert result["orbit_samples_xyz_au"][0] == pytest.approx(
        [-0.4090804856935994, 1.550383461345186, 0.0425209637046078]
    )
    assert result["orbit_sample_times_utc"] == [
        "2026-11-10T04:54:00+00:00",
        "2026-11-10T05:54:00+00:00",
        "2026-11-10T06:54:00+00:00",
    ]
