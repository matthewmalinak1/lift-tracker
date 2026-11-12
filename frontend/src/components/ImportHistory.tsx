import { useState, type ChangeEvent } from "react";
import { api, prettyDate, type ImportReport } from "../api";

/** Upload the Excel template: preview what's in it, then confirm. */
export default function ImportHistory({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setReport(null);
    setError(null);
    setBusy(true);
    try {
      setReport(await api.importXlsx(f, false));
    } catch {
      setError("Couldn't read that file. Is the database connected?");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await api.importXlsx(file, true);
      setReport(r);
    } catch {
      setError("Import failed. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  const toAdd = report ? report.workouts - report.already_in_app : 0;

  return (
    <div className="import">
      <h2>Import past workouts</h2>

      {!report?.committed && (
        <>
          <ol className="import-steps">
            <li>
              Fill in the{" "}
              <a href="/lift-history-template.xlsx" download className="doc-link">
                Excel template
              </a>{" "}
              (instructions are on its first tab).
            </li>
            <li>Choose the file below to see a preview. Nothing is saved until you confirm.</li>
          </ol>
          <label className="file-pick">
            <input type="file" accept=".xlsx" onChange={pick} />
            <span>{file ? file.name : "Choose .xlsx file"}</span>
          </label>
        </>
      )}

      {busy && <p className="muted center">{report ? "Importing…" : "Reading file…"}</p>}
      {error && <p className="error small">{error}</p>}

      {report && !report.committed && (
        <div className="import-report">
          {report.workouts > 0 && (
            <div className="summary-row">
              <div className="summary-tile">
                <span className="hud-label">Workouts</span>
                <strong>{report.workouts}</strong>
              </div>
              <div className="summary-tile">
                <span className="hud-label">Sets</span>
                <strong>{report.sets}</strong>
              </div>
              <div className="summary-tile">
                <span className="hud-label">New exercises</span>
                <strong>{report.new_exercises.length}</strong>
              </div>
            </div>
          )}
          {report.date_from && report.date_to && (
            <p className="small">
              {prettyDate(report.date_from, { month: "short", day: "numeric", year: "numeric" })} –{" "}
              {prettyDate(report.date_to, { month: "short", day: "numeric", year: "numeric" })}
              {report.already_in_app > 0 && (
                <span className="muted"> · {report.already_in_app} already in the app (skipped)</span>
              )}
            </p>
          )}

          {report.errors.length > 0 && (
            <div className="problems errors">
              <strong>Fix these in the file, then choose it again:</strong>
              <ul>
                {report.errors.map((p, i) => (
                  <li key={i}>
                    <span className="muted">
                      {p.sheet}
                      {p.row ? ` row ${p.row}` : ""}:
                    </span>{" "}
                    {p.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.warnings.length > 0 && (
            <div className="problems warnings">
              <strong>Heads up:</strong>
              <ul>
                {report.warnings.map((p, i) => (
                  <li key={i}>
                    <span className="muted">
                      {p.sheet} row {p.row}:
                    </span>{" "}
                    {p.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.errors.length === 0 && (
            <button className="primary" disabled={busy || toAdd === 0} onClick={commit}>
              {toAdd === 0 ? "Nothing new to import" : `Import ${toAdd} workout${toAdd === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}

      {report?.committed && (
        <div className="import-done">
          <p className="accent">
            Imported {report.workouts - report.already_in_app} workouts ({report.sets} sets).
          </p>
          <p className="muted small">Your calendar, body map, progress charts and Lab now include them.</p>
          <button className="primary" onClick={onDone}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
