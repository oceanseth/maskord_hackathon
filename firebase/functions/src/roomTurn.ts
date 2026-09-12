import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

/**
 * Inference bridge for the Convex game rooms.
 *
 * The rooms live in Convex; the Anthropic key lives on `guilds/{id}.claudeApiKey`
 * in Firestore, typed in by a server owner under Server Settings → AI Assistance.
 * That is the same credential index.html has always used, so a room that talks
 * through here talks exactly the way the existing Maskord agents do.
 *
 * Why a server-to-server bridge instead of handing the room the key: the guild
 * document is readable by *any member* of that guild
 * (masky_auth/firestore.rules — `allow read: if isMember(guildId)`), and the
 * shared Maskord server has `allowGuests: true`. Anything that moves the key
 * toward the client puts a live, uncapped `sk-ant-…` within reach of anyone who
 * pressed "Look around as a guest". Here the key is read with admin credentials,
 * used, and never leaves this function.
 */

const bridgeSecret = defineSecret('ROOM_BRIDGE_SECRET');

/**
 * Which guilds this bridge will spend for, comma-separated — or `*` for "any
 * server that has opted in by configuring its own key".
 *
 * `*` is the normal setting, because a manual list is the wrong shape for the
 * rule everyone actually expects: *put your key in your server, and your
 * server's rooms can think*. Opting in is the owner typing a key into Server
 * Settings; nobody should have to be added to a secret by hand afterwards.
 *
 * What keeps `*` honest is the membership check below, which is now required
 * rather than optional: a guild's key is only ever spent on behalf of somebody
 * who is in that guild. Keep an explicit list here only to lock the bridge to
 * named servers while something is being debugged.
 */
const bridgeGuilds = defineSecret('ROOM_BRIDGE_GUILDS');
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 1024;

type Body = {
  guildId?: string;
  /** Uid on whose behalf the room is spending this guild's key. */
  memberUid?: string;
  system?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools?: unknown[];
  model?: string;
  maxTokens?: number;
};

export const roomTurn = onRequest(
  { cors: false, secrets: [bridgeSecret, bridgeGuilds], timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only' });
      return;
    }

    // Shared secret, not Firebase auth: the caller is a Convex action, not a user.
    const presented = req.get('x-room-bridge-secret') ?? '';
    const expected = bridgeSecret.value();
    if (!expected || presented !== expected) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const body = (req.body ?? {}) as Body;
    const { guildId, memberUid, system, messages } = body;
    if (!guildId || !system || !messages?.length) {
      res.status(400).json({ error: 'guildId, system and messages are required' });
      return;
    }

    // A room's `config.guildId` is client-supplied, so it is a request rather
    // than a permission. `*` delegates the decision to the server owner, who
    // grants it by configuring a key at all.
    const allowed = (bridgeGuilds.value() ?? '')
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);
    if (!allowed.includes('*') && !allowed.includes(guildId)) {
      res.status(403).json({
        error: 'guild-not-allowed',
        message: `Server ${guildId} is not in ROOM_BRIDGE_GUILDS.`,
      });
      return;
    }

    const db = admin.firestore();

    // Spend a guild's key only on behalf of somebody in that guild — and
    // *required*, not skipped when the caller omits a uid. It used to be
    // conditional, which meant a caller could avoid the check entirely by
    // saying nothing, leaving the allowlist as the only real boundary.
    if (!memberUid) {
      res.status(403).json({
        error: 'member-required',
        message: 'A turn must name the member it is thinking for.',
      });
      return;
    }
    const member = await db.doc(`guilds/${guildId}/members/${memberUid}`).get();
    if (!member.exists) {
      res.status(403).json({ error: 'Not a member of that server' });
      return;
    }

    const guild = await db.doc(`guilds/${guildId}`).get();
    const apiKey = guild.data()?.claudeApiKey as string | undefined;
    if (!apiKey) {
      // A specific, actionable answer rather than a 500 — this is the single
      // most likely reason a room is quiet.
      res.status(409).json({
        error: 'no-key',
        message:
          `Server ${guildId} has no AI key. Set one in Server Settings → AI Assistance.`,
      });
      return;
    }

    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: body.model ?? DEFAULT_MODEL,
        max_tokens: body.maxTokens ?? MAX_TOKENS,
        system,
        messages,
        ...(body.tools?.length ? { tools: body.tools } : {}),
      }),
    });

    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 400);
      // Never echo the key back, even inside an upstream error string.
      res.status(502).json({ error: 'upstream', detail: detail.replace(/sk-ant-[\w-]+/g, 'sk-ant-…') });
      return;
    }

    const data = (await upstream.json()) as {
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; name: string; input: Record<string, unknown> }
      >;
    };

    res.json({
      text: data.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim(),
      toolCalls: data.content
        .filter(
          (b): b is { type: 'tool_use'; name: string; input: Record<string, unknown> } =>
            b.type === 'tool_use',
        )
        .map((b) => ({ name: b.name, input: b.input })),
    });
  },
);
