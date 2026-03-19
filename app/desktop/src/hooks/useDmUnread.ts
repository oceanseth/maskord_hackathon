import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { getFirebaseDb } from '@maskord/shared';
import type { DirectMessageConversation } from '@maskord/shared';

// ─── localStorage helpers ─────────────────────────────────────────────────────

const lsKey = (convId: string) => `maskord_dm_seen_${convId}`;

function loadLastSeen(convId: string): number {
  try {
    const v = localStorage.getItem(lsKey(convId));
    return v ? parseInt(v, 10) : 0;
  } catch { return 0; }
}

/** Call this when the DM panel opens for a conversation. */
export function saveDmLastSeen(convId: string, ts: number = Date.now()) {
  try { localStorage.setItem(lsKey(convId), String(ts)); } catch {}
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Tracks unread DM message counts per conversation using localStorage timestamps.
 * Subscribes to Firestore messages since lastSeen for each conversation.
 */
export function useDmUnread(
  myUid: string | null,
  conversations: DirectMessageConversation[],
): { counts: Record<string, number>; markSeen: (convId: string) => void } {
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Bumped whenever markSeen is called, to force re-subscription with new lastSeen
  const [seenVersion, setSeenVersion] = useState(0);

  const markSeen = useCallback((convId: string) => {
    saveDmLastSeen(convId);
    setCounts((prev) => ({ ...prev, [convId]: 0 }));
    setSeenVersion((v) => v + 1);
  }, []);

  // Stable signature — only changes when conversation IDs change, not on every message
  const convSignature = conversations.map((c) => c.id).join(',');

  useEffect(() => {
    if (!myUid || conversations.length === 0) return;

    const db = getFirebaseDb();
    const unsubs: Array<() => void> = [];

    for (const conv of conversations) {
      const lastSeen = loadLastSeen(conv.id);
      const convId = conv.id;

      const q = lastSeen > 0
        ? query(
            collection(db, 'directMessages', convId, 'messages'),
            where('createdAt', '>', Timestamp.fromMillis(lastSeen)),
          )
        : query(collection(db, 'directMessages', convId, 'messages'));

      const unsub = onSnapshot(q, (snap) => {
        const count = snap.docs.filter((d) => {
          const data = d.data();
          return (data.senderId || data.authorId) !== myUid;
        }).length;
        setCounts((prev) => ({ ...prev, [convId]: count }));
      });

      unsubs.push(unsub);
    }

    return () => { unsubs.forEach((u) => u()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUid, convSignature, seenVersion]);

  return { counts, markSeen };
}
