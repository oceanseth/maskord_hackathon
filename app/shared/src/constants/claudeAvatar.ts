/**
 * Default AI avatar — the shared "Masky" avatar that every server can fall back
 * to before the owner picks (or creates) their own. Built and maintained in masky
 * under the `simplystrong` Twitch account.
 */
export const DEFAULT_CLAUDE_AVATAR = {
  /** masky owner UID. Twitch-auth users have UID prefix `twitch:{twitchUserId}`. */
  ownerUid: 'twitch:11867613',
  /** Firestore doc ID under `users/{ownerUid}/avatarGroups/{avatarId}`. */
  avatarId: 'OPVx2xSCl9UpdnDIfIUD',
  /** Display name shown in the avatar picker until live data arrives. */
  fallbackDisplayName: 'Masky',
};
