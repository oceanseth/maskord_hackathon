import { useState, useEffect } from 'react';
import {
  collection,
  doc,
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
} from 'firebase/firestore';
import { getFirebaseDb } from '../firebase/init';
import type { Guild, GuildMember, Role, Channel } from '../types';
import { DEFAULT_PERMISSIONS } from '../utils/permissions';

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
      // Fetch each guild doc
      const results = await Promise.all(
        guildIds.map(async (gid) => {
          const gSnap = await getDocs(query(collection(db, 'guilds'), where('__name__', '==', gid)));
          return gSnap.docs[0] ? ({ id: gSnap.docs[0].id, ...gSnap.docs[0].data() } as Guild) : null;
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

// ─── Create guild ─────────────────────────────────────────────────────────────

export async function createGuild(ownerId: string, name: string): Promise<string> {
  const db = getFirebaseDb();

  const guildRef = await addDoc(collection(db, 'guilds'), {
    name,
    description: '',
    iconUrl: '',
    ownerId,
    createdAt: serverTimestamp(),
    vanityCode: null,
    settings: {
      defaultNotifications: 'all',
      explicitContentFilter: 'disabled',
      verificationLevel: 'none',
    },
  });

  const guildId = guildRef.id;

  // Create @everyone role
  const everyoneRoleRef = doc(collection(db, 'guilds', guildId, 'roles'));
  await setDoc(everyoneRoleRef, {
    name: '@everyone',
    color: '#99AAB5',
    permissions: DEFAULT_PERMISSIONS,
    position: 0,
    hoist: false,
    mentionable: false,
  });

  // Add owner as member
  await setDoc(doc(db, 'guilds', guildId, 'members', ownerId), {
    nickname: null,
    roles: [everyoneRoleRef.id],
    joinedAt: serverTimestamp(),
    muted: false,
    deafened: false,
    pending: false,
  });

  // Mirror membership for fast querying
  await setDoc(doc(db, 'members_index', `${guildId}_${ownerId}`), {
    guildId,
    userId: ownerId,
    joinedAt: serverTimestamp(),
  });

  // Create default channels
  await addDoc(collection(db, 'guilds', guildId, 'channels'), {
    name: 'general',
    type: 'text',
    position: 0,
    topic: 'General discussion',
    slowmode: 0,
    nsfw: false,
    parentId: null,
    permissionOverwrites: {},
  });

  await addDoc(collection(db, 'guilds', guildId, 'channels'), {
    name: 'General',
    type: 'voice',
    position: 1,
    topic: null,
    slowmode: 0,
    nsfw: false,
    parentId: null,
    permissionOverwrites: {},
  });

  return guildId;
}

// ─── Update guild settings ────────────────────────────────────────────────────

export async function updateGuildSettings(
  guildId: string,
  updates: Partial<Pick<Guild, 'name' | 'description' | 'iconUrl' | 'settings'>>,
) {
  const db = getFirebaseDb();
  await updateDoc(doc(db, 'guilds', guildId), updates as Record<string, unknown>);
}

// ─── Delete guild ─────────────────────────────────────────────────────────────

export async function deleteGuild(guildId: string) {
  const db = getFirebaseDb();
  await deleteDoc(doc(db, 'guilds', guildId));
}
