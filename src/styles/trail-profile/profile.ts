import type { Contributions } from '../../core/data/contributions.js';

/**
 * The contribution calendar as a trail profile: one column per week, each
 * week's total the trail's elevation at that point of the year.
 *
 * Elevation is built so the busiest week is always the highest point, and the
 * line never shows a peak the data does not have: weekly totals sit at their
 * column centres and are joined with monotone cubic interpolation
 * (Fritsch-Carlson), which never overshoots. The profile peaks at exactly the
 * summit total at the busiest week (ties go to the latest week), and it stays
 * on the ground line across empty weeks and the flat margins.
 *
 * Heights are in contributions per week. The profile is sampled once (every 4
 * world units) and simplified (Ramer-Douglas-Peucker, epsilon 1); the strata
 * spans, the x ranges where the trail is above each level, are computed once
 * here. Nothing is derived per frame.
 */

/** One week column; one empty column flanks the calendar on each side. */
export const CELL = 48;
/** The sheet is 2.2:1, the viewport's aspect, so the wide shot fills the frame. */
export const WORLD_H = 1200;
/** World y of elevation 0, and of the summit (the busiest week). */
export const GROUND_Y = 1080;
export const SUMMIT_Y = 300;

/** Profile sampling pitch and simplification, world units. */
const SAMPLE = 4;
const SPAN_SAMPLE = 2;
const RDP_EPSILON = 1;
export const MAX_LEVELS = 8;

export type Point = readonly [number, number];
export type Span = readonly [number, number];

export type LevelKind = 'index' | 'intermediate';

export interface ProfileLevel {
  /** Height in contributions per week. */
  height: number;
  /** World y of the level line. */
  y: number;
  kind: LevelKind;
  /** X ranges where the profile is above this level. */
  spans: Span[];
}

export interface Summit {
  week: number;
  total: number;
  /** Week dates, YYYY-MM-DD. */
  from: string;
  to: string;
  x: number;
  y: number;
}

export interface SpotHeight {
  week: number;
  total: number;
  x: number;
  y: number;
}

export interface WeekInfo {
  from: string;
  to: string;
  total: number;
}

export interface Profile {
  cols: number;
  world: { w: number; h: number };
  /** The map area inside the neatline. */
  mapArea: { x0: number; y0: number; x1: number; y1: number };
  weeks: WeekInfo[];
  /** Level interval in contributions; 0 when there are no contributions. */
  interval: number;
  levels: ProfileLevel[];
  /** The simplified profile polyline, world units. */
  line: Point[];
  summit: Summit | null;
  spots: SpotHeight[];
  /** World y of the trail at x. */
  profileY(x: number): number;
  /** World x of week column `i`'s centre. */
  weekX(i: number): number;
  /** The week column at world x, clamped to the calendar. */
  weekAt(x: number): number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The contour interval: the smallest of 1, 2, 5, 10, 20, 50, ... that gives at
 * most `MAX_LEVELS` levels up to the summit, never below 1 contribution.
 */
export function contourInterval(summit: number): number {
  const series: number[] = [];
  for (let pow = 1; pow <= 1e6; pow *= 10) series.push(pow, pow * 2, pow * 5);
  return series.find((step) => Math.floor(summit / step) <= MAX_LEVELS) ?? series.at(-1)!;
}

/**
 * Fritsch-Carlson monotone cubic interpolation over uniformly spaced nodes:
 * the curve never overshoots, so it stays 0 across a run of empty weeks and
 * peaks at exactly the node value at a peak node.
 */
export function monotoneCubic(nodes: number[], pitch: number, x0: number) {
  const n = nodes.length;
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) delta.push((nodes[i + 1]! - nodes[i]!) / pitch);
  const m: number[] = Array.from({ length: n });
  m[0] = delta[0] ?? 0;
  m[n - 1] = delta[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1]! * delta[i]! <= 0) {
      m[i] = 0;
      continue;
    }
    // Weighted harmonic mean of the two segment slopes (equal pitches here),
    // which never exceeds either in magnitude, so the curve stays monotone.
    m[i] = (2 * delta[i - 1]! * delta[i]!) / (delta[i - 1]! + delta[i]!);
  }
  return (x: number): number => {
    if (n === 1) return nodes[0]!;
    const u = clamp((x - x0) / pitch, 0, n - 1);
    const i = Math.min(Math.floor(u), n - 2);
    const t = u - i;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * nodes[i]! +
      (t3 - 2 * t2 + t) * pitch * m[i]! +
      (-2 * t3 + 3 * t2) * nodes[i + 1]! +
      (t3 - t2) * pitch * m[i + 1]!
    );
  };
}

