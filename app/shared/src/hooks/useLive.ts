import { useState, useEffect } from 'react';
import {
  collection, query, orderBy, limit,
  onSnapshot, doc, startAfter,
  getDocs, type QueryDocumentSnapshot, type DocumentData,
} from 'firebase/firestore';
import { getFirebaseDb } from '../firebase/init';
import type { LiveMessage, LiveStatus } from '../types';

const PAGE_SIZE = 75;

// ─── Live messages ────────────────────────────────────────────────────────────

export function useLiveMessages(guildId: string | null) {
  const [messages,   setMessages]   = useState<LiveMessage[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [hasMore,    setHasMore]    = useState(true);
  const [oldestDoc,  setOldestDoc]  = useState<QueryDocumentSnapshot<DocumentData> | null>(null);

  useEffect(() => {
    if (!guildId) { setMessages([]); setLoading(false); return; }

    setLoading(true);
    setMessages([]);
    setHasMore(true);
    setOldestDoc(null);

    const db  = getFirebaseDb();
    const ref = collection(db, 'guilds', guildId, 'liveMessages');
    const q   = query(ref, orderBy('timestamp', 'desc'), limit(PAGE_SIZE));

    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.slice().reverse(); // oldest → newest for display
      setMessages(docs.map((d) => ({ id: d.id, ...d.data() } as LiveMessage)));
      if (snap.docs.length > 0) setOldestDoc(snap.docs[snap.docs.length - 1]);
      setHasMore(snap.docs.length === PAGE_SIZE);
      setLoading(false);
    }, () => setLoading(false));

    return unsub;
  }, [guildId]);

  async function loadMore() {
    if (!guildId || !oldestDoc || !hasMore) return;
    const db  = getFirebaseDb();
    const ref = collection(db, 'guilds', guildId, 'liveMessages');
    const q   = query(ref, orderBy('timestamp', 'desc'), startAfter(oldestDoc), limit(PAGE_SIZE));
    const snap = await getDocs(q);
    const older = snap.docs.slice().reverse().map((d) => ({ id: d.id, ...d.data() } as LiveMessage));
    setMessages((prev) => [...older, ...prev]);
    if (snap.docs.length > 0) setOldestDoc(snap.docs[snap.docs.length - 1]);
    setHasMore(snap.docs.length === PAGE_SIZE);
  }

  return { messages, loading, hasMore, loadMore };
}

// ─── Live status ──────────────────────────────────────────────────────────────

export function useLiveStatus(guildId: string | null): LiveStatus | null {
  const [status, setStatus] = useState<LiveStatus | null>(null);

  useEffect(() => {
    if (!guildId) { setStatus(null); return; }
    const db = getFirebaseDb();
    const unsub = onSnapshot(
      doc(db, 'guilds', guildId, '_meta', 'liveStatus'),
      (snap) => setStatus(snap.exists() ? (snap.data() as LiveStatus) : null),
      () => setStatus(null),
    );
    return unsub;
  }, [guildId]);

  return status;
}
