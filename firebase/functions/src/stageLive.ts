import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { createConversation, postTurn } from './maskyConversation';

/**
 * Stage faces on masky.ai /live.
 *
 * Each seated mask gets one conversation, and the host is always the shared
 * Masky. Silent waiting clips keep the face moving between lines; a speak
 * turn is what the live page plays when it is that mask's line. The mky_ key
 * never leaves this function.
 *
 * A guild Masky key is used when Server Settings has one. Otherwise the
 * avatar owner's own maskord key is created and reused — the same registration
 * voice channels use for an invited avatar — so a stage still speaks when the
 * server has not pasted a key.
 *
 * Defaults match app/shared/src/constants/claudeAvatar.ts.
 */

const DEFAULT_HOST = {
  ownerUid: 'twitch:11867613',
  avatarId: 'OPVx2xSCl9UpdnDIfIUD',
};

const POLL_MS = 2_000;
const POLL_BUDGET_MS = 70_000;
const SPEAK_CHARS = 500;

export interface StageLiveBody {
  op?: 'stage-ensure' | 'stage-speak';
  avatarOwnerUserId?: string;
  avatarId?: string;
  conversationId?: string;
  text?: string;
  /** When false, return as soon as the turn is accepted. The live page plays it when the video lands. */
  wait?: boolean;
}

