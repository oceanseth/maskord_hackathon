import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from '../firebase/init';

/**
 * The shared Maskord server — the one room everybody is in.
 *
 * Membership is granted by the `joinDefaultGuild` callable rather than an
 * invite, so it does not depend on a code being pasted anywhere, and it is
 * idempotent: after the first call it is a single document read that finds the
 * membership already there. Which guild is "the" Maskord server is server-side
 * state (`system/maskordDefaults`), so it can be repointed without a release.
 *
 * One call per signed-in user per page load, shared by every consumer.
 */
const inFlight = new Map<string, Promise<string | null>>();

export function ensureDefaultGuild(userId: string): Promise<string | null> {
  const existing = inFlight.get(userId);
  if (existing) return existing;

  const call = httpsCallable<void, { guildId: string; alreadyMember: boolean }>(
    getFirebaseFunctions(), 'joinDefaultGuild',
  )()
    .then(({ data }) => data.guildId)
    .catch((err: unknown) => {
      // Not provisioned, not deployed, or closed to guests — the app is still
      // perfectly usable without it, so this is a warning, not an error.
      console.warn('[default-guild] not joined:', (err as Error)?.message);
      return null;
    });

  inFlight.set(userId, call);
  return call;
}

/** The shared server's id once the caller is in it, or null. */
export function useDefaultGuildId(userId: string | null): string | null {
  const [guildId, setGuildId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) { setGuildId(null); return; }
    let alive = true;
    void ensureDefaultGuild(userId).then((id) => { if (alive) setGuildId(id); });
    return () => { alive = false; };
  }, [userId]);

  return guildId;
}
