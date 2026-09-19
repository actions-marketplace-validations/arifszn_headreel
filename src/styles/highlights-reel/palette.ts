import type { Accent, Options, Theme } from './options.js';

export type Rgb = readonly [number, number, number];

/** A color with the alpha it is drawn at. */
export interface Tint {
  rgb: Rgb;
  alpha: number;
}

export interface Palette {
  desk: Rgb;
  card: Rgb;
  /** Pseudo repo cards on the stars card. */
  plate: Rgb;
  /** Empty bars. */
  well: Rgb;
  ink: Rgb;
  soft: Rgb;
  accent: Rgb;
  /** Day counts on the busiest week's accent cells. */
  onAccent: Rgb;
  amber: Rgb;
  dots: Tint;
  marks: Tint;
  shadow: Tint;
  border: Tint;
}

const AMBER: Rgb = [232, 163, 61];

/**
 * Accent presets, [light, dark]. Each passes 4.5:1 against its theme's desk,
 * the lowest background its small type sits on (see SPEC, Highlights Reel).
 * Receipt shares them: its counter is this desk.
 */
export const ACCENT_VALUES: Record<Accent, [Rgb, Rgb]> = {
  cobalt: [
    [53, 88, 232],
    [123, 147, 255],
  ],
  green: [
    [18, 122, 66],
    [61, 203, 127],
  ],
  violet: [
    [109, 63, 214],
    [169, 139, 255],
  ],
  orange: [
    [176, 71, 22],
    [255, 143, 87],
  ],
  pink: [
    [196, 40, 94],
    [255, 119, 168],
  ],
};

const LIGHT_INK: Rgb = [11, 12, 20];
const DARK_INK: Rgb = [238, 240, 246];

const BASE: Record<Theme, Omit<Palette, 'accent' | 'onAccent'>> = {
  light: {
    desk: [236, 237, 241],
    card: [255, 255, 255],
    plate: [242, 243, 247],
    well: [228, 230, 236],
    ink: LIGHT_INK,
    soft: [102, 106, 124],
    amber: AMBER,
    dots: { rgb: LIGHT_INK, alpha: 0.16 },
    marks: { rgb: LIGHT_INK, alpha: 0.15 },
    shadow: { rgb: LIGHT_INK, alpha: 0.07 },
    border: { rgb: LIGHT_INK, alpha: 0.09 },
  },
  dark: {
    desk: [13, 15, 23],
    card: [23, 26, 37],
    plate: [31, 35, 49],
    well: [38, 43, 58],
    ink: DARK_INK,
    soft: [140, 146, 168],
    amber: AMBER,
    dots: { rgb: DARK_INK, alpha: 0.1 },
    marks: { rgb: DARK_INK, alpha: 0.14 },
    shadow: { rgb: [0, 0, 0], alpha: 0.35 },
    border: { rgb: DARK_INK, alpha: 0.08 },
  },
};

export function paletteOf(options: Pick<Options, 'theme' | 'accent'>): Palette {
  const base = BASE[options.theme];
  const [light, dark] = ACCENT_VALUES[options.accent];
  return options.theme === 'light'
    ? { ...base, accent: light, onAccent: [255, 255, 255] }
    : { ...base, accent: dark, onAccent: base.desk };
}

/** Flat colors the encoder keeps exact and undithered. */
export function pinnedOf(palette: Palette): Rgb[] {
  return [palette.desk, palette.card, palette.plate, palette.well, palette.accent, palette.ink];
}
