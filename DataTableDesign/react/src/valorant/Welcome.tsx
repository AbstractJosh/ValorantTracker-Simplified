/**
 * Landing screen: pick a profile to look at.
 *
 * The search box is the whole point, so it leads. Everything already scraped is
 * listed underneath — those open instantly from the server's cache, which is
 * the difference between a click and another minute of Cloudflare.
 */
import { useEffect, useMemo, useState } from 'react'

import {
  PLAYLISTS,
  deleteProfile,
  listProfiles,
  listSeasons,
  type Playlist,
  type ProfileSummary,
  type Season,
} from './api'

const WINDOW_DAYS = 90

/** The fallback the server also applies when `since` is omitted. */
export function defaultSince(): string {
  const d = new Date()
  d.setDate(d.getDate() - WINDOW_DAYS)
  return d.toISOString().slice(0, 10)
}

/** Sentinel for the option that swaps the dropdown out for a date field. */
const CUSTOM = 'custom'

const readableDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

/**
 * Acts grouped under their episode, order preserved.
 *
 * The list arrives newest-first and episodes are contiguous within it, so this
 * only has to start a new group when the episode name changes - no sorting,
 * which would fight the ordering the server already chose.
 */
function byEpisode(seasons: Season[]): Array<{ episode: string; acts: Season[] }> {
  const groups: Array<{ episode: string; acts: Season[] }> = []
  for (const season of seasons) {
    const last = groups[groups.length - 1]
    if (last && last.episode === season.episode) last.acts.push(season)
    else groups.push({ episode: season.episode, acts: [season] })
  }
  return groups
}

export interface Query {
  player: string
  playlist: Playlist
  since: string
  refresh?: boolean
}

export default function Welcome({
  onSearch,
  initialError,
}: {
  onSearch: (q: Query) => void
  initialError?: string | null
}) {
  const [player, setPlayer] = useState('')
  const [playlist, setPlaylist] = useState<Playlist>('competitive')
  const [since, setSince] = useState(defaultSince)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [recents, setRecents] = useState<ProfileSummary[]>([])
  const [seasons, setSeasons] = useState<Season[]>([])
  // Starts true so the date field is what shows if the act list never arrives;
  // loading a non-empty list is what switches the dropdown on.
  const [custom, setCustom] = useState(true)

  useEffect(() => {
    listProfiles()
      .then(setRecents)
      .catch(() => setRecents([]))
  }, [])

  useEffect(() => {
    listSeasons()
      .then((rows) => {
        if (!rows.length) return
        setSeasons(rows)
        setCustom(false)
        // The act in progress is the useful default: it answers "how am I doing
        // this act", which is the question a rank-tracking page is usually
        // opened to answer.
        setSince(rows[0].start)
      })
      .catch(() => setSeasons([]))
  }, [])

  const groups = useMemo(() => byEpisode(seasons), [seasons])
  const current = seasons[0]

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const value = player.trim()
    // Mirrors the server's check so a typo costs a keystroke, not a round trip.
    if (!/^[^#/\\?]{3,16}#[A-Za-z0-9]{3,5}$/.test(value)) {
      setError('That is not a Riot ID. It looks like Name#TAG — for example Akemsss#7421.')
      return
    }
    setError(null)
    onSearch({ player: value, playlist, since })
  }

  async function forget(slug: string) {
    await deleteProfile(slug).catch(() => {})
    setRecents((rows) => rows.filter((r) => r.slug !== slug))
  }

  return (
    <div className="val-welcome">
      <header className="val-welcome__head">
        <h1>Valorant match history</h1>
        <p>
          Scrapes a tracker.gg profile with Scrapling and lays the matches out in a sortable,
          filterable table. A profile that has not been read before takes two to three minutes —
          the scrape drives a real browser through Cloudflare. After that it is cached.
        </p>
      </header>

      <form className="val-search" onSubmit={submit}>
        <div className="val-search__row">
          <label className="val-field val-field--grow">
            <span>Riot ID</span>
            <input
              className="val-input val-input--lg"
              value={player}
              onChange={(e) => setPlayer(e.target.value)}
              placeholder="Name#TAG"
              spellCheck={false}
              autoComplete="off"
              autoFocus
              aria-label="Riot ID"
            />
          </label>

          <label className="val-field">
            <span>Playlist</span>
            <select
              className="val-input"
              value={playlist}
              onChange={(e) => setPlaylist(e.target.value as Playlist)}
            >
              {PLAYLISTS.map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </label>

          <label className={custom ? 'val-field' : 'val-field val-field--wide'}>
            <span>Since</span>
            {custom ? (
              <input
                className="val-input"
                type="date"
                value={since}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setSince(e.target.value)}
                aria-label="Start date"
              />
            ) : (
              <select
                className="val-input"
                value={since}
                onChange={(e) => {
                  if (e.target.value === CUSTOM) setCustom(true)
                  else setSince(e.target.value)
                }}
                aria-label="Start of the period to scrape"
              >
                {groups.map((group) => (
                  <optgroup key={group.episode} label={group.episode}>
                    {group.acts.map((act) => (
                      /* The episode is repeated in every option rather than
                         left to the optgroup: a closed <select> shows only the
                         option's own text, so "Act 5" alone would not say which
                         episode it belongs to. The date is not repeated here -
                         it would make the closed control very wide, and the
                         line under the form already states it. */
                      <option key={act.start} value={act.start}>
                        {act.label}
                        {act === current ? ' · current' : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value={CUSTOM}>Pick a date instead…</option>
              </select>
            )}
          </label>

          <button className="val-btn val-btn--primary" type="submit">
            Look up
          </button>
        </div>

        <p className="val-since-note">
          {custom ? (
            <>
              Scraping matches from {readableDate(since)} onwards.
              {seasons.length > 0 && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="val-linkish"
                    onClick={() => {
                      setCustom(false)
                      setSince(seasons[0].start)
                    }}
                  >
                    Choose an act instead
                  </button>
                </>
              )}
            </>
          ) : (
            <>Scraping matches from {readableDate(since)} onwards.</>
          )}
        </p>

        {error && (
          <p className="val-error" role="alert">
            {error}
          </p>
        )}
      </form>

      <section className="val-recents">
        <h2>Already scraped</h2>
        {recents.length === 0 ? (
          <p className="val-empty">Nothing yet. The first profile you look up will land here.</p>
        ) : (
          <ul>
            {recents.map((r) => (
              <li key={r.slug}>
                <button
                  className="val-recent"
                  onClick={() =>
                    onSearch({ player: r.player, playlist: r.playlist as Playlist, since: r.since })
                  }
                >
                  <span className="val-recent__name">{r.player}</span>
                  <span className="val-recent__meta">
                    {r.played} matches · <span className="val-w">{r.wins}W</span>
                    <span className="val-sep">/</span>
                    <span className="val-l">{r.losses}L</span> · since {r.since}
                  </span>
                </button>
                <div className="val-recent__actions">
                  <button
                    className="val-btn val-btn--ghost"
                    title="Scrape it again, ignoring the cache"
                    onClick={() =>
                      onSearch({
                        player: r.player,
                        playlist: r.playlist as Playlist,
                        since: r.since,
                        refresh: true,
                      })
                    }
                  >
                    Refresh
                  </button>
                  <button
                    className="val-btn val-btn--ghost val-btn--danger"
                    title="Remove from the cache"
                    onClick={() => forget(r.slug)}
                  >
                    Forget
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
