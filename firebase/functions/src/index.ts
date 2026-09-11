import * as admin from 'firebase-admin';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentDeleted, onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onValueDeleted, onValueCreated } from 'firebase-functions/v2/database';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';

admin.initializeApp();
const db = admin.firestore();

// ─── Claude agent triggers (text-channel messages + voice-channel transcripts) ─
export {
  onClaudeChannelMessage, onClaudeTranscriptUtterance,
  onChannelAiDisabled, onGuildAiDisabled, agentSpeak,
  inviteAvatarToVoice,
} from './claudeAgent';
// ─── Inference bridge for the Convex game rooms ───────────────────────────────
export { roomTurn } from './roomTurn';
export { roomMessage } from './roomMessage';

import { removeAvatarsInvitedBy } from './channelAvatars';
import { forwardRoomEventToAgents } from './agentbox';

/** Display name for a uid (best-effort) for room events. */
async function displayNameFor(uid: string): Promise<string> {
  const d = (await db.doc(`users/${uid}`).get()).data();
  return (d?.displayName ?? d?.twitchUsername ?? uid.slice(0, 8)) as string;
}

// ─── Twitch OAuth ─────────────────────────────────────────────────────────────

const twitchClientSecret = defineSecret('TWITCH_CLIENT_SECRET');

const TWITCH_CLIENT_ID = 'sgb17aslo6gesnetuqfnf6qql6jrae';

const ALLOWED_REDIRECT_URIS = [
  'http://localhost:2468',                      // Electron desktop app
  'https://www.maskord.com/app',                // Web app (production)
  'https://maskord.com/app',                    // Web app (apex — redirects to www)
  'https://www.maskord.com/oauth/twitch',       // iOS / Android mobile app (HTTPS relay)
  'https://hackathon.maskord.com/app',          // Burning Token hackathon build
];

export const twitchOAuth = onRequest(
  {
    // Mobile apps send requests with no Origin header; passing true allows any
    // origin (the allowlist above still gates which redirect URIs are accepted).
    cors: true,
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

    // Persist the access token in custom claims so sendLiveChatMessage can use it.
    // setCustomUserClaims must be called before createCustomToken so the fresh
    // token is available as soon as the client signs in with the custom token.
    await admin.auth().setCustomUserClaims(uid, {
      provider:           'twitch',
      twitchId:           twitchUser.id,
      twitchAccessToken:  accessToken,
    });

    const customToken = await admin.auth().createCustomToken(uid, {
      provider:   'twitch',
      twitchId:   twitchUser.id,
    });

    res.json({ firebaseToken: customToken, twitchId: twitchUser.id, displayName: twitchUser.display_name });
  },
);

// ─── Guests ───────────────────────────────────────────────────────────────────

/**
 * A guest is an anonymous Firebase sign-in — the "Look around as a guest"
 * button. They get a real uid, so every membership rule keeps working; what
 * they don't get is a way back into the account.
 *
 * Read off the token's sign_in_provider, which is the only discriminator that
 * holds here: Twitch users are provisioned with createUser() and signed in with
 * a custom token, so they have no linked providers either, and they must not be
 * mistaken for guests.
 *
 *   guest -> 'anonymous'    Twitch -> 'custom'
 *   Google -> 'google.com'  email  -> 'password'
 */
function isGuest(request: { auth?: { token?: { firebase?: { sign_in_provider?: string } } } }): boolean {
  return request.auth?.token?.firebase?.sign_in_provider === 'anonymous';
}

/**
 * Guests only get into servers that opted in. Membership is created by these
 * functions alone (`guilds/{id}/members` is `allow create: if false` in the
 * rules), so this is the whole gate — there is no client path around it.
 *
 * Absent settings.allowGuests reads as off, so every server that existed before
 * this setting stays closed to guests without a migration.
 */
async function assertGuestAllowed(
  request: { auth?: { token?: { firebase?: { sign_in_provider?: string } } } },
  guildId: string,
): Promise<void> {
  if (!isGuest(request)) return;
  const guildSnap = await db.doc(`guilds/${guildId}`).get();
  if (guildSnap.data()?.settings?.allowGuests !== true) {
    throw new HttpsError('permission-denied', 'This server does not accept guests. Sign in to join.');
  }
}

