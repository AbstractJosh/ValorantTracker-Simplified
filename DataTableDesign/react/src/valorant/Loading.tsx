/**
 * The wait between "look up" and the table.
 *
 * A scrape is long enough that a spinner alone reads as a hang, so the bar is
 * paired with the phase label the server sends and a running clock. The bar is
 * only honest during pagination, where the server knows how far back through
 * the requested window it has walked; before that it is easing along a
 * time curve, which is why the label always names the actual phase.
 */
import type { Progress } from './api'

// Thresholds match the server's phase boundaries in server.py.
const STEPS: ReadonlyArray<{ key: string; label: string; at: number }> = [
  { key: 'browser', label: 'Browser', at: 0 },
  { key: 'cloudflare', label: 'Cloudflare', at: 10 },
  { key: 'history', label: 'Match history', at: 74 },
  { key: 'table', label: 'Table', at: 97 },
]

export default function Loading({
  player,
  progress,
  onCancel,
}: {
  player: string
  progress: Progress | null
  onCancel: () => void
}) {
  const pct = progress?.pct ?? 0
  const label = progress?.label ?? 'Starting'
  const elapsed = progress?.elapsed

  return (
    <div className="val-loading">
      <div className="val-loading__card">
        <p className="val-loading__kicker">Scraping tracker.gg</p>
        <h1>{player}</h1>

        <div
          className="val-bar"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        >
          <div className="val-bar__fill" style={{ width: `${pct}%` }} />
        </div>

        <div className="val-loading__line">
          <span className="val-loading__label">{label}</span>
          <span className="val-loading__pct">
            {Math.round(pct)}%{elapsed !== undefined && ` · ${elapsed.toFixed(0)}s`}
          </span>
        </div>

        <ol className="val-steps">
          {STEPS.map((s) => (
            <li key={s.key} className={pct >= s.at ? 'is-done' : ''}>
              {s.label}
            </li>
          ))}
        </ol>

        <p className="val-loading__note">
          The browser is real and Cloudflare has to be cleared before any match data is
          readable, which is almost all of the wait — expect two to three minutes. Reading the
          history itself takes seconds. The result is cached, so coming back to this profile is
          instant.
        </p>

        <button className="val-btn val-btn--ghost" onClick={onCancel}>
          Back to search
        </button>
      </div>
    </div>
  )
}
