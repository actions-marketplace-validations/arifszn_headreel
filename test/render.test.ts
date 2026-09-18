import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encodeGif } from '../src/core/encode/gif.js';
import { renderFrames, type Sketch } from '../src/core/render/render.js';

const spec = { width: 64, height: 32, frames: 4 };

const sketch: Sketch = {
  draw(p, _frame, t) {
    p.background(10, 20, 40);
    p.noStroke();
    p.fill(255, 200, 100);
    p.rect(t * spec.width, 8, 8, 16);
  },
};

const hash = (d: Uint8ClampedArray) => createHash('sha256').update(d).digest('hex');

describe('renderFrames', () => {
  it('renders distinct, deterministic frames', async () => {
    const a = await renderFrames(sketch, spec);
    const b = await renderFrames(sketch, spec);
    expect(a).toHaveLength(spec.frames);
    expect(a.map(hash)).toEqual(b.map(hash));
    expect(new Set(a.map(hash)).size).toBe(spec.frames);
  });

  it('encodes a GIF', async () => {
    const frames = await renderFrames(sketch, spec);
    const gif = encodeGif(frames, { width: spec.width, height: spec.height, fps: 15 });
    expect(Buffer.from(gif.subarray(0, 6)).toString('ascii')).toBe('GIF89a');
  });
});
