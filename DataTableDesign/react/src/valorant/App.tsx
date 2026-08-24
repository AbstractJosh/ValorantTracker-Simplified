/**
 * Akemsss#7421's scraped competitive matches, in the Records data table.
 *
 * Data comes from `matches.json`, written by `scrape_tracker.py` at the repo
 * root. Nothing here fetches — the scrape is a separate step, so the page
 * renders the same rows every time regardless of Cloudflare's mood.
 */
import { useMemo, useState } from 'react'

import { DataTable } from '../lib/DataTable'
import type { DataTableRecord } from '../lib/types'
import matches from './matches.json'
import { applyValorantLabels } from './labels'
import { summarise, toRecords, type ValorantMatch } from './mapping'

applyValorantLabels()

const MATCHES = matches as ValorantMatch[]

export default function App() {
  const [records, setRecords] = useState<DataTableRecord[]>(() => toRecords(MATCHES))
  const stats = useMemo(() => summarise(MATCHES), [])

  return (
    <div className="val-page">
      <header className="val-head">
        <div className="val-head__id">
          <h1>Akemsss#7421</h1>
          <p>
            Valorant · Competitive · {stats.from} to {stats.to} · scraped from tracker.gg
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
        kicker={`${stats.played} competitive matches`}
        logoSrc={null}
      />
    </div>
  )
}
