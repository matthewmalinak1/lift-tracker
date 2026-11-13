import random
from datetime import date, timedelta

from app.db import SessionLocal
from app.models import WhoopDaily


def test_weight_log_replace_delete_and_trend(client):
    start = date(2024, 3, 1)
    rng = random.Random(4)
    # Losing ~0.5 lb/week with +-1.5 lb daily water swings
    for i in range(42):
        w = 185 - 0.5 * i / 7 + rng.gauss(0, 1.5)
        r = client.put(
            "/api/weight", json={"date": str(start + timedelta(days=i)), "weight": round(w, 1)}
        )
        assert r.status_code == 204

    last = start + timedelta(days=41)
    s = client.get("/api/weight", params={"today": str(last), "days": 365}).json()
    assert len(s["points"]) == 42
    assert s["today_logged"] is True
    # The trend is much smoother than the scale
    jumps_raw = [
        abs(a["weight"] - b["weight"]) for a, b in zip(s["points"], s["points"][1:], strict=False)
    ]
    jumps_trend = [
        abs(a["trend"] - b["trend"]) for a, b in zip(s["points"], s["points"][1:], strict=False)
    ]
    assert sum(jumps_trend) < 0.3 * sum(jumps_raw)
    # and recovers the real rate of loss
    assert -1.2 < s["rate_per_week"] < 0.0
    assert s["noise_lb"] is not None and 0.7 < s["noise_lb"] < 2.5

    # Same day again replaces, not duplicates
    client.put("/api/weight", json={"date": str(last), "weight": 170.0})
    s2 = client.get("/api/weight", params={"today": str(last), "days": 365}).json()
    assert len(s2["points"]) == 42 and s2["latest"] == 170.0

    assert client.delete(f"/api/weight/{last}").status_code == 204
    assert client.delete(f"/api/weight/{last}").status_code == 404
    assert client.get("/api/weight", params={"today": str(last)}).json()["today_logged"] is False


def test_weight_validation(client):
    assert client.put("/api/weight", json={"date": "2024-01-01", "weight": 5}).status_code == 422


def test_health_trends_fill_every_day_and_mark_workouts(client):
    with SessionLocal() as s:
        s.add(WhoopDaily(date=date(2023, 6, 10), recovery_score=80, strain=12.0, steps=9000))
        s.add(WhoopDaily(date=date(2023, 6, 12), recovery_score=40, strain=8.0, steps=5000))
        s.commit()
    client.post("/api/workouts", json={"date": "2023-06-12", "split_day": "legs"})
    t = client.get("/api/health/trends", params={"days": 7, "today": "2023-06-14"}).json()
    assert [d["date"] for d in t["days"]][0] == "2023-06-08"
    assert len(t["days"]) == 7
    by = {d["date"]: d for d in t["days"]}
    assert by["2023-06-11"]["recovery_score"] is None  # gap stays a gap
    assert by["2023-06-12"]["workout"] is True and by["2023-06-10"]["workout"] is False
    assert t["averages"]["recovery_score"] == 60.0
    assert t["averages"]["steps"] == 7000.0


def test_new_routes_need_login(anon):
    assert anon.get("/api/weight").status_code == 401
    assert anon.get("/api/health/trends").status_code == 401
