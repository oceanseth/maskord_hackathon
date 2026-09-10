import * as admin from 'firebase-admin';

// ─── Active avatars in a voice channel ─────────────────────────────────────────
//
// A voice channel can host multiple AI avatars at once. The set is stored as an
// `activeAvatars` array on the channel doc (members already have read access to
// the channel doc, so no rules change is needed; only the Admin SDK writes it).
// The primary avatar (the guild's configured one) is always present; others are
// added via voice command ("Masky, invite Gary") and removed by their goodbye
// word.

export interface ChannelAvatar {
  ownerUid:          string;
  avatarId:          string;
  displayName:       string;
  thumbnailUrl:      string;
  humeVoiceId:       string;
  wakeWord:          string;   // comma-separated alternatives
  goodbyeWord:       string;   // comma-separated alternatives
  personalityPrompt: string;
  isPrimary:         boolean;
  conversationId:    string;
  viewerToken:       string;
  shareSlug:         string;
  liveUrl:           string;
  invitedBy:         string;   // uid that invited this avatar ('' for primary)
  joinedAt:          number;   // ms — serverTimestamp() is illegal inside arrays
  /** True when this avatar is backed by a GMI agentbox (reasoned by its own VM
   *  rather than the built-in wake-word path). The invokeUrl/auth live on the
   *  avatar doc (not here) to keep secrets out of the member-readable channel. */
  hasAgentbox?:      boolean;
}

function chanRef(guildId: string, channelId: string) {
  return admin.firestore().doc(`guilds/${guildId}/channels/${channelId}`);
}

export async function loadActiveAvatars(guildId: string, channelId: string): Promise<ChannelAvatar[]> {
  const snap = await chanRef(guildId, channelId).get();
  const arr = snap.data()?.activeAvatars;
  return Array.isArray(arr) ? (arr as ChannelAvatar[]) : [];
}

/**
 * Add an avatar to the channel (idempotent by avatarId). Transactional so two
 * concurrent utterances can't double-add. Returns the updated list.
 */
export async function addActiveAvatar(
  guildId: string, channelId: string, entry: ChannelAvatar,
): Promise<ChannelAvatar[]> {
  const ref = chanRef(guildId, channelId);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = (snap.data()?.activeAvatars as ChannelAvatar[] | undefined) ?? [];
    if (cur.some((a) => a.avatarId === entry.avatarId)) return cur;
    const next = [...cur, entry];
    tx.set(ref, { activeAvatars: next }, { merge: true });
    return next;
  });
}

export async function removeActiveAvatar(
  guildId: string, channelId: string, avatarId: string,
): Promise<void> {
  const ref = chanRef(guildId, channelId);
  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = (snap.data()?.activeAvatars as ChannelAvatar[] | undefined) ?? [];
    const next = cur.filter((a) => a.avatarId !== avatarId);
    if (next.length !== cur.length) tx.set(ref, { activeAvatars: next }, { merge: true });
  });
}

/** Remove every non-primary avatar that a given user invited (e.g. when that
 *  user leaves the voice channel). The primary is never removed this way. */
export async function removeAvatarsInvitedBy(
  guildId: string, channelId: string, uid: string,
): Promise<void> {
  const ref = chanRef(guildId, channelId);
  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = (snap.data()?.activeAvatars as ChannelAvatar[] | undefined) ?? [];
    const next = cur.filter((a) => a.isPrimary || a.invitedBy !== uid);
    if (next.length !== cur.length) tx.set(ref, { activeAvatars: next }, { merge: true });
  });
}

// ─── Word matching + intent parsing ────────────────────────────────────────────

/** Split a comma-separated wake/goodbye field into lower-cased alternatives. */
export function splitWords(field?: string): string[] {
  return (field ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** True if `text` contains any of `words` as `@word` or a whole-word phrase. */
export function textMatchesAny(text: string, words: string[]): boolean {
  const norm = text.toLowerCase();
  for (const w of words) {
    if (!w) continue;
    const compact = w.replace(/\s+/g, '');
    if (norm.includes(`@${compact}`)) return true;
    const phrase = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    if (new RegExp(`\\b${phrase}\\b`).test(norm)) return true;
  }
  return false;
}

/**
 * Extract the avatar name from an invite command, e.g. "Masky, invite Gary" →
 * "gary". Returns null if no invite intent is present.
 */
export function parseInviteName(text: string): string | null {
  const m = text.match(
    /\b(?:invite|bring(?:\s+in)?|add|call(?:\s+in)?|summon|introduce|get)\s+([A-Za-z][A-Za-z0-9'-]*)/i,
  );
  return m ? m[1].trim().toLowerCase() : null;
}
