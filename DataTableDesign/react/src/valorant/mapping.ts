/**
 * Valorant match data -> the table's record shape.
 *
 * The component's `DataTableRecord` is a fixed six-column schema and `ColumnKey`
 * is a closed union, threaded through ~15 modules (sorting, filtering, metrics,
 * cell ranges, CSV). Re-keying it to Valorant names would touch all of them and
 * invalidate `PARITY.md`'s behaviour inventory, so instead each Valorant field
 * takes the slot whose *type* it genuinely is, and the labels are renamed in
 * `labels.ts`. The keys stay the library's; only the words change.
 *
 *   name             text    -> Agent
 *   date             date    -> Date       ISO, so it sorts and filters right
 *   status           enum    -> Result     Win -> Success (green), Loss -> Failed (red)
 *   solvedCases      number  -> ACS        so the flow block can average it
 *   favouriteSeason  enum    -> Rating     ACS bucketed into the enum's four slots
 *   address          text    -> K / D / A
 *
 * Map, round score, rank, K/D and the accuracy line go to the detail pane.
 */
import type { DataTableRecord, RecordStatus, Season } from '../lib/types'

export interface ValorantMatch {
  id: string
  timestamp: string
  date: string
  agent: string
  map: string
  result: 'Win' | 'Loss' | 'Draw'
  score: string
  kills: number
  deaths: number
  assists: number
  kda: string
  acs: number | null
  kd_ratio: number | null
  headshot_pct: number | null
  placement: number | null
  rank: string | null
  trn_score: number | null
  season: string | null
}

/**
 * ACS into the four enum slots. Valorant has no official banding, so these are
 * the conventional readings of a competitive combat score — stated here rather
 * than buried, because the Rating column is derived, not scraped.
 */
export const ACS_BANDS: ReadonlyArray<{ season: Season; label: string; min: number }> = [
  { season: 'Spring', label: 'Excellent', min: 280 },
  { season: 'Summer', label: 'Good', min: 200 },
  { season: 'Autumn', label: 'Average', min: 130 },
  { season: 'Winter', label: 'Poor', min: 0 },
]

const bandFor = (acs: number | null): Season =>
  acs === null ? 'Winter' : (ACS_BANDS.find((b) => acs >= b.min)?.season ?? 'Winter')

/**
 * A draw takes `'In progress'` — the only slot left in a three-value enum, and
 * the neutral-toned pill, which is the right reading for a match that was
 * neither won nor lost. `labels.ts` renames it "Draw".
 */
const statusFor = (result: ValorantMatch['result']): RecordStatus =>
  result === 'Win' ? 'Success' : result === 'Draw' ? 'In progress' : 'Failed'

export function toRecords(matches: ValorantMatch[]): DataTableRecord[] {
  return matches.map((m) => ({
    id: m.id,
    name: m.agent,
    // ISO rather than "23 August, 2026": the comparator falls back to
    // localeCompare for non-numeric cells, and only ISO sorts correctly there.
    date: m.date,
    status: statusFor(m.result),
    // Held as a string like every other field; the flow block parses it back.
    solvedCases: m.acs === null ? '' : String(m.acs),
    favouriteSeason: bandFor(m.acs),
    address: `${m.kills} / ${m.deaths} / ${m.assists}`,

    // Detail pane.
    email: m.map,
    owner: m.rank ?? 'Unranked',
    activity: m.score,
    plan: m.kd_ratio === null ? '—' : m.kd_ratio.toFixed(2),
    note: [
      m.headshot_pct === null ? null : `${m.headshot_pct}% headshots`,
      m.trn_score === null ? null : `Tracker score ${m.trn_score}`,
      m.placement === null ? null : `${m.placement} on the scoreboard`,
      m.season,
    ]
      .filter(Boolean)
      .join(' · '),
  }))
}

/** Summary numbers for the strip above the table. */
export function summarise(matches: ValorantMatch[]) {
  const acs = matches.map((m) => m.acs).filter((v): v is number => v !== null)
  const wins = matches.filter((m) => m.result === 'Win').length
  const draws = matches.filter((m) => m.result === 'Draw').length
  const kills = matches.reduce((n, m) => n + m.kills, 0)
  const deaths = matches.reduce((n, m) => n + m.deaths, 0)
  const assists = matches.reduce((n, m) => n + m.assists, 0)
  const dates = matches.map((m) => m.date).sort()
  return {
    played: matches.length,
    wins,
    draws,
    losses: matches.length - wins - draws,
    winRate: matches.length ? Math.round((wins / matches.length) * 100) : 0,
    avgAcs: acs.length ? Math.round(acs.reduce((a, b) => a + b, 0) / acs.length) : 0,
    kills,
    deaths,
    assists,
    kd: deaths ? (kills / deaths).toFixed(2) : '—',
    from: dates[0] ?? '',
    to: dates[dates.length - 1] ?? '',
  }
}
