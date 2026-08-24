/**
 * Three screens, one at a time: search → scrape → table.
 *
 * The profile lives in `location.hash`, so a reload or a shared link comes back
 * to the same table instead of the search box. That also makes the browser's
 * back button work as the way out of a profile, which is what people reach for.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { getProfile, scrapeProfile, type Progress, type ProfileRecord } from './api'
import { applyValorantLabels } from './labels'
import Loading from './Loading'
import MatchTable from './MatchTable'
import Welcome, { type Query } from './Welcome'

applyValorantLabels()

type View =
  | { kind: 'welcome'; error?: string | null }
  | { kind: 'loading'; player: string }
  | { kind: 'table'; profile: ProfileRecord }

const slugify = (player: string) =>
  player
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export default function App() {
  const [view, setView] = useState<View>({ kind: 'welcome' })
  const [progress, setProgress] = useState<Progress | null>(null)
  // The in-flight scrape, so a second search or a hash change can drop the
  // first one's EventSource instead of leaving it open and reconnecting.
  const active = useRef<{ cancel: () => void } | null>(null)

  const search = useCallback(({ player, playlist, since, refresh }: Query) => {
    active.current?.cancel()
    setProgress(null)
    setView({ kind: 'loading', player })

    const run = scrapeProfile({
      player,
      playlist,
      since,
      refresh,
      onProgress: setProgress,
    })
    active.current = run

    run.promise
      .then((profile) => {
        if (active.current !== run) return // superseded by a newer search
        setView({ kind: 'table', profile })
        // replace, not push: the loading screen should not be a back target.
        window.history.replaceState(null, '', `#${slugify(player)}`)
      })
      .catch((err: Error) => {
        if (active.current !== run) return
        setView({ kind: 'welcome', error: err.message })
        window.history.replaceState(null, '', window.location.pathname)
      })
  }, [])

  const goHome = useCallback(() => {
    active.current?.cancel()
    active.current = null
    setView({ kind: 'welcome' })
    window.history.pushState(null, '', window.location.pathname)
  }, [])

  // Open whatever the hash names, on load and on every back/forward.
  useEffect(() => {
    const open = () => {
      const slug = window.location.hash.replace(/^#/, '')
      if (!slug) {
        active.current?.cancel()
        active.current = null
        setView({ kind: 'welcome' })
        return
      }
      getProfile(slug)
        .then((profile) => setView({ kind: 'table', profile }))
        // A hash for a profile that is not cached is not worth an error screen;
        // the search box with nothing selected is the honest fallback.
        .catch(() => {
          setView({ kind: 'welcome' })
          window.history.replaceState(null, '', window.location.pathname)
        })
    }
    open()
    window.addEventListener('hashchange', open)
    window.addEventListener('popstate', open)
    return () => {
      window.removeEventListener('hashchange', open)
      window.removeEventListener('popstate', open)
    }
  }, [])

  // Never leave a scrape's EventSource open behind an unmount.
  useEffect(() => () => active.current?.cancel(), [])

  if (view.kind === 'loading') {
    return <Loading player={view.player} progress={progress} onCancel={goHome} />
  }

  if (view.kind === 'table') {
    return (
      <MatchTable
        profile={view.profile}
        onBack={goHome}
        onRefresh={() =>
          search({
            player: view.profile.player,
            playlist: view.profile.playlist as Query['playlist'],
            since: view.profile.since,
            refresh: true,
          })
        }
      />
    )
  }

  return <Welcome onSearch={search} initialError={view.error} />
}
