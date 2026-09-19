import * as gifencModule from 'gifenc';

// Node loads gifenc's CommonJS build (functions live on the default export);
// ESM-aware tools such as vitest load its ESM build (named exports).
const gifenc: typeof gifencModule =
  typeof gifencModule.quantize === 'function'
    ? gifencModule
    : (gifencModule as unknown as { default: typeof gifencModule }).default;
const { GIFEncoder, quantize } = gifenc;

export interface EncodeSpec {
  width: number;
  height: number;
  fps: number;
  /**
   * Flat colors kept exact: each gets its own palette slot, and pixels of
   * exactly that color are not dithered. Large flat areas (a light card on a
   * light desk) otherwise dither into a fixed screen pattern that the moving
   * shapes slide under, which reads as flicker.
   */
  pinned?: readonly (readonly [number, number, number])[];
}

/** Number of frames sampled to build the shared palette. */
const PALETTE_SAMPLES = 6;
/** 255 real colors; the last global palette slot is the transparent index. */
const COLORS = 255;
const TRANSPARENT = COLORS;
/** Peak-to-peak dither amplitude, per channel. About one palette step. */
const DITHER_SPREAD = 14;
/** GIF disposal: leave the frame in place, so transparent pixels show the previous one. */
const DISPOSE_KEEP = 1;

// 8x8 Bayer matrix, normalized to -0.5..0.5.
const BAYER = (() => {
  const m = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ];
  return m.flat().map((v) => (v + 0.5) / 64 - 0.5);
})();

/**
 * Ordered dithering. The pattern depends only on pixel position, so a pixel
 * that does not change between frames dithers identically, which keeps the
 * frame deltas small and avoids shimmer.
 */
function dither(rgba: Uint8ClampedArray, width: number, pinned: Set<number>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    const x = p % width;
    const y = (p - x) / width;
    const exact =
      pinned.size > 0 && pinned.has((rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!);
    const offset = exact ? 0 : BAYER[(y & 7) * 8 + (x & 7)]! * DITHER_SPREAD;
    out[i] = rgba[i]! + offset;
    out[i + 1] = rgba[i + 1]! + offset;
    out[i + 2] = rgba[i + 2]! + offset;
    out[i + 3] = 255;
  }
  return out;
}

/**
 * Maps pixels to their nearest palette index, memoized per exact color.
 * gifenc's `applyPalette` memoizes per rgb565 bucket instead, so the first pixel
 * of a bucket in scan order picks the index for the whole bucket. Near-white
 * pixels then land on white in one frame and on a pale grey in the next, and a
 * flat card flickers. An exact memo is a pure function of the color.
 */
function createMapper(palette: number[][]): (rgba: Uint8ClampedArray) => Uint8Array {
  const memo = new Int16Array(1 << 24).fill(-1);
  const nearest = (r: number, g: number, b: number): number => {
    let best = 0;
    let bestDist = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const c = palette[k]!;
      const d = (c[0]! - r) ** 2 + (c[1]! - g) ** 2 + (c[2]! - b) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
    return best;
  };
  return (rgba) => {
    const out = new Uint8Array(rgba.length / 4);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      const key = (rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!;
      let index = memo[key]!;
      if (index < 0) {
        index = nearest(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
        memo[key] = index;
      }
      out[p] = index;
    }
    return out;
  };
}

function buildPalette(frames: Uint8ClampedArray[], frameBytes: number, colors: number): number[][] {
  const step = Math.max(1, Math.floor(frames.length / PALETTE_SAMPLES));
  const picks = frames.filter((_, i) => i % step === 0).slice(0, PALETTE_SAMPLES);
  const sample = new Uint8ClampedArray(frameBytes * picks.length);
  picks.forEach((data, i) => sample.set(data, i * frameBytes));
  return quantize(sample, colors);
}

/**
 * Encodes RGBA frames into a looping GIF: one global palette, ordered
 * dithering, and delta frames where unchanged pixels are transparent.
 */
export function encodeGif(frames: Uint8ClampedArray[], spec: EncodeSpec): Uint8Array {
  const { width, height } = spec;
  const pinnedColors = spec.pinned ?? [];
  const palette = [
    ...buildPalette(frames, width * height * 4, COLORS - pinnedColors.length),
    ...pinnedColors.map((c) => [...c]),
  ];
  const pinned = new Set(pinnedColors.map(([r, g, b]) => (r << 16) | (g << 8) | b));
  const globalPalette = [...palette];
  while (globalPalette.length < TRANSPARENT) globalPalette.push([0, 0, 0]);
  globalPalette.push([0, 0, 0]);

  const toIndex = createMapper(palette);
  const gif = GIFEncoder();
  const delay = Math.round(1000 / spec.fps);
  let previous: Uint8Array | undefined;
  for (const [i, data] of frames.entries()) {
    const index = toIndex(dither(data, width, pinned));
    let pixels = index;
    if (previous) {
      pixels = new Uint8Array(index);
      for (let p = 0; p < pixels.length; p++) {
        if (index[p] === previous[p]) pixels[p] = TRANSPARENT;
      }
    }
    gif.writeFrame(pixels, width, height, {
      ...(i === 0 ? { palette: globalPalette } : {}),
      delay,
      repeat: 0,
      transparent: i > 0,
      transparentIndex: TRANSPARENT,
      dispose: DISPOSE_KEEP,
    });
    previous = index;
  }
  gif.finish();
  return gif.bytes();
}
