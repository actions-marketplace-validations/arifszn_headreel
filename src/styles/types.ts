import type { z } from 'zod';
import type { GraphQLClient } from '../core/data/graphql.js';
import type { Rng } from '../core/prng.js';
import type { Sketch } from '../core/render/render.js';

/** Identity text shown on the banner. `name` comes from GitHub; the rest is user input. */
export interface Identity {
  name: string;
  tagline?: string;
  website?: string;
  handle?: string;
}

export interface StyleContext<Data, Options> {
  login: string;
  data: Data;
  options: Options;
  identity: Identity;
  rng: Rng;
}

export interface DataSource<Data, Options = unknown> {
  /** Fixture file suffix: `fixtures/<login>.<name>.json`. */
  name: string;
  /** Validates `--fixture` files and defines the normalized data shape. */
  schema: z.ZodType<Data>;
  /** Options are the validated style options, so they can shape the queries. */
  fetch(client: GraphQLClient, login: string, now: Date, options: Options): Promise<Data>;
}

export interface Style<Data = unknown, Schema extends z.ZodType = z.ZodType> {
  id: string;
  fps: number;
  frames: number;
  /** Flat colors the encoder keeps exact and undithered; see `EncodeSpec.pinned`. */
  pinned?: (options: z.infer<Schema>) => readonly (readonly [number, number, number])[];
  data: DataSource<Data, z.infer<Schema>>;
  options: Schema;
  createSketch(ctx: StyleContext<Data, z.infer<Schema>>): Sketch;
}
