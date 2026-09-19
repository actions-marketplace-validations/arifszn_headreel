import { contributionCity } from './contribution-city/index.js';
import { highlightsReel } from './highlights-reel/index.js';
import { nowPlaying } from './now-playing/index.js';
import { receipt } from './receipt/index.js';
import { repoGalaxy } from './repo-galaxy/index.js';
import { specSheet } from './spec-sheet/index.js';
import { trailProfile } from './trail-profile/index.js';
import type { Style } from './types.js';

/** Built-in styles, keyed by id. */
export const styles: Record<string, Style<any, any>> = {
  [contributionCity.id]: contributionCity,
  [highlightsReel.id]: highlightsReel,
  [nowPlaying.id]: nowPlaying,
  [receipt.id]: receipt,
  [repoGalaxy.id]: repoGalaxy,
  [specSheet.id]: specSheet,
  [trailProfile.id]: trailProfile,
};
