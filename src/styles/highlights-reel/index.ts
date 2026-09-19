import { fetchHighlights, highlightsSchema, type Highlights } from '../../core/data/highlights.js';
import type { Style } from '../types.js';
import { options } from './options.js';
import { buildReel, FRAMES } from './reel.js';
import { paletteOf, pinnedOf } from './palette.js';
import { createReelSketch } from './sketch.js';

export const highlightsReel: Style<Highlights, typeof options> = {
  id: 'highlights-reel',
  fps: 25,
  frames: FRAMES,
  pinned: (options) => pinnedOf(paletteOf(options)),
  data: { name: 'highlights', schema: highlightsSchema, fetch: fetchHighlights },
  options,
  createSketch({ data, options, identity, rng }) {
    return createReelSketch(buildReel(data, rng, options), identity);
  },
};
