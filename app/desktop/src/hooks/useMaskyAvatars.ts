import { useState, useEffect } from 'react';
import { collection, onSnapshot, getDocs, query, limit } from 'firebase/firestore';
import { getFirebaseDb } from '@maskord/shared';

export interface MaskyAvatarGroup {
  id: string;
  displayName: string;
  personalityPrompt?: string;
  thumbnailUrl?: string;
  humeVoiceId?: string;
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const selectedKey  = (uid: string) => `maskord_selected_masky_avatar_${uid}`;
const groupsKey    = (uid: string) => `maskord_masky_avatar_groups_${uid}`;

export function loadSelectedAvatarId(uid: string): string | null {
  try { return localStorage.getItem(selectedKey(uid)); } catch { return null; }
}
export function saveSelectedAvatarId(uid: string, groupId: string | null) {
  try {
    if (groupId) localStorage.setItem(selectedKey(uid), groupId);
    else         localStorage.removeItem(selectedKey(uid));
  } catch {}
}

type SlimGroup = Pick<MaskyAvatarGroup, 'id' | 'displayName' | 'thumbnailUrl'>;

function loadCachedGroups(uid: string): SlimGroup[] {
  try {
    const v = localStorage.getItem(groupsKey(uid));
    return v ? (JSON.parse(v) as SlimGroup[]) : [];
  } catch { return []; }
}
function saveCachedGroups(uid: string, groups: MaskyAvatarGroup[]) {
  try {
    const slim: SlimGroup[] = groups.map(({ id, displayName, thumbnailUrl }) => ({
      id, displayName, thumbnailUrl,
    }));
    localStorage.setItem(groupsKey(uid), JSON.stringify(slim));
  } catch {}
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Loads the user's masky.ai avatar groups.
 *
 * Strategy: stale-while-revalidate.
 *   1. Immediately populate from localStorage cache (instant, no flicker on reopen).
 *   2. Subscribe to Firestore in the background and update the list when data arrives.
 *   3. Save updated list back to localStorage so the next open is instant again.
 *
 * `selectedId` is also read/written from localStorage so it survives modal close/reopen.
 */
export function useMaskyAvatars(uid: string | null) {
  // Seed state from cache immediately — this is what makes reopen feel instant.
  const [avatarGroups, setAvatarGroups] = useState<MaskyAvatarGroup[]>(
    () => (uid ? loadCachedGroups(uid) : []) as MaskyAvatarGroup[],
  );
  // Only show spinner if we have nothing cached to display yet.
  const [loading, setLoading] = useState<boolean>(
    () => !uid || loadCachedGroups(uid).length === 0,
  );
  const [selectedId, setSelectedIdState] = useState<string | null>(
    () => uid ? loadSelectedAvatarId(uid) : null,
  );

  // When uid resolves (e.g. auth delay on first render), re-read localStorage.
  // This covers the edge case where uid was null on first mount.
  useEffect(() => {
    if (!uid) return;
    setSelectedIdState(loadSelectedAvatarId(uid));
    const cached = loadCachedGroups(uid);
    if (cached.length > 0) {
      setAvatarGroups(cached as MaskyAvatarGroup[]);
      setLoading(false);
    }
  }, [uid]);

  // Firestore subscription — runs in the background, updates cache + state.
  useEffect(() => {
    if (!uid) return;
    const db = getFirebaseDb();
    const groupsRef = collection(db, 'users', uid, 'heygenAvatarGroups');

    const unsub = onSnapshot(
      groupsRef,
      async (snap) => {
        const groups: MaskyAvatarGroup[] = [];

        await Promise.all(
          snap.docs.map(async (docSnap) => {
            const data = docSnap.data();
            let thumbnailUrl: string = data.cachedAvatarUrl || data.heygenAvatarUrl || '';

            // Fall back to first asset if the group doc has no thumbnail yet.
            if (!thumbnailUrl) {
              try {
                const assetsRef = collection(
                  db, 'users', uid, 'heygenAvatarGroups', docSnap.id, 'assets',
                );
                const assetsSnap = await getDocs(query(assetsRef, limit(1)));
                if (!assetsSnap.empty) {
                  const ad = assetsSnap.docs[0].data();
                  thumbnailUrl = ad.cachedAvatarUrl || ad.url || '';
                }
              } catch { /* no assets or permission error — leave blank */ }
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
        saveCachedGroups(uid, sorted);  // persist for next open
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
