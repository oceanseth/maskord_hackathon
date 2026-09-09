import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
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
 * Counts unread DM messages per conversation.
 *
 * Uses one-time getDocs fetches (not persistent listeners) to avoid security-rule
 * edge cases with get()-based subcollection rules.  Counts refresh automatically
 * whenever conversations update (i.e. lastMessageAt changes on the conv doc),
 * and immediately when markSeen is called.
 */
export function useDmUnread(
  myUid: string | null,
  conversations: DirectMessageConversation[],
): { counts: Record<string, number>; markSeen: (convId: string) => void } {
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Bumping seenVersion forces an immediate re-fetch after markSeen
  const [seenVersion, setSeenVersion] = useState(0);

  const markSeen = useCallback((convId: string) => {
    saveDmLastSeen(convId);
    setCounts((prev) => ({ ...prev, [convId]: 0 }));
    setSeenVersion((v) => v + 1);
  }, []);

  // Include lastMessageAt so counts refresh whenever a new message arrives
  // (useDmConversations already updates lastMessageAt via its onSnapshot)
  const convSignature = conversations
    .map((c) => `${c.id}:${(c.lastMessageAt as { seconds?: number })?.seconds ?? 0}`)
    .join(',');

  useEffect(() => {
    if (!myUid || conversations.length === 0) return;

    let cancelled = false;
    const db = getFirebaseDb();

    async function fetchCounts() {
      const newCounts: Record<string, number> = {};

      await Promise.all(
        conversations.map(async (conv) => {
          const lastSeen = loadLastSeen(conv.id);
          try {
            const q = lastSeen > 0
              ? query(
                  collection(db, 'directMessages', conv.id, 'messages'),
                  where('createdAt', '>', Timestamp.fromMillis(lastSeen)),
                )
              : query(collection(db, 'directMessages', conv.id, 'messages'));

            const snap = await getDocs(q);
            newCounts[conv.id] = snap.docs.filter((d) => {
              const data = d.data();
              return (data.senderId || data.authorId) !== myUid;
            }).length;
          } catch {
            // Permission errors or network issues — treat as 0 (best-effort)
            newCounts[conv.id] = 0;
          }
        }),
      );

      if (!cancelled) setCounts(newCounts);
    }

    fetchCounts();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUid, convSignature, seenVersion]);

  return { counts, markSeen };
}
