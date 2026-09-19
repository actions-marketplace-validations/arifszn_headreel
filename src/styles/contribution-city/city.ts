import type { Contributions } from '../../core/data/contributions.js';
import type { Rng } from '../../core/prng.js';

export const LAYOUT = {
  width: 1280,
  height: 400,
  /** Week column width. */
  cell: 18,
  /** Street between buildings. */
  gap: 4,
  /** Oblique offset per weekday row. */
  depthX: 6,
  depthY: 7,
  /** Tallest tower, px. */
  maxH: 150,
  /** Ground line of the front row. */
  baseY: 352,
  rightMargin: 28,
  arcs: 4,
  arcTowers: 24,
  arcMinWeeks: 8,
  stars: 180,
  grain: 2600,
} as const;

export interface Window {
  x: number;
  y: number;
  lit: boolean;
  /** Flicker cycles per loop; 0 = steady. */
  cycles: number;
  off: number;
}

export interface Building {
  /** Week column. */
  w: number;
  /** Weekday: 0 = Sunday (back row) ... 6 = Saturday (front row). */
  d: number;
  count: number;
  /** Normalized height, 0..1. */
  t: number;
  h: number;
  x: number;
  y: number;
  bw: number;
  windows: Window[];
  beacon: boolean;
  beaconOffset: number;
}

export interface Star {
  x: number;
  y: number;
  s: number;
  a: number;
  cycles: number;
  off: number;
}

export interface Arc {
  a: Building;
  b: Building;
  off: number;
  lift: number;
}

export interface MonthLabel {
  w: number;
  label: string;
}

export interface City {
  weeks: number;
  total: number;
  maxCount: number;
  buildings: Building[];
  stars: Star[];
  arcs: Arc[];
  months: MonthLabel[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Front-left ground corner of the whole city. */
export function cityOrigin(weeks: number): { x: number; y: number } {
  const span = weeks * LAYOUT.cell + 7 * LAYOUT.depthX;
  return { x: LAYOUT.width - span - LAYOUT.rightMargin, y: LAYOUT.baseY };
}

/** Screen position of the front-left ground corner for (week, weekday). */
export function tileAt(weeks: number, w: number, d: number): { x: number; y: number } {
  const o = cityOrigin(weeks);
  const depth = 6 - d;
  return { x: o.x + w * LAYOUT.cell + depth * LAYOUT.depthX, y: o.y - depth * LAYOUT.depthY };
}

/** Busiest days marked with a beacon. */
export const BEACONS = 8;

export function buildCity(data: Contributions, rng: Rng): City {
  const between = (min: number, max: number) => min + rng() * (max - min);
  const weeks = data.weeks.length;
  const maxCount = Math.max(0, ...data.weeks.flat().map((d) => d.count));

  const buildings: Building[] = [];
  data.weeks.forEach((week, w) => {
    for (const day of week) {
      const t = maxCount > 0 ? Math.sqrt(day.count / maxCount) : 0;
      const h = day.count === 0 ? 0 : 6 + t * (LAYOUT.maxH - 6);
      const b: Building = {
        w,
        d: day.weekday,
        count: day.count,
        t,
        h,
        ...tileAt(weeks, w, day.weekday),
        bw: LAYOUT.cell - LAYOUT.gap,
        windows: [],
        beacon: false,
        beaconOffset: rng(),
      };
      if (h > 14) {
        const rows = Math.floor((h - 8) / 6);
        for (let r = 0; r < rows; r++) {
          for (let k = 0; k < 2; k++) {
            b.windows.push({
              x: 3 + k * 6,
              y: 6 + r * 6,
              lit: rng() < 0.25 + t * 0.5,
              cycles: rng() < 0.12 ? Math.floor(between(1, 4)) : 0,
              off: rng(),
            });
          }
        }
      }
      buildings.push(b);
    }
  });

  // Stable ranking: count, then chronological order, so ties never depend on sort internals.
  const ranked = buildings
    .filter((b) => b.count > 0)
    .sort((a, b) => b.count - a.count || a.w - b.w || a.d - b.d);
  for (const b of ranked.slice(0, BEACONS)) b.beacon = true;
  // Back rows first, then left to right, so front towers occlude correctly.
  buildings.sort((a, b) => a.d - b.d || a.w - b.w);

  const stars: Star[] = Array.from({ length: LAYOUT.stars }, () => ({
    x: rng() * LAYOUT.width,
    y: Math.pow(rng(), 1.6) * 250,
    s: rng() < 0.08 ? 2 : 1,
    a: between(40, 160),
    cycles: Math.floor(between(1, 4)),
    off: rng(),
  }));

  const arcs: Arc[] = [];
  const towers = ranked.slice(0, LAYOUT.arcTowers);
  if (towers.length >= 2) {
    const pick = () => towers[Math.floor(rng() * towers.length)]!;
    for (let i = 0; i < LAYOUT.arcs; i++) {
      const a = pick();
      let b = pick();
      for (let tries = 0; Math.abs(a.w - b.w) < LAYOUT.arcMinWeeks && tries < 20; tries++)
        b = pick();
      if (a === b) continue;
      arcs.push({ a, b, off: i / LAYOUT.arcs, lift: between(40, 80) });
    }
  }

  return { weeks, total: data.total, maxCount, buildings, stars, arcs, months: monthLabels(data) };
}

/** A label at the first week of each month; drops a partial leading month that would collide. */
export function monthLabels(data: Contributions): MonthLabel[] {
  const months: MonthLabel[] = [];
  let last = -1;
  data.weeks.forEach((week, w) => {
    const first = week[0];
    if (!first) return;
    const date = new Date(`${first.date}T00:00:00Z`);
    const m = date.getUTCMonth();
    if (m !== last) {
      if (w > 0 || date.getUTCDate() <= 7) months.push({ w, label: MONTHS[m]! });
      last = m;
    }
  });
  if (months[0]?.w === 0 && months[1] && months[1].w < 3) months.shift();
  return months;
}
