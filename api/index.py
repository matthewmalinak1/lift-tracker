"""Vercel entry point.

Vercel turns every file in /api into a serverless function. This one imports
the FastAPI app from /backend and exposes it as `app`, which Vercel's Python
runtime serves as an ASGI application. vercel.json routes every /api/* request
here.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.main import app  # noqa: E402,F401
