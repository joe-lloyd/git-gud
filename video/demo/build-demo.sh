#!/usr/bin/env bash
# Builds the demo repository the tutorial shows: "tidepool", a small tide-chart
# dashboard with a few weeks of history from four people.
#
#   video/demo/build-demo.sh <out-dir>
#
# Creates <out>/tidepool (the repo), <out>/origin/tidepool.git (its remote) and
# <out>/tidepool.worktrees/hotfix/tide-offset (a linked worktree). Rerunning wipes <out>.
set -euo pipefail

OUT="${1:?usage: build-demo.sh <out-dir>}"
rm -rf "$OUT"
mkdir -p "$OUT/origin"
REPO="$OUT/tidepool"
ORIGIN="$OUT/origin/tidepool.git"
TICK=$(date -j -f "%Y-%m-%d %H:%M" "2026-10-01 09:12" +%s)

# macOS ships bash 3.2, which has no associative arrays.
email() { echo "$(echo "${1%% *}" | tr '[:upper:]' '[:lower:]')@tidepool.dev"; }

# commit <dir> <author> <hours-later> <message>
commit() {
  local dir="$1" who="$2" hours="$3" msg="$4"
  TICK=$((TICK + hours * 3600 + RANDOM % 1800))
  local when
  when=$(date -u -r "$TICK" +"%Y-%m-%dT%H:%M:%SZ")
  git -C "$dir" add -A
  GIT_AUTHOR_NAME="$who" GIT_AUTHOR_EMAIL="$(email "$who")" GIT_AUTHOR_DATE="$when" \
  GIT_COMMITTER_NAME="$who" GIT_COMMITTER_EMAIL="$(email "$who")" GIT_COMMITTER_DATE="$when" \
    git -C "$dir" commit -q -m "$msg"
}
merge() {
  local dir="$1" who="$2" hours="$3" branch="$4" msg="$5"
  TICK=$((TICK + hours * 3600))
  local when
  when=$(date -u -r "$TICK" +"%Y-%m-%dT%H:%M:%SZ")
  GIT_AUTHOR_NAME="$who" GIT_AUTHOR_EMAIL="$(email "$who")" GIT_AUTHOR_DATE="$when" \
  GIT_COMMITTER_NAME="$who" GIT_COMMITTER_EMAIL="$(email "$who")" GIT_COMMITTER_DATE="$when" \
    git -C "$dir" merge -q --no-ff "$branch" -m "$msg"
}
tag() {
  local dir="$1" name="$2" msg="$3"
  local when
  when=$(date -u -r "$TICK" +"%Y-%m-%dT%H:%M:%SZ")
  GIT_COMMITTER_NAME="Maya Chen" GIT_COMMITTER_EMAIL="maya@tidepool.dev" GIT_COMMITTER_DATE="$when" \
    git -C "$dir" tag -a "$name" -m "$msg"
}
put() { mkdir -p "$(dirname "$REPO/$1")"; cat > "$REPO/$1"; }

git init -q --bare -b main "$ORIGIN"
git init -q -b main "$REPO"
git -C "$REPO" config user.name "Alex Rivera"
git -C "$REPO" config user.email "alex@tidepool.dev"
git -C "$REPO" config commit.gpgsign false
git -C "$REPO" remote add origin "$ORIGIN"

put README.md <<'X'
# tidepool

Tide charts for the beaches you actually go to.
X
put package.json <<'X'
{
  "name": "tidepool",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "test": "node test/units.test.js" }
}
X
put .gitignore <<'X'
node_modules/
dist/
.cache/
X
commit "$REPO" "Maya Chen" 0 "chore: scaffold tidepool"

put src/api.ts <<'X'
const STATION_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

export type TidePoint = { time: string; height: number };

export async function fetchTides(station: string): Promise<TidePoint[]> {
  const url = `${STATION_URL}?station=${station}&product=predictions&datum=MLLW&format=json`;
  const response = await fetch(url);
  const body = await response.json();
  return body.predictions.map((p: { t: string; v: string }) => ({ time: p.t, height: Number(p.v) }));
}
X
commit "$REPO" "Sam Okafor" 5 "feat(api): fetch tide predictions from NOAA"

put src/units.js <<'X'
// Heights arrive in feet. Everyone outside the US wants metres.
export const FEET_PER_METRE = 3.28084;

export function toMetres(feet) {
  return Math.round((feet / FEET_PER_METRE) * 100) / 100;
}

export function toFeet(metres) {
  return Math.round(metres * FEET_PER_METRE * 100) / 100;
}

