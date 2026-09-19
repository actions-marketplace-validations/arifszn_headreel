import { ACCENT_VALUES } from '../highlights-reel/palette.js';
import type { Options, Theme } from './options.js';

export type Rgb = readonly [number, number, number];

export interface Palette {
  /** The surface the printer sits on. */
  counter: Rgb;
  /** Printer body and its slot. */
  body: Rgb;
  slot: Rgb;
  /** Highlight edge on the body. */
  bevel: Rgb;
  paper: Rgb;
  /** Thermal ink and its faded pass, the same in both themes. */
  ink: Rgb;
  fadedInk: Rgb;
  identityInk: Rgb;
  identityMuted: Rgb;
  /** Prompt, cursor, tagline, website, LED. */
  accent: Rgb;
  /** Paper edge treatment: a hairline and a soft shadow, light theme only. */
  paperBorder: Rgb | null;
  shadow: number;
}

const PAPER = {
  paper: [250, 249, 245],
  ink: [30, 30, 34],
  fadedInk: [106, 106, 112],
} as const satisfies Partial<Record<keyof Palette, Rgb>>;

const BASE: Record<Theme, Omit<Palette, 'accent'>> = {
  dark: {
    ...PAPER,
    counter: [13, 15, 23],
    body: [28, 31, 41],
    slot: [5, 6, 10],
    bevel: [58, 61, 74],
    identityInk: [238, 240, 246],
    identityMuted: [140, 146, 168],
    paperBorder: null,
    shadow: 0,
  },
  light: {
    ...PAPER,
    counter: [236, 237, 241],
    body: [201, 204, 211],
    slot: [42, 45, 53],
    bevel: [246, 247, 249],
    identityInk: [11, 12, 20],
    identityMuted: [102, 106, 124],
    paperBorder: [11, 12, 20],
    shadow: 0.09,
  },
};

export function paletteOf(options: Pick<Options, 'theme' | 'accent'>): Palette {
  const [light, dark] = ACCENT_VALUES[options.accent];
  return {
    ...BASE[options.theme],
    accent: options.theme === 'light' ? light : dark,
  };
}

/** Flat colors the encoder keeps exact and undithered. */
export function pinnedOf(palette: Palette): Rgb[] {
  return [
    palette.counter,
    palette.paper,
    palette.ink,
    palette.fadedInk,
    palette.body,
    palette.accent,
  ];
}
