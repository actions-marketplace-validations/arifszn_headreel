import { fetchNowPlaying, nowPlayingSchema, type NowPlaying } from '../../core/data/now-playing.js';
import type { Style } from '../types.js';
import { buildDeck, FRAMES } from './deck.js';
import { options } from './options.js';
import { paletteOf, pinnedOf } from './palette.js';
import { createDeckSketch } from './sketch.js';

export const nowPlaying: Style<NowPlaying, typeof options> = {
  id: 'now-playing',
  fps: 25,
  frames: FRAMES,
  pinned: (options) => pinnedOf(paletteOf(options)),
  data: { name: 'nowplaying', schema: nowPlayingSchema, fetch: fetchNowPlaying },
  options,
  createSketch({ data, options, identity, rng }) {
    return createDeckSketch(buildDeck(data, options, rng), identity);
  },
};
