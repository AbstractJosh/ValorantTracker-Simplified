# Implementation notes

Details that would clutter the [README](README.md) but cost real time to work
out. Everything here is about *why* the code looks the way it does.

## The scrape

`scrape_tracker.py` reads tracker.gg's **JSON API**, not the rendered rows. The
rendered page is capped at the latest 20 matches behind a "Load More" button,
while the API paginates the full history and returns exact timestamps and
unrounded stats.

The browser still makes the request. `StealthyFetcher` (Scrapling's Patchright
backend) loads the profile page with `solve_cloudflare=True`, and `page_action`
then runs `fetch()` *inside* that page, so every API call carries its cookies
and referer. `block_ads=True` keeps ~3,500 ad domains out of the way.

Three findings that shape the query:

- **Drop the `season` parameter.** Filtering by season stops at that act's first
  match — `V26: A5` only reaches 19 August (33 matches). The unfiltered feed
  pages back through every act; reaching 18 July needs both `A5` and `A4`.
- **Pagination is a `next` cursor** in `data.metadata.next`, appended as
  `&next=N`. The loop stops when a page's oldest match predates the cutoff, so
  the last page is fetched whole and then filtered — no matches are lost at the
  boundary.
- **The cursor loop belongs in Python, not in the page.** It started as one
  `evaluate()` that walked the whole history and returned at the end, which
  reports nothing while it runs. The obvious fix — `page.expose_function` — does
  not work here: the JS-side wrapper is installed as an init script for *new*
  documents, so on an already-loaded page `window[name]` is Playwright's raw
  binding and rejects an object with `Invalid arguments: should be exactly one
  string`. One `evaluate()` per page reports naturally and puts the cutoff logic
  where it can be read.

Per match it reads agent, map, result, round score, K/D/A, ACS, K/D ratio,
headshot %, tracker score, rank and scoreboard placement. Rank is the one field
that is not in `value`/`displayValue` — it lives in `stats.rank.metadata.tierName`.

`ERROR: No Cloudflare challenge found` in the log is Scrapling saying there was
nothing to solve. It is not a failure, despite the level.

### The earlier HTML approach

The first version parsed `.v3-match-row` elements. It works and agrees with the
API on all 20 rows it could see, but it cannot page past them. Two traps it hit,
kept here because they apply to anyone scraping these pages:

- Win/loss is only in the row's class (`v3-match-row--win` / `--loss`), never in
  any text.
- The agent icon's URL is percent-encoded, so `img[src*='/agents/']` never
  matches — key on `displayicon` instead.

## The server

`server.py` is a small Starlette app. Starlette and uvicorn arrive with
Scrapling's `ai` extra, so it adds no dependency.

| Route | |
|---|---|
| `GET /api/scrape?player=&playlist=&since=&refresh=` | SSE: progress events, then `done` with the matches |
| `GET /api/profiles` | everything cached, newest first |
| `GET /api/profile/{slug}` | one cached profile |
| `DELETE /api/profile/{slug}` | drop it |

Results land in `profiles/<name-tag>.json`. A cached scrape is reused only when
it reaches at least as far back as the window being asked for now, so widening
`since` re-scrapes but narrowing it does not.

`profiles/` is gitignored — committing a cache would mean every re-scrape
dirtied a tracked file. `matches.json` is committed and is a real scrape, so on
a fresh clone the server seeds the cache from it and the app opens with data.

Three things that are easy to get wrong:

- **The one-scrape-at-a-time lock is taken by the request handler and released
  by the worker thread.** Closing the tab mid-scrape cancels the SSE generator,
  and a lock released there would free the slot while Patchright still had a
  browser open.
- **The client closes its EventSource the moment a terminal event lands.**
  EventSource reconnects whenever a stream ends, and the server ends the stream
  on success too — left alone it silently starts a second scrape.
- **No CORS header, on purpose.** Vite proxies `/api`, so the page is
  same-origin. With CORS instead, any site the browser had open could make this
  machine scrape.

### What the progress bar means

The pagination stretch is real: the scraper knows the newest match, the cutoff
date, and how far back it has walked, so 74–95% is a measurement. Everything
before it is not — Cloudflare is solved inside `StealthyFetcher.fetch`, which
does not report — so that stretch eases along an elapsed-time curve toward 72%
and never arrives. The label always names the actual phase, so the bar reads as
pacing rather than a claim.

The split is lopsided because the work is: on this machine Cloudflare takes
about 170 seconds and paginating the whole history takes about 3. An even split
left the bar apparently stuck at 38% for three minutes.

## The table

The component's `DataTableRecord` is a closed six-column schema threaded through
~15 modules, so `src/valorant/mapping.ts` puts each Valorant field in the slot
whose *type* it is, and `src/valorant/labels.ts` renames the words at runtime
(the label objects are plain exports, so no library file is edited):

| Record key | Type | Shows as | Holds |
|---|---|---|---|
| `name` | text | Agent | Agent played |
| `date` | date | Date | Match date, ISO |
| `status` | enum | Result | Win → `Success` (green), Loss → `Failed` (red) |
| `solvedCases` | number | ACS | Average combat score |
| `favouriteSeason` | enum | Rating | ACS bucketed into the enum's four slots |
| `address` | text | K / D / A | Kills / deaths / assists |

Detail pane: match id, rank, map, K/D, round score, and a notes line with
headshot %, tracker score, placement and act.

**Rating is derived, not scraped.** Valorant publishes no official ACS bands;
the thresholds (280 / 200 / 130) are in `ACS_BANDS` in `mapping.ts`.

Dates are stored ISO on purpose. The library's `compareCells` sorts two finite
numbers numerically (so ACS goes 460 → 62, not lexicographically) but falls back
to `localeCompare` for everything else, and only ISO sorts correctly there.

`DataTableDesign/` is a copy of
[AbstractJosh/DataTableDesign](https://github.com/AbstractJosh/DataTableDesign)
vendored in as plain files, not a submodule — edits here do not reach that repo,
and vice versa. Nothing under `DataTableDesign/react/src/lib/` was modified;
`npx vitest run` there passes all 359 tests.
