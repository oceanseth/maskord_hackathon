import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { onValueDeleted } from 'firebase-functions/v2/database';

admin.initializeApp();
const db = admin.firestore();

// ─── Join Guild via Invite ────────────────────────────────────────────────────

export const joinGuildWithInvite = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

  const { code } = request.data as { code: string };
  if (!code) throw new HttpsError('invalid-argument', 'invite code required');

  const inviteSnap = await db.collection('invites').doc(code).get();
  if (!inviteSnap.exists) throw new HttpsError('not-found', 'Invite not found');

  const invite = inviteSnap.data()!;

  // Check expiry
  if (invite.expiresAt && invite.expiresAt.toMillis() < Date.now()) {
    throw new HttpsError('deadline-exceeded', 'Invite has expired');
  }

  // Check max uses
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
    throw new HttpsError('resource-exhausted', 'Invite has reached its maximum uses');
  }

  const { guildId } = invite;
  const userId = request.auth.uid;

  // Check if already a member
  const memberSnap = await db.doc(`guilds/${guildId}/members/${userId}`).get();
  if (memberSnap.exists) {
    return { guildId, alreadyMember: true };
  }

  // Get @everyone role id
  const rolesSnap = await db.collection(`guilds/${guildId}/roles`)
    .where('name', '==', '@everyone').limit(1).get();
  const everyoneRoleId = rolesSnap.docs[0]?.id ?? '';

  const batch = db.batch();

  // Add member
  batch.set(db.doc(`guilds/${guildId}/members/${userId}`), {
    nickname: null,
    roles: [everyoneRoleId],
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    muted: false,
    deafened: false,
    pending: false,
  });

  // Mirror in members_index
  batch.set(db.doc(`members_index/${guildId}_${userId}`), {
    guildId,
    userId,
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Increment invite uses
  batch.update(db.doc(`invites/${code}`), {
    uses: admin.firestore.FieldValue.increment(1),
  });

  // Post system message
  const firstTextChannel = await db.collection(`guilds/${guildId}/channels`)
    .where('type', '==', 'text').orderBy('position').limit(1).get();

  if (!firstTextChannel.empty) {
    const channelId = firstTextChannel.docs[0].id;
    batch.set(db.collection(`guilds/${guildId}/channels/${channelId}/messages`).doc(), {
      content: '',
      authorId: userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      editedAt: null,
      attachments: [],
      reactions: {},
      mentions: [],
      pinned: false,
      type: 'system_join',
    });
  }

  await batch.commit();

  return { guildId, alreadyMember: false };
});

// ─── Leave Guild ──────────────────────────────────────────────────────────────

export const leaveGuild = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

  const { guildId } = request.data as { guildId: string };
  if (!guildId) throw new HttpsError('invalid-argument', 'guildId required');

  const userId = request.auth.uid;

  // Owners can't leave (must transfer ownership first)
  const guildSnap = await db.doc(`guilds/${guildId}`).get();
  if (!guildSnap.exists) throw new HttpsError('not-found', 'Guild not found');
  if (guildSnap.data()!.ownerId === userId) {
    throw new HttpsError('failed-precondition', 'Guild owner must transfer ownership before leaving');
  }

  const batch = db.batch();
  batch.delete(db.doc(`guilds/${guildId}/members/${userId}`));
  batch.delete(db.doc(`members_index/${guildId}_${userId}`));
  await batch.commit();

  return { success: true };
});

// ─── Kick Member ──────────────────────────────────────────────────────────────

export const kickMember = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

  const { guildId, targetUserId } = request.data as { guildId: string; targetUserId: string };

  // Verify requester has KICK_MEMBERS (bit 14 = 16384)
  const requesterMember = await db.doc(`guilds/${guildId}/members/${request.auth.uid}`).get();
  if (!requesterMember.exists) throw new HttpsError('permission-denied', 'Not a member');

  const roleIds: string[] = requesterMember.data()!.roles ?? [];
  let hasKick = false;
  for (const roleId of roleIds) {
    const roleSnap = await db.doc(`guilds/${guildId}/roles/${roleId}`).get();
    if (roleSnap.exists && (roleSnap.data()!.permissions & 16384) !== 0) {
      hasKick = true;
      break;
    }
  }

  const guildSnap = await db.doc(`guilds/${guildId}`).get();
  if (guildSnap.data()!.ownerId !== request.auth.uid && !hasKick) {
    throw new HttpsError('permission-denied', 'Missing KICK_MEMBERS permission');
  }

  const batch = db.batch();
  batch.delete(db.doc(`guilds/${guildId}/members/${targetUserId}`));
  batch.delete(db.doc(`members_index/${guildId}_${targetUserId}`));
  await batch.commit();

  return { success: true };
});

// ─── Clean up members_index on member delete ──────────────────────────────────

export const onMemberDeleted = onDocumentDeleted(
  'guilds/{guildId}/members/{userId}',
  async (event) => {
    const { guildId, userId } = event.params;
    await db.doc(`members_index/${guildId}_${userId}`).delete().catch(() => {});
  },
);

// ─── Clean up stale voice signaling rooms (older than 1 hour) ─────────────────

export const onVoiceStateDeleted = onValueDeleted(
  'voiceState/{guildId}/{channelId}/{userId}',
  async (event) => {
    // When last person leaves a channel, clean up orphaned signaling rooms
    const { guildId, channelId } = event.params;
    const rtdb = admin.database();
    const channelSnap = await rtdb.ref(`voiceState/${guildId}/${channelId}`).get();
    if (!channelSnap.exists()) {
      // Channel is empty — clean up old signaling rooms for this channel
      const signalingSnap = await rtdb.ref('voiceSignaling').get();
      if (!signalingSnap.exists()) return;
      const rooms = signalingSnap.val() as Record<string, { guildId: string; channelId: string; createdAt: number }>;
      const staleRoomIds = Object.entries(rooms)
        .filter(([, room]) => room.guildId === guildId && room.channelId === channelId)
        .map(([id]) => id);
      await Promise.all(staleRoomIds.map((id) => rtdb.ref(`voiceSignaling/${id}`).remove()));
    }
  },
);
