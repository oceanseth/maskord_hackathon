import * as admin from 'firebase-admin';
import { createConversation, postTurn } from './maskyConversation';

/**
 * Stage faces on masky.ai /live.
 *
 * Each seated mask (and the host) gets one conversation. Silent waiting clips
 * keep the face moving between lines; a speak turn is what the live page plays
 * when it is that mask's line. The guild's mky_ key never leaves this function.
 *
 * Defaults match app/shared/src/constants/claudeAvatar.ts — the shared Masky
 * a server uses until its owner picks one.
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

function docId(ownerUid: string, avatarId: string): string {
  return `${ownerUid}__${avatarId}`.replace(/\//g, '_');
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
  const apiKey = data.maskyApiKey as string | undefined;
  if (!apiKey) {
    return {
      status: 409,
      json: {
        error: 'no-masky-key',
        message: 'This server has no Masky key. Set one in Server Settings → AI Assistance.',
      },
    };
  }

  if (body.op === 'stage-ensure') {
    const avatarId = (body.avatarId || (data.claudeAvatarId as string) || DEFAULT_HOST.avatarId).trim();
    const avatarOwnerUserId = (
      body.avatarOwnerUserId ||
      (data.claudeAvatarOwnerUid as string) ||
      DEFAULT_HOST.ownerUid
    ).trim();
    if (!avatarId || !avatarOwnerUserId) {
      return { status: 400, json: { error: 'avatar-required' } };
    }

    const ref = db.doc(`guilds/${guildId}/stageLives/${docId(avatarOwnerUserId, avatarId)}`);
    const existing = await ref.get();
    if (existing.exists) {
      const cached = existing.data() as LiveRecord;
      if (!cached.silent && cached.conversationId) {
        const silent = await enableSilent(apiKey, cached.conversationId);
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
