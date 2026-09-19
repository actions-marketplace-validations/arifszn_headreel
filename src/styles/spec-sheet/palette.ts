import type { Options } from './options.js';

export type Rgb = readonly [number, number, number];

export interface Palette {
  /** The card's grid paper. */
  paper: Rgb;
  /** Name, values, dots, table rules and the card border. */
  ink: Rgb;
  /** Labels, the top bar, the footer's handle. */
  muted: Rgb;
  /** Eyebrow, tagline, website, cursor. */
  accent: Rgb;
  /** The paper's grid hairlines: the ink thinned onto paper, drawn opaque. */
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

/**
 * Gray is the muted label color itself: the card prints in ink and one
 * grey, like the portrait. Teal is new to this style; the other three share Trail Profile's
 * values.
 */
const ACCENT_VALUES = {
  gray: [106, 106, 112], // #6A6A70, the muted labels
  teal: [30, 122, 94], // #1E7A5E
  cobalt: [47, 85, 212], // #2F55D4
  violet: [106, 63, 200], // #6A3FC8
  sienna: [138, 75, 34], // #8A4B22
} as const satisfies Record<Options['accent'], Rgb>;

const BASE = {
  paper: [245, 245, 242], // #F5F5F2
  ink: [22, 22, 26], // #16161A
  muted: [106, 106, 112], // #6A6A70
} as const satisfies Partial<Record<keyof Palette, Rgb>>;

export function paletteOf(options: Pick<Options, 'accent'>): Palette {
  return {
    ...BASE,
    accent: ACCENT_VALUES[options.accent],
    // Pre-blended solid, drawn opaque so the encoder can pin it: alpha
    // hairlines anti-alias into a ramp of near-identical colors that dithers.
    grid: blend(BASE.ink, BASE.paper, 0.06),
  };
}

/** Flat colors the encoder keeps exact and undithered. */
export function pinnedOf(palette: Palette): Rgb[] {
  const colors = [palette.paper, palette.ink, palette.muted, palette.accent, palette.grid];
  // Gray accent is the muted color: pin it once.
  return colors.filter((c, i) => colors.findIndex((d) => d.join() === c.join()) === i);
}
