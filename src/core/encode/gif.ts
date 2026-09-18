import * as gifencModule from 'gifenc';

// Node loads gifenc's CommonJS build (functions live on the default export);
// ESM-aware tools such as vitest load its ESM build (named exports).
const gifenc: typeof gifencModule =
  typeof gifencModule.quantize === 'function'
    ? gifencModule
    : (gifencModule as unknown as { default: typeof gifencModule }).default;
const { GIFEncoder, quantize, applyPalette } = gifenc;

export interface EncodeSpec {
  width: number;
  height: number;
  fps: number;
}

/** Number of frames sampled to build the shared palette. */
const PALETTE_SAMPLES = 4;

/** Encodes RGBA frames into a looping GIF with one global 256-color palette. */
export function encodeGif(frames: Uint8ClampedArray[], spec: EncodeSpec): Uint8Array {
  const frameBytes = spec.width * spec.height * 4;
  const step = Math.max(1, Math.floor(frames.length / PALETTE_SAMPLES));
  const picks = frames.filter((_, i) => i % step === 0).slice(0, PALETTE_SAMPLES);
  const sample = new Uint8ClampedArray(frameBytes * picks.length);
  picks.forEach((data, i) => sample.set(data, i * frameBytes));
  const palette = quantize(sample, 256);

  const gif = GIFEncoder();
  const delay = Math.round(1000 / spec.fps);
  for (const data of frames) {
    gif.writeFrame(applyPalette(data, palette), spec.width, spec.height, {
      palette,
      delay,
      repeat: 0,
    });
  }
  gif.finish();
  return gif.bytes();
}
