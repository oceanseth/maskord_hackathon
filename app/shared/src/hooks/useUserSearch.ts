import {
  collection,
  query,
  where,
  orderBy,
  startAt,
  endAt,
  limit,
  getDocs,
} from 'firebase/firestore';
import { getFirebaseDb } from '../firebase/init';
import type { User } from '../types';

/**
 * Find someone by the handle they'd tell you: a Masky/Twitch username, a
 * display name, or the email they signed up with.
 *
 * `users` is publicly readable — username lookup is what that rule exists for —
 * so this is three single-field queries, all on default indexes, with no
 * composite index to deploy.
 *
 * Twitch usernames are stored lowercase, so that one is matched lowercased.
 * Display names are matched as a prefix, the closest Firestore gets to search;
 * it is case-sensitive, so "Seth" finds "Seth Caldwell" and "seth" does not.
 * Email has to be exact: a prefix scan over emails would be an address
 * harvester, and this collection is world-readable.
 */
const MAX_RESULTS = 8;

/** Sorts after any ordinary character, so startAt(x)..endAt(x + HIGH) is "starts with x". */
const HIGH_CODEPOINT = '';

export async function findUsersByHandle(handleRaw: string): Promise<User[]> {
  const handle = handleRaw.trim();
  if (handle.length < 2) return [];

  const db = getFirebaseDb();
  const users = collection(db, 'users');

  const [byTwitch, byName, byEmail] = await Promise.all([
    getDocs(query(users, where('twitchUsername', '==', handle.toLowerCase()), limit(MAX_RESULTS))),
    getDocs(query(users, orderBy('displayName'), startAt(handle), endAt(handle + HIGH_CODEPOINT), limit(MAX_RESULTS))),
    handle.includes('@')
      ? getDocs(query(users, where('email', '==', handle.toLowerCase()), limit(MAX_RESULTS)))
      : Promise.resolve(null),
  ]);

  const seen = new Map<string, User>();
  for (const snap of [byTwitch, byName, byEmail]) {
    for (const d of snap?.docs ?? []) {
      if (!seen.has(d.id)) seen.set(d.id, { id: d.id, ...d.data() } as User);
    }
  }
  return [...seen.values()].slice(0, MAX_RESULTS);
}
