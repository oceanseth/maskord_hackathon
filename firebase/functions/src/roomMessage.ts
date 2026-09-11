import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

/**
 * Lets a Convex game room post into the channel it is bound to.
 *
 * A mask's line only existed in the room's own transcript, so it was visible on
 * the board and nowhere else — not in channel history, not in notifications, not
 * on mobile, and gone entirely for anyone who opened the channel later. That is
 * the difference between "the game is the channel" and "a game is rendered
 * beside the channel", which is the whole point of the mode.
 *
 * Server-to-server for the same reason as `roomTurn`: writing a message as
 * somebody who is not the caller needs admin credentials, and the guild document
 * is readable by any member of a server that allows guests. Same shared secret
 * and the same fail-closed guild allowlist — deliberately the *same* secrets, so
 * there is one thing to rotate rather than two.
 */

const bridgeSecret = defineSecret('ROOM_BRIDGE_SECRET');
const bridgeGuilds = defineSecret('ROOM_BRIDGE_GUILDS');

const MAX_CONTENT = 4000;

type Body = {
  guildId?: string;
  channelId?: string;
  /** Stable id for this speaker within the guild, e.g. a room memberKey. */
  speakerKey?: string;
  speakerName?: string;
  speakerAvatarUrl?: string;
  content?: string;
};

/**
 * Synthetic uid for a mask, matching the shape `claudeAgent` already writes
 * (`bot:<guildId>:<id>`) so the client resolves the name and avatar through the
 * ordinary profile lookup and renders the line like any other author.
 */
function maskUid(guildId: string, speakerKey: string): string {
  return `bot:${guildId}:${speakerKey}`;
}

export const roomMessage = onRequest(
  { cors: false, secrets: [bridgeSecret, bridgeGuilds], timeoutSeconds: 60 },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only' });
      return;
    }

    const presented = req.get('x-room-bridge-secret') ?? '';
    const expected = bridgeSecret.value();
    if (!expected || presented !== expected) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { guildId, channelId, speakerKey, speakerName, speakerAvatarUrl, content } =
      (req.body ?? {}) as Body;
    if (!guildId || !channelId || !speakerKey || !speakerName || !content?.trim()) {
      res.status(400).json({
        error: 'guildId, channelId, speakerKey, speakerName and content are required',
      });
      return;
    }

    // Allowlist first, exactly as in roomTurn: a room's channel binding comes
    // from a client, so it is a request rather than a permission.
    const allowed = (bridgeGuilds.value() ?? '')
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);
    if (!allowed.includes(guildId)) {
      res.status(403).json({ error: 'guild-not-allowed' });
      return;
    }

    const db = admin.firestore();

    // Refuse to post into a channel that is not actually in game mode. Without
    // this, anyone holding the secret could write as an arbitrary author into
    // any channel of an allowlisted guild; with it, the blast radius is the
    // channels a server owner has deliberately turned into tables.
    const channel = await db.doc(`guilds/${guildId}/channels/${channelId}`).get();
    if (!channel.exists) {
      res.status(404).json({ error: 'no-such-channel' });
      return;
    }
    const mode = (channel.data()?.mode as string | undefined) ?? 'default';
    if (mode === 'default') {
      res.status(409).json({ error: 'channel-not-in-game-mode', mode });
      return;
    }

    const uid = maskUid(guildId, speakerKey);
    // The profile doc is what makes the line render as the mask rather than as a
    // raw id; merge so a renamed mask updates rather than duplicating.
    await db.doc(`users/${uid}`).set(
      {
        displayName: speakerName,
        avatarUrl: speakerAvatarUrl ?? '',
        isBot: true,
        guildId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await db.collection(`guilds/${guildId}/channels/${channelId}/messages`).add({
      content: content.slice(0, MAX_CONTENT),
      authorId: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      editedAt: null,
      attachments: [],
      reactions: {},
      // A mask never pings anyone: it speaks constantly, and a table that
      // notifies on every line is a table people mute.
      mentions: [],
      pinned: false,
      type: 'default',
    });

    // Same counters `sendMessage` maintains, or the channel's unread badge and
    // ordering quietly drift away from what is in it.
    await db.doc(`guilds/${guildId}/channels/${channelId}`).update({
      messageCount: admin.firestore.FieldValue.increment(1),
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ ok: true, authorId: uid });
  },
);
