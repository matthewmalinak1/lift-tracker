"""Import from the real Excel template, filled in the way a user would."""

import io
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook

REPO = Path(__file__).resolve().parents[2]
TEMPLATE = REPO / "frontend" / "public" / "lift-history-template.xlsx"


def filled(exercises, lifts) -> bytes:
    wb = load_workbook(TEMPLATE)
    ex, lf = wb["Exercises"], wb["Lifts"]
    for i, row in enumerate(exercises, start=3):  # row 2 is the example
        for j, v in enumerate(row, start=1):
            ex.cell(row=i, column=j, value=v)
    for i, row in enumerate(lifts, start=4):  # rows 2-3 are examples
        for j, v in enumerate(row, start=1):
            lf.cell(row=i, column=j, value=v)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def post(client, data, commit=False):
    return client.post(
        "/api/import/xlsx",
        params={"commit": str(commit).lower(), "today": "2025-12-31"},
        content=data,
        headers={"content-type": "application/octet-stream"},
    )


EXERCISES = [
    ["Import Bench", "Chest/Bi", "chest, shoulders, Triceps"],
    ["Import Squat", "legs", "quads; glutes"],
    ["Import Leg Raise", "Legs", "core"],  # alias -> abs
]
LIFTS = [
    [datetime(2025, 10, 1), "Chest/Bi", "Import Bench", 205, 8, 1, 205, 7, 0, ""],
    [datetime(2025, 10, 3), "Legs", "Import Squat", 275, 6, None, 265, 6, None, ""],
    [datetime(2025, 10, 3), "Legs", "Import Leg Raise", 0, 15, None, 0, 12, None, "bw"],
    ["10/6/2025", "Chest/Bi", "Import Bench", 210, 7, None, None, None, None, "one set"],
]


def test_preview_then_commit_then_reimport_is_idempotent(client):
    data = filled(EXERCISES, LIFTS)

    r = post(client, data)
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["errors"] == []
    assert rep["committed"] is False
    assert rep["workouts"] == 3  # Oct 3 rows group into one legs workout
    assert rep["sets"] == 7
    assert rep["date_from"] == "2025-10-01" and rep["date_to"] == "2025-10-06"
    assert set(rep["new_exercises"]) == {"Import Bench", "Import Squat", "Import Leg Raise"}
    # Preview wrote nothing
    assert client.get("/api/day/2025-10-01").json()["workouts"] == []

    r = post(client, data, commit=True)
    assert r.json()["committed"] is True
    day = client.get("/api/day/2025-10-03").json()["workouts"][0]
    assert day["split_day"] == "legs"
    assert {e["name"] for e in day["exercises"]} == {"Import Squat", "Import Leg Raise"}

    exercises = {e["name"]: e for e in client.get("/api/exercises").json()}
    assert exercises["Import Bench"]["muscles"] == ["chest", "shoulders", "triceps"]
    assert exercises["Import Leg Raise"]["muscles"] == ["abs"]

    # Uploading the same file again adds nothing
    again = post(client, data).json()
    assert again["already_in_app"] == 3
    assert again["new_exercises"] == []
    post(client, data, commit=True)
    assert len(client.get("/api/day/2025-10-03").json()["workouts"]) == 1


def test_errors_are_reported_with_row_numbers_and_block_commit(client):
    data = filled(
        [["Err Press", "Chest/Bi", "chest, wings"], ["Err Row", "Backs", ""]],
        [
            ["not a date", "Chest/Bi", "Err Press", 100, 5, None, None, None, None, ""],
            [datetime(2025, 11, 1), "Chest/Bi", "Err Press", 100, None, None, None, None, None, ""],
            [datetime(2030, 1, 1), "Chest/Bi", "Err Press", 100, 5, None, None, None, None, ""],
        ],
    )
    rep = post(client, data).json()
    msgs = {(e["sheet"], e["row"]): e["message"] for e in rep["errors"]}
    assert "wings" in msgs[("Exercises", 3)]
    assert "Backs" in msgs[("Exercises", 4)]
    assert "date" in msgs[("Lifts", 4)]
    assert "weight and reps" in msgs[("Lifts", 5)]
    assert "future" in msgs[("Lifts", 6)]
    assert post(client, data, commit=True).status_code == 422


def test_unknown_exercise_on_lifts_tab_is_added_with_a_warning(client):
    row = [date(2025, 9, 1), "Legs", "Mystery Lunge", 50, 10, None, None, None, None, ""]
    data = filled([], [row])
    rep = post(client, data).json()
    assert rep["errors"] == []
    assert "Mystery Lunge" in rep["new_exercises"]
    assert any("Exercises tab" in w["message"] for w in rep["warnings"])


def test_rejects_non_excel(client):
    assert post(client, b"hello").json()["errors"][0]["message"].startswith("This isn't")


def test_import_requires_login(anon):
    assert anon.post("/api/import/xlsx", content=b"x").status_code == 401
