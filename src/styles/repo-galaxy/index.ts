import { fetchRepos, reposSchema, type Repos } from '../../core/data/repos.js';
import type { Style } from '../types.js';
import { buildGalaxy } from './galaxy.js';
import { options } from './options.js';
import { createGalaxySketch } from './sketch.js';

export const repoGalaxy: Style<Repos, typeof options> = {
  id: 'repo-galaxy',
  fps: 25,
  frames: 300,
  data: { name: 'repos', schema: reposSchema, fetch: fetchRepos },
  options,
  createSketch({ login, data, options, identity, rng }) {
    return createGalaxySketch(buildGalaxy(data, rng, options), identity, login, rng);
  },
};
