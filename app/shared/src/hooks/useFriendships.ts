import { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { getFirebaseDb } from '../firebase/init';
import type { Friendship } from '../types';

/** Deterministic friendship document ID from two user UIDs. */
export function friendshipId(uid1: string, uid2: string): string {
  return [uid1, uid2].sort().join('__');
}

export function useFriendships(myUid: string | null) {
  const [friendships, setFriendships] = useState<Friendship[]>([]);

  useEffect(() => {
    if (!myUid) { setFriendships([]); return; }

    const db = getFirebaseDb();
    const q  = query(
      collection(db, 'friendships'),
      where('uids', 'array-contains', myUid),
    );

    const unsub = onSnapshot(q, (snap) => {
      setFriendships(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Friendship)));
    });

    return unsub;
  }, [myUid]);

  const friends         = friendships.filter((f) => f.status === 'accepted');
  const pendingIncoming = friendships.filter((f) => f.status === 'pending' && f.requesterId !== myUid);
  const pendingOutgoing = friendships.filter((f) => f.status === 'pending' && f.requesterId === myUid);

  function getFriendUid(f: Friendship): string {
    return f.uids.find((uid) => uid !== myUid) ?? '';
  }

  async function sendRequest(toUid: string) {
    if (!myUid) return;

    // If there's already an incoming request from this user, accept it instead
    const incoming = pendingIncoming.find((f) => f.uids.includes(toUid));
    if (incoming) {
      await acceptRequest(incoming.id);
      return;
    }

    const db  = getFirebaseDb();
    const fId = friendshipId(myUid, toUid);
    await setDoc(doc(db, 'friendships', fId), {
      uids:        [myUid, toUid].sort(),
      status:      'pending',
      requesterId: myUid,
      createdAt:   serverTimestamp(),
    });
  }

  async function acceptRequest(fId: string) {
    const db = getFirebaseDb();
    await updateDoc(doc(db, 'friendships', fId), { status: 'accepted' });
  }

  async function rejectRequest(fId: string) {
    const db = getFirebaseDb();
    await deleteDoc(doc(db, 'friendships', fId));
  }

  return {
    friendships,
    friends,
    pendingIncoming,
    pendingOutgoing,
    getFriendUid,
    sendRequest,
    acceptRequest,
    rejectRequest,
  };
}
