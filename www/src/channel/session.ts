import { ConvexReactClient } from 'convex/react';

/**
 * The production build always talks to the prod Convex deployment. `.env.local`
 * points VITE_CONVEX_URL at the *dev* deployment for `npx convex dev`, and Vite
 * would happily bake that into a production bundle otherwise.
 */
const PROD_CONVEX_URL = 'https://impressive-skunk-614.convex.cloud';

export const convex = new ConvexReactClient(
  import.meta.env.PROD ? PROD_CONVEX_URL : import.meta.env.VITE_CONVEX_URL ?? PROD_CONVEX_URL,
);

/** Per-tab, so two tabs of the same browser show up as two people in the demo. */
export function getSessionId(): string {
  const existing = sessionStorage.getItem('maskord.sessionId');
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem('maskord.sessionId', id);
  return id;
}

export function getDisplayName(): string {
  const existing = localStorage.getItem('maskord.name');
  if (existing) return existing;
  const name = `guest-${Math.random().toString(36).slice(2, 6)}`;
  localStorage.setItem('maskord.name', name);
  return name;
}

export function setDisplayName(name: string) {
  localStorage.setItem('maskord.name', name);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
