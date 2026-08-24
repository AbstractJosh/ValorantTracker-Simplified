"""Local HTTP API behind the profile search page.

`scrape_tracker.py` is a one-shot CLI: it scrapes a profile and writes a file.
The web UI needs three things it does not offer — an arbitrary `Name#Tag`, some
sign of life across the two or three minutes a scrape takes, and somewhere to
keep results so a profile is only paid for once. This wraps it in those.

    GET    /api/profiles         cached profiles, newest first
    GET    /api/profile/{slug}   one cached profile with its matches
    DELETE /api/profile/{slug}   drop it from the cache
    GET    /api/scrape?player=…  server-sent events: progress, then the matches

Run it beside Vite:

    ./.venv/Scripts/python.exe server.py          # :8787
    cd DataTableDesign/react && npx vite          # proxies /api to it

There is deliberately no CORS header. The page reaches this through Vite's
proxy, so it is same-origin; opening it up would let any site the browser has
open drive a scrape on this machine.
"""

import json
import os
import queue
import re
import sys
import threading
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from math import exp
from pathlib import Path

import anyio
import uvicorn
from starlette.applications import Starlette
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from scrape_tracker import DEFAULT_PLAYER, DEFAULT_SINCE, ScrapeError, normalise, scrape

ROOT = Path(__file__).parent
CACHE = ROOT / "profiles"
DEFAULT_WINDOW_DAYS = 90
MAX_PAGES = 60

# tracker.gg Riot IDs: a 3-16 character game name, then #, then a 3-5 character
# tag. Spaces are legal inside a game name, so only the separator and the
# URL-hostile characters are excluded.
PLAYER_RE = re.compile(r"^[^#/\\?]{3,16}#[A-Za-z0-9]{3,5}$")
PLAYLISTS = {"competitive", "unrated", "premier"}

# One browser at a time. Patchright is heavy, and two concurrent Cloudflare
# solves on one machine mostly produce two slow failures.
_lock = threading.Lock()


def slugify(player):
    return re.sub(r"[^a-z0-9]+", "-", player.lower()).strip("-")


def default_since():
    return (date.today() - timedelta(days=DEFAULT_WINDOW_DAYS)).isoformat()


# --- progress ----------------------------------------------------------------
# Only `paginate` is measured: it knows how far back through the requested date
# window it has walked. Everything before it happens inside
# StealthyFetcher.fetch, which does not report, so that stretch is an
# elapsed-time curve easing toward OPENING_CEIL and never reaching it. The label
# always names the actual phase, so the bar reads as pacing, not measurement.
#
# The split is lopsided because the work is. Measured on this machine, clearing
# Cloudflare takes ~170s and paginating the whole history takes ~3s, so giving
# the opening phase most of the bar is what keeps it moving at a believable
# rate; an even split left it apparently stuck at 38% for three minutes. The
# time constant is set so the curve is still visibly climbing at 170s.
OPENING_CEIL, OPENING_TAU = 72.0, 60.0
PAGINATE_FLOOR, PAGINATE_CEIL = 74.0, 95.0


def _opening_pct(elapsed):
    return OPENING_CEIL - (OPENING_CEIL - 4.0) * exp(-elapsed / OPENING_TAU)


def _sse(event, payload):
    return ("event: " + event + "\ndata: " + json.dumps(payload) + "\n\n").encode("utf-8")


