import type p5 from 'p5';
import { installDom } from './dom.js';

export interface RenderSpec {
  width: number;
  height: number;
  frames: number;
}

/**
 * Draws one frame. `frame` runs from 0 to `frames - 1`; `t` is frame / frames,
 * so a loop that is periodic in `t` closes seamlessly.
 */
export type DrawFrame = (p: p5, frame: number, t: number) => void;

export interface Sketch {
  setup?: (p: p5) => void | Promise<void>;
  draw: DrawFrame;
}

/** Renders every frame of a sketch headlessly and returns RGBA buffers. */
export async function renderFrames(sketch: Sketch, spec: RenderSpec): Promise<Uint8ClampedArray[]> {
  installDom();
  const { default: P5 } = (await import('p5/node')) as { default: typeof p5 };

  let frame = 0;
  let capturing = false;
  const instance: p5 = new P5((p: p5) => {
    p.setup = async () => {
      p.pixelDensity(1);
      p.createCanvas(spec.width, spec.height);
      p.noLoop();
      await sketch.setup?.(p);
    };
    // p5 runs one draw after setup even under noLoop(); skip it.
    p.draw = () => {
      if (capturing) sketch.draw(p, frame, frame / spec.frames);
    };
  });
  await untilIdle(instance);
  capturing = true;

  const ctx = instance.drawingContext as CanvasRenderingContext2D;
  const out: Uint8ClampedArray[] = [];
  for (frame = 0; frame < spec.frames; frame++) {
    // redraw() is async in p5 2.x; not awaiting it captures blank frames.
    await instance.redraw();
    out.push(ctx.getImageData(0, 0, spec.width, spec.height).data);
  }
  instance.remove();
  return out;
}

const SETUP_TIMEOUT_MS = 30_000;

/**
 * p5's redraw() silently does nothing until setup has finished and while a
 * draw is in progress. Wait for both before driving frames.
 */
async function untilIdle(instance: p5): Promise<void> {
  const state = instance as unknown as { _setupDone?: boolean; _inUserDraw?: boolean };
  const deadline = Date.now() + SETUP_TIMEOUT_MS;
  while (!state._setupDone || state._inUserDraw) {
    if (Date.now() > deadline) throw new Error('p5 sketch setup timed out');
    await new Promise((r) => setImmediate(r));
  }
}
