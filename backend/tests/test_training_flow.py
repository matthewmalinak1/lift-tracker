"""End-to-end API tests for logging, the calendar, progress and the lab.

The test database is shared across test files, so this file uses its own
exercise names and 2025 dates to stay independent.
"""

from datetime import date, timedelta


def make_exercise(client, name, split, muscles):
    r = client.post("/api/exercises", json={"name": name, "split_day": split, "muscles": muscles})
    assert r.status_code == 201
    return r.json()["id"]


def log(client, day, split, sets):
    r = client.post("/api/workouts", json={"date": str(day), "split_day": split, "sets": sets})
    assert r.status_code == 201
    return r.json()["id"]


def two_sets(ex_id, weight, reps):
    return [
        {"exercise_id": ex_id, "set_number": 1, "weight": weight, "reps": reps, "rir": 1},
        {"exercise_id": ex_id, "set_number": 2, "weight": weight, "reps": reps - 1, "rir": 0},
    ]


def test_full_training_flow(client):
    press = make_exercise(client, "Flow Press", "chest_bi", ["chest", "triceps"])
    curl = make_exercise(client, "Flow Curl", "chest_bi", ["biceps"])
    start = date(2025, 3, 3)  # a Monday

    # Eight chest days, getting stronger
    days = [start + timedelta(days=3 * i) for i in range(8)]
    for i, d in enumerate(days):
        log(client, d, "chest_bi", two_sets(press, 200 + 5 * i, 6) + two_sets(curl, 60, 10))

    # --- Day detail: names, e1RM, PRs
    r = client.get(f"/api/day/{days[-1]}")
    assert r.status_code == 200
    w = r.json()["workouts"][0]
    assert [e["name"] for e in w["exercises"]] == ["Flow Press", "Flow Curl"]
    press_sets = w["exercises"][0]["sets"]
    assert press_sets[0]["is_pr"] is True  # heavier than ever before
    assert w["exercises"][1]["sets"][0]["is_pr"] is False  # curl unchanged
    assert w["pr_count"] == 1
    first_day = client.get(f"/api/day/{days[0]}").json()["workouts"][0]
    assert first_day["pr_count"] == 0  # first time logging doesn't count as a PR

    assert client.get("/api/day/2025-01-01").json()["workouts"] == []

    # --- Log template: last session's numbers, in the order they were done
    r = client.get(
        "/api/log/template", params={"split_day": "chest_bi", "today": str(days[-1] + timedelta(1))}
    )
    t = r.json()
    names = [e["name"] for e in t["exercises"]]
    assert names.index("Flow Press") < names.index("Flow Curl")
    fp = next(e for e in t["exercises"] if e["name"] == "Flow Press")
    assert fp["last_date"] == str(days[-1])
    assert [s["weight"] for s in fp["last_sets"]] == [235, 235]
    # Chest was just trained, so another split is suggested.
    assert t["suggested_split"] != "chest_bi"

    # --- Progress: Kalman series, trend, PRs
    r = client.get(f"/api/progress/lift/{press}", params={"today": str(days[-1])})
    p = r.json()
    assert len(p["series"]) == 8
    assert p["fitted"] is True
    for pt in p["series"]:
        assert pt["lower"] <= pt["estimate"] <= pt["upper"]
    assert p["series"][-1]["estimate"] > p["series"][0]["estimate"]
    assert p["trend"]["status"] == "improving"
    assert p["heaviest_weight"] == 235

    lifts = client.get("/api/progress/lifts").json()
    assert {"Flow Press", "Flow Curl"} <= {lift["name"] for lift in lifts}

    # --- Weekly volume: 4 sets of press + 2 of curl per session
    vol = client.get(
        "/api/progress/volume", params={"today": str(start + timedelta(days=6)), "weeks": 1}
    ).json()
    # Sessions on Mon 3rd, Thu 6th, Sun 9th of March 2025
    assert vol[0]["sets"]["chest"] == 6
    assert vol[0]["sets"]["biceps"] == 6

    # --- Summary
    s = client.get("/api/summary", params={"today": str(days[-1])}).json()
    assert s["last_workout"] == str(days[-1])
    assert s["this_week"] >= 1

    # --- Lab
    lab = client.get("/api/lab", params={"today": str(days[-1])}).json()
    by_key = {m["key"]: m for m in lab["models"]}
    assert by_key["kalman"]["status"] == "live"
    assert by_key["readiness"]["status"] == "collecting"
    assert any(row["name"] == "Flow Press" for row in lab["plateaus"])

    # --- Delete a workout
    wid = log(client, date(2025, 6, 1), "legs", [])
    assert client.delete(f"/api/workouts/{wid}").status_code == 204
    assert client.get("/api/day/2025-06-01").json()["workouts"] == []
    assert client.delete(f"/api/workouts/{wid}").status_code == 404


def test_new_routes_require_login(anon):
    for path in ["/api/day/2025-01-01", "/api/log/template", "/api/progress/lifts", "/api/lab"]:
        assert anon.get(path).status_code == 401


def test_bodyweight_exercises_dont_break_progress(client):
    leg_raise = make_exercise(client, "Flow Leg Raise", "legs", ["abs"])
    for i in range(3):
        log(client, date(2025, 8, 1) + timedelta(days=2 * i), "legs",
            [{"exercise_id": leg_raise, "set_number": 1, "weight": 0, "reps": 12}])
    assert client.get("/api/progress/lifts").status_code == 200
    assert client.get("/api/lab").status_code == 200
    r = client.get(f"/api/progress/lift/{leg_raise}")
    assert r.status_code == 200
    assert r.json()["series"] == []


def test_backtest_endpoint(client):
    lift = make_exercise(client, "BT Press", "chest_bi", ["chest"])
    for i in range(8):
        log(client, date(2025, 4, 1) + timedelta(days=4 * i), "chest_bi",
            two_sets(lift, 150 + 2 * i, 8))
    r = client.get("/api/lab/backtest")
    assert r.status_code == 200
    b = r.json()
    row = next(x for x in b["per_lift"] if x["name"] == "BT Press")
    assert row["predictions"] == 8 - 3
    assert 0 <= b["coverage_95"] <= 1
    assert b["mae_pct"] is not None and b["naive_mae_pct"] is not None


def test_calendar_month_counts_sets_and_prs(client):
    lift = make_exercise(client, "Cal Press", "chest_bi", ["chest"])
    log(client, date(2025, 2, 3), "chest_bi", two_sets(lift, 100, 8))
    log(client, date(2025, 2, 6), "chest_bi", two_sets(lift, 110, 8))  # PR on set 1
    log(client, date(2025, 2, 9), "legs", [])  # no set detail
    m = client.get("/api/calendar", params={"year": 2025, "month": 2}).json()
    by_day = {d["date"]: d for d in m["days"]}
    assert by_day["2025-02-03"]["prs"] == 0  # first time isn't a PR
    feb6 = by_day["2025-02-06"]
    assert (feb6["split_day"], feb6["sets"], feb6["prs"]) == ("chest_bi", 2, 1)
    assert by_day["2025-02-09"]["sets"] == 0
    assert m["max_sets"] == 2


def test_lifts_have_primary_muscle_and_trend(client):
    lift = make_exercise(client, "Group Row", "back_shoulder_tri", ["lats", "traps"])
    log(client, date(2025, 5, 1), "back_shoulder_tri", two_sets(lift, 135, 8))
    row = next(x for x in client.get("/api/progress/lifts").json() if x["name"] == "Group Row")
    assert row["primary_muscle"] == "lats"
    assert row["muscles"] == ["lats", "traps"]
    assert row["trend"] == "not_enough_data"
