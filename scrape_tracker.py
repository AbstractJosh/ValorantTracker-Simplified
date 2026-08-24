"""Scrape a tracker.gg Valorant profile's competitive match history.

Reads tracker.gg's own JSON API rather than the rendered rows: the overview page
only ever holds the latest 20 matches, and the API paginates the whole history
with exact timestamps and unrounded stats. The browser is still what makes the
request — Scrapling's StealthyFetcher clears Cloudflare and the calls are issued
from inside the loaded page, so they carry its cookies and referer.

Per match: agent, map, K/D/A, ACS, round score and win/loss, plus rank, K/D,
headshot %, tracker score and scoreboard placement.

Usage:
    ./.venv/Scripts/python.exe scrape_tracker.py
    ./.venv/Scripts/python.exe scrape_tracker.py --since 2026-07-18 -o matches.json
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from urllib.parse import quote

from scrapling.fetchers import StealthyFetcher

DEFAULT_PLAYER = "Akemsss#7421"
DEFAULT_SINCE = "2026-07-18"

# The profile page is loaded only to get a Cloudflare-cleared browsing context;
# the matches themselves come from the API calls made inside it. No `season`
# parameter, on purpose — filtering by season stops at that act's first match
# (V26: A5 only reaches 19 August), while the unfiltered feed pages back through
# every act.
PROFILE_URL = "https://tracker.gg/valorant/profile/riot/{player}/matches?platform=pc&playlist={playlist}"
API_URL = "https://api.tracker.gg/api/v2/valorant/standard/matches/riot/{player}?platform=pc&type={playlist}"

# Fetches ONE page of the match feed and returns it trimmed to the fields used
# here, so a long history stays a small payload.
#
# The `next`-cursor loop lives in Python rather than in here. Keeping it in the
# page meant a single evaluate() that returned nothing until the whole history
# had been walked, and the only way to report progress out of it was
# page.expose_function — which fails on an already-loaded page: the JS-side
# wrapper is installed as an init script for *new* documents, so window[name]
# resolves to Playwright's raw binding and rejects an object argument with
# "Invalid arguments: should be exactly one string". One evaluate per page
# reports naturally, and puts the cutoff logic somewhere it can be read.
FETCH_PAGE_JS = """
async ({api, next}) => {
  const url = api + (next === null ? '' : '&next=' + next);
  const r = await fetch(url, {credentials: 'include', headers: {'Accept': 'application/json'}});
  if (!r.ok) return {ok: false, status: r.status};
  const d = await r.json();
  const page = (d.data && d.data.matches) || [];
  const matches = [];
  for (const m of page) {
    const seg = (m.segments || []).find((s) => s.type === 'overview');
    if (!seg) continue;
    const st = seg.stats || {}, md = seg.metadata || {}, mm = m.metadata || {};
    const v = (k) => (st[k] ? st[k].value : null);
    // Rank carries no value/displayValue — the tier is only in its metadata.
    const tier = (st.rank && st.rank.metadata && st.rank.metadata.tierName) || null;
    matches.push({
      id: m.attributes && m.attributes.id,
      timestamp: mm.timestamp,
      map: mm.mapName,
      mode: mm.modeName,
      season: mm.seasonName,
      agent: md.agentName,
      won: md.hasWon,
      result: mm.result,
      kills: v('kills'), deaths: v('deaths'), assists: v('assists'),
      acs: v('scorePerRound'),
      kd: v('kdRatio'),
      roundsWon: v('roundsWon'), roundsLost: v('roundsLost'),
      hs: v('headshotsPercentage'),
      placement: v('placement'),
      rank: tier,
      trn: v('trnPerformanceScore'),
    });
  }
  const meta = d.data && d.data.metadata;
  return {
    ok: true,
    count: page.length,
    matches: matches,
    newest: page.length ? page[0].metadata.timestamp : null,
    oldest: page.length ? page[page.length - 1].metadata.timestamp : null,
    next: (meta && meta.next !== undefined && meta.next !== null) ? meta.next : null,
  };
}
"""


def _covered(newest, oldest, since):
    """How much of the requested window has been walked, as 0..1.

    Whole days are enough for a progress bar, and comparing dates sidesteps the
    naive/aware mismatch between the API's offset-carrying timestamps and the
    plain `since` date.
    """
    if not newest or not oldest:
        return 0.0
    try:
        top = date.fromisoformat(newest[:10])
        bottom = date.fromisoformat(oldest[:10])
        floor = date.fromisoformat(since)
    except ValueError:
        return 0.0
    span = (top - floor).days
    if span <= 0:
        return 1.0
    return max(0.0, min(1.0, (top - bottom).days / span))


class ScrapeError(RuntimeError):
    """A scrape that failed for a reportable reason, rather than a bug."""


def scrape(player, playlist, since, max_pages, verbose, on_progress=None):
    """Return the raw match dicts for one profile.

    `on_progress(phase, detail)` is called as the scrape moves through its
    stages, so a caller with a UI can show something truthful while the browser
    works. It is optional and never affects the result. Phases:

        browser     the fetcher is starting Patchright
        paginate    the page is up and API pages are landing; `detail` carries
                    `covered`, the fraction of the requested date window walked
        parsing     pagination finished, rows are being shaped

    Everything before `paginate` is opaque by nature: Cloudflare is solved
    inside `StealthyFetcher.fetch`, which does not call back.
    """
    emit = on_progress or (lambda phase, detail=None: None)

    # Encodes the "#" as %23 like the old hand-rolled replace did, and also
    # the spaces a Riot game name is allowed to contain.
    quoted = quote(player, safe="")
    api = API_URL.format(player=quoted, playlist=playlist)
    profile = PROFILE_URL.format(player=quoted, playlist=playlist)
    captured = {}

    cutoff = since + "T00:00:00"

    def paginate(page):
        """Walk the `next` cursor, one evaluate() per page, until the cutoff."""
        matches, log = [], []
        cursor, newest = None, None

        for i in range(max_pages):
            res = page.evaluate(FETCH_PAGE_JS, {"api": api, "next": cursor}) or {}
            if not res.get("ok"):
                log.append("page {}: HTTP {}".format(i, res.get("status")))
                break
            if not res.get("count"):
                log.append("page {}: empty".format(i))
                break

            matches.extend(res.get("matches") or [])
            oldest = res.get("oldest")
            newest = newest or res.get("newest")
            log.append("page {}: {} matches, oldest {}".format(i, res["count"], oldest))
            emit(
                "paginate",
                {
                    "page": i,
                    "matches": len(matches),
                    "oldest": oldest,
                    "covered": _covered(newest, oldest, since),
                },
            )

            if oldest and oldest < cutoff:
                log.append("reached cutoff")
                break
            if res.get("next") is None:
                log.append("no further cursor")
                break
            cursor = res["next"]

        captured["result"] = {"matches": matches, "log": log}
        return page

    print("Loading " + profile, file=sys.stderr)
    emit("browser", {"url": profile})
    response = StealthyFetcher.fetch(
        profile,
        headless=True,
        solve_cloudflare=True,
        network_idle=True,
        block_ads=True,
        timeout=180000,
        page_action=paginate,
    )
    if response.status != 200:
        raise ScrapeError("Profile page failed with status " + str(response.status))

    out = captured.get("result") or {}
    if verbose:
        for line in out.get("log", []):
            print("  " + line, file=sys.stderr)
    emit("parsing", {"matches": len(out.get("matches", []))})
    return out.get("matches", [])


def _round(value, digits=0):
    if not isinstance(value, (int, float)):
        return None
    return round(value, digits) if digits else round(value)


def normalise(raw, since):
    """Drop matches before the cutoff, de-duplicate, and shape for the table."""
    seen, rows = set(), []
    for m in raw:
        match_id = m.get("id")
        stamp = m.get("timestamp")
        if not match_id or match_id in seen or not stamp or stamp[:10] < since:
            continue
        seen.add(match_id)

        result = "Win" if m.get("won") else ("Draw" if m.get("result") == "draw" else "Loss")
        rows.append(
            {
                "id": match_id,
                "timestamp": stamp,
                "date": stamp[:10],
                "agent": m.get("agent") or "Unknown",
                "map": m.get("map") or "Unknown",
                "result": result,
                "score": "{}:{}".format(m.get("roundsWon"), m.get("roundsLost")),
                "kills": m.get("kills") or 0,
                "deaths": m.get("deaths") or 0,
                "assists": m.get("assists") or 0,
                "kda": "{}/{}/{}".format(m.get("kills"), m.get("deaths"), m.get("assists")),
                # The API's ACS is unrounded (172.52…); the site displays it rounded.
                "acs": _round(m.get("acs")),
                "kd_ratio": _round(m.get("kd"), 2),
                "headshot_pct": _round(m.get("hs")),
                "placement": m.get("placement"),
                "rank": m.get("rank"),
                "trn_score": m.get("trn"),
                "season": m.get("season"),
            }
        )
    rows.sort(key=lambda r: r["timestamp"], reverse=True)
    return rows


def summarise(matches):
    wins = sum(m["result"] == "Win" for m in matches)
    acs = [m["acs"] for m in matches if m["acs"] is not None]
    kills = sum(m["kills"] for m in matches)
    deaths = sum(m["deaths"] for m in matches)
    assists = sum(m["assists"] for m in matches)
    lines = [
        "",
        "{} matches ({} .. {})".format(len(matches), matches[-1]["date"], matches[0]["date"]),
        "  {}W / {}L  ({}% win rate)".format(wins, len(matches) - wins, round(wins / len(matches) * 100)),
        "  average ACS {:.1f}".format(sum(acs) / len(acs)) if acs else "  average ACS n/a",
        "  K/D/A {}/{}/{}".format(kills, deaths, assists)
        + ("  (K/D {:.2f})".format(kills / deaths) if deaths else ""),
    ]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--player", default=DEFAULT_PLAYER)
    ap.add_argument("--playlist", default="competitive")
    ap.add_argument("--since", default=DEFAULT_SINCE, help="YYYY-MM-DD, inclusive")
    ap.add_argument("--max-pages", type=int, default=60)
    ap.add_argument("-o", "--out", default="matches.json", type=Path)
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args()

    try:
        raw = scrape(args.player, args.playlist, args.since, args.max_pages, not args.quiet)
    except ScrapeError as exc:
        sys.exit(str(exc))
    if not raw:
        sys.exit("No matches returned — the API shape has probably changed.")

    matches = normalise(raw, args.since)
    if not matches:
        sys.exit("No matches on or after " + args.since + ".")

    args.out.write_text(json.dumps(matches, indent=2), encoding="utf-8")
    print(summarise(matches), file=sys.stderr)
    print("  -> " + str(args.out), file=sys.stderr)


if __name__ == "__main__":
    main()
