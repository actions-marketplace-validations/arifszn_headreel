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

  it('captures each frame after its own draw', async () => {
    const drawn: number[] = [];
    const frames = await renderFrames(
      {
        draw(p, frame) {
          drawn.push(frame);
          p.background(frame * 60, 0, 0);
        },
      },
      spec,
    );
    expect(drawn).toEqual([0, 1, 2, 3]);
    expect(frames.map((d) => [d[0], d[3]])).toEqual([
      [0, 255],
      [60, 255],
      [120, 255],
      [180, 255],
    ]);
  });

  it('draws offscreen layers onto the main canvas', async () => {
    let layer: ReturnType<Parameters<Sketch['draw']>[0]['createGraphics']>;
    const [frame] = await renderFrames(
      {
        setup(p) {
          layer = p.createGraphics(spec.width, spec.height);
          layer.background(0, 255, 0);
        },
        draw(p) {
          p.image(layer, 0, 0);
        },
      },
      spec,
    );
    expect(Array.from(frame!.subarray(0, 4))).toEqual([0, 255, 0, 255]);
  });

  it('encodes a GIF', async () => {
    const frames = await renderFrames(sketch, spec);
    const gif = encodeGif(frames, { width: spec.width, height: spec.height, fps: 15 });
    expect(Buffer.from(gif.subarray(0, 6)).toString('ascii')).toBe('GIF89a');
  });
});
