import type { Options } from './options.js';

export type Rgb = readonly [number, number, number];

export interface Palette {
  /** Sheet and collar. */
  paper: Rgb;
  /** Name, total, ground line, neatline, spot heights, marker. */
  ink: Rgb;
  /** Eyebrow, units, scale text, grid and month labels. */
  muted: Rgb;
  /** Month lines on the graticule: the survey blue washed onto paper. */
  graticule: Rgb;
  /** The summit flag and its survey triangle. */
  flag: Rgb;
  /** Profile line, tagline, website. */
  accent: Rgb;
  /** Strata under the profile: the accent thinned with paper. */
  strata: Rgb;
  /** Engraved relief dots: the ink thinned onto paper, plotted solid. */
  stipple: Rgb;
  /** Elevation grid hairlines: the ink thinned onto paper. */
  grid: Rgb;
}

/** `over` at `alpha` over `base`, both opaque. */
export function blend(over: Rgb, base: Rgb, alpha: number): Rgb {
  return [
    Math.round(over[0] * alpha + base[0] * (1 - alpha)),
    Math.round(over[1] * alpha + base[1] * (1 - alpha)),
    Math.round(over[2] * alpha + base[2] * (1 - alpha)),
  ];
}

/** Survey-map contour brown, new to this style; the others keep shared names. */
const ACCENT_VALUES = {
  sienna: [138, 75, 34], // #8A4B22
  cobalt: [47, 85, 212], // #2F55D4
  green: [31, 107, 58], // #1F6B3A
  violet: [106, 63, 200], // #6A3FC8
} as const satisfies Record<Options['accent'], Rgb>;

const BASE = {
  paper: [243, 239, 227], // #F3EFE3
  ink: [43, 38, 32], // #2B2620
  muted: [107, 99, 88], // #6B6358
  graticule: [47, 111, 168], // #2F6FA8
  flag: [200, 16, 46], // #C8102E
} as const satisfies Partial<Record<keyof Palette, Rgb>>;

export function paletteOf(options: Pick<Options, 'accent'>): Palette {
  const accent = ACCENT_VALUES[options.accent];
  const paper = BASE.paper;
  return {
    ...BASE,
    accent,
    // Pre-blended solids, drawn opaque so the encoder can pin them: alpha
    // strokes anti-alias into a ramp of near-identical colors that dithers
    // and re-shuffles every frame the camera moves.
    strata: blend(accent, paper, 0.6),
    graticule: blend(BASE.graticule, paper, 0.35),
    stipple: blend(BASE.ink, paper, 0.55),
    grid: blend(BASE.ink, paper, 0.15),
  };
}

/** Flat colors the encoder keeps exact and undithered. */
export function pinnedOf(palette: Palette): Rgb[] {
  return [
    palette.paper,
    palette.ink,
    palette.accent,
    palette.flag,
    palette.strata,
    palette.graticule,
    palette.stipple,
    palette.grid,
  ];
}
