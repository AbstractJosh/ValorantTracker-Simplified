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
from pathlib import Path

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

# Walks the `next` cursor until a page's oldest match predates the cutoff.
# Trimmed to the fields used here so a long history stays a small payload.
PAGINATE_JS = """
async ({api, cutoff, maxPages}) => {
  const matches = [], log = [];
  let next = null;
  for (let i = 0; i < maxPages; i++) {
    const url = api + (next === null ? '' : '&next=' + next);
    const r = await fetch(url, {credentials: 'include', headers: {'Accept': 'application/json'}});
    if (!r.ok) { log.push('page ' + i + ': HTTP ' + r.status); break; }
    const d = await r.json();
    const page = (d.data && d.data.matches) || [];
    if (!page.length) { log.push('page ' + i + ': empty'); break; }

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
    const oldest = page[page.length - 1].metadata.timestamp;
    log.push('page ' + i + ': ' + page.length + ' matches, oldest ' + oldest);
    if (oldest < cutoff) { log.push('reached cutoff'); break; }
    const nx = d.data.metadata && d.data.metadata.next;
    if (nx === undefined || nx === null) { log.push('no further cursor'); break; }
    next = nx;
  }
  return {matches, log};
}
"""


def scrape(player, playlist, since, max_pages, verbose):
    quoted = player.replace("#", "%23")
    api = API_URL.format(player=quoted, playlist=playlist)
    profile = PROFILE_URL.format(player=quoted, playlist=playlist)
    captured = {}

    def paginate(page):
        captured["result"] = page.evaluate(
            PAGINATE_JS, {"api": api, "cutoff": since + "T00:00:00", "maxPages": max_pages}
        )
        return page

    print("Loading " + profile, file=sys.stderr)
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
        sys.exit("Profile page failed with status " + str(response.status))

    out = captured.get("result") or {}
    if verbose:
        for line in out.get("log", []):
            print("  " + line, file=sys.stderr)
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

    raw = scrape(args.player, args.playlist, args.since, args.max_pages, not args.quiet)
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
