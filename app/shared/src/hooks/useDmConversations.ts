import { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import { getFirebaseDb } from '../firebase/init';
import type { DirectMessageConversation } from '../types';

export function useDmConversations(myUid: string | null) {
  const [conversations, setConversations] = useState<DirectMessageConversation[]>([]);

  useEffect(() => {
    if (!myUid) { setConversations([]); return; }

    const db = getFirebaseDb();
    const q  = query(
      collection(db, 'directMessages'),
      where('participants', 'array-contains', myUid),
      orderBy('lastMessageAt', 'desc'),
    );

    const unsub = onSnapshot(q, (snap) => {
      setConversations(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as DirectMessageConversation)),
      );
    });

    return unsub;
  }, [myUid]);

  function getPartnerUid(conv: DirectMessageConversation): string {
    return conv.participants.find((uid) => uid !== myUid) ?? '';
  }

  return { conversations, getPartnerUid };
}
