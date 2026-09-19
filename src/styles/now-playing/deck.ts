import type { NowPlaying, NowPlayingStatus } from '../../core/data/now-playing.js';
import type { Rng } from '../../core/prng.js';
import type { Options } from './options.js';
import { paletteOf, type Palette, type Rgb } from './palette.js';

/** 8 lyric lines at 2 s each, at 25 fps. */
export const FRAMES = 400;

/** Cassette hub and the fullest tape pack, px. */
export const HUB_R = 26;
export const PACK_MAX = 40;

export interface Reel {
  /** Tape pack radius; the share of tape the reel holds. */
  radius: number;
  /** Whole revolutions per loop, so the loop closes. The smaller pack turns faster. */
  revs: number;
  /** Seeded start angle, turns. */
  phase: number;
}

/** One brushed highlight across the faceplate, as fractions of the plate. */
export interface BrushStroke {
  y: number;
  x0: number;
  x1: number;
  alpha: number;
}

export interface Deck {
  palette: Palette;
  status: NowPlayingStatus;
  /** The tape's repository; null when there is no cassette. */
  repo: { owner: string; name: string } | null;
  /** Language color darkened for the label band; a repo without one uses slate. */
  bandColor: Rgb;
  languageName: string | null;
  /** Counter value, capped at 999 like a three-digit mechanical counter. */
  counter: number;
  /** Meter heights 0..1; 0 is an unlit ghost, one per window day. */
  bars: number[];
  lyrics: string[];
  takeUp: Reel;
  supply: Reel;
  brush: BrushStroke[];
  /** Seeded screw slot angles, radians. */
  screws: number[];
  /** The hand-written repo name sits a touch off square. */
  labelTilt: number;
}

const COUNTER_MAX = 999;

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(channel(h + 1 / 3) * 255),
    Math.round(channel(h) * 255),
    Math.round(channel(h - 1 / 3) * 255),
  ];
}

/**
 * The band's caption is small white type, so the band is held to a darkness
 * pale linguist colors reach after adjustment and dark ones keep their hue.
 */
export function languageBandColor(hex: string | null | undefined): Rgb {
  if (!hex) return [90, 96, 110];
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return hslToRgb(h, Math.min(s, 0.8), Math.min(Math.max(l, 0.3), 0.45));
}

/** Tape pack radius for a share of the tape, by area. */
export function packRadius(share: number): number {
  const s = Math.min(1, Math.max(0, share));
  return Math.sqrt(HUB_R ** 2 + s * (PACK_MAX ** 2 - HUB_R ** 2));
}

function reel(share: number, phase: number): Reel {
  const radius = packRadius(share);
  return { radius, revs: Math.max(1, Math.round(80 / radius)), phase };
}

/** Meter heights: sqrt scaling, so a quiet day next to a busy one still shows. */
export function meterBars(days: number[]): number[] {
  const max = Math.max(1, ...days);
  return days.map((c) => (c > 0 ? Math.sqrt(c / max) : 0));
}

export function buildDeck(data: NowPlaying, options: Options, rng: Rng): Deck {
  const brush: BrushStroke[] = [];
  for (let i = 0; i < 90; i++) {
    brush.push({
      y: rng(),
      x0: rng() * 0.6,
      x1: 0.4 + rng() * 0.6,
      alpha: 0.03 + rng() * 0.03,
    });
  }

  return {
    palette: paletteOf(options),
    status: data.status,
    repo: data.repo ? { owner: data.repo.owner, name: data.repo.name } : null,
    bandColor: languageBandColor(data.repo?.language?.color),
    languageName: data.repo?.language?.name ?? null,
    counter: Math.min(COUNTER_MAX, data.commits),
    bars: meterBars(data.days),
    lyrics: data.lyrics,
    takeUp: reel(data.share, rng()),
    supply: reel(1 - data.share, rng()),
    brush,
    screws: [rng() * Math.PI, rng() * Math.PI, rng() * Math.PI, rng() * Math.PI],
    labelTilt: (rng() - 0.5) * 0.04,
  };
}
