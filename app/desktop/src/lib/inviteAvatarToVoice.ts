import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from '@maskord/shared';

/**
 * Seat a masky avatar at the table the same way "invite {name}" does: one
 * conversation, a tile in the call, billed on the caller's key.
 */
export async function inviteAvatarToVoiceChannel(
  guildId: string,
  name: string,
  channelId?: string,
): Promise<void> {
  const fn = httpsCallable<{ guildId: string; name: string; channelId?: string }, { ok: boolean; message: string }>(
    getFirebaseFunctions(), 'inviteAvatarToVoice',
  );
  await fn({ guildId, name, ...(channelId ? { channelId } : {}) });
}

export async function dismissAvatarFromVoiceChannel(
  guildId: string,
  name: string,
  channelId?: string,
): Promise<void> {
  const fn = httpsCallable<{ guildId: string; name: string; channelId?: string }, { ok: boolean; message: string }>(
    getFirebaseFunctions(), 'dismissAvatarFromVoice',
  );
  await fn({ guildId, name, ...(channelId ? { channelId } : {}) });
}
