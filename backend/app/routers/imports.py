"""Upload the Excel template to import past workouts.

The file is sent as the raw request body (no multipart parsing needed).
`commit=false` returns a preview; `commit=true` writes it, but only if the
file has no errors.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import importer
from ..db import get_session
from ..models import Exercise
from ..schemas import ImportProblem, ImportReport

router = APIRouter()

MAX_BYTES = 5 * 1024 * 1024


@router.post("/import/xlsx", response_model=ImportReport)
async def import_xlsx(
    request: Request,
    commit: bool = Query(default=False),
    today: date | None = Query(default=None),
    session: Session = Depends(get_session),
) -> ImportReport:
    data = await request.body()
    if not data:
        raise HTTPException(400, "No file received")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File is too large (max 5 MB)")

    today = today or date.today()
    existing = {importer._key(e.name): e for e in session.scalars(select(Exercise))}
    parsed = importer.parse_workbook(data, existing, today)
    skips = importer.plan_skips(session, parsed)
    days = [w.day for w in parsed.workouts]

    report = ImportReport(
        committed=False,
        workouts=len(parsed.workouts),
        sets=sum(len(w.sets) for w in parsed.workouts),
        new_exercises=sorted(pe.name for k, pe in parsed.exercises.items() if k not in existing),
        date_from=min(days) if days else None,
        date_to=max(days) if days else None,
        already_in_app=len(skips),
        errors=[ImportProblem(**vars(p)) for p in parsed.errors],
        warnings=[ImportProblem(**vars(p)) for p in parsed.warnings],
    )
    if commit:
        if parsed.errors:
            raise HTTPException(422, "Fix the errors in the file before importing")
        importer.apply(session, parsed)
        report.committed = True
    return report