export const DEFAULT_UNIT = "ft";
X
commit "$REPO" "Priya Raman" 20 "feat(units): convert between feet and metres"

put test/units.test.js <<'X'
import assert from "node:assert/strict";
import { toFeet, toMetres } from "../src/units.js";

assert.equal(toMetres(3.28084), 1);
assert.equal(toMetres(10), 3.05);
assert.equal(toFeet(1), 3.28);
console.log("units: all 3 checks passed");
X
commit "$REPO" "Priya Raman" 2 "test(units): cover both conversions"

put src/ui/chart.ts <<'X'
import type { TidePoint } from "../api";

export function renderChart(points: TidePoint[], width = 640, height = 200): string {
  const max = Math.max(...points.map((p) => p.height));
  const step = width / (points.length - 1);
  const path = points.map((p, i) => `${i ? "L" : "M"}${i * step},${height - (p.height / max) * height}`).join(" ");
  return `<svg viewBox="0 0 ${width} ${height}"><path d="${path}" fill="none" stroke="currentColor"/></svg>`;
}
X
commit "$REPO" "Maya Chen" 18 "feat(ui): draw the tide curve as SVG"

put README.md <<'X'
# tidepool

Tide charts for the beaches you actually go to.

## Usage

    npm start -- --station 9414290

Heights are shown in feet. Set `TIDEPOOL_UNIT=m` for metres.
X
commit "$REPO" "Alex Rivera" 6 "docs: usage and units in the README"
tag "$REPO" v1.0.0 "tidepool 1.0.0"

# feature/dark-mode, merged
git -C "$REPO" checkout -q -b feature/dark-mode
put src/ui/theme.css <<'X'
:root { --bg: #ffffff; --ink: #10202c; --tide: #1f7a8c; }
X
commit "$REPO" "Alex Rivera" 20 "feat(ui): theme variables"
put src/ui/theme.css <<'X'
:root { --bg: #ffffff; --ink: #10202c; --tide: #1f7a8c; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0b1820; --ink: #d8e6ee; --tide: #58c4dd; }
}
X
commit "$REPO" "Alex Rivera" 3 "feat(ui): dark mode follows the system"
git -C "$REPO" checkout -q main

# fix/rounding on main's side, merged first
git -C "$REPO" checkout -q -b fix/negative-tides
put src/ui/chart.ts <<'X'
import type { TidePoint } from "../api";

export function renderChart(points: TidePoint[], width = 640, height = 200): string {
  const heights = points.map((p) => p.height);
  const max = Math.max(...heights);
  const min = Math.min(0, ...heights);
  const step = width / (points.length - 1);
  const y = (h: number) => height - ((h - min) / (max - min)) * height;
  const path = points.map((p, i) => `${i ? "L" : "M"}${i * step},${y(p.height)}`).join(" ");
  return `<svg viewBox="0 0 ${width} ${height}"><path d="${path}" fill="none" stroke="currentColor"/></svg>`;
}
X
commit "$REPO" "Sam Okafor" 4 "fix(chart): negative low tides went off the bottom"
git -C "$REPO" checkout -q main
merge "$REPO" "Maya Chen" 6 fix/negative-tides "Merge branch 'fix/negative-tides'"
merge "$REPO" "Maya Chen" 2 feature/dark-mode "Merge branch 'feature/dark-mode'"
git -C "$REPO" branch -q -d fix/negative-tides

put src/forecast.ts <<'X'
import { fetchTides, type TidePoint } from "./api";

export type Outlook = { day: string; high: number; low: number };

export async function threeDayOutlook(station: string): Promise<Outlook[]> {
  const points = await fetchTides(station);
  const byDay = new Map<string, TidePoint[]>();
  for (const p of points) {
    const day = p.time.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }
  return [...byDay].slice(0, 3).map(([day, list]) => ({
    day,
    high: Math.max(...list.map((p) => p.height)),
    low: Math.min(...list.map((p) => p.height)),
  }));
}

/** A one-line summary for the station header. */
export function describe(outlook: Outlook[]): string {
  if (outlook.length === 0) return "No predictions";
  const highest = Math.max(...outlook.map((o) => o.high));
  const lowest = Math.min(...outlook.map((o) => o.low));
  return `Next ${outlook.length} days: ${lowest} to ${highest}`;
}

/** Heights rounded for display. */
export function formatHeight(height: number, unit = "ft"): string {
  return `${height.toFixed(1)} ${unit}`;
}
X
commit "$REPO" "Maya Chen" 22 "feat(forecast): three-day outlook"

put src/cache.ts <<'X'
const TEN_MINUTES = 10 * 60 * 1000;
const entries = new Map<string, { at: number; value: unknown }>();

export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < TEN_MINUTES) return hit.value as T;
  const value = await load();
  entries.set(key, { at: Date.now(), value });
  return value;
}
X
commit "$REPO" "Sam Okafor" 5 "perf(api): cache station responses for ten minutes"
tag "$REPO" v1.1.0 "tidepool 1.1.0"

