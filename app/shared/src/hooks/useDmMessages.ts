import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  getDocs,
  doc,
  setDoc,
  serverTimestamp,
  startAfter,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { getFirebaseDb } from '../firebase/init';
import type { DirectMessage } from '../types';

const PAGE_SIZE = 50;

/** Deterministic DM channel ID from two user UIDs. */
export function dmChannelId(uid1: string, uid2: string): string {
  return [uid1, uid2].sort().join('__');
}

export function useDmMessages(localUid: string | null, partnerUid: string | null) {
  const [messages, setMessages]   = useState<DirectMessage[]>([]);
  const [loading, setLoading]     = useState(true);
  const [hasMore, setHasMore]     = useState(true);
  const [oldestDoc, setOldestDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);

  const dmId = localUid && partnerUid ? dmChannelId(localUid, partnerUid) : null;

  useEffect(() => {
    if (!dmId || !localUid || !partnerUid) { setMessages([]); setLoading(false); return; }

    setLoading(true);
    setMessages([]);
    setHasMore(true);
    setOldestDoc(null);

    const db = getFirebaseDb();
    let unsub: (() => void) | undefined;
    let cancelled = false;

    // Ensure the conversation doc exists BEFORE attaching the snapshot listener.
    // The subcollection read rule does get(conversationDoc).data.participants —
    // if the doc is missing that get() returns null and the rule denies the read,
    // killing the listener permanently before any message is ever sent.
    setDoc(
      doc(db, 'directMessages', dmId),
      { participants: [localUid, partnerUid].sort() },
      { merge: true },
    ).then(() => {
      if (cancelled) return;
      const ref = collection(db, 'directMessages', dmId, 'messages');
      const q   = query(ref, orderBy('createdAt', 'desc'), limit(PAGE_SIZE));
      unsub = onSnapshot(q, (snap) => {
        const docs = snap.docs.reverse();
        setMessages(docs.map((d) => ({ id: d.id, ...d.data() } as DirectMessage)));
        if (docs.length > 0) setOldestDoc(snap.docs[snap.docs.length - 1]);
        setHasMore(snap.docs.length === PAGE_SIZE);
        setLoading(false);
      });
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [dmId, localUid, partnerUid]);

  const loadMore = useCallback(async () => {
    if (!dmId || !oldestDoc || !hasMore) return;

    const db  = getFirebaseDb();
    const ref = collection(db, 'directMessages', dmId, 'messages');
    const q   = query(ref, orderBy('createdAt', 'desc'), startAfter(oldestDoc), limit(PAGE_SIZE));

    const snap  = await getDocs(q);
    const older = snap.docs.reverse().map((d) => ({ id: d.id, ...d.data() } as DirectMessage));
    setMessages((prev) => [...older, ...prev]);
    if (snap.docs.length > 0) setOldestDoc(snap.docs[snap.docs.length - 1]);
    setHasMore(snap.docs.length === PAGE_SIZE);
  }, [dmId, oldestDoc, hasMore]);

  return { messages, loading, hasMore, loadMore };
}

export async function sendDmMessage(
  localUid: string,
  partnerUid: string,
  content: string,
) {
  const db   = getFirebaseDb();
  const dmId = dmChannelId(localUid, partnerUid);

  // Ensure the DM conversation document exists
  const convRef = doc(db, 'directMessages', dmId);
  await setDoc(convRef, {
    participants: [localUid, partnerUid].sort(),
    lastMessageAt: serverTimestamp(),
  }, { merge: true });

  await addDoc(collection(db, 'directMessages', dmId, 'messages'), {
    content,
    senderId:    localUid,
    createdAt:   serverTimestamp(),
    editedAt:    null,
    attachments: [],
    reactions:   {},
    mentions:    [],
    pinned:      false,
    type:        'default',
  });
}
