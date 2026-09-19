import { GlobalFonts } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';

/** Bundled fonts (OFL). Only these are used, so output never depends on system fonts. */
const FONT_FILES = [
  'SpaceGrotesk-Medium.ttf',
  'SpaceGrotesk-Bold.ttf',
  'JetBrainsMono-Regular.ttf',
  // Handwriting face for Now Playing's cassette label. Variable font: Skia
  // registers the default 400 instance and ignores other weights.
  'Caveat.ttf',
] as const;

// Resolves from both src/core (tsx, vitest) and dist/core (published build).
const FONT_DIR = new URL('../../assets/fonts/', import.meta.url);

let registered = false;

export function registerFonts(): void {
  if (registered) return;
  for (const file of FONT_FILES) {
    const path = fileURLToPath(new URL(file, FONT_DIR));
    if (!GlobalFonts.registerFromPath(path)) {
      throw new Error(`Failed to register font ${path}`);
    }
  }
  registered = true;
}