def _run_scrape(player, playlist, since, events):
    """Scrape on a worker thread, pushing (kind, payload) onto `events`.

    Takes ownership of `_lock`, which the request handler acquired before
    starting this thread. Releasing it here rather than in the handler is what
    makes the guard mean anything: if the browser tab closes mid-scrape the SSE
    generator is cancelled, and a lock released there would free the slot while
    Patchright is still driving a browser.
    """
    started = time.monotonic()

    def on_progress(phase, detail=None):
        events.put(("progress", {"phase": phase, "detail": detail or {}}))

    try:
        raw = scrape(player, playlist, since, MAX_PAGES, True, on_progress=on_progress)
        if not raw:
            raise ScrapeError(
                "tracker.gg returned no matches for " + player + ". Check the spelling, "
                "and note that the profile has to be public."
            )
        matches = normalise(raw, since)
        if not matches:
            raise ScrapeError(
                player + " has no " + playlist + " matches on or after " + since + "."
            )

        record = {
            "player": player,
            "playlist": playlist,
            "since": since,
            "scrapedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "took": round(time.monotonic() - started, 1),
            "matches": matches,
        }
        CACHE.mkdir(exist_ok=True)
        (CACHE / (slugify(player) + ".json")).write_text(
            json.dumps(record, indent=2), encoding="utf-8"
        )
        events.put(("done", record))
    except ScrapeError as exc:
        events.put(("error", {"message": str(exc)}))
    except Exception as exc:  # noqa: BLE001 - the stream must always terminate
        print("scrape failed: " + repr(exc), file=sys.stderr)
        events.put(("error", {"message": type(exc).__name__ + ": " + str(exc)}))
    finally:
        _lock.release()


def _error_stream(message):
    async def gen():
        yield _sse("error", {"message": message})

    return StreamingResponse(gen(), media_type="text/event-stream")


async def scrape_stream(request):
    player = (request.query_params.get("player") or "").strip()
    playlist = (request.query_params.get("playlist") or "competitive").strip().lower()
    since = (request.query_params.get("since") or default_since()).strip()
    refresh = request.query_params.get("refresh") == "1"

    if not PLAYER_RE.match(player):
        return _error_stream("Enter a Riot ID as Name#TAG.")
    if playlist not in PLAYLISTS:
        return _error_stream("Unknown playlist: " + playlist)
    try:
        datetime.strptime(since, "%Y-%m-%d")
    except ValueError:
        return _error_stream("`since` must be YYYY-MM-DD.")

    # A cached scrape only answers the question if it reaches at least as far
    # back as the one being asked now.
    cached = CACHE / (slugify(player) + ".json")
    if cached.exists() and not refresh:
        try:
            record = json.loads(cached.read_text(encoding="utf-8"))
        except ValueError:
            record = None
        if record and record.get("since", "9999") <= since:

            async def hit():
                yield _sse("progress", {"phase": "cache", "pct": 100, "label": "Loaded from cache"})
                yield _sse("done", record)

            return StreamingResponse(hit(), media_type="text/event-stream")

    async def stream():
        if not _lock.acquire(blocking=False):
            yield _sse("error", {"message": "Another scrape is already running — one browser at a time."})
            return
        # Ownership of the lock passes to the worker; see _run_scrape.
        events = queue.Queue()
        threading.Thread(
            target=_run_scrape, args=(player, playlist, since, events), daemon=True
        ).start()
        started = time.monotonic()
        pct, label = 3.0, "Starting browser"
        while True:
            elapsed = time.monotonic() - started
            try:
                kind, payload = events.get_nowait()
            except queue.Empty:
                # No news: keep the opening curve and the clock moving so
                # the bar stays alive while Cloudflare is being solved.
                if pct < PAGINATE_FLOOR:
                    pct = max(pct, _opening_pct(elapsed))
                yield _sse(
                    "progress",
                    {"phase": "waiting", "pct": round(pct, 1), "label": label,
                     "elapsed": round(elapsed, 1)},
                )
                await anyio.sleep(0.4)
                continue

            if kind == "progress":
                phase, detail = payload["phase"], payload["detail"]
                if phase == "browser":
                    label = "Loading profile · solving Cloudflare"
                elif phase == "paginate":
                    covered = float(detail.get("covered") or 0.0)
                    pct = max(pct, PAGINATE_FLOOR + covered * (PAGINATE_CEIL - PAGINATE_FLOOR))
                    label = "Reading match history · " + str(detail.get("matches", 0)) + " matches"
                elif phase == "parsing":
                    pct, label = 97.0, "Shaping rows"
                yield _sse(
                    "progress",
                    {"phase": phase, "pct": round(pct, 1), "label": label,
                     "elapsed": round(elapsed, 1), "detail": detail},
                )
            elif kind == "done":
                yield _sse(
                    "progress",
                    {"phase": "done", "pct": 100, "label": "Done", "elapsed": round(elapsed, 1)},
                )
                yield _sse("done", payload)
                return
            elif kind == "error":
                yield _sse("error", payload)
                return

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        # Neither Vite's proxy nor anything in front of it may buffer these.
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


