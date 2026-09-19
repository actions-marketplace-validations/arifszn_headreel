import { AVATAR_GRID } from '../../core/data/spec-sheet.js';

/**
 * The portrait: a monochrome halftone of the avatar's luma grid, on a screen
 * angled 45 degrees like print. Dots, radii and animation delays are computed
 * once (pure functions of the grid and the seeded jitter); every frame only
 * scales each dot's radius.
 */

/** Screen pitch, px: the distance between neighbouring dot centres. */
export const PITCH = 7;
/** Dot radius at full ink, as a fraction of the pitch. */
export const DOT_MAX = 0.55;
/** Radii below this, px, are left out entirely. */
export const DOT_MIN = 0.6;
/** The outer share of the disc where dots fade toward the paper. */
export const RIM = 0.12;
/**
 * Loop phases where the portrait dissolves and rebuilds. The two are the same
 * length and mirror each other, and the hold between them wraps across the
 * seam, so the loop reads as one even rhythm: hold, dissolve, rebuild.
 */
export const DISSOLVE: readonly [number, number] = [10 / 140, 70 / 140];
export const BUILD: readonly [number, number] = [70 / 140, 130 / 140];
/** Share of a sub-phase a single dot takes to shrink or grow. */
const WINDOW = 0.2;
/** Share of a sub-phase given to the seeded jitter, which feathers the front. */
const JITTER = 0.06;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export interface Dot {
  /** Screen-space centre. */
  x: number;
  y: number;
  /** Radius at rest, px: dark luma grows the dot, the rim shrinks it. */
  r: number;
  /** Distance from the disc centre over its radius, 0 at the centre. */
  rim: number;
  /** Seeded delay jitter, 0..1. */
  jitter: number;
  /**
   * Where the sweep reaches this dot, 0 (first to dissolve) to 1 (last): the
   * share of the portrait's ink in dots nearer the rim. Pacing by ink, not by
   * distance or area, keeps the visible change even: the faded rim and the
   * pale patches hold little ink, so a distance-paced front spent frames on
   * them with no visible change.
   */
  front: number;
}

/** Bilinear sample of the luma grid at a point of the unit square (0..1). */
export function sampleLuma(luma: ArrayLike<number>, u: number, v: number): number {
  const g = AVATAR_GRID - 1;
  const x = clamp01(u) * g;
  const y = clamp01(v) * g;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(g, x0 + 1);
  const y1 = Math.min(g, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const a = luma[y0 * AVATAR_GRID + x0]!;
  const b = luma[y0 * AVATAR_GRID + x1]!;
  const c = luma[y1 * AVATAR_GRID + x0]!;
  const d = luma[y1 * AVATAR_GRID + x1]!;
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/** One dot's at-rest radius: dark luma grows it, the rim fades it out. */
export function dotRadius(luma: number, rim: number): number {
  const ink = 1 - luma / 255;
  const fade = clamp01((1 - rim) / RIM);
  return PITCH * DOT_MAX * Math.sqrt(ink) * fade;
}

/**
 * The screen: a square lattice rotated 45 degrees, one dot per intersection
 * inside the disc, each sampling the grid bilinearly at its centre. Dots
 * whose faded radius falls below `DOT_MIN` (the pale and the outermost rim)
 * are left out.
 */
export function halftoneDots(
  luma: ArrayLike<number>,
  cx: number,
  cy: number,
  radius: number,
  next: () => number,
): Dot[] {
  const dots: Dot[] = [];
  const step = PITCH / Math.SQRT2;
  const k = Math.ceil(radius / step) + 1;
  for (let u = -k; u <= k; u++) {
    for (let v = -k; v <= k; v++) {
      const x = cx + (u - v) * step;
      const y = cy + (u + v) * step;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist > radius) continue;
      const rim = dist / radius;
      const sample = sampleLuma(luma, (x - cx) / radius / 2 + 0.5, (y - cy) / radius / 2 + 0.5);
      const r = dotRadius(sample, rim);
      if (r < DOT_MIN) continue;
      dots.push({ x, y, r, rim, jitter: next(), front: 0 });
    }
  }
  const order = dots.map((_, i) => i).sort((a, b) => dots[b]!.rim - dots[a]!.rim || a - b);
  const total = dots.reduce((sum, d) => sum + d.r * d.r, 0);
  let before = 0;
  for (const i of order) {
    const ink = dots[i]!.r * dots[i]!.r;
    dots[i]!.front = total > 0 ? (before + ink / 2) / total : 0;
    before += ink;
  }
  return dots;
}

/**
 * The fallback portrait when no avatar could be fetched: a sphere shaded from
 * a seeded light direction, as the reference card's halftone sphere. Points
 * outside the unit disc are paper (no dot).
 */
export function sphereLuma(next: () => number): number[] {
  const g = AVATAR_GRID;
  const lx = -0.52 - 0.2 * next();
  const ly = -0.58 - 0.2 * next();
  const lz = 0.62;
  const norm = Math.hypot(lx, ly, lz);
  const l = [lx / norm, ly / norm, lz / norm];
  const luma = Array.from({ length: g * g }, () => 255);
  for (let y = 0; y < g; y++) {
    for (let x = 0; x < g; x++) {
      const nx = ((x + 0.5) / g) * 2 - 1;
      const ny = ((y + 0.5) / g) * 2 - 1;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) {
        luma[y * g + x] = 255;
        continue;
      }
      const nz = Math.sqrt(1 - d2);
      const lit = Math.max(0, nx * l[0]! + ny * l[1]! + nz * l[2]!);
      luma[y * g + x] = Math.round(255 * (0.16 + 0.78 * lit));
    }
  }
  return luma;
}

/**
 * One dot's radius scale over one sub-phase `s` (0..1): the dissolve, rim
 * first, the front paced by ink (`Dot.front`), so about the same amount of
 * ink leaves on every frame. Every dot reaches exactly 0 at `s` 1: trigger
 * plus WINDOW never passes 1.
 */
function dissolveScale(dot: Dot, s: number): number {
  const trigger = dot.front * (1 - WINDOW - JITTER) + dot.jitter * JITTER;
  return 1 - smoothstep(trigger, trigger + WINDOW, s);
}

/**
 * One dot's radius scale at loop phase `t`. The portrait holds finished
 * (scale exactly 1), dissolves rim to centre, then rebuilds centre to rim as
 * the dissolve played backwards, so both halves have the same pace. Periodic:
 * `t` 0 and every `t` outside the two phases read exactly 1.
 */
export function dotScale(dot: Dot, t: number): number {
  if (t >= DISSOLVE[0] && t < DISSOLVE[1]) {
    return dissolveScale(dot, (t - DISSOLVE[0]) / (DISSOLVE[1] - DISSOLVE[0]));
  }
  if (t >= BUILD[0] && t < BUILD[1]) {
    return dissolveScale(dot, 1 - (t - BUILD[0]) / (BUILD[1] - BUILD[0]));
  }
  return 1;
}
