/**
 * One profile's matches in the Records data table.
 *
 * Was the whole of App.tsx when the page only ever showed Akemsss#7421 out of a
 * bundled JSON file. Now the rows arrive from the scrape API, so the profile is
 * a prop and the header gains the controls for leaving it.
 */
import { useEffect, useMemo, useState } from 'react'

import { DataTable } from '../lib/DataTable'
import type { DataTableRecord } from '../lib/types'
import type { ProfileRecord } from './api'
import { summarise, toRecords } from './mapping'

export default function MatchTable({
  profile,
  onBack,
  onRefresh,
}: {
  profile: ProfileRecord
  onBack: () => void
  onRefresh: () => void
}) {
  const matches = profile.matches
  const [records, setRecords] = useState<DataTableRecord[]>(() => toRecords(matches))
  const stats = useMemo(() => summarise(matches), [matches])

  // Switching profiles keeps this component mounted, so the rows have to be
  // rebuilt when the data underneath changes rather than only on first render.
  useEffect(() => setRecords(toRecords(matches)), [matches])

  const scrapedAt = profile.scrapedAt ? new Date(profile.scrapedAt).toLocaleString() : null

  return (
    <div className="val-page">
      {/* Page chrome: leaving this profile, and re-reading it. Both belong to
          the page rather than to the table, so they sit above the header
          rather than in a band between the header and the table. */}
      <div className="val-topbar">
        <button className="val-back" onClick={onBack}>
          ← All profiles
        </button>
        <button className="val-btn val-btn--ghost" onClick={onRefresh}>
          Re-scrape this profile
        </button>
      </div>

      <header className="val-head">
        <div className="val-head__id">
          <h1>{profile.player}</h1>
          <p>
            Valorant · {profile.playlist} · {stats.from} to {stats.to} · scraped from tracker.gg
            {scrapedAt && ` on ${scrapedAt}`}
          </p>
        </div>
        <dl className="val-stats">
          <div>
            <dt>Matches</dt>
            <dd>{stats.played}</dd>
          </div>
          <div>
            <dt>Record</dt>
            <dd>
              <span className="val-w">{stats.wins}W</span>
              <span className="val-sep">/</span>
              <span className="val-l">{stats.losses}L</span>
              {stats.draws > 0 && (
                <>
                  <span className="val-sep">/</span>
                  <span>{stats.draws}D</span>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Win rate</dt>
            <dd>{stats.winRate}%</dd>
          </div>
          <div>
            <dt>Avg ACS</dt>
            <dd>{stats.avgAcs}</dd>
          </div>
          <div>
            <dt>K / D / A</dt>
            <dd>
              {stats.kills} / {stats.deaths} / {stats.assists}
            </dd>
          </div>
          <div>
            <dt>K/D</dt>
            <dd>{stats.kd}</dd>
          </div>
        </dl>
      </header>

      <DataTable
        records={records}
        onRecordsChange={setRecords}
        rowsPerPage={15}
        // The flow block reads a dragged run of ACS cells three ways; `mean` is
        // the average combat score for whatever is selected.
        metrics={{ number: ['mean', 'highest', 'sum'] }}
        title="Match history"
        kicker={`${stats.played} ${profile.playlist} matches`}
        logoSrc={null}
      />
    </div>
  )
}