// ─── The shared Maskord server ────────────────────────────────────────────────
//
// One server everybody is in: the room a new account — or a guest who has just
// clicked "look around" — lands in with people already in it, instead of an
// empty personal server.
//
// Which guild that is lives in `system/maskordDefaults.guildId`, written once by
// `scripts/provision-maskord-server.mjs`. It is deliberately not a build-time
// constant: pointing the whole product at a different server should not need a
// client release. Nothing client-side reads the doc — only these functions do,
// with admin credentials — so it needs no rules change.

/** `system/maskordDefaults.guildId`, or null when it has not been provisioned. */
async function defaultGuildId(): Promise<string | null> {
  const snap = await db.doc('system/maskordDefaults').get();
  const id = snap.data()?.guildId;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Put the caller in the shared server. Idempotent, and safe to call on every
 * load: the common case is one document read that finds an existing membership.
 *
 * Guests are welcome here by design — this is the server the guest button
 * exists for — but they still go through the same allowGuests check as any
 * other server, so turning that setting off closes this door too.
 */
export const joinDefaultGuild = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

  const guildId = await defaultGuildId();
  if (!guildId) throw new HttpsError('failed-precondition', 'No shared server is configured');

  const userId = request.auth.uid;
  const memberRef = db.doc(`guilds/${guildId}/members/${userId}`);
  if ((await memberRef.get()).exists) return { guildId, alreadyMember: true };

  const guildSnap = await db.doc(`guilds/${guildId}`).get();
  if (!guildSnap.exists) throw new HttpsError('not-found', 'The shared server is missing');
  await assertGuestAllowed(request, guildId);

  // Same @everyone role every other join path hands out.
  const everyone = await db.collection(`guilds/${guildId}/roles`)
    .where('name', '==', '@everyone').limit(1).get();
  const roles = everyone.empty ? [] : [everyone.docs[0].id];

  const batch = db.batch();
  batch.set(memberRef, {
    nickname: null,
    roles,
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    muted: false,
    deafened: false,
    pending: false,
  });
  batch.set(db.doc(`members_index/${guildId}_${userId}`), {
    guildId,
    userId,
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Say hello in #general, the same as an invite join does. In the shared
  // server this is also how you meet anyone: the join notice is often the only
  // place a new person's name appears, and it opens their profile.
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
      allowGuests: false,
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

  // #live channel — pinned at position -1 so it always sorts first.
  // type='live' marks it as non-editable and triggers the live UI.
  const liveChannelRef = db.collection(`guilds/${guildId}/channels`).doc();
  batch.set(liveChannelRef, {
    name: 'live',
    type: 'live',
    position: -1,
    topic: 'Twitch chat & live stream',
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

  await assertGuestAllowed(request, guildId);

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

// ─── Join Guild as Mutual Friend ──────────────────────────────────────────────

export const joinGuildAsMutualFriend = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

  const { guildId } = request.data as { guildId: string };
  if (!guildId) throw new HttpsError('invalid-argument', 'guildId required');

  const userId = request.auth.uid;

  // Get the guild to find its owner
  const guildSnap = await db.doc(`guilds/${guildId}`).get();
  if (!guildSnap.exists) throw new HttpsError('not-found', 'Guild not found');
  const ownerId = guildSnap.data()!.ownerId as string;

  await assertGuestAllowed(request, guildId);

  // Verify the requester is a mutual friend of the owner.
  // Friendship ID uses sorted UIDs: [uid1, uid2].sort().join('__')
  const fId = [userId, ownerId].sort().join('__');
  const friendshipSnap = await db.doc(`friendships/${fId}`).get();
  if (!friendshipSnap.exists || friendshipSnap.data()!.status !== 'accepted') {
    throw new HttpsError('permission-denied', 'Must be a mutual friend of the server owner to join');
  }

  // Already a member — idempotent
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

  // Post system join message in first text channel
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

  // The shared server is not leaveable. The client hides the menu item; this is
  // the half that holds when someone calls the function directly.
  if (guildId === await defaultGuildId()) {
    throw new HttpsError('failed-precondition', 'The Maskord server cannot be left');
  }

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

// ─── TURN Credentials ─────────────────────────────────────────────────────────
// Returns ICE server config (STUN + TURN) for WebRTC NAT traversal.
//
// Setup — create Firestore document at _config/turn (no redeploy needed):
//
//   Self-hosted coturn (free — see coturn setup below):
//     { "provider": "static", "servers": [
//         { "urls": "stun:stun.l.google.com:19302" },
//         { "urls": ["turn:YOUR_IP:3478","turn:YOUR_IP:443?transport=tcp"],
//           "username": "maskord", "credential": "YOUR_PASSWORD" }
//     ]}
//
//   Cloudflare TURN (1TB/month free — no server to manage):
//     cloudflare.com → Calls → TURN → Create key → copy Key ID + API token
//     { "provider": "cloudflare", "keyId": "...", "apiToken": "..." }
//
//   Metered.ca (1GB/month free):
//     { "provider": "metered", "apiKey": "...", "appName": "..." }
//
//   Also add a Firestore security rule:
//     match /_config/{doc=**} { allow read, write: if false; }
//
// Without config, falls back to STUN-only (same-network calls work; cross-network
// calls behind symmetric NAT will fail).

// Module-level cache — credentials last 24h; refresh after 23h.
let cachedTurnServers: unknown[] | null = null;
let turnCacheTimestamp = 0;
const TURN_CACHE_TTL = 23 * 60 * 60 * 1000;

export const getTurnCredentials = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

  // Serve from in-memory cache if still fresh
  if (cachedTurnServers && Date.now() - turnCacheTimestamp < TURN_CACHE_TTL) {
    return cachedTurnServers;
  }

  // Read provider config from Firestore (_config/turn — admin SDK bypasses rules)
  try {
    const snap = await db.doc('_config/turn').get();
    const cfg = snap.data() as {
      provider?: string;
      // Cloudflare
      keyId?: string; apiToken?: string;
      // Metered.ca
      apiKey?: string; appName?: string;
      // Static / self-hosted coturn
      servers?: unknown[];
    } | undefined;

    if (cfg?.provider === 'cloudflare' && cfg.keyId && cfg.apiToken) {
      const res = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${cfg.keyId}/credentials/generate`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.apiToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 86400 }),
        },
      );
      if (res.ok) {
        const data = await res.json() as { iceServers: unknown[] };
        cachedTurnServers = data.iceServers;
        turnCacheTimestamp = Date.now();
        console.log('[getTurnCredentials] Returning Cloudflare TURN credentials');
        return cachedTurnServers;
      }
      console.warn('[getTurnCredentials] Cloudflare API returned', res.status, await res.text());

    } else if (cfg?.provider === 'metered' && cfg.apiKey && cfg.appName) {
      const res = await fetch(
        `https://${cfg.appName}.metered.live/api/v1/turn/credentials?apiKey=${cfg.apiKey}`,
      );
      if (res.ok) {
        cachedTurnServers = await res.json() as unknown[];
        turnCacheTimestamp = Date.now();
        console.log('[getTurnCredentials] Returning Metered.ca TURN credentials');
        return cachedTurnServers;
      }
      console.warn('[getTurnCredentials] Metered.ca API returned', res.status);

    } else if (cfg?.provider === 'static' && Array.isArray(cfg.servers)) {
      // Self-hosted TURN (coturn, etc.) — credentials stored directly in Firestore.
      // Static credentials don't expire, so cache indefinitely within the instance.
      cachedTurnServers = cfg.servers as unknown[];
      turnCacheTimestamp = Date.now();
      console.log('[getTurnCredentials] Returning static TURN credentials');
      return cachedTurnServers;
    }
  } catch (e) {
    console.warn('[getTurnCredentials] Failed to fetch TURN credentials:', e);
  }

  // Fallback — STUN only
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
});

// ─── Live Channel ─────────────────────────────────────────────────────────────
//
// Network enum (must stay in sync with shared/src/types/index.ts LiveNetwork):
const LiveNetwork = { Twitch: 0, YouTube: 1, Facebook: 2, Maskord: 99 } as const;

// Module-level app token cache — valid for ~60 days; refresh when expired.
let cachedAppToken: string | null = null;
let appTokenExpiry = 0;

async function getTwitchAppToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedAppToken && Date.now() < appTokenExpiry) return cachedAppToken;
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`Twitch token error: ${await res.text()}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  cachedAppToken = data.access_token;
  appTokenExpiry = Date.now() + (data.expires_in - 300) * 1000; // refresh 5 min early
  return cachedAppToken;
}

/**
 * Actively check whether a guild owner is currently live on Twitch and update
 * the liveStatus doc. Clients call this on mount so the badge/embed is accurate
 * without waiting for a webhook event from masky.
 *
 * Returns the current LiveStatus fields so the caller can use them immediately.
 */
export const checkLiveStatus = onCall(
  { secrets: [twitchClientSecret] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

    const { guildId } = request.data as { guildId: string };
    if (!guildId) throw new HttpsError('invalid-argument', 'guildId required');

    // Get guild owner's Twitch details
    const guildSnap = await db.doc(`guilds/${guildId}`).get();
    if (!guildSnap.exists) throw new HttpsError('not-found', 'Guild not found');
    const ownerId = guildSnap.data()!.ownerId as string;

    const ownerSnap = await db.doc(`users/${ownerId}`).get();
    const ownerData = ownerSnap.data();
    const twitchId    = ownerData?.twitchId    as string | undefined;
    const twitchLogin = ownerData?.twitchUsername as string | undefined;

    if (!twitchId) {
      // Owner hasn't connected Twitch — return offline status without writing
      return { isLive: false, network: 0 };
    }

    const clientId     = TWITCH_CLIENT_ID;
    const clientSecret = twitchClientSecret.value();
    const appToken     = await getTwitchAppToken(clientId, clientSecret);

    const streamRes = await fetch(
      `https://api.twitch.tv/helix/streams?user_id=${twitchId}`,
      { headers: { Authorization: `Bearer ${appToken}`, 'Client-Id': clientId } },
    );

    if (!streamRes.ok) {
      console.warn('[checkLiveStatus] Helix streams error:', streamRes.status, await streamRes.text());
      throw new HttpsError('internal', 'Failed to fetch stream status from Twitch');
    }

    const streamData = await streamRes.json() as {
      data: Array<{
        title: string;
        viewer_count: number;
        started_at: string;
        thumbnail_url: string;
        type: string;
      }>;
    };

    const stream    = streamData.data[0];
    const isLive    = !!stream && stream.type === 'live';
    const statusDoc = {
      isLive,
      network:      0, // Twitch
      streamTitle:  stream?.title        ?? null,
      viewerCount:  stream?.viewer_count ?? 0,
      twitchLogin:  twitchLogin          ?? null,
      thumbnailUrl: stream?.thumbnail_url?.replace('{width}', '640').replace('{height}', '360') ?? null,
      startedAt:    isLive ? stream!.started_at : null,
      updatedAt:    admin.firestore.FieldValue.serverTimestamp(),
      ...(isLive ? {} : { startedAt: null }),
    };

    await db.doc(`guilds/${guildId}/_meta/liveStatus`).set(statusDoc, { merge: true });

    console.log(`[checkLiveStatus] guild=${guildId} twitchId=${twitchId} isLive=${isLive} viewers=${stream?.viewer_count ?? 0}`);
    return { isLive, viewerCount: stream?.viewer_count ?? 0, streamTitle: stream?.title ?? null, twitchLogin };
  },
);

