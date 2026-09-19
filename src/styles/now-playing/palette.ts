import type { Accent, Options, Theme } from './options.js';

export type Rgb = readonly [number, number, number];

export interface Palette {
  /** Room the deck sits in. */
  bg: Rgb;
  /** Darkening toward the corners of the room, 0..1. */
  vignette: number;
  faceplate: Rgb;
  /** Highlight edges on the faceplate, the well and the display. */
  bevel: Rgb;
  /** Raised transport keys. */
  keyTop: Rgb;
  /** The rim light on a raised key. */
  keyRim: Rgb;
  screw: Rgb;
  /** Key, counter and LED captions printed on the faceplate. */
  plateInk: Rgb;
  /** Cassette shell. */
  shell: Rgb;
  /** Tape pack wound on a reel. */
  tape: Rgb;
  /** Cassette label paper and the ink written on it. */
  paper: Rgb;
  ink: Rgb;
  /** Display glass; the well's window uses it too. Dark in both themes. */
  glass: Rgb;
  /** Phosphor, on the display glass. */
  accent: Rgb;
  /** The accent where it sits on the room or the faceplate: prompt, links, PLAY key. */
  identityAccent: Rgb;
  /** Counter digits. */
  amber: Rgb;
  /** Record LED, unlit because it is not recording. */
  red: Rgb;
  identityInk: Rgb;
  identityMuted: Rgb;
}

/**
 * Accent presets: the three colors real VFDs came in. The phosphor value
 * passes 4.5:1 on the display glass; the light theme's darker value passes
 * 4.5:1 on its room (both asserted by a test).
 */
export const ACCENT_VALUES: Record<Accent, Rgb> = {
  cyan: [34, 211, 238],
  green: [52, 211, 153],
  orange: [251, 146, 60],
};

/** Tailwind 700 of each accent (orange 800: 700 misses 4.5:1), for type on the light room. */
const LIGHT_ACCENT_VALUES: Record<Accent, Rgb> = {
  cyan: [14, 116, 144],
  green: [4, 120, 87],
  orange: [154, 52, 18],
};

const CASSETTE = {
  shell: [46, 44, 41],
  tape: [24, 19, 17],
  paper: [239, 230, 210],
  ink: [31, 29, 26],
  glass: [7, 16, 15],
  amber: [255, 181, 71],
  red: [255, 77, 61],
} as const satisfies Partial<Record<keyof Palette, Rgb>>;

const BASE: Record<Theme, Omit<Palette, 'accent' | 'identityAccent'>> = {
  dark: {
    ...CASSETTE,
    bg: [16, 17, 20],
    vignette: 0.3,
    faceplate: [36, 38, 43],
    bevel: [58, 61, 68],
    keyTop: [58, 61, 68],
    keyRim: [255, 255, 255],
    screw: [22, 23, 26],
    plateInk: [143, 147, 156],
    identityInk: [242, 239, 232],
    identityMuted: [143, 147, 156],
  },
  // A silver deck, as 1980s hi-fi came in. The window and display stay dark.
  light: {
    ...CASSETTE,
    bg: [236, 237, 241],
    vignette: 0.06,
    faceplate: [204, 207, 212],
    bevel: [246, 247, 249],
    keyTop: [226, 228, 232],
    keyRim: [255, 255, 255],
    screw: [120, 124, 132],
    plateInk: [70, 74, 82],
    identityInk: [17, 18, 22],
    identityMuted: [92, 96, 106],
  },
};

export function paletteOf(options: Pick<Options, 'theme' | 'accent'>): Palette {
  const accent = ACCENT_VALUES[options.accent];
  return {
    ...BASE[options.theme],
    accent,
    identityAccent: options.theme === 'dark' ? accent : LIGHT_ACCENT_VALUES[options.accent],
  };
}

/** Flat colors the encoder keeps exact and undithered. */
export function pinnedOf(palette: Palette): Rgb[] {
  const colors = [palette.bg, palette.faceplate, palette.glass, palette.paper, palette.accent];
  if (palette.identityAccent !== palette.accent) colors.push(palette.identityAccent);
  return colors;
}
