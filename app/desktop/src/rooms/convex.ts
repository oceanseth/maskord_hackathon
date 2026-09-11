import { ConvexReactClient } from 'convex/react';

/**
 * The production build always talks to the prod Convex deployment. `.env.local`
 * (written by `npx convex dev` in www/) points VITE_CONVEX_URL at a dev or
 * local deployment, and Vite would otherwise bake that into a release bundle.
 * Mirrors www/src/channel/session.ts.
 */
const PROD_CONVEX_URL = 'https://impressive-skunk-614.convex.cloud';

export const convex = new ConvexReactClient(
  import.meta.env.PROD ? PROD_CONVEX_URL : import.meta.env.VITE_CONVEX_URL ?? PROD_CONVEX_URL,
);

/** Per tab: the id a runner uses when it claims a room's turn. */
export function getRunnerId(): string {
  const existing = sessionStorage.getItem('maskord.rooms.runnerId');
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem('maskord.rooms.runnerId', id);
  return id;
}
