"""Rebuild `seasons.json`, the act list the "Since" dropdown offers.

Valorant's competitive calendar is episodes divided into acts, and tracker.gg
stamps every match with the act it was played in ("V26: A5"). Picking a start
date is really picking an act, so the UI offers acts rather than a bare
calendar - but that needs their start dates, and they are not derivable from
anything in this repo.

Source is valorant-api.com, a community mirror of the game client's own data.
Its act boundaries agree with the seasons tracker.gg reports: V26 ACT V opens
2026-08-19, and the first match stamped `V26: A5` in matches.json is 2026-08-19.

Run it when a new act starts:

    ./.venv/Scripts/python.exe fetch_seasons.py

Riot renamed the scheme partway through: episodes were "EPISODE 1" through
"EPISODE 9", then from 2025 they became "V25" and "V26" with acts running I to
VI. Both spellings are kept as-is so the labels match what the game and
tracker.gg show.
"""

import json
import sys
import urllib.request
from pathlib import Path

SOURCE = "https://valorant-api.com/v1/seasons"
OUT = Path(__file__).parent / "seasons.json"

ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "valorant-tracker/1.0"})
    with urllib.request.urlopen(req, timeout=30) as response:  # noqa: S310 - fixed https URL
        return json.loads(response.read().decode("utf-8"))


def build(rows):
    parents = {r["uuid"]: r for r in rows if not r.get("parentUuid")}
    seasons = []

    for row in rows:
        parent = parents.get(row.get("parentUuid") or "")
        if not parent:
            continue  # an episode itself, or something unparented like Closed Beta
        name = (row.get("displayName") or "").strip().upper()
        if not name.startswith("ACT"):
            continue
        act = ROMAN.get(name.replace("ACT", "").strip())
        start = (row.get("startTime") or "")[:10]
        if act is None or not start:
            continue

        # "EPISODE 9" reads better as "Episode 9"; "V26" is already how the game
        # and tracker.gg write it, so it is left alone.
        episode = (parent.get("displayName") or "").strip()
        pretty = episode.title() if episode.upper().startswith("EPISODE") else episode

        seasons.append(
            {
                "label": pretty + " · Act " + str(act),
                "episode": pretty,
                "act": act,
                "start": start,
                "end": (row.get("endTime") or "")[:10],
            }
        )

    # Newest first: that is the order the dropdown wants, and the order someone
    # scanning for "the act I just played" reads in.
    seasons.sort(key=lambda s: s["start"], reverse=True)
    return seasons


def main():
    try:
        payload = fetch(SOURCE)
    except Exception as exc:  # noqa: BLE001 - a refresh script may simply fail
        sys.exit("Could not reach " + SOURCE + ": " + str(exc))

    rows = payload.get("data") or []
    if not rows:
        sys.exit("No seasons in the response - the API shape has probably changed.")

    seasons = build(rows)
    if not seasons:
        sys.exit("Parsed no acts from " + str(len(rows)) + " rows - check the act naming.")

    OUT.write_text(json.dumps(seasons, indent=2, ensure_ascii=False), encoding="utf-8")
    print("Wrote " + str(len(seasons)) + " acts to " + OUT.name)
    print("  newest: " + seasons[0]["label"] + "  (from " + seasons[0]["start"] + ")")
    print("  oldest: " + seasons[-1]["label"] + "  (from " + seasons[-1]["start"] + ")")


if __name__ == "__main__":
    main()