def _summary(record):
    matches = record.get("matches", [])
    wins = sum(m["result"] == "Win" for m in matches)
    return {
        "slug": slugify(record["player"]),
        "player": record["player"],
        "playlist": record.get("playlist", "competitive"),
        "since": record.get("since"),
        "scrapedAt": record.get("scrapedAt"),
        "played": len(matches),
        "wins": wins,
        "losses": len(matches) - wins,
    }


async def list_profiles(request):
    CACHE.mkdir(exist_ok=True)
    out = []
    for path in sorted(CACHE.glob("*.json")):
        try:
            out.append(_summary(json.loads(path.read_text(encoding="utf-8"))))
        except (ValueError, KeyError):
            continue  # a half-written or hand-edited file should not 500 the list
    out.sort(key=lambda r: r.get("scrapedAt") or "", reverse=True)
    return JSONResponse(out)


async def get_profile(request):
    path = CACHE / (slugify(request.path_params["slug"]) + ".json")
    if not path.exists():
        return JSONResponse({"message": "Not scraped yet."}, status_code=404)
    return JSONResponse(json.loads(path.read_text(encoding="utf-8")))


async def delete_profile(request):
    path = CACHE / (slugify(request.path_params["slug"]) + ".json")
    path.unlink(missing_ok=True)
    return JSONResponse({"ok": True})


def seed_cache():
    """Put the committed scrape into the cache so the app opens with something.

    `profiles/` is a cache and is gitignored — committing it would mean every
    re-scrape showed up as a modified tracked file. `matches.json` is committed
    though, and it is a real scrape of DEFAULT_PLAYER, so on a fresh clone it
    becomes that profile's first cache entry. An existing entry is never
    overwritten: a scrape the user ran is newer than this one.
    """
    target = CACHE / (slugify(DEFAULT_PLAYER) + ".json")
    source = ROOT / "matches.json"
    if target.exists() or not source.exists():
        return
    try:
        matches = json.loads(source.read_text(encoding="utf-8"))
        if not isinstance(matches, list) or not matches:
            return
        record = {
            "player": DEFAULT_PLAYER,
            "playlist": "competitive",
            "since": DEFAULT_SINCE,
            # No finish time was recorded for the CLI run that produced it, so
            # the newest match it contains stands in rather than a made-up one.
            "scrapedAt": max(m["date"] for m in matches) + "T00:00:00+00:00",
            "matches": matches,
        }
    except (ValueError, KeyError, TypeError) as exc:
        # A hand-edited matches.json is not a reason to refuse to start.
        print("Could not seed from matches.json: " + repr(exc), file=sys.stderr)
        return
    CACHE.mkdir(exist_ok=True)
    target.write_text(json.dumps(record, indent=2), encoding="utf-8")
    print("Seeded " + target.name + " from matches.json", file=sys.stderr)


@asynccontextmanager
async def lifespan(_app):
    seed_cache()
    yield


app = Starlette(
    lifespan=lifespan,
    routes=[
        Route("/api/scrape", scrape_stream),
        Route("/api/profiles", list_profiles),
        Route("/api/profile/{slug}", get_profile),
        Route("/api/profile/{slug}", delete_profile, methods=["DELETE"]),
    ]
)

if __name__ == "__main__":
    # start.bat and vite.config.ts read the same variable, so moving the API
    # off 8787 keeps the launcher, the proxy and the server agreeing.
    port = int(os.environ.get("VT_SERVER_PORT") or 8787)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
