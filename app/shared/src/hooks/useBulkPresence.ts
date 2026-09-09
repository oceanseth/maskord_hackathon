import { useState, useEffect, useRef } from 'react';
import { ref, onValue } from 'firebase/database';
import { getFirebaseRtdb } from '../firebase/init';
import type { UserStatus } from '../types';

/**
 * Watches RTDB presence for a list of UIDs.
 * Returns a Record<uid, UserStatus> that updates in real time.
 *
 * IMPORTANT: The caller must memoize the `uids` array (e.g. with useMemo)
 * to avoid infinite re-subscription loops.
 */
export function useBulkPresence(uids: string[]): Record<string, UserStatus> {
  const [presence, setPresence] = useState<Record<string, UserStatus>>({});
  const unsubsRef = useRef<Record<string, () => void>>({});

  useEffect(() => {
    const rtdb       = getFirebaseRtdb();
    const currentSet = new Set(uids);
    const previousSet = new Set(Object.keys(unsubsRef.current));

    // Unsubscribe from UIDs that are no longer needed
    for (const uid of previousSet) {
      if (!currentSet.has(uid)) {
        unsubsRef.current[uid]?.();
        delete unsubsRef.current[uid];
        setPresence((prev) => {
          const next = { ...prev };
          delete next[uid];
          return next;
        });
      }
    }

    // Subscribe to newly added UIDs
    for (const uid of uids) {
      if (previousSet.has(uid)) continue;

      const presenceRef = ref(rtdb, `presence/${uid}`);
      const unsub = onValue(presenceRef, (snap) => {
        const data = snap.val() as { status?: UserStatus } | null;
        setPresence((prev) => ({ ...prev, [uid]: data?.status ?? 'offline' }));
      });

      unsubsRef.current[uid] = unsub;
    }
  }, [uids]);

  // Cleanup all listeners on unmount
  useEffect(() => {
    return () => {
      Object.values(unsubsRef.current).forEach((unsub) => unsub());
    };
  }, []);

  return presence;
}
