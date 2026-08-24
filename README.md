# Valorant tracker.gg scrape → Records data table

Scrapes a tracker.gg Valorant profile with [Scrapling](https://github.com/D4Vinci/Scrapling)
and renders the matches in the React data table from
[DataTableDesign](https://github.com/AbstractJosh/DataTableDesign).

Profile: `Akemsss#7421`, competitive. Current pull: **132 matches, 18 July –
23 August 2026**.

## Run it

```bash
# 1. Scrape (writes matches.json)
PYTHONIOENCODING=utf-8 ./.venv/Scripts/python.exe scrape_tracker.py --since 2026-07-18

# 2. Feed the table and serve it
cp matches.json DataTableDesign/react/src/valorant/matches.json
cd DataTableDesign/react && npx vite --port 5180
# then open http://localhost:5180/valorant.html
```

`PYTHONIOENCODING=utf-8` only matters for the console — without it Windows
renders non-ASCII output as `?`. The scraped data is correct either way.

Vite binds IPv6 first here, so `localhost` and `[::1]` work but `127.0.0.1`
does not. Use `--host 127.0.0.1` if you need the IPv4 address.

## The scrape

`scrape_tracker.py` reads tracker.gg's **JSON API**, not the rendered rows. The
rendered page is capped at the latest 20 matches behind a "Load More" button,
while the API paginates the full history and returns exact timestamps and
unrounded stats.

The browser still makes the request. `StealthyFetcher` (Scrapling's Patchright
backend) loads the profile page with `solve_cloudflare=True`, and `page_action`
then runs a `fetch()` loop *inside* that page, so every API call carries its
cookies and referer. `block_ads=True` keeps ~3,500 ad domains out of the way.

Two findings that shape the query:

- **Drop the `season` parameter.** Filtering by season stops at that act's first
  match — `V26: A5` only reaches 19 August (33 matches). The unfiltered feed
  pages back through every act; reaching 18 July needs both `A5` and `A4`.
- **Pagination is a `next` cursor** in `data.metadata.next`, appended as
  `&next=N`. The loop stops when a page's oldest match predates the cutoff, so
  the last page is fetched whole and then filtered — no matches are lost at the
  boundary.

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

## Layout

```
scrape_tracker.py                          the scraper
matches.json                               its output (132 matches)
CLAUDE.md                                  notes on the Scrapling codebase
scrapling/                                 Scrapling v0.4.15 (cloned)
.venv/                                     python 3.10 + scrapling[all] + chromium
DataTableDesign/react/src/valorant/        the app built on their component
  ├── App.tsx      page: profile header + <DataTable>
  ├── mapping.ts   ValorantMatch -> DataTableRecord
  ├── labels.ts    renames columns/statuses in both languages
  ├── valorant.css page frame (Modernist: radius 0, 2px borders, flat)
  └── matches.json copy of the scrape
DataTableDesign/react/valorant.html        vite entry
```

Nothing under `DataTableDesign/react/src/lib/` was modified; `npm test` there
passes 358/359, the one failure being a pre-existing jsdom focus quirk in an
export test, present before these files were added.
