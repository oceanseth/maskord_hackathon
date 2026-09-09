import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  increment,
  serverTimestamp,
  startAfter,
  getDocs,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { getFirebaseDb } from '../firebase/init';
import type { Message } from '../types';

const PAGE_SIZE = 50;

export function useMessages(guildId: string | null, channelId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [oldestDoc, setOldestDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);

  useEffect(() => {
    if (!guildId || !channelId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessages([]);
    setHasMore(true);
    setOldestDoc(null);

    const db = getFirebaseDb();
    const messagesRef = collection(db, 'guilds', guildId, 'channels', channelId, 'messages');

    // Subscribe to the latest PAGE_SIZE messages in real-time
    const q = query(messagesRef, orderBy('createdAt', 'desc'), limit(PAGE_SIZE));

    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.reverse(); // display oldest → newest
      setMessages(docs.map((d) => ({ id: d.id, ...d.data() } as Message)));
      if (docs.length > 0) setOldestDoc(snap.docs[snap.docs.length - 1]); // oldest in asc is last in desc
      setHasMore(snap.docs.length === PAGE_SIZE);
      setLoading(false);
    });

    return unsub;
  }, [guildId, channelId]);

  const loadMore = useCallback(async () => {
    if (!guildId || !channelId || !oldestDoc || !hasMore) return;

    const db = getFirebaseDb();
    const messagesRef = collection(db, 'guilds', guildId, 'channels', channelId, 'messages');
    const q = query(
      messagesRef,
      orderBy('createdAt', 'desc'),
      startAfter(oldestDoc),
      limit(PAGE_SIZE),
    );

    const snap = await getDocs(q);
    const older = snap.docs.reverse().map((d) => ({ id: d.id, ...d.data() } as Message));
    setMessages((prev) => [...older, ...prev]);
    if (snap.docs.length > 0) setOldestDoc(snap.docs[snap.docs.length - 1]);
    setHasMore(snap.docs.length === PAGE_SIZE);
  }, [guildId, channelId, oldestDoc, hasMore]);

  return { messages, loading, hasMore, loadMore };
}

// ─── Send message ─────────────────────────────────────────────────────────────

export async function sendMessage(
  guildId: string,
  channelId: string,
  authorId: string,
  content: string,
) {
  const db = getFirebaseDb();
  const messagesRef = collection(db, 'guilds', guildId, 'channels', channelId, 'messages');

  const mentions = extractMentions(content);

  await addDoc(messagesRef, {
    content,
    authorId,
    createdAt: serverTimestamp(),
    editedAt: null,
    attachments: [],
    reactions: {},
    mentions,
    pinned: false,
    type: 'default',
  });

  // Increment the channel's total message counter (used for scalable unread tracking)
  await updateDoc(doc(db, 'guilds', guildId, 'channels', channelId), {
    messageCount: increment(1),
    lastMessageAt: serverTimestamp(),
  });
}

// ─── Edit message ─────────────────────────────────────────────────────────────

export async function editMessage(
  guildId: string,
  channelId: string,
  messageId: string,
  content: string,
) {
  const db = getFirebaseDb();
  await updateDoc(
    doc(db, 'guilds', guildId, 'channels', channelId, 'messages', messageId),
    { content, editedAt: serverTimestamp() },
  );
}

// ─── Delete message ───────────────────────────────────────────────────────────

export async function deleteMessage(
  guildId: string,
  channelId: string,
  messageId: string,
) {
  const db = getFirebaseDb();
  await deleteDoc(doc(db, 'guilds', guildId, 'channels', channelId, 'messages', messageId));
}

// ─── Add reaction ─────────────────────────────────────────────────────────────

export async function toggleReaction(
  guildId: string,
  channelId: string,
  messageId: string,
  emoji: string,
  userId: string,
) {
  const db = getFirebaseDb();
  const msgRef = doc(db, 'guilds', guildId, 'channels', channelId, 'messages', messageId);

  // Read-modify-write (in production wrap in a transaction)
  const snap = await getDocs(
    query(collection(db, 'guilds', guildId, 'channels', channelId, 'messages')),
  );
  const msgDoc = snap.docs.find((d) => d.id === messageId);
  if (!msgDoc) return;

  const reactions = msgDoc.data().reactions as Record<string, { count: number; userIds: string[] }>;
  const current = reactions[emoji] ?? { count: 0, userIds: [] };
  const hasReacted = current.userIds.includes(userId);

  if (hasReacted) {
    const updated = current.userIds.filter((id) => id !== userId);
    if (updated.length === 0) {
      const { [emoji]: _removed, ...rest } = reactions;
      await updateDoc(msgRef, { reactions: rest });
    } else {
      await updateDoc(msgRef, {
        [`reactions.${emoji}`]: { count: updated.length, userIds: updated },
      });
    }
  } else {
    await updateDoc(msgRef, {
      [`reactions.${emoji}`]: {
        count: current.count + 1,
        userIds: [...current.userIds, userId],
      },
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractMentions(content: string): string[] {
  const mentionPattern = /<@([A-Za-z0-9]+)>/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = mentionPattern.exec(content)) !== null) {
    mentions.push(match[1]);
  }
  return mentions;
}
