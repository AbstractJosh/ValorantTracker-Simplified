/**
 * Renames the table's words for Valorant, in both languages.
 *
 * `DataTableProps` has no per-column label prop — the words come from
 * `STRINGS[locale]` inside the package, and the package's own note says a new
 * vocabulary is "a new entry in `STRINGS`, in this package". That is the right
 * rule for a third *language*; this is the same two languages renaming the same
 * six columns, so it is done here instead of forking `i18n.ts` and leaving the
 * library carrying a game it does not know about.
 *
 * Data keys are untouched — a status is still `'Success'`, a band still
 * `'Spring'` — so sorting, filtering, the rate metrics and the CSV all keep
 * working on the values the library expects. Only the rendered words change.
 *
 * Call `applyValorantLabels()` once before the first render.
 */
import { EN, TR, type Strings } from '../lib/i18n'
import { COLUMN_LABELS } from '../lib/types'

type Patch = Pick<Strings, 'columns' | 'status' | 'season'> & Partial<Strings>

const EN_PATCH: Patch = {
  columns: {
    name: 'Agent',
    date: 'Date',
    status: 'Result',
    solvedCases: 'ACS',
    favouriteSeason: 'Rating',
    address: 'K / D / A',
  },
  status: { Success: 'Win', 'In progress': 'Draw', Failed: 'Loss' },
  season: { Spring: 'Excellent', Summer: 'Good', Autumn: 'Average', Winter: 'Poor' },
  searchPlaceholder: 'Search agent, map or K/D/A',
  searchLabel: 'Search matches',
  paneEmail: 'Map',
  paneOwner: 'Rank',
  paneActivity: 'Score',
  panePlan: 'K/D',
  paneNote: 'Notes',
  paneRecordId: 'Match',
  title: 'Match history',
  kicker: 'Akemsss#7421 · Competitive',
  statTotal: 'Matches',
  statMatching: 'Showing',
  statSelected: 'Selected',
}

const TR_PATCH: Patch = {
  columns: {
    name: 'Ajan',
    date: 'Tarih',
    status: 'Sonuç',
    solvedCases: 'ACS',
    favouriteSeason: 'Değerlendirme',
    address: 'K / Ö / A',
  },
  status: { Success: 'Galibiyet', 'In progress': 'Berabere', Failed: 'Mağlubiyet' },
  season: { Spring: 'Mükemmel', Summer: 'İyi', Autumn: 'Ortalama', Winter: 'Zayıf' },
  searchPlaceholder: 'Ajan, harita veya K/Ö/A ara',
  searchLabel: 'Maç ara',
  paneEmail: 'Harita',
  paneOwner: 'Rütbe',
  paneActivity: 'Skor',
  panePlan: 'K/Ö',
  paneNote: 'Notlar',
  paneRecordId: 'Maç',
  title: 'Maç geçmişi',
  kicker: 'Akemsss#7421 · Rekabetçi',
  statTotal: 'Maç',
  statMatching: 'Gösterilen',
  statSelected: 'Seçili',
}

let applied = false

export function applyValorantLabels(): void {
  if (applied) return
  Object.assign(EN, EN_PATCH)
  Object.assign(TR, TR_PATCH)
  // The stable English labels a host reads a column back as, and the CSV header
  // fallback — renamed too, so an exported file says Agent, not Name.
  Object.assign(COLUMN_LABELS, EN_PATCH.columns)
  applied = true
}