/**
 * Bridge: when masky writes a new chatMessage for a user, normalize it and fan
 * it out to that user's personal guild's liveMessages subcollection.
 *
 * Source path : users/{uid}/chatMessages/{msgId}   (written by masky Lambda)
 * Target path : guilds/{guildId}/liveMessages/{id}
 */
export const onChatMessageCreated = onDocumentCreated(
  'users/{uid}/chatMessages/{msgId}',
  async (event) => {
    const { uid, msgId } = event.params;
    const data = event.data?.data();
    if (!data) return;

    // Look up the owner's personal guild
    const userSnap = await db.doc(`users/${uid}`).get();
    const guildId  = userSnap.data()?.personalGuildId as string | undefined;
    if (!guildId) return; // no personal guild yet — skip

    // Resolve the senderMaskordUid: Twitch-authenticated Maskord users have UID
    // `twitch:{twitchId}`, so we can do a direct doc lookup — no query needed.
    const chatterId = (data.chatterId ?? data.userId ?? '') as string;
    let senderMaskordUid: string | null = null;
    if (chatterId) {
      const directSnap = await db.doc(`users/twitch:${chatterId}`).get();
      if (directSnap.exists) {
        senderMaskordUid = directSnap.id;
      }
    }

    const network: number = typeof data.network === 'number' ? data.network : LiveNetwork.Twitch;

    await db.collection(`guilds/${guildId}/liveMessages`).doc(msgId).set({
      network,
      platformMsgId:    msgId,
      senderName:       (data.username ?? data.userName ?? data.chatter_user_name ?? 'Unknown') as string,
      senderPlatformId: chatterId,
      senderMaskordUid,
      text:             (data.messageText ?? data.text ?? data.message?.text ?? '') as string,
      fragments:        data.fragments ?? null,
      timestamp:        data.timestamp ?? admin.firestore.FieldValue.serverTimestamp(),
      lang:             data.detectedLanguage ?? null,
    });
  },
);

