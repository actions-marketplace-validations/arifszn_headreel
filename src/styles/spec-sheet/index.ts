import { fetchSpecSheet, specSheetSchema, type SpecSheet } from '../../core/data/spec-sheet.js';
import type { Style } from '../types.js';
import { buildSheet, FRAMES } from './sheet.js';
import { options } from './options.js';
import { paletteOf, pinnedOf } from './palette.js';
import { createSpecSheetSketch } from './sketch.js';

export const specSheet: Style<SpecSheet, typeof options> = {
  id: 'spec-sheet',
  fps: 25,
  frames: FRAMES,
  pinned: (o) => pinnedOf(paletteOf(o)),
  data: { name: 'specsheet', schema: specSheetSchema, fetch: fetchSpecSheet },
  options,
  createSketch({ data, identity, options, rng }) {
    return createSpecSheetSketch(buildSheet(data, identity, paletteOf(options), rng));
  },
};