put src/stations.json <<'X'
[
  { "id": "9414290", "name": "San Francisco" },
  { "id": "8518750", "name": "The Battery, NY" },
  { "id": "9447130", "name": "Seattle" }
]
X
commit "$REPO" "Priya Raman" 19 "feat: list of favourite stations"

# The planted bug, for bisect: rounding to one decimal breaks the tests.
put src/units.js <<'X'
// Heights arrive in feet. Everyone outside the US wants metres.
export const FEET_PER_METRE = 3.28084;

const round = (n) => Math.round(n * 10) / 10;

export function toMetres(feet) {
  return round(feet / FEET_PER_METRE);
}

export function toFeet(metres) {
  return round(metres * FEET_PER_METRE);
}

export const DEFAULT_UNIT = "ft";
X
commit "$REPO" "Alex Rivera" 7 "refactor(units): share one rounding helper"

put src/ui/chart.ts <<'X'
import type { TidePoint } from "../api";

export function renderChart(points: TidePoint[], width = 640, height = 200): string {
  const heights = points.map((p) => p.height);
  const max = Math.max(...heights);
  const min = Math.min(0, ...heights);
  const step = width / (points.length - 1);
  const y = (h: number) => height - ((h - min) / (max - min)) * height;
  const path = points.map((p, i) => `${i ? "L" : "M"}${i * step},${y(p.height)}`).join(" ");
  const now = `<line x1="${width / 2}" x2="${width / 2}" y1="0" y2="${height}" class="now"/>`;
  return `<svg viewBox="0 0 ${width} ${height}"><path d="${path}" fill="none" stroke="currentColor"/>${now}</svg>`;
}
X
commit "$REPO" "Maya Chen" 21 "feat(chart): mark the current time"

put CHANGELOG.md <<'X'
# Changelog

## 1.2.0
- Favourite stations
- The chart marks the current time

## 1.1.0
- Three-day outlook
- Ten-minute response cache
X
commit "$REPO" "Maya Chen" 3 "docs: changelog for 1.2.0"
put package.json <<'X'
{
  "name": "tidepool",
  "version": "1.2.0",
  "type": "module",
  "scripts": { "test": "node test/units.test.js" }
}
X
commit "$REPO" "Maya Chen" 1 "chore(release): 1.2.0"
tag "$REPO" v1.2.0 "tidepool 1.2.0"

put src/api.ts <<'X'
import { cached } from "./cache";

const STATION_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

export type TidePoint = { time: string; height: number };