/** Ramer-Douglas-Peucker, iterative. */
function simplify(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;
    const [ax, ay] = points[lo]!;
    const [bx, by] = points[hi]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let far = -1;
    let dist = 0;
    for (let i = lo + 1; i < hi; i++) {
      const [px, py] = points[i]!;
      const d = Math.abs((px - ax) * dy - (py - ay) * dx) / len;
      if (d > dist) {
        dist = d;
        far = i;
      }
    }
    if (dist > epsilon && far > 0) {
      keep[far] = 1;
      stack.push([lo, far], [far, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** The x ranges where the trail is at or above `level` contributions. */
function spansAbove(trail: (x: number) => number, level: number, x0: number, x1: number): Span[] {
  const spans: Span[] = [];
  const f = (x: number): number => trail(x) - level;
  let start: number | null = null;
  let prevX = x0;
  let prevF = f(x0);
  if (prevF >= 0) start = x0;
  for (let x = x0 + SPAN_SAMPLE; x <= x1 + 1e-9; x += SPAN_SAMPLE) {
    const curF = f(x);
    if (prevF < 0 && curF >= 0 && start === null) {
      start = prevX + (SPAN_SAMPLE * -prevF) / (curF - prevF);
    } else if (prevF >= 0 && curF < 0 && start !== null) {
      spans.push([start, prevX + (SPAN_SAMPLE * prevF) / (prevF - curF)]);
      start = null;
    }
    prevX = x;
    prevF = curF;
  }
  if (start !== null) spans.push([start, x1]);
  return spans;
}

export function buildProfile(contributions: Contributions): Profile {
  const cols = contributions.weeks.length;
  const world = { w: (cols + 2) * CELL, h: WORLD_H };
  const mapArea = { x0: CELL, y0: 48, x1: world.w - CELL, y1: world.h - 48 };
  const weekX = (i: number): number => mapArea.x0 + (i + 0.5) * CELL;

  // Weekly totals; days outside the window are skipped.
  const weeks: WeekInfo[] = contributions.weeks.map((week) => {
    let total = 0;
    for (const day of week) {
      if (day.date < contributions.from || day.date > contributions.to) continue;
      total += day.count;
    }
    return { from: week[0]!.date, to: week.at(-1)!.date, total };
  });

  // The busiest week; ties go to the latest.
  let summitWeek = -1;
  let summitTotal = 0;
  weeks.forEach(({ total }, i) => {
    if (total >= summitTotal && total > 0) {
      summitTotal = total;
      summitWeek = i;
    }
  });

  // Zero nodes in the margins keep the sheet's edges flat ground.
  const trail = monotoneCubic([0, ...weeks.map((w) => w.total), 0], CELL, mapArea.x0 - CELL / 2);
  const scale = (GROUND_Y - SUMMIT_Y) / (summitTotal || 1);
  const profileY = (x: number): number => GROUND_Y - trail(x) * scale;

  const line: Point[] = [];
  for (let x = mapArea.x0; x <= mapArea.x1 + 1e-9; x += SAMPLE) {
    line.push([Math.min(x, mapArea.x1), profileY(Math.min(x, mapArea.x1))]);
  }

  const summit: Summit | null =
    summitWeek >= 0
      ? {
          week: summitWeek,
          total: summitTotal,
          from: weeks[summitWeek]!.from,
          to: weeks[summitWeek]!.to,
          x: weekX(summitWeek),
          y: profileY(weekX(summitWeek)),
        }
      : null;

  const levels: ProfileLevel[] = [];
  let interval = 0;
  if (summit) {
    interval = contourInterval(summit.total);
    for (let k = 1; k * interval <= summit.total + 1e-9; k++) {
      const height = k * interval;
      levels.push({
        height,
        y: GROUND_Y - height * scale,
        kind: k % 5 === 0 ? 'index' : 'intermediate',
        spans: spansAbove(trail, height, mapArea.x0, mapArea.x1),
      });
    }
  }

  // Spot heights: the next 3 busiest weeks that are local maxima of the
  // profile, at least 4 weeks from the summit and from each other.
  const spots: SpotHeight[] = [];
  if (summit) {
    const order = weeks
      .map(({ total }, i) => ({ total, i }))
      .filter(({ total, i }) => total > 0 && i !== summit.week)
      .sort((a, b) => b.total - a.total || a.i - b.i);
    const isPeak = (i: number): boolean => {
      const left = i > 0 ? weeks[i - 1]!.total : 0;
      const right = i < weeks.length - 1 ? weeks[i + 1]!.total : 0;
      const v = weeks[i]!.total;
      return v >= left && v >= right && (v > left || v > right);
    };
    const taken = [summit.week];
    for (const { total, i } of order) {
      if (spots.length >= 3) break;
      if (!isPeak(i)) continue;
      if (taken.some((w) => Math.abs(w - i) < 4)) continue;
      taken.push(i);
      spots.push({ week: i, total, x: weekX(i), y: profileY(weekX(i)) });
    }
  }

  return {
    cols,
    world,
    mapArea,
    weeks,
    interval,
    levels,
    line: simplify(line, RDP_EPSILON),
    summit,
    spots,
    profileY,
    weekX,
    weekAt: (x: number): number => clamp(Math.floor((x - mapArea.x0) / CELL), 0, cols - 1),
  };
}
