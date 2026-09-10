import { useState, useEffect } from 'react';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirebaseDb, getFirebaseFunctions, getFirebaseStorage } from '../firebase/init';
import type { Guild, GuildMember, Role, Channel, ChannelType } from '../types';

// ─── User's guild list ────────────────────────────────────────────────────────

export function useUserGuilds(userId: string | null) {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setGuilds([]);
      setLoading(false);
      return;
    }

    // Query all guilds where this user is a member via collectionGroup
    const db = getFirebaseDb();
    const memberQuery = query(
      collection(db, 'members_index'),
      where('userId', '==', userId),
    );

    const unsub = onSnapshot(memberQuery, async (snap) => {
      const guildIds = snap.docs.map((d) => d.data().guildId as string);
      if (guildIds.length === 0) {
        setGuilds([]);
        setLoading(false);
        return;
      }
      // Fetch each guild individually so a permission error on one (e.g. a brief
      // consistency window after invite join) doesn't kill the whole batch.
      const results = await Promise.all(
        guildIds.map(async (gid) => {
          try {
            const snap = await getDoc(doc(db, 'guilds', gid));
            return snap.exists() ? ({ id: snap.id, ...snap.data() } as Guild) : null;
          } catch {
            return null; // permission not yet propagated — next snapshot will retry
          }
        }),
      );
      setGuilds(results.filter(Boolean) as Guild[]);
      setLoading(false);
    });

    return unsub;
  }, [userId]);

  return { guilds, loading };
}

// ─── Single guild ─────────────────────────────────────────────────────────────

export function useGuild(guildId: string | null) {
  const [guild, setGuild] = useState<Guild | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!guildId) { setGuild(null); setLoading(false); return; }
    const db = getFirebaseDb();
    const unsub = onSnapshot(doc(db, 'guilds', guildId), (snap) => {
      setGuild(snap.exists() ? ({ id: snap.id, ...snap.data() } as Guild) : null);
      setLoading(false);
    });
    return unsub;
  }, [guildId]);

  return { guild, loading };
}

// ─── Guild members ────────────────────────────────────────────────────────────

export function useGuildMembers(guildId: string | null) {
  const [members, setMembers] = useState<GuildMember[]>([]);

  useEffect(() => {
    if (!guildId) { setMembers([]); return; }
    const db = getFirebaseDb();
    const unsub = onSnapshot(
      collection(db, 'guilds', guildId, 'members'),
      (snap) => setMembers(snap.docs.map((d) => ({ userId: d.id, ...d.data() } as GuildMember))),
    );
    return unsub;
  }, [guildId]);

  return members;
}

// ─── Guild roles ──────────────────────────────────────────────────────────────

export function useGuildRoles(guildId: string | null) {
  const [roles, setRoles] = useState<Role[]>([]);

  useEffect(() => {
    if (!guildId) { setRoles([]); return; }
    const db = getFirebaseDb();
    const unsub = onSnapshot(
      query(collection(db, 'guilds', guildId, 'roles'), orderBy('position', 'desc')),
      (snap) => setRoles(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Role))),
    );
    return unsub;
  }, [guildId]);

  return roles;
}

// ─── Guild channels ───────────────────────────────────────────────────────────

export function useGuildChannels(guildId: string | null) {
  const [channels, setChannels] = useState<Channel[]>([]);

  useEffect(() => {
    if (!guildId) { setChannels([]); return; }
    const db = getFirebaseDb();
    const unsub = onSnapshot(
      query(collection(db, 'guilds', guildId, 'channels'), orderBy('position', 'asc')),
      (snap) => setChannels(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Channel))),
    );
    return unsub;
  }, [guildId]);

  return channels;
}

// ─── Create guild (via Cloud Function — bypasses member write rules) ──────────

export async function createGuild(_ownerId: string, name: string): Promise<string> {
  const fn = httpsCallable<{ name: string }, { guildId: string }>(
    getFirebaseFunctions(), 'createGuildFn',
  );
  const result = await fn({ name });
  return result.data.guildId;
}

// ─── Channel CRUD ─────────────────────────────────────────────────────────────

