import { useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { getFirebaseDb } from '../firebase/init';
import type { User } from '../types';

/**
 * Fetches and caches user profiles for a list of UIDs.
 * Only fetches each UID once per component mount; new UIDs are added incrementally.
 */
export function useUserProfiles(userIds: string[]): Record<string, User> {
  const [profiles, setProfiles] = useState<Record<string, User>>({});
  const fetchedIds = useRef(new Set<string>());

  useEffect(() => {
    const db = getFirebaseDb();
    const newIds = userIds.filter((id) => id && !fetchedIds.current.has(id));
    if (newIds.length === 0) return;

    newIds.forEach((uid) => {
      fetchedIds.current.add(uid);
      getDoc(doc(db, 'users', uid)).then((snap) => {
        if (snap.exists()) {
          setProfiles((prev) => ({ ...prev, [uid]: { id: snap.id, ...snap.data() } as User }));
        }
      });
    });
  }, [userIds]);

  return profiles;
}
