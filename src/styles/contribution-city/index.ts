import {
  contributionsSchema,
  fetchContributions,
  type Contributions,
} from '../../core/data/contributions.js';
import type { Style } from '../types.js';
import { buildCity } from './city.js';
import { options } from './options.js';
import { createCitySketch } from './sketch.js';

export const contributionCity: Style<Contributions, typeof options> = {
  id: 'contribution-city',
  fps: 25,
  frames: 150,
  data: { name: 'contributions', schema: contributionsSchema, fetch: fetchContributions },
  options,
  createSketch({ data, options, identity, rng }) {
    return createCitySketch(buildCity(data, rng, options.beacons), identity, rng);
  },
};
