import * as admin from 'firebase-admin';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { onValueDeleted } from 'firebase-functions/v2/database';
import { defineSecret } from 'firebase-functions/params';

admin.initializeApp();
const db = admin.firestore();

// ─── Twitch OAuth ─────────────────────────────────────────────────────────────

const twitchClientSecret = defineSecret('TWITCH_CLIENT_SECRET');

const TWITCH_CLIENT_ID = 'sgb17aslo6gesnetuqfnf6qql6jrae';

const ALLOWED_REDIRECT_URIS = [
  'http://localhost:2468',           // Electron desktop app
  'https://www.maskord.com/app',     // Web app (production)
  'https://maskord.com/app',         // Web app (apex — redirects to www)
];

export const twitchOAuth = onRequest(
  {
    cors: ['https://www.maskord.com', 'https://maskord.com', /^http:\/\/localhost(:\d+)?$/],
    secrets: [twitchClientSecret],
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const { code, redirectUri = 'http://localhost:2468' } = req.body as { code?: string; redirectUri?: string };
    if (!code) { res.status(400).json({ error: 'missing code' }); return; }
    if (!ALLOWED_REDIRECT_URIS.includes(redirectUri)) {
      res.status(400).json({ error: 'invalid redirect URI' });
      return;
    }

    const clientId     = TWITCH_CLIENT_ID;
    const clientSecret = twitchClientSecret.value();

    // Exchange authorization code for access token
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        code,
        grant_type:    'authorization_code',
        redirect_uri:  redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('Twitch token exchange failed:', err);
      res.status(502).json({ error: 'token exchange failed' });
      return;
    }

    const { access_token: accessToken } = await tokenRes.json() as { access_token: string };

    // Fetch Twitch user info
    const userRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id':   clientId,
      },
    });

    if (!userRes.ok) { res.status(502).json({ error: 'failed to fetch twitch user' }); return; }

    const { data: [twitchUser] } = await userRes.json() as {
      data: Array<{ id: string; login: string; display_name: string; profile_image_url: string; email?: string }>;
    };

    const uid = `twitch:${twitchUser.id}`;

    // Create Firebase Auth user if new
    try {
      await admin.auth().getUser(uid);
    } catch {
      await admin.auth().createUser({
        uid,
        displayName: twitchUser.display_name,
        photoURL:    twitchUser.profile_image_url,
        ...(twitchUser.email ? { email: twitchUser.email } : {}),
      });
    }

    // Upsert Firestore user doc (same schema as maskord users collection)
    await db.collection('users').doc(uid).set({
      displayName:    twitchUser.display_name,
      avatarUrl:      twitchUser.profile_image_url,
      twitchId:       twitchUser.id,
      twitchUsername: twitchUser.login,
      ...(twitchUser.email ? { email: twitchUser.email } : {}),
    }, { merge: true });

    const customToken = await admin.auth().createCustomToken(uid, {
      provider:   'twitch',
      twitchId:   twitchUser.id,
    });

    res.json({ firebaseToken: customToken, twitchId: twitchUser.id, displayName: twitchUser.display_name });
  },
);

// ─── Create Guild ─────────────────────────────────────────────────────────────

// DEFAULT_PERMISSIONS = VIEW_CHANNEL|SEND_MESSAGES|READ_MESSAGE_HISTORY|EMBED_LINKS|ATTACH_FILES|ADD_REACTIONS|CONNECT|SPEAK
const DEFAULT_PERMISSIONS = 1 | 2 | 4 | 16 | 32 | 64 | 128 | 256; // 503

export const createGuildFn = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

  const { name } = request.data as { name: string };
  if (!name?.trim()) throw new HttpsError('invalid-argument', 'name required');

  const ownerId = request.auth.uid;

  // Server-side idempotency: if user already has a personal guild, return it.
  const userSnap = await db.doc(`users/${ownerId}`).get();
  const existingGuildId = userSnap.data()?.personalGuildId as string | undefined;
  if (existingGuildId) {
    const guildSnap = await db.doc(`guilds/${existingGuildId}`).get();
    if (guildSnap.exists) return { guildId: existingGuildId };
    // Guild was deleted — clear the stale field and fall through to recreate
    await db.doc(`users/${ownerId}`).update({ personalGuildId: admin.firestore.FieldValue.delete() });
  }

  const batch = db.batch();

  // Create guild
  const guildRef = db.collection('guilds').doc();
  batch.set(guildRef, {
    name: name.trim(),
    description: '',
    iconUrl: '',
    ownerId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    vanityCode: null,
    settings: {
      defaultNotifications: 'all',
      explicitContentFilter: 'disabled',
      verificationLevel: 'none',
    },
  });

  const guildId = guildRef.id;

  // Create @everyone role
  const everyoneRoleRef = db.collection(`guilds/${guildId}/roles`).doc();
  batch.set(everyoneRoleRef, {
    name: '@everyone',
    color: '#99AAB5',
    permissions: DEFAULT_PERMISSIONS,
    position: 0,
    hoist: false,
    mentionable: false,
  });

  // Add owner as member
  batch.set(db.doc(`guilds/${guildId}/members/${ownerId}`), {
    nickname: null,
    roles: [everyoneRoleRef.id],
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    muted: false,
    deafened: false,
    pending: false,
  });

  // Mirror in members_index
  batch.set(db.doc(`members_index/${guildId}_${ownerId}`), {
    guildId,
    userId: ownerId,
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Default text channel
  const textChannelRef = db.collection(`guilds/${guildId}/channels`).doc();
  batch.set(textChannelRef, {
    name: 'general',
    type: 'text',
    position: 0,
    topic: 'General discussion',
    slowmode: 0,
    nsfw: false,
    parentId: null,
    permissionOverwrites: {},
  });

  // Default voice channel
  const voiceChannelRef = db.collection(`guilds/${guildId}/channels`).doc();
  batch.set(voiceChannelRef, {
    name: 'General',
    type: 'voice',
    position: 1,
    topic: null,
    slowmode: 0,
    nsfw: false,
    parentId: null,
    permissionOverwrites: {},
  });

  // Record personalGuildId on user doc so future calls return early
  batch.set(db.doc(`users/${ownerId}`), { personalGuildId: guildId }, { merge: true });

  await batch.commit();

  return { guildId };
});

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
