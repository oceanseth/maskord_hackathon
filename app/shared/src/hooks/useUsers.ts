import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { getFirebaseDb } from '../firebase/init';
import type { User } from '../types';

/**
 * Watches user profiles for a list of UIDs via real-time listeners.
 * Firestore returns cached data immediately, so profiles are available before
 * network round-trip completes — eliminates the "Unknown" flash.
 */
export function useUserProfiles(userIds: string[]): Record<string, User> {
  const [profiles, setProfiles] = useState<Record<string, User>>({});
  const unsubs = useRef(new Map<string, () => void>());

  useEffect(() => {
    const db = getFirebaseDb();
    const wanted = new Set(userIds.filter(Boolean));

    // Unsubscribe UIDs no longer needed
    for (const [uid, unsub] of unsubs.current) {
      if (!wanted.has(uid)) {
        unsub();
        unsubs.current.delete(uid);
      }
    }

    // Subscribe to new UIDs
    for (const uid of wanted) {
      if (unsubs.current.has(uid)) continue;
      const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
        if (snap.exists()) {
          setProfiles((prev) => ({ ...prev, [uid]: { id: snap.id, ...snap.data() } as User }));
        }
      });
      unsubs.current.set(uid, unsub);
    }

    return () => {
      // Only clean up on unmount (not on every userIds change — handled above)
    };
  }, [userIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unsubscribe everything on unmount
  useEffect(() => {
    return () => {
      for (const unsub of unsubs.current.values()) unsub();
      unsubs.current.clear();
    };
  }, []);

  return profiles;
}