export async function createChannel(
  guildId: string,
  data: { name: string; type: ChannelType; parentId?: string | null; position?: number },
): Promise<string> {
  const db = getFirebaseDb();
  const ref = await addDoc(collection(db, 'guilds', guildId, 'channels'), {
    name: data.name,
    type: data.type,
    position: data.position ?? 999,
    topic: null,
    slowmode: 0,
    nsfw: false,
    parentId: data.parentId ?? null,
    permissionOverwrites: {},
  });
  return ref.id;
}

export async function updateChannel(
  guildId: string,
  channelId: string,
  updates: Partial<Pick<Channel, 'name' | 'topic' | 'position' | 'parentId' | 'claudeMode' | 'claudeMediaMode'>>,
): Promise<void> {
  const db = getFirebaseDb();
  await updateDoc(doc(db, 'guilds', guildId, 'channels', channelId), updates as Record<string, unknown>);
}

export async function deleteChannel(guildId: string, channelId: string): Promise<void> {
  const db = getFirebaseDb();
  await deleteDoc(doc(db, 'guilds', guildId, 'channels', channelId));
}

// ─── Create invite ────────────────────────────────────────────────────────────

export async function createInvite(
  guildId: string,
  channelId: string,
  inviterId: string,
  options: { maxUses?: number | null; expiresInHours?: number | null } = {},
): Promise<string> {
  const db = getFirebaseDb();
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];

  const expiresAt = options.expiresInHours
    ? Timestamp.fromDate(new Date(Date.now() + options.expiresInHours * 3600_000))
    : null;

  await setDoc(doc(db, 'invites', code), {
    code,
    guildId,
    channelId,
    inviterId,
    uses: 0,
    maxUses: options.maxUses ?? null,
    expiresAt,
    createdAt: serverTimestamp(),
  });
  return code;
}

// ─── Leave guild (via Cloud Function) ────────────────────────────────────────

export async function leaveGuild(guildId: string): Promise<void> {
  const fn = httpsCallable<{ guildId: string }, { success: boolean }>(
    getFirebaseFunctions(), 'leaveGuild',
  );
  await fn({ guildId });
}

// ─── Update guild settings ────────────────────────────────────────────────────

export async function updateGuildSettings(
  guildId: string,
  updates: Partial<Pick<Guild,
    | 'name' | 'description' | 'iconUrl' | 'settings'
    | 'claudeEnabled' | 'claudeApiKey' | 'claudeAvatarOwnerUid' | 'claudeAvatarId'
  >>,
) {
  const db = getFirebaseDb();
  await updateDoc(doc(db, 'guilds', guildId), updates as Record<string, unknown>);
}

// ─── Upload guild icon ────────────────────────────────────────────────────────

export async function uploadGuildIcon(guildId: string, file: File): Promise<string> {
  const storage = getFirebaseStorage();
  // Fixed filename per guild — overwriting updates the token/URL automatically
  const iconRef = storageRef(storage, `maskord/guilds/${guildId}/icon/icon`);
  await uploadBytes(iconRef, file, { contentType: file.type });
  const url = await getDownloadURL(iconRef);
  await updateGuildSettings(guildId, { iconUrl: url });
  return url;
}

// ─── Delete guild ─────────────────────────────────────────────────────────────

export async function deleteGuild(guildId: string) {
  const db = getFirebaseDb();
  await deleteDoc(doc(db, 'guilds', guildId));
}

// ─── Join via invite link (Cloud Function) ────────────────────────────────────

export async function joinViaInvite(code: string): Promise<{ guildId: string; alreadyMember: boolean }> {
  const fn = httpsCallable<{ code: string }, { guildId: string; alreadyMember: boolean }>(
    getFirebaseFunctions(), 'joinGuildWithInvite',
  );
  const result = await fn({ code });
  return result.data;
}

// ─── Join a mutual friend's guild (Cloud Function) ───────────────────────────

export async function joinGuildAsMutualFriend(guildId: string): Promise<{ guildId: string; alreadyMember: boolean }> {
  const fn = httpsCallable<{ guildId: string }, { guildId: string; alreadyMember: boolean }>(
    getFirebaseFunctions(), 'joinGuildAsMutualFriend',
  );
  const result = await fn({ guildId });
  return result.data;
}
