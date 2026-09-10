import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { loadActiveAvatars } from './channelAvatars';

// ─── GMI agentbox bridge ────────────────────────────────────────────────────────
//
// When an avatar is backed by a live GMI agentbox VM, maskord acts as a relay:
// every channel action is POSTed to the agentbox `/invoke` (fire-and-forget) with
// a short-lived callback token, and the agent — when it decides it's its turn —
// calls back to the `agentSpeak` HTTPS function with that token to speak/post into
// the channel. See the skill at maskord.com/maskord-agent-skill.md.

const TOKEN_PREFIX = 'mtok_';
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2h — re-minted on every forwarded event
const INVOKE_TIMEOUT_MS = 8000;

// The public URL of the agentSpeak callback (gen2 cloudfunctions.net alias).
export const AGENT_SPEAK_URL =
  'https://us-central1-maskydotnet.cloudfunctions.net/agentSpeak';

// ─── Callback token (stateless, HMAC-signed) ────────────────────────────────────

export interface CallbackClaims { g: string; c: string; a: string; o: string; exp: number }

let cachedSecret: string | null = null;
async function tokenSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const ref = admin.firestore().doc('config/agentToken');
  const existing = (await ref.get()).data()?.secret;
  if (typeof existing === 'string') { cachedSecret = existing; return existing; }
  const secret = crypto.randomBytes(32).toString('hex');
  await ref.set({ secret, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  cachedSecret = secret;
  return secret;
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function mintCallbackToken(
  guildId: string, channelId: string, avatarId: string, ownerUid: string,
): Promise<string> {
  const secret = await tokenSecret();
  const payload = b64url(JSON.stringify(
    { g: guildId, c: channelId, a: avatarId, o: ownerUid, exp: Date.now() + TOKEN_TTL_MS } as CallbackClaims,
  ));
  const sig = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  return `${TOKEN_PREFIX}${payload}.${sig}`;
}

export async function verifyCallbackToken(token: string): Promise<CallbackClaims | null> {
  try {
    if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
    const [payload, sig] = token.slice(TOKEN_PREFIX.length).split('.');
    if (!payload || !sig) return null;
    const expSig = b64url(crypto.createHmac('sha256', await tokenSecret()).update(payload).digest());
    const a = Buffer.from(sig); const b = Buffer.from(expSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const claims = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    ) as CallbackClaims;
    if (!claims.exp || claims.exp < Date.now()) return null;
    return claims;
  } catch { return null; }
}

// ─── Outbound: forward channel events to agentbox /invoke ────────────────────────

async function postInvoke(invokeUrl: string, authToken: string | undefined, body: unknown): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INVOKE_TIMEOUT_MS);
    try {
      const res = await fetch(invokeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) console.warn('[agentbox] /invoke non-2xx', res.status, invokeUrl);
    } finally { clearTimeout(timer); }
  } catch (err) {
    console.warn('[agentbox] /invoke failed', invokeUrl, (err as Error)?.message);
  }
}

export interface RoomEvent { type: string; [k: string]: unknown }

/**
 * Forward a room event to every agentbox-linked avatar currently in the channel.
 * Each gets its own callback token (scoped to that channel + avatar). The
 * invokeUrl/auth are read fresh from the avatar doc (not the channel roster) so
 * the agentbox secret never lands in the member-readable channel doc.
 * Fire-and-forget: the agent reasons and may call back via agentSpeak.
 */
export async function forwardRoomEventToAgents(
  guildId: string, channelId: string, event: RoomEvent,
): Promise<void> {
  const active = await loadActiveAvatars(guildId, channelId);
  const agents = active.filter((a) => a.hasAgentbox);
  if (agents.length === 0) return;

  const db = admin.firestore();
  await Promise.allSettled(agents.map(async (a) => {
    const doc = (await db.doc(`users/${a.ownerUid}/avatarGroups/${a.avatarId}`).get()).data();
    const gb = doc?.gmiAgentbox;
    if (!gb?.invokeUrl) return;
    const token = await mintCallbackToken(guildId, channelId, a.avatarId, a.ownerUid);
    await postInvoke(gb.invokeUrl, gb.authToken, {
      ...event,
      guildId,
      channelId,
      avatarId:     a.avatarId,
      avatarName:   a.displayName,
      conversation: { id: a.conversationId, viewerToken: a.viewerToken, liveUrl: a.liveUrl },
      callbackToken: token,
      callbackUrl:   AGENT_SPEAK_URL,
      ts:            Date.now(),
    });
  }));
}
