import {
  contributionsSchema,
  fetchContributions,
  type Contributions,
} from '../../core/data/contributions.js';
import type { Style } from '../types.js';
import { buildTrail, FRAMES } from './trail.js';
import { options } from './options.js';
import { paletteOf, pinnedOf } from './palette.js';
import { createTrailSketch } from './sketch.js';

export const trailProfile: Style<Contributions, typeof options> = {
  id: 'trail-profile',
  fps: 25,
  frames: FRAMES,
  pinned: (o) => pinnedOf(paletteOf(o)),
  data: { name: 'contributions', schema: contributionsSchema, fetch: fetchContributions },
  options,
  createSketch({ data, identity, options, rng }) {
    return createTrailSketch(buildTrail(data, identity, paletteOf(options)), rng);
  },
};
