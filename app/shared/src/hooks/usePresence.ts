import { useEffect } from 'react';
import {
  ref,
  onValue,
  set,
  onDisconnect,
  serverTimestamp,
  type DatabaseReference,
} from 'firebase/database';
import { getFirebaseRtdb } from '../firebase/init';
import type { PresenceState } from '../types';

/**
 * Register the current user's presence in Realtime DB.
 * Uses onDisconnect() to automatically set offline state when
 * the WebSocket connection drops.
 *
 * Note: `.info/connected` can fire before the RTDB WebSocket has exchanged
 * the auth token with the server (the two are async). We catch permission
 * errors and retry so the first transient denial doesn't leave the user
 * appearing offline.
 */
export function usePresence(userId: string | null, status: PresenceState['status'] = 'online') {
  useEffect(() => {
    if (!userId) return;

    const rtdb = getFirebaseRtdb();
    const presenceRef: DatabaseReference = ref(rtdb, `presence/${userId}`);
    const connectedRef = ref(rtdb, '.info/connected');

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    async function writePresence() {
      if (cancelled) return;
      try {
        await onDisconnect(presenceRef).set({
          status: 'offline' as const,
          lastSeen: serverTimestamp(),
          activeGuildId: null,
          activeChannelId: null,
        });
        await set(presenceRef, {
          status,
          lastSeen: serverTimestamp(),
          activeGuildId: null,
          activeChannelId: null,
        });
      } catch {
        // Auth token hasn't propagated to RTDB yet — retry after 2 s
        if (!cancelled) retryTimer = setTimeout(writePresence, 2000);
      }
    }

    const unsub = onValue(connectedRef, (snap) => {
      if (!snap.val()) return;
      writePresence();
    });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsub();
      // Explicitly mark offline on clean unmount
      set(presenceRef, {
        status: 'offline',
        lastSeen: Date.now(),
        activeGuildId: null,
        activeChannelId: null,
      });
    };
  }, [userId, status]);
}

/** Update the user's active guild/channel in presence */
export function updateActiveContext(
  userId: string,
  guildId: string | null,
  channelId: string | null,
) {
  const rtdb = getFirebaseRtdb();
  const presenceRef = ref(rtdb, `presence/${userId}`);
  set(presenceRef, {
    activeGuildId: guildId,
    activeChannelId: channelId,
    lastSeen: serverTimestamp(),
  });
}