type LiveRecord = {
  conversationId: string;
  liveUrl: string;
  shareSlug: string;
  avatarId: string;
  avatarOwnerUserId: string;
  silent: boolean;
  /** True when the conversation was opened with the avatar owner's key, not the guild key. */
  billedToOwner?: boolean;
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The create-conversation API usually returns `liveUrl`. When it does not, the
 * embed is the public live page for that share slug plus the viewer token —
 * the same URL `liveUrlForToken` builds on masky.ai.
 */
function resolveLiveUrl(conv: { liveUrl: string; shareSlug: string; viewerToken: string }): string {
  const direct = conv.liveUrl?.trim();
  if (direct) return direct;
  if (!conv.shareSlug || !conv.viewerToken) return '';
  return `https://masky.ai/live/${encodeURIComponent(conv.shareSlug)}?token=${encodeURIComponent(conv.viewerToken)}`;
}

function docId(role: 'host' | 'seat', ownerUid: string, avatarId: string): string {
  return `${role}__${ownerUid}__${avatarId}`.replace(/\//g, '_');
}

/**
 * A maskord-issued mky_ key for this uid, created once and reused.
 * Registered the same way masky.ai/developer does: apiKeys/{sha256(key)}
 * carries the owner, and the raw key stays in maskordUserKeys/{uid}.
 * A transaction keeps two seats opening at once from each minting a key
 * the other one's conversation cannot use.
 */
async function ensureUserMaskyKey(db: admin.firestore.Firestore, uid: string): Promise<string | null> {
  if (!uid) return null;
  try {
    const ref = db.doc(`maskordUserKeys/${uid}`);
    const existing = (await ref.get()).data()?.apiKey;
    if (typeof existing === 'string' && existing.startsWith('mky_')) return existing;

    const raw = 'mky_' + crypto.randomBytes(24).toString('hex');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.data()?.apiKey;
      if (typeof current === 'string' && current.startsWith('mky_')) return;
      tx.set(db.doc(`apiKeys/${hash}`), {
        ownerUid: uid,
        name: 'maskord',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastUsedAt: null,
        revokedAt: null,
      });
      tx.set(ref, {
        apiKey: raw,
        name: 'maskord',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    const saved = (await ref.get()).data()?.apiKey;
    return typeof saved === 'string' && saved.startsWith('mky_') ? saved : null;
  } catch (err) {
    console.warn('[stage-live] ensureUserMaskyKey', (err as Error).message);
    return null;
  }
}

/** Guild key when the conversation was opened with one; otherwise the owner's. */
async function resolveApiKey(
  db: admin.firestore.Firestore,
  guildKey: unknown,
  ownerUid: string,
  billedToOwner: boolean,
): Promise<string | null> {
  const guild = typeof guildKey === 'string' ? guildKey.trim() : '';
  if (!billedToOwner && guild.startsWith('mky_')) return guild;
  return ensureUserMaskyKey(db, ownerUid);
}

function videoSettled(d: admin.firestore.DocumentData): boolean {
  const status = (d.status as string) ?? 'pending';
  return status === 'video' || status === 'ready' || status === 'error' || !!d.videoStoragePath;
}

function videoOk(d: admin.firestore.DocumentData): boolean {
  const status = (d.status as string) ?? '';
  return status !== 'error' && (status === 'video' || status === 'ready' || !!d.videoStoragePath);
}

async function enableSilent(apiKey: string, conversationId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://masky.ai/api/conversations/${conversationId}/silent-renders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: true }),
    });
    if (!res.ok) {
      console.warn('[stage-live] silent-renders', res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[stage-live] silent-renders', (err as Error).message);
    return false;
  }
}

/**
 * Wait until the speak turn's video chunks have landed, or the budget runs out.
 * The live page plays them either way; waiting lets the stage hold the floor
 * until the face is actually about to talk. Later chunks keep rendering after
 * we return — the live page plays those in order on its own.
 */
async function waitForVideo(conversationId: string, turnId: string): Promise<boolean> {
  const turnsCol = admin.firestore().collection(`conversations/${conversationId}/turns`);
  const chunk0 = await turnsCol.doc(turnId).get();
  const startTs = chunk0.get('createdAt') as admin.firestore.Timestamp | undefined;
  const deadline = Date.now() + POLL_BUDGET_MS;
  let lastCount = -1;
  let stable = 0;

  while (Date.now() < deadline) {
    let q: admin.firestore.Query = turnsCol.orderBy('createdAt', 'asc');
    if (startTs) q = q.where('createdAt', '>=', startTs);
    const snap = await q.get();
    const chunks: admin.firestore.DocumentData[] = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.role !== 'avatar') {
        if (chunks.length > 0) break;
        continue;
      }
      chunks.push(d);
    }
    const allSettled = chunks.length > 0 && chunks.every(videoSettled);
    if (allSettled && chunks.length === lastCount) {
      if (++stable >= 2) return chunks.some(videoOk);
    } else {
      stable = 0;
    }
    lastCount = chunks.length;
    await delay(POLL_MS);
  }
  return false;
}

export async function handleStageLive(
  db: admin.firestore.Firestore,
  guildId: string,
  body: StageLiveBody,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const guild = await db.doc(`guilds/${guildId}`).get();
  const data = guild.data() ?? {};
  const guildKey = data.maskyApiKey;

  if (body.op === 'stage-ensure') {
    // No avatar on the request means the host. She is the shared Masky, not
    // whichever portrait the server picked for chat.
    const hostSeat = !body.avatarId?.trim();
    const avatarId = (hostSeat ? DEFAULT_HOST.avatarId : body.avatarId || '').trim();
    const avatarOwnerUserId = (
      hostSeat ? DEFAULT_HOST.ownerUid : body.avatarOwnerUserId || ''
    ).trim();
    if (!avatarId || !avatarOwnerUserId) {
      return { status: 400, json: { error: 'avatar-required' } };
    }

    const billedToOwner = !(typeof guildKey === 'string' && guildKey.trim().startsWith('mky_'));
    const apiKey = await resolveApiKey(db, guildKey, avatarOwnerUserId, billedToOwner);
    if (!apiKey) {
      return {
        status: 409,
        json: {
          error: 'no-masky-key',
          message: 'No Masky key for this avatar. Set one in Server Settings → AI Assistance.',
        },
      };
    }

    const ref = db.doc(`guilds/${guildId}/stageLives/${docId(hostSeat ? 'host' : 'seat', avatarOwnerUserId, avatarId)}`);
    const existing = await ref.get();
    if (existing.exists) {
      const cached = existing.data() as LiveRecord;
      const cacheKey = await resolveApiKey(
        db,
        guildKey,
        cached.avatarOwnerUserId || avatarOwnerUserId,
        cached.billedToOwner === true,
      );
      if (!cached.silent && cached.conversationId && cacheKey) {
        const silent = await enableSilent(cacheKey, cached.conversationId);
        if (silent) await ref.set({ silent: true }, { merge: true });
      }
      if (cached.conversationId && cached.liveUrl) {
        return {
          status: 200,
          json: { conversationId: cached.conversationId, liveUrl: cached.liveUrl },
        };
      }
    }

    const conv = await createConversation({ apiKey, avatarOwnerUserId, avatarId });
    const liveUrl = conv ? resolveLiveUrl(conv) : '';
    if (!conv || !liveUrl) {
      return { status: 502, json: { error: 'conversation-failed' } };
    }
    const silent = await enableSilent(apiKey, conv.conversationId);
    const record: LiveRecord = {
      conversationId: conv.conversationId,
      liveUrl,
      shareSlug: conv.shareSlug,
      avatarId,
      avatarOwnerUserId,
      silent,
      billedToOwner,
    };
    await ref.set(record);
    return {
      status: 200,
      json: { conversationId: record.conversationId, liveUrl: record.liveUrl },
    };
  }

  if (body.op === 'stage-speak') {
    const conversationId = body.conversationId?.trim() ?? '';
    const text = (body.text ?? '').trim().slice(0, SPEAK_CHARS);
    if (!conversationId || !text) {
      return { status: 400, json: { error: 'conversationId and text are required' } };
    }
    const owned = await db
      .collection(`guilds/${guildId}/stageLives`)
      .where('conversationId', '==', conversationId)
      .limit(1)
      .get();
    if (owned.empty) {
      return { status: 404, json: { error: 'unknown-conversation' } };
    }

    const conv = owned.docs[0].data() as LiveRecord;
    const apiKey = await resolveApiKey(db, guildKey, conv.avatarOwnerUserId, conv.billedToOwner === true);
    if (!apiKey) {
      return {
        status: 409,
        json: {
          error: 'no-masky-key',
          message: 'No Masky key for this avatar. Set one in Server Settings → AI Assistance.',
        },
      };
    }
    const posted = await postTurn({
      conversation: {
        conversationId,
        viewerToken: '',
        shareSlug: conv.shareSlug,
        liveUrl: conv.liveUrl,
      },
      apiKey,
      userText: text,
      mode: 'speak',
      output: 'video',
    });
    if (!posted) return { status: 502, json: { error: 'turn-failed', posted: false } };

    // Reveal lines don't hold the round. The board is already showing the words.
    if (body.wait === false) {
      return { status: 200, json: { posted: true, ready: false, turnId: posted.turnId } };
    }

    const ready = await waitForVideo(conversationId, posted.turnId);
    return { status: 200, json: { posted: true, ready, turnId: posted.turnId } };
  }

  return { status: 400, json: { error: 'unknown-op' } };
}
