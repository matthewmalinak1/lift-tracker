import { useEffect, useState, type FormEvent } from "react";
import { api, localDateISO, prettyDate, type WeightSummary } from "../api";
import StrengthChart from "./StrengthChart";

/** Morning weigh-ins with a Kalman-filtered trend that ignores daily water swings. */
export default function Weight({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<WeightSummary | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState(90);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api.weight(range).then(setData).catch(() => setError("Couldn't load weigh-ins."));
  }, [range, reload]);

  const today = localDateISO();
  const todayPoint = data?.points.find((p) => p.date === today);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const w = Number(value);
    if (!(w > 50 && w < 700)) {
      setError("Enter your weight in lb, e.g. 182.4");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.logWeight(today, w);
      setValue("");
      setReload((r) => r + 1);
      onChanged?.();
    } catch {
      setError("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (date: string) => {
    await api.deleteWeight(date).catch(() => {});
    setReload((r) => r + 1);
  };

  const fmt = (v: number | null | undefined, digits = 1) => (v == null ? "--" : v.toFixed(digits));
  const signed = (v: number | null | undefined) => (v == null ? "--" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`);

  return (
    <div className="weight">
      <form className="card weigh-in" onSubmit={save}>
        <div>
          <span className="hud-label">This morning</span>
          <div className="weigh-row">
            <input
              inputMode="decimal"
              className="num-input weigh-input"
              placeholder={todayPoint ? String(todayPoint.weight) : data?.latest ? String(data.latest) : "lb"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label="Today's weight in pounds"
            />
            <span className="muted">lb</span>
            <button className="primary small-btn" disabled={saving || !value}>
              {todayPoint ? "Update" : "Save"}
            </button>
          </div>
        </div>
        {todayPoint ? (
          <p className="small logged-ok">✓ Logged today: {todayPoint.weight} lb</p>
        ) : (
          <p className="muted small">Weigh in after waking, before eating, for the steadiest numbers.</p>
        )}
        {error && <p className="error small">{error}</p>}
      </form>

      {data && data.points.length > 0 && (
        <>
          <div className="stat-grid four">
            <div className="card stat">
              <span className="hud-label">Trend weight</span>
              <strong>{fmt(data.trend_now)}</strong>
              <span className="muted small">filtered</span>
            </div>
            <div className="card stat">
              <span className="hud-label">7-day change</span>
              <strong>{signed(data.change_7d)}</strong>
              <span className="muted small">lb</span>
            </div>
            <div className="card stat">
              <span className="hud-label">Rate</span>
              <strong>{signed(data.rate_per_week)}</strong>
              <span className="muted small">lb / week</span>
            </div>
            <div className="card stat">
              <span className="hud-label">Daily swing</span>
              <strong>±{fmt(data.noise_lb)}</strong>
              <span className="muted small">{data.noise_lb == null ? "after 6 days" : "lb water/food"}</span>
            </div>
          </div>

          <div className="card chart-card">
            <div className="range-row">
              <span className="muted small">Scale vs trend</span>
              <div className="segmented small-seg">
                {[30, 90, 365].map((r) => (
                  <button key={r} type="button" className={range === r ? "active" : ""} onClick={() => setRange(r)}>
                    {r === 365 ? "1y" : `${r}d`}
                  </button>
                ))}
              </div>
            </div>
            <StrengthChart
              series={data.points.map((p) => ({
                date: p.date,
                observed: p.weight,
                estimate: p.trend,
                lower: p.lower,
                upper: p.upper,
              }))}
              unit="lb"
              labels={{ estimate: "Trend", observed: "Scale" }}
            />
          </div>

          <div className="card">
            <h3 className="section-title">Recent weigh-ins</h3>
            {[...data.points]
              .reverse()
              .slice(0, 10)
              .map((p) => (
                <div key={p.date} className="weigh-list-row">
                  <span>{prettyDate(p.date, { weekday: "short", month: "short", day: "numeric" })}</span>
                  <strong>{p.weight}</strong>
                  <span className="muted small">trend {p.trend.toFixed(1)}</span>
                  <button type="button" className="text-btn" onClick={() => remove(p.date)} aria-label="Delete">
                    ✕
                  </button>
                </div>
              ))}
          </div>
        </>
      )}
      {data && data.points.length === 0 && (
        <p className="muted small center">
          Your first weigh-in starts the chart. The trend line kicks in after a few days.
        </p>
      )}
    </div>
  );
}