/**
 * TTL cleanup: delete chatMessages older than 30 days.
 * Runs daily at 03:00 UTC. Processes up to 500 docs per run (repeated runs
 * catch any backlog). At >500 docs/run Firestore batch limit applies.
 */
export const cleanupOldChatMessages = onSchedule('0 3 * * *', async () => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const cutoffTs = admin.firestore.Timestamp.fromDate(cutoff);

  // Query across all users' chatMessages subcollections via collectionGroup
  const snap = await db.collectionGroup('chatMessages')
    .where('timestamp', '<', cutoffTs)
    .limit(500)
    .get();

  if (snap.empty) return;

  const batches: Array<ReturnType<typeof db.batch>> = [];
  let batch = db.batch();
  let count = 0;

  for (const docSnap of snap.docs) {
    batch.delete(docSnap.ref);
    count++;
    if (count % 499 === 0) {
      batches.push(batch);
      batch = db.batch();
    }
  }
  batches.push(batch);
  await Promise.all(batches.map((b) => b.commit()));
  console.log(`[cleanupOldChatMessages] Deleted ${count} documents`);
});

/**
 * Also clean up liveMessages beyond 5,000 per guild (keeps Firestore lean).
 * Runs daily at 03:30 UTC.
 */
export const cleanupOldLiveMessages = onSchedule('30 3 * * *', async () => {
  const guildsSnap = await db.collection('guilds').select().get();
  await Promise.all(guildsSnap.docs.map(async (guildDoc) => {
    const ref    = db.collection(`guilds/${guildDoc.id}/liveMessages`);
    const total  = await ref.count().get();
    const excess = total.data().count - 5000;
    if (excess <= 0) return;

    const oldestSnap = await ref
      .orderBy('timestamp', 'asc')
      .limit(excess)
      .get();

    const batch = db.batch();
    oldestSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    console.log(`[cleanupOldLiveMessages] guild=${guildDoc.id} deleted=${excess}`);
  }));
});

