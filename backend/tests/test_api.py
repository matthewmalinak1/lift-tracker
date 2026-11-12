def test_health_is_public(anon):
    r = anon.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "database": "ok"}


def test_exercise_and_workout_roundtrip(client):
    r = client.post("/api/exercises", json={"name": "Bench Press", "split_day": "chest_bi"})
    assert r.status_code == 201
    bench_id = r.json()["id"]

    # Same name twice is rejected, so one lift never splits into two histories.
    assert (
        client.post(
            "/api/exercises", json={"name": "Bench Press", "split_day": "chest_bi"}
        ).status_code
        == 409
    )

    r = client.post(
        "/api/workouts",
        json={
            "date": "2026-11-12",
            "split_day": "chest_bi",
            "sets": [
                {"exercise_id": bench_id, "set_number": 1, "weight": 225, "reps": 6, "rir": 1},
                {"exercise_id": bench_id, "set_number": 2, "weight": 225, "reps": 5, "rir": 0},
            ],
        },
    )
    assert r.status_code == 201
    assert len(r.json()["sets"]) == 2

    r = client.get("/api/workouts", params={"year": 2026, "month": 11})
    assert r.status_code == 200
    assert [w["date"] for w in r.json()] == ["2026-11-12"]

    # Nothing in October.
    assert client.get("/api/workouts", params={"year": 2026, "month": 10}).json() == []


def test_workout_with_unknown_exercise_is_rejected(client):
    r = client.post(
        "/api/workouts",
        json={
            "date": "2026-11-13",
            "split_day": "legs",
            "sets": [{"exercise_id": 9999, "set_number": 1, "weight": 315, "reps": 5}],
        },
    )
    assert r.status_code == 422


def test_body_status_shades_recently_trained_muscles(client):
    r = client.post(
        "/api/exercises",
        json={"name": "Hanging Leg Raise", "split_day": "legs", "muscles": ["abs"]},
    )
    abs_id = r.json()["id"]
    client.post(
        "/api/workouts",
        json={
            "date": "2026-11-11",
            "split_day": "legs",
            "sets": [
                {"exercise_id": abs_id, "set_number": 1, "weight": 0, "reps": 15},
                {"exercise_id": abs_id, "set_number": 2, "weight": 0, "reps": 12},
            ],
        },
    )
    # A session logged with no set detail counts the split's default muscles.
    client.post("/api/workouts", json={"date": "2026-11-12", "split_day": "back_shoulder_tri"})

    r = client.get("/api/body", params={"today": "2026-11-12"})
    assert r.status_code == 200
    m = r.json()["muscles"]
    assert m["abs"]["days_since"] == 1
    assert 0 < m["abs"]["fatigue"] < 1  # 2 sets, 1 day ago
    assert m["lats"]["fatigue"] == 1.0  # full hit today
    assert m["hamstrings"]["fatigue"] == 0.0  # tagged exercise only hit abs
    assert r.json()["whoop"] is None


def test_body_requires_login(anon):
    assert anon.get("/api/body").status_code == 401
