/**
 * Client for the local scrape API in `server.py`.
 *
 * Vite proxies `/api` to it, so everything here is same-origin and needs no
 * base URL. See vite.config.ts.
 */
import type { ValorantMatch } from './mapping'

export interface ProfileSummary {
  slug: string
  player: string
  playlist: string
  since: string
  scrapedAt: string
  played: number
  wins: number
  losses: number
}

export interface ProfileRecord {
  player: string
  playlist: string
  since: string
  scrapedAt: string
  took?: number
  matches: ValorantMatch[]
}

export interface Progress {
  phase: 'waiting' | 'browser' | 'paginate' | 'parsing' | 'cache' | 'done'
  pct: number
  label: string
  elapsed?: number
}

export const PLAYLISTS = ['competitive', 'unrated', 'premier'] as const
export type Playlist = (typeof PLAYLISTS)[number]

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

export const listProfiles = () => fetch('/api/profiles').then(json<ProfileSummary[]>)

export const getProfile = (slug: string) =>
  fetch(`/api/profile/${encodeURIComponent(slug)}`).then(json<ProfileRecord>)

export const deleteProfile = (slug: string) =>
  fetch(`/api/profile/${encodeURIComponent(slug)}`, { method: 'DELETE' }).then(json<unknown>)

export interface ScrapeOptions {
  player: string
  playlist: Playlist
  since: string
  refresh?: boolean
  onProgress?: (p: Progress) => void
}

/**
 * Run a scrape, resolving with the matches once it finishes.
 *
 * EventSource is the right client for the server's SSE, with one sharp edge: it
 * reconnects automatically whenever the stream ends, and the server ends the
 * stream on both success and failure. Left alone that silently starts a second
 * scrape — another browser, another minute. So the source is closed the moment
 * a terminal event lands, and again if the caller aborts.
 */
export function scrapeProfile({
  player,
  playlist,
  since,
  refresh,
  onProgress,
}: ScrapeOptions): { promise: Promise<ProfileRecord>; cancel: () => void } {
  const params = new URLSearchParams({ player, playlist, since })
  if (refresh) params.set('refresh', '1')
  const source = new EventSource(`/api/scrape?${params}`)

  let settled = false
  const close = () => {
    settled = true
    source.close()
  }

  const promise = new Promise<ProfileRecord>((resolve, reject) => {
    source.addEventListener('progress', (e) => {
      onProgress?.(JSON.parse((e as MessageEvent).data) as Progress)
    })
    source.addEventListener('done', (e) => {
      close()
      resolve(JSON.parse((e as MessageEvent).data) as ProfileRecord)
    })
    source.addEventListener('error', (e) => {
      // Two different things arrive here: our own `error` event, which carries
      // a message, and EventSource's transport error, which carries none and
      // means the server is not up.
      const data = (e as MessageEvent).data
      close()
      reject(
        new Error(
          data
            ? (JSON.parse(data) as { message: string }).message
            : 'Cannot reach the scrape server. Start it with `python server.py`.',
        ),
      )
    })
  })

  return {
    promise,
    cancel: () => {
      if (!settled) close()
    },
  }
}
