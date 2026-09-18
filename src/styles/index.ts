import { contributionCity } from './contribution-city/index.js';
import type { Style } from './types.js';

/** Built-in styles, keyed by id. */
export const styles: Record<string, Style<any, any>> = {
  [contributionCity.id]: contributionCity,
};
