import { fetchReceipt, receiptSchema, type Receipt } from '../../core/data/receipt.js';
import type { Style } from '../types.js';
import { buildReceipt, FRAMES } from './receipt.js';
import { options } from './options.js';
import { paletteOf, pinnedOf } from './palette.js';
import { createReceiptSketch } from './sketch.js';

export const receipt: Style<Receipt, typeof options> = {
  id: 'receipt',
  fps: 25,
  frames: FRAMES,
  pinned: (options) => pinnedOf(paletteOf(options)),
  data: { name: 'receipt', schema: receiptSchema, fetch: fetchReceipt },
  options,
  createSketch({ data, login, options, identity, rng }) {
    return createReceiptSketch(
      buildReceipt(data, login, identity, options, paletteOf(options), rng),
      identity,
    );
  },
};