// updateLiveStatus removed — masky's Lambda writes directly to Firestore via
// the admin SDK (same maskydotnet project), so no Cloud Function wrapper needed.

/**
 * Send a message to the live chat on behalf of a Maskord user.
 * Uses the user's stored Twitch access token (from masky custom claims).
 *
 * Payload: { guildId, text, maskPersonalityPrompt? }
 */
export const sendLiveChatMessage = onCall(
  { secrets: [twitchClientSecret] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

    const { guildId, text, maskPersonalityPrompt } = request.data as {
      guildId: string;
      text: string;
      maskPersonalityPrompt?: string;
    };

    if (!text?.trim()) throw new HttpsError('invalid-argument', 'text required');

    const senderId = request.auth.uid;

    // Get the guild to find the owner's Twitch channel
    const guildSnap = await db.doc(`guilds/${guildId}`).get();
    if (!guildSnap.exists) throw new HttpsError('not-found', 'Guild not found');
    const ownerId = guildSnap.data()!.ownerId as string;

    // Get streamer's Twitch ID from their user doc
    const ownerSnap = await db.doc(`users/${ownerId}`).get();
    const broadcasterTwitchId = ownerSnap.data()?.twitchId as string | undefined;
    if (!broadcasterTwitchId) {
      throw new HttpsError('failed-precondition', 'Server owner has not connected Twitch');
    }

    // Get sender's Twitch credentials (stored as custom claims by masky OAuth)
    const senderRecord = await admin.auth().getUser(senderId);
    const claims = senderRecord.customClaims ?? {};
    const accessToken   = claims.twitchAccessToken as string | undefined;
    const senderTwitchId = claims.twitchId as string | undefined;

    if (!accessToken || !senderTwitchId) {
      throw new HttpsError('failed-precondition', 'TWITCH_NOT_CONNECTED');
    }

    // Personality rewrite happens on-device before calling this function.
    // `text` arrives already rewritten. We just send it.
    const messageText = (maskPersonalityPrompt ? text : text).trim();

    const sendRes = await fetch('https://api.twitch.tv/helix/chat/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Client-Id':     TWITCH_CLIENT_ID,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        broadcaster_id: broadcasterTwitchId,
        sender_id:      senderTwitchId,
        message:        messageText,
      }),
    });

    if (!sendRes.ok) {
      const err = await sendRes.text();
      console.error('[sendLiveChatMessage] Twitch API error:', err);
      // 401 = token expired/invalid
      if (sendRes.status === 401) throw new HttpsError('unauthenticated', 'TWITCH_TOKEN_EXPIRED');
      throw new HttpsError('internal', 'Failed to send to Twitch chat');
    }

    // Echo the message into liveMessages immediately so the sender sees it
    // without waiting for the EventSub webhook to bounce back.
    const senderSnap = await db.doc(`users/${senderId}`).get();
    const senderData = senderSnap.data();
    await db.collection(`guilds/${guildId}/liveMessages`).add({
      network:          LiveNetwork.Maskord,
      platformMsgId:    `maskord_${Date.now()}_${senderId}`,
      senderName:       senderData?.displayName ?? senderData?.twitchUsername ?? 'Unknown',
      senderPlatformId: senderTwitchId,
      senderMaskordUid: senderId,
      text:             messageText,
      fragments:        null,
      timestamp:        admin.firestore.FieldValue.serverTimestamp(),
      lang:             null,
    });

    return { success: true };
  },
);

// ─── Clean up stale voice signaling rooms (older than 1 hour) ─────────────────

export const onVoiceStateDeleted = onValueDeleted(
  'voiceState/{guildId}/{channelId}/{userId}',
  async (event) => {
    const { guildId, channelId, userId } = event.params;
    const rtdb = admin.database();

    // Tell live agents this user left (before we tear down their avatars).
    await forwardRoomEventToAgents(guildId, channelId, {
      type: 'user_left', userId, name: await displayNameFor(userId),
    }).catch(() => {});

    // When a user leaves the channel, remove any AI avatars they invited.
    await removeAvatarsInvitedBy(guildId, channelId, userId).catch((e) =>
      console.warn('[voice] failed to remove invited avatars on leave', e),
    );

    // When the last person leaves a channel, clean up orphaned signaling rooms.
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

// When a user joins a voice channel, notify any live agents present.
export const onVoiceStateCreated = onValueCreated(
  'voiceState/{guildId}/{channelId}/{userId}',
  async (event) => {
    const { guildId, channelId, userId } = event.params;
    await forwardRoomEventToAgents(guildId, channelId, {
      type: 'user_joined', userId, name: await displayNameFor(userId),
    }).catch(() => {});
  },
);
