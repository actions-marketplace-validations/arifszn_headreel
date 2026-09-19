import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';
import { z } from 'zod';
import { contributionWindow } from './contributions.js';
import type { GraphQLClient } from './graphql.js';

// The card's own query: the profile (avatar, followers, account age), the
// owned public non-fork repositories paged by 100 (the connection's
// totalCount is the repo count, the nodes' stars are summed), and the
// 365-day calendar total, so it matches the other styles. Field names
// checked against the live GraphQL schema (2026-09-19).
const QUERY = /* GraphQL */ `
  query SpecSheet($login: String!, $from: DateTime!, $to: DateTime!, $after: String) {
    user(login: $login) {
      avatarUrl(size: 256)
      createdAt
      followers {
        totalCount
      }
      repositories(
        first: 100
        ownerAffiliations: OWNER
        isFork: false
        privacy: PUBLIC
        after: $after
      ) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          stargazerCount
        }
      }
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
        }
      }
    }
  }
`;

interface SpecSheetResponse {
  user: {
    avatarUrl: string;
    createdAt: string;
    followers: { totalCount: number };
    repositories: {
      totalCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string };
      nodes: { stargazerCount: number }[];
    };
    contributionsCollection: {
      contributionCalendar: { totalContributions: number };
    };
  };
}

/** Repositories per page; GitHub caps `first` at 100. */
export const REPO_PAGE_SIZE = 100;
/** Pages fetched before the star sum stops: 1,000 repositories. */
export const REPO_PAGES_MAX = 10;
/** Avatar download limit: a stalled image host must not hang the run. */
const AVATAR_TIMEOUT_MS = 15_000;
/** The avatar is reduced to this square luma grid before it is stored. */
export const AVATAR_GRID = 64;

const lumaBytes = AVATAR_GRID * AVATAR_GRID;

const avatarSchema = z.object({
  size: z.literal(AVATAR_GRID),
  /** The grid's bytes, base64: luma 0 (black) to 255 (white), row-major. */
  luma: z
    .string()
    .base64()
    .refine((s) => Buffer.from(s, 'base64').length === lumaBytes, {
      message: `luma must decode to ${lumaBytes} bytes`,
    }),
});

export const specSheetSchema = z.object({
  /** Fetch date (= window end), YYYY-MM-DD (UTC). */
  asOf: z.iso.date(),
  /** Account creation date, YYYY-MM-DD. */
  createdAt: z.iso.date(),
  followers: z.number().int().min(0),
  /** Stars summed over the fetched owned public non-fork repositories. */
  stars: z.number().int().min(0),
  /** The repositories connection's totalCount under the same filters. */
  repos: z.number().int().min(0),
  /** The calendar's total over the 365-day window, as the other styles show. */
  contributions: z.number().int().min(0),
  /** Null when the avatar could not be fetched; the render draws a sphere. */
  avatar: avatarSchema.nullable(),
});

export type SpecSheet = z.infer<typeof specSheetSchema>;

/** Rec. 709 luma of a flattened pixel, 0 to 255. */
function lumaOf(r: number, g: number, b: number): number {
  return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
}

/**
 * Flattens the avatar on white (they can be transparent) and area-averages it
 * into the luma grid: each cell holds the mean luma of its rectangle of
 * source pixels, drawn at natural size so no scaling filter is involved. The
 * render reads only the grid, so decoding differences never reach the output.
 */
export function normalizeAvatar(img: Image): number[] {
  const w = Math.max(1, img.width);
  const h = Math.max(1, img.height);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;

  const luma: number[] = Array.from({ length: lumaBytes });
  for (let gy = 0; gy < AVATAR_GRID; gy++) {
    const y0 = Math.floor((gy * h) / AVATAR_GRID);
    const y1 = Math.min(h, Math.max(y0 + 1, Math.floor(((gy + 1) * h) / AVATAR_GRID)));
    for (let gx = 0; gx < AVATAR_GRID; gx++) {
      const x0 = Math.floor((gx * w) / AVATAR_GRID);
      const x1 = Math.min(w, Math.max(x0 + 1, Math.floor(((gx + 1) * w) / AVATAR_GRID)));
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          r += px[i]!;
          g += px[i + 1]!;
          b += px[i + 2]!;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      luma[gy * AVATAR_GRID + gx] = lumaOf(r / n, g / n, b / n);
    }
  }
  return luma;
}

export async function fetchSpecSheet(
  client: GraphQLClient,
  login: string,
  now: Date,
): Promise<SpecSheet> {
  const { from, to } = contributionWindow(now);
  let after: string | null = null;
  let user: SpecSheetResponse['user'] | undefined;
  let stars = 0;
  let repos = 0;
  for (let page = 0; ; page++) {
    const data: SpecSheetResponse = await client<SpecSheetResponse>(QUERY, {
      login,
      from: `${from}T00:00:00Z`,
      to: `${to}T23:59:59Z`,
      after,
    });
    user = data.user;
    const conn: SpecSheetResponse['user']['repositories'] = user.repositories;
    repos = conn.totalCount;
    stars += conn.nodes.reduce((sum: number, n) => sum + n.stargazerCount, 0);
    if (!conn.pageInfo.hasNextPage || page + 1 >= REPO_PAGES_MAX) break;
    after = conn.pageInfo.endCursor;
  }

  // The loop runs at least once, so the user block is set.
  const profile = user!;
  const avatar = await fetchAvatarLuma(profile.avatarUrl);
  return {
    asOf: to,
    createdAt: profile.createdAt.slice(0, 10),
    followers: profile.followers.totalCount,
    stars,
    repos,
    contributions: profile.contributionsCollection.contributionCalendar.totalContributions,
    avatar,
  };
}

/**
 * Fetches the avatar and reduces it to the luma grid. GitHub serves avatars
 * publicly (no token); any failure (network, non-image, decode) returns null
 * with a warning, and the render falls back to the sphere instead of failing
 * the run.
 */
async function fetchAvatarLuma(url: string): Promise<SpecSheet['avatar']> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const img = await loadImage(bytes);
    return { size: AVATAR_GRID, luma: Buffer.from(normalizeAvatar(img)).toString('base64') };
  } catch (err) {
    console.warn(
      `headreel: avatar unavailable, drawing the fallback sphere (${(err as Error).message})`,
    );
    return null;
  }
}
