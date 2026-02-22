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
 */
export function usePresence(userId: string | null, status: PresenceState['status'] = 'online') {
  useEffect(() => {
    if (!userId) return;

    const rtdb = getFirebaseRtdb();
    const presenceRef: DatabaseReference = ref(rtdb, `presence/${userId}`);
    const connectedRef = ref(rtdb, '.info/connected');

    const unsub = onValue(connectedRef, (snap) => {
      if (!snap.val()) return;

      // When connection is lost, set offline
      onDisconnect(presenceRef).set({
        status: 'offline',
        lastSeen: serverTimestamp(),
        activeGuildId: null,
        activeChannelId: null,
      });

      // Set online immediately
      set(presenceRef, {
        status,
        lastSeen: serverTimestamp(),
        activeGuildId: null,
        activeChannelId: null,
      });
    });

    return () => {
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
