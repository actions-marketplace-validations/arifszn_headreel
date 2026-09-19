import type { Key, Shot } from '../../core/camera.js';
import type { Contributions } from '../../core/data/contributions.js';
import { canvasMeasure, fitLine, type FittedLine } from '../../core/text.js';
import type { Identity } from '../types.js';
import type { Palette } from './palette.js';
import { buildProfile, CELL, type Profile } from './profile.js';

/**
 * The survey sheet as filmed: where the collar's type sits, and one walk from
 * the year's first week to the summit and back (Highlights Reel's camera, in
 * `core/camera.ts`). Everything here is a pure function of the data; the
 * sketch only draws.
 */

export const FRAMES = 480;

const W = 1280;
const H = 400;
/** The map's viewport: right of the collar. */
const VIEWPORT_LEFT = 400;

export const LAYOUT = {
  width: W,
  height: H,
  viewport: { left: VIEWPORT_LEFT, cx: (VIEWPORT_LEFT + W) / 2, cy: H / 2 },
  /** Margin around the sheet at the wide shot, screen px. */
  wideMargin: 24,
  /** The summit holds close. */
  summitZ: 1.6,
  /** Camera dip tuning: moves longer than `travel` dip, scaled to `span`. */
  travel: 700,
  span: 1600,
  /** Collar text column. */
  collar: { left: 48, right: 368 },
  /**
   * The walk. The camera frames the whole elevation band, from above the
   * flag to the month labels, so it never chases the walker up and down: `y`
   * and `z` are fixed and only `x` pans. The walker keeps one speed along the
   * trail (screen px per frame, at `z`), eased in and out over `ramp` frames.
   * A walk shorter than `max` frames gives its spare frames to the holds; a
   * longer trail starts the walk that far before the summit.
   */
  walk: { z: 0.43, y: 660, speed: 7, ramp: 20, min: 60, max: 215 },
  /** The walk's horizontal view keeps this margin past the map, world units. */
  panMargin: 40,
  /**
   * Segment lengths, in frames, with the walk at `walk.max`; they add up to
   * `FRAMES`. A shorter walk splits its spare frames between the two holds.
   */
  segments: { wideHold: 55, descend: 40, arrive: 40, summitHold: 80, pullBack: 50 },
} as const;

export interface Window {
  start: number;
  end: number;
}

export interface Plan {
  keys: Key[];
  /** The summit hold, when the flag waves. Empty when it never holds. */
  summitHold: Window;
  /** The walk, trail start to summit. Empty when there is nothing to walk to. */
  walk: Window;
  /** The walker fades in over this window, on the descend. */
  fadeIn: Window;
  /** The walker fades out over this window, on the arrival at the summit. */
  fadeOut: Window;
  /** The walker's world x at each walk frame, `walk.start` to `walk.end`. */
  path: number[];
}

export interface MonthMark {
  /** Week column the month starts in. */
  week: number;
  label: string;
}

export interface Collar {
  name: FittedLine;
  tagline: FittedLine | null;
  website: FittedLine | null;
  total: string;
  /** `SUMMIT 166 · OCT 5 TO 11`; null when there are no contributions. */
  summitLine: string | null;
  /** `CONTOUR INTERVAL 20 CONTRIBUTIONS`; null when there are no levels. */
  intervalText: string | null;
  /** Scale bar: weeks per segment and one segment's width, screen px. */
  scale: { weeksPerSegment: number; segments: number; px: number };
}

