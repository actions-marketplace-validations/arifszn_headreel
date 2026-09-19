import { z } from 'zod';
import type { Identity, Style } from '../styles/types.js';
import { encodeGif } from './encode/gif.js';
import { registerFonts } from './fonts.js';
import { createRng, hashSeed } from './prng.js';
import { renderFrames } from './render/render.js';
import { CANVAS } from './canvas.js';

export interface BannerInput<Data> {
  login: string;
  data: Data;
  identity: Identity;
  /** Raw `key: value` options from the Action input or CLI, validated by the style. */
  options?: Record<string, string>;
}

/** Validates raw options against the style's schema. Runs before any API call. */
export function parseOptions<S extends z.ZodType>(
  style: Style<unknown, S>,
  raw: Record<string, string> = {},
): z.infer<S> {
  const parsed = style.options.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid options for ${style.id}:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export async function renderBanner<Data, S extends z.ZodType>(
  style: Style<Data, S>,
  input: BannerInput<Data>,
): Promise<Uint8Array> {
  const options = parseOptions(style as Style<unknown, S>, input.options);
  registerFonts();
  const rng = createRng(hashSeed(`${input.login}:${style.id}`));
  const sketch = style.createSketch({
    login: input.login,
    data: input.data,
    options,
    identity: input.identity,
    rng,
  });
  const frames = await renderFrames(sketch, { ...CANVAS, frames: style.frames });
  return encodeGif(frames, {
    ...CANVAS,
    fps: style.fps,
    ...(style.pinned ? { pinned: style.pinned(options) } : {}),
  });
}