export async function fetchTides(station: string): Promise<TidePoint[]> {
  return cached(`tides:${station}`, async () => {
    const url = `${STATION_URL}?station=${station}&product=predictions&datum=MLLW&format=json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`NOAA answered ${response.status} for station ${station}`);
    const body = await response.json();
    return body.predictions.map((p: { t: string; v: string }) => ({ time: p.t, height: Number(p.v) }));
  });
}
X
commit "$REPO" "Sam Okafor" 18 "fix(api): say which station failed"

# Branches that stay open
git -C "$REPO" checkout -q -b feature/hourly-forecast
put src/hourly.ts <<'X'
import { fetchTides } from "./api";

export async function nextHours(station: string, hours = 12) {
  const points = await fetchTides(station);
  return points.slice(0, hours * 10);
}
X
commit "$REPO" "Priya Raman" 4 "feat(hourly): first cut of the hourly view"
put src/hourly.ts <<'X'
import { fetchTides } from "./api";

/** Predictions come every six minutes, so ten points make an hour. */
const POINTS_PER_HOUR = 10;

export async function nextHours(station: string, hours = 12) {
  const points = await fetchTides(station);
  return points.slice(0, hours * POINTS_PER_HOUR);
}
X
commit "$REPO" "Priya Raman" 2 "refactor(hourly): name the magic number"
put src/ui/hourly.css <<'X'
.hourly { display: grid; grid-template-columns: repeat(12, 1fr); gap: 4px; }
X
commit "$REPO" "Priya Raman" 3 "feat(hourly): grid layout"
git -C "$REPO" checkout -q main

git -C "$REPO" checkout -q -b experiment/radar
put src/radar.ts <<'X'
// Spike: overlay rain radar tiles on the map. Not wired in yet.
export const RADAR_TILES = "https://tilecache.rainviewer.com/v2/radar";
X
commit "$REPO" "Alex Rivera" 5 "spike: rain radar tiles"
git -C "$REPO" checkout -q main

# A branch that conflicts with main in src/units.js
git -C "$REPO" checkout -q -b feature/metric-default v1.2.0
sed -i '' 's/export const DEFAULT_UNIT = "ft";/export const DEFAULT_UNIT = "m";/' "$REPO/src/units.js"
commit "$REPO" "Priya Raman" 3 "feat(units): metric by default"
git -C "$REPO" checkout -q main
sed -i '' 's/export const DEFAULT_UNIT = "ft";/export const DEFAULT_UNIT = process.env.TIDEPOOL_UNIT ?? "ft";/' "$REPO/src/units.js"
commit "$REPO" "Sam Okafor" 2 "feat(units): read the unit from TIDEPOOL_UNIT"

# Publish, then let a teammate push two commits we don't have yet.
git -C "$REPO" push -q origin main feature/hourly-forecast --tags
git -C "$REPO" branch -q -u origin/main main
OTHER="$OUT/.teammate"
git clone -q "$ORIGIN" "$OTHER"
cat >> "$OTHER/README.md" <<'X'

## Stations

Pick a station id from https://tidesandcurrents.noaa.gov/stations.html.
X
commit "$OTHER" "Maya Chen" 3 "docs: where to find station ids"
cat > "$OTHER/src/stations.json" <<'X'
[
  { "id": "9414290", "name": "San Francisco" },
  { "id": "8518750", "name": "The Battery, NY" },
  { "id": "9447130", "name": "Seattle" },
  { "id": "8443970", "name": "Boston" }
]
X
commit "$OTHER" "Maya Chen" 1 "feat: add Boston to favourite stations"
git -C "$OTHER" push -q origin main
rm -rf "$OTHER"

# A linked worktree for a hotfix.
git -C "$REPO" worktree add -q -b hotfix/tide-offset "$OUT/tidepool.worktrees/hotfix/tide-offset" v1.2.0

# A stash.
cat >> "$REPO/src/ui/theme.css" <<'X'
.now { stroke: #f2a541; stroke-dasharray: 4 3; }
X
git -C "$REPO" stash push -q -m "wip: amber marker for the current time"

# Work in progress for the staging chapter.
put src/forecast.ts <<'X'
import { fetchTides, type TidePoint } from "./api";
import { toMetres } from "./units.js";

export type Outlook = { day: string; high: number; low: number; unit: "ft" | "m" };

export async function threeDayOutlook(station: string, unit: "ft" | "m" = "ft"): Promise<Outlook[]> {
  const points = await fetchTides(station);
  const byDay = new Map<string, TidePoint[]>();
  for (const p of points) {
    const day = p.time.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }
  const convert = unit === "m" ? toMetres : (feet: number) => feet;
  return [...byDay].slice(0, 3).map(([day, list]) => ({
    day,
    high: convert(Math.max(...list.map((p) => p.height))),
    low: convert(Math.min(...list.map((p) => p.height))),
    unit,
  }));
}

/** A one-line summary for the station header. */
export function describe(outlook: Outlook[]): string {
  if (outlook.length === 0) return "No predictions";
  const highest = Math.max(...outlook.map((o) => o.high));
  const lowest = Math.min(...outlook.map((o) => o.low));
  return `Next ${outlook.length} days: ${lowest} to ${highest}`;
}

/** Heights rounded for display. */
export function formatHeight(height: number, unit = "ft"): string {
  return `${height.toFixed(1)} ${unit}`;
}

// TODO: remove before committing
console.log("outlook loaded");
X
put README.md <<'X'
# tidepool

Tide charts for the beaches you actually go to.

## Usage

    npm start -- --station 9414290 --unit m

Heights are shown in feet. Pass `--unit m` or set `TIDEPOOL_UNIT=m` for metres.
X
put src/ui/legend.ts <<'X'
export function legend(unit: "ft" | "m"): string {
  return `<p class="legend">Heights in ${unit === "m" ? "metres" : "feet"} above mean lower low water</p>`;
}
X
echo "built $REPO"