export interface TrailModel {
  profile: Profile;
  collar: Collar;
  months: MonthMark[];
  plan: Plan;
  palette: Palette;
  /** Wide-shot zoom, also the scale bar's honest scale. */
  zWide: number;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "2026-03-12" .. "2026-03-18" -> "MAR 12 TO 18" (crossing months spells both). */
export function summitDates(from: string, to: string): string {
  const [, fm, fd] = from.split('-').map(Number);
  const [, tm, td] = to.split('-').map(Number);
  return fm === tm
    ? `${MONTHS[fm! - 1]} ${fd} TO ${td}`
    : `${MONTHS[fm! - 1]} ${fd} TO ${MONTHS[tm! - 1]} ${td}`;
}

/** The wide shot: the whole sheet in the viewport with `wideMargin` to spare. */
export function wideShot(profile: Profile): Shot {
  const z = Math.min(
    (W - VIEWPORT_LEFT - LAYOUT.wideMargin) / profile.world.w,
    (H - LAYOUT.wideMargin) / profile.world.h,
  );
  return { x: profile.world.w / 2, y: profile.world.h / 2, z };
}

/** Weeks the months start in, for the graticule and the labels under the ground. */
export function monthMarks(contributions: Contributions): MonthMark[] {
  const marks: MonthMark[] = [];
  contributions.weeks.forEach((week, i) => {
    for (const day of week) {
      if (day.date < contributions.from || day.date > contributions.to) continue;
      const [, m, d] = day.date.split('-').map(Number);
      if (d === 1) {
        marks.push({ week: i, label: MONTHS[m! - 1]! });
        break;
      }
    }
  });
  return marks;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export interface MarkerState {
  x: number;
  y: number;
  /** 0 on the wide holds, ramping in on the descend and out on the arrival. */
  alpha: number;
  /** True while the marker moves along the profile. */
  walking: boolean;
}

/**
 * The walker at a loop frame: standing at the walk's start while it fades in,
 * walking the baked path to the summit, then fading out as the camera pushes
 * in, so the survey triangle takes over and the wide holds match.
 */
export function markerAt(profile: Profile, plan: Plan, frame: number): MarkerState | null {
  const { path, walk, fadeIn, fadeOut } = plan;
  if (!profile.summit || path.length === 0) return null;
  const f = Math.floor(frame);
  let x: number;
  let alpha = 1;
  let walking = false;
  if (f < walk.start) {
    x = path[0]!;
    alpha = clamp01((frame - fadeIn.start) / (fadeIn.end - fadeIn.start));
  } else if (f < walk.end) {
    x = path[f - walk.start]!;
    walking = true;
  } else {
    x = path.at(-1)!;
    alpha = 1 - clamp01((frame - fadeOut.start) / (fadeOut.end - fadeOut.start));
  }
  return { x, y: profile.profileY(x), alpha, walking };
}

/**
 * Distance along the trail at walk frame `f` of `n`, for a trail `length`
 * long: a sine ramp up over `ramp` frames, a steady cruise, and the mirror
 * ramp down, so velocity is continuous and the cruise is one speed.
 */
export function walkDistance(f: number, n: number, ramp: number, length: number): number {
  const v = length / (n - ramp);
  const up = (g: number): number =>
    v * (g / 2 - (ramp / (2 * Math.PI)) * Math.sin((Math.PI * g) / ramp));
  if (f <= 0) return 0;
  if (f >= n) return length;
  if (f < ramp) return up(f);
  if (f <= n - ramp) return v * (ramp / 2 + (f - ramp));
  return length - up(n - f);
}

/**
 * The walker's path: its x at each walk frame, at one speed along the trail
 * (arc length, so it slows on the climbs instead of shooting up them). The
 * walk takes as many frames as the trail needs at `walk.speed`, within
 * `walk.min` and `walk.max`; a trail too long for `walk.max` starts that far
 * before the summit.
 */
function walkPath(profile: Profile): number[] {
  const { speed, ramp, min, max, z } = LAYOUT.walk;
  const to = profile.summit!.x;
  // Cumulative arc length from the first week, sampled every world unit.
  const xs: number[] = [];
  const arc: number[] = [];
  let s = 0;
  let prevY = profile.profileY(profile.weekX(0));
  for (let x = profile.weekX(0); ; x = Math.min(x + 1, to)) {
    const y = profile.profileY(x);
    if (xs.length > 0) s += Math.hypot(x - xs.at(-1)!, y - prevY);
    xs.push(x);
    arc.push(s);
    prevY = y;
    if (x >= to) break;
  }
  const maxLength = ((max - ramp) * speed) / z;
  const length = Math.min(s, maxLength);
  const n = Math.min(max, Math.max(min, Math.round((length * z) / speed + ramp)));
  const offset = s - length;

  const path: number[] = [];
  let i = 0;
  for (let f = 0; f <= n; f++) {
    const target = offset + walkDistance(f, n, ramp, length);
    while (i < arc.length - 2 && arc[i + 1]! < target) i++;
    const a = arc[i]!;
    const b = arc[i + 1] ?? a;
    const u = b > a ? clamp01((target - a) / (b - a)) : 0;
    path.push(xs[i]! + ((xs[i + 1] ?? xs[i]!) - xs[i]!) * u);
  }
  path[n] = to;
  return path;
}

/**
 * The walk's camera: fixed `y` and `z`, and an `x` that pans in step with
 * the walker across the whole sheet, so the view's left edge sits at the
 * map's west margin at the first week and its right edge at the east margin
 * at the last. The pan is a straight line of the walker's x: no kinks.
 */
function walkCam(profile: Profile, x: number): Shot {
  const { z, y } = LAYOUT.walk;
  const half = (W - VIEWPORT_LEFT) / 2 / z;
  const lo = profile.mapArea.x0 - LAYOUT.panMargin + half;
  const hi = profile.mapArea.x1 + LAYOUT.panMargin - half;
  const first = profile.weekX(0);
  const last = profile.weekX(profile.cols - 1);
  const u = last > first ? clamp01((x - first) / (last - first)) : 0.5;
  return { x: hi > lo ? lo + (hi - lo) * u : profile.world.w / 2, y, z };
}

const EMPTY: Window = { start: 0, end: 0 };

/**
 * The camera plan. The walk is baked as one key per frame, so GIF frames
 * sample it exactly and nothing re-eases.
 */
function buildPlan(profile: Profile): Plan {
  const wide = wideShot(profile);
  if (!profile.summit) {
    // The empty state: the camera holds the wide shot for the whole loop.
    return {
      keys: [
        { frame: 0, ...wide },
        { frame: FRAMES, ...wide },
      ],
      summitHold: EMPTY,
      walk: EMPTY,
      fadeIn: EMPTY,
      fadeOut: EMPTY,
      path: [],
    };
  }

  const seg = LAYOUT.segments;
  const path = walkPath(profile);
  const walkFrames = path.length - 1;
  const spare = LAYOUT.walk.max - walkFrames;
  const wideHold = seg.wideHold + Math.floor(spare / 2);
  const summitHold = seg.summitHold + Math.ceil(spare / 2);
  const walkStart = wideHold + seg.descend;
  const walkEnd = walkStart + walkFrames;
  const holdStart = walkEnd + seg.arrive;
  const holdEnd = holdStart + summitHold;

  const keys: Key[] = [
    { frame: 0, ...wide },
    { frame: wideHold, ...wide },
  ];
  path.forEach((x, f) => keys.push({ frame: walkStart + f, ...walkCam(profile, x) }));
  const summit: Shot = { x: profile.summit.x, y: profile.summit.y + 30, z: LAYOUT.summitZ };
  keys.push({ frame: holdStart, ...summit });
  keys.push({ frame: holdEnd, ...summit });
  keys.push({ frame: FRAMES, ...wide });
  return {
    keys,
    summitHold: { start: holdStart, end: holdEnd },
    walk: { start: walkStart, end: walkEnd },
    fadeIn: { start: wideHold, end: walkStart },
    fadeOut: { start: walkEnd, end: holdStart },
    path,
  };
}

/**
 * The collar's altimeter line: the summit at rest, and the week under the
 * walker (its total and dates) while it walks, switching back at arrival.
 */
export function altimeterLine(profile: Profile, plan: Plan, frame: number): string | null {
  const summit = profile.summit;
  if (!summit) return null;
  const marker = markerAt(profile, plan, frame);
  if (marker?.walking) {
    const week = profile.weeks[profile.weekAt(marker.x)]!;
    return `ALT ${week.total} · ${summitDates(week.from, week.to)}`;
  }
  return `SUMMIT ${summit.total} · ${summitDates(summit.from, summit.to)}`;
}

function buildCollar(profile: Profile, identity: Identity, zWide: number, total: number): Collar {
  const column = LAYOUT.collar.right - LAYOUT.collar.left;
  return {
    name: fitLine(
      identity.name.toUpperCase(),
      column,
      44,
      30,
      canvasMeasure('Space Grotesk', 700, 3),
    ),
    tagline: identity.tagline
      ? fitLine(identity.tagline, column, 17, 17, canvasMeasure('Space Grotesk', 400))
      : null,
    website: identity.website
      ? fitLine(
          `↗ ${displayUrl(identity.website)}`,
          column,
          12,
          12,
          canvasMeasure('JetBrains Mono', 400),
        )
      : null,
    total: total.toLocaleString('en-US'),
    ...(profile.summit
      ? {
          summitLine: `SUMMIT ${profile.summit.total} · ${summitDates(profile.summit.from, profile.summit.to)}`,
          intervalText: `CONTOUR INTERVAL ${profile.interval} CONTRIBUTIONS`,
        }
      : { summitLine: null, intervalText: null }),
    scale: { weeksPerSegment: 4, segments: 3, px: 4 * CELL * zWide },
  };
}

/** "https://www.example.com/" -> "www.example.com" */
function displayUrl(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
}

export function buildTrail(data: Contributions, identity: Identity, palette: Palette): TrailModel {
  const profile = buildProfile(data);
  const zWide = wideShot(profile).z;
  return {
    profile,
    collar: buildCollar(profile, identity, zWide, data.total),
    months: monthMarks(data),
    plan: buildPlan(profile),
    palette,
    zWide,
  };
}
