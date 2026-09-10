import { useState, useEffect } from 'react';
import { collection, onSnapshot, getDocs, query, limit } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirebaseDb } from '@maskord/shared';

export interface MaskyAvatarGroup {
  id: string;
  displayName: string;
  personalityPrompt?: string;
  thumbnailUrl?: string;
  humeVoiceId?: string;
}

// ─── AsyncStorage helpers ─────────────────────────────────────────────────────

const selectedKey = (uid: string) => `maskord_selected_masky_avatar_${uid}`;
const groupsKey   = (uid: string) => `maskord_masky_avatar_groups_${uid}`;

async function loadSelectedAvatarId(uid: string): Promise<string | null> {
  try { return await AsyncStorage.getItem(selectedKey(uid)); } catch { return null; }
}
async function saveSelectedAvatarId(uid: string, groupId: string | null) {
  try {
    if (groupId) await AsyncStorage.setItem(selectedKey(uid), groupId);
    else         await AsyncStorage.removeItem(selectedKey(uid));
  } catch {}
}

type SlimGroup = Pick<MaskyAvatarGroup, 'id' | 'displayName' | 'thumbnailUrl'>;

async function loadCachedGroups(uid: string): Promise<SlimGroup[]> {
  try {
    const v = await AsyncStorage.getItem(groupsKey(uid));
    return v ? (JSON.parse(v) as SlimGroup[]) : [];
  } catch { return []; }
}
async function saveCachedGroups(uid: string, groups: MaskyAvatarGroup[]) {
  try {
    const slim: SlimGroup[] = groups.map(({ id, displayName, thumbnailUrl }) => ({
      id, displayName, thumbnailUrl,
    }));
    await AsyncStorage.setItem(groupsKey(uid), JSON.stringify(slim));
  } catch {}
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Loads the user's masky.ai avatar groups from Firestore.
 * Stale-while-revalidate: AsyncStorage cache is shown instantly, then
 * Firestore subscription updates the list and refreshes the cache.
 */
export function useMaskyAvatars(uid: string | null) {
  const [avatarGroups, setAvatarGroups] = useState<MaskyAvatarGroup[]>([]);
  const [loading, setLoading]           = useState(true);
  const [selectedId, setSelectedIdState] = useState<string | null>(null);

  // Seed from cache on mount / uid change
  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const [cached, saved] = await Promise.all([
        loadCachedGroups(uid),
        loadSelectedAvatarId(uid),
      ]);
      if (cancelled) return;
      if (cached.length > 0) {
        setAvatarGroups(cached as MaskyAvatarGroup[]);
        setLoading(false);
      }
      setSelectedIdState(saved);
    })();
    return () => { cancelled = true; };
  }, [uid]);

  // Live Firestore subscription
  useEffect(() => {
    if (!uid) return;
    const db = getFirebaseDb();
    const groupsRef = collection(db, 'users', uid, 'avatarGroups');

    const unsub = onSnapshot(
      groupsRef,
      async (snap) => {
        const groups: MaskyAvatarGroup[] = [];

        await Promise.all(
          snap.docs.map(async (docSnap) => {
            const data = docSnap.data();
            let thumbnailUrl: string = data.cachedAvatarUrl || data.avatarUrl || '';

            if (!thumbnailUrl) {
              try {
                const assetsRef = collection(
                  db, 'users', uid, 'avatarGroups', docSnap.id, 'assets',
                );
                const assetsSnap = await getDocs(query(assetsRef, limit(1)));
                if (!assetsSnap.empty) {
                  const ad = assetsSnap.docs[0].data();
                  thumbnailUrl = ad.cachedAvatarUrl || ad.url || '';
                }
              } catch {}
            }

            groups.push({
              id:                docSnap.id,
              displayName:       data.displayName || 'Unnamed Avatar',
              personalityPrompt: data.personalityPrompt,
              thumbnailUrl,
              humeVoiceId:       data.humeVoiceId,
            });
          }),
        );

        const sorted = groups.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setAvatarGroups(sorted);
        saveCachedGroups(uid, sorted);
        setLoading(false);
      },
      () => setLoading(false),
    );

    return unsub;
  }, [uid]);

  function setSelected(groupId: string | null) {
    if (uid) saveSelectedAvatarId(uid, groupId);
    setSelectedIdState(groupId);
  }

  return { avatarGroups, loading, selectedId, setSelected };
}
