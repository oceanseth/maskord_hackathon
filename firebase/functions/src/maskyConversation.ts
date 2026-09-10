import * as admin from 'firebase-admin';

// ─── masky.ai conversation integration ─────────────────────────────────────────
//
// Every voice channel with AI assistance on is backed by a masky.ai
// "conversation" (https://masky.ai/masky-api-skill.md). The avatar's replies are
// injected as chat-mode turns: masky's Gemini generates a reply in the avatar's
// personality AND renders it to the avatar's Hume voice. The rendered audio lands
// on a Firestore turn doc in the SAME project (maskydotnet), so we can poll it
// directly with the Admin SDK and hand back a durable, self-re-signing audio URL.

const MASKY_API_BASE = 'https://masky.ai/api';

const POLL_INTERVAL_MS = 900;
// Audio lands in seconds (this is the only thing we block on). Video renders
// take ~30–60s/chunk and are watched client-side via the liveTurns mirror.
const POLL_TIMEOUT_AUDIO_MS = 90_000;
// Rounds with no new chunk (and all settled) before we consider the reply done.
// Guards against exiting between one chunk finishing and the next being created.
const STABLE_ROUNDS    = 3;

/** Whether a chunk turn doc has finished rendering audio (the only stage we
 *  block on; video is watched client-side). */
function chunkSettled(d: admin.firestore.DocumentData): boolean {
  const status = (d.status as string) ?? 'pending';
  return status === 'audio' || status === 'video' || status === 'ready' || status === 'error';
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

async function safeText(res: FetchResponse): Promise<string> {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}

export interface ChannelConversation {
  conversationId: string;
  viewerToken:    string;
  shareSlug:      string;
  liveUrl:        string;
}

/**
 * Create a masky.ai conversation for an avatar. Each avatar present in a voice
 * channel gets its own conversation (its own voice + personality + history).
 * Returns null if creation fails (caller degrades to text-only).
 */
export async function createConversation(opts: {
  apiKey:            string;           // mky_… developer key (the conversation owner)
  avatarOwnerUserId: string;
  avatarId:          string;
}): Promise<ChannelConversation | null> {
  try {
    const res = await fetch(`${MASKY_API_BASE}/conversations`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        avatarOwnerUserId: opts.avatarOwnerUserId,
        avatarId:          opts.avatarId,
      }),
    });
    if (!res.ok) {
      console.warn('[masky] create conversation failed', res.status, await safeText(res));
      return null;
    }
    const data = await res.json() as {
      conversationId?: string; shareSlug?: string; viewerToken?: string; liveUrl?: string;
    };
    if (!data.conversationId || !data.viewerToken) {
      console.warn('[masky] create conversation: missing fields', data);
      return null;
    }
    return {
      conversationId: data.conversationId,
      viewerToken:    data.viewerToken,
      shareSlug:      data.shareSlug ?? '',
      liveUrl:        data.liveUrl  ?? '',
    };
  } catch (err) {
    console.warn('[masky] create conversation error', err);
    return null;
  }
}

export interface SpokenReply {
  text:      string;   // the avatar's full reply, concatenated across chunks
  audioUrls: string[]; // ordered durable live-media audio URLs, played back-to-back
}

/**
 * Inject a chat-mode turn and wait for it to fully render. masky runs Gemini
 * against the avatar's personality + conversation history, then TTS through the
 * avatar's Hume voice. Long replies are auto-chunked into MULTIPLE avatar turn
 * docs; we collect them all (in order) so the whole reply is heard.
 *
 * Audio lands on Firestore turn docs in the SAME project (maskydotnet), so we
 * poll them directly and return durable live-media URLs that re-sign server-side
 * on each request (no 1-hour expiry to manage).
 */
/**
 * POST a turn and return chunk-0's turn id WITHOUT waiting for it to render.
 * The masky API responds 202 immediately; media lands on the turn doc later.
 * Use this for the non-blocking video path (the client watches the mirror).
 */
export async function postTurn(opts: {
  conversation: ChannelConversation;
  apiKey:       string;
  userText:     string;
  mode?:        'chat' | 'speak';
  output?:      'audio' | 'video' | 'text';
}): Promise<{ turnId: string } | null> {
  try {
    const output = opts.output === 'video' ? 'video' : opts.output === 'text' ? 'text' : 'audio';
    const res = await fetch(
      `${MASKY_API_BASE}/conversations/${opts.conversation.conversationId}/turn`,
      {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userText: opts.userText,
          mode:     opts.mode ?? 'chat',
          output,
        }),
      },
    );
    if (!res.ok) {
      console.warn('[masky] turn failed', res.status, await safeText(res));
      return null;
    }
    const data = await res.json() as { turn?: { id?: string }; firestorePath?: string };
    const turnId = data.turn?.id
      ?? (data.firestorePath ? (data.firestorePath.split('/').pop() ?? null) : null);
    if (!turnId) {
      console.warn('[masky] turn: no turnId in response');
      return null;
    }
    return { turnId };
  } catch (err) {
    console.warn('[masky] turn error', err);
    return null;
  }
}

export async function generateAndVoiceReply(opts: {
  conversation: ChannelConversation;
  apiKey:       string;
  userText:     string;
  /** 'chat' (default): Gemini generates a reply in the avatar's personality.
   *  'speak': the avatar says `userText` verbatim (used for scripted lines). */
  mode?:        'chat' | 'speak';
  /** 'audio' (default) voices the reply; 'text' just generates the reply text
   *  (no TTS) — used for the cheap "should I even talk?" decision pass. Video is
   *  handled non-blocking elsewhere (postTurn + the liveTurns mirror). */
  output?:      'audio' | 'text';
}): Promise<SpokenReply | null> {
  const db = admin.firestore();
  const { conversation } = opts;

  const posted = await postTurn({ ...opts, output: opts.output === 'text' ? 'text' : 'audio' });
  if (!posted) return null;
  const turnId = posted.turnId;

  // chunk 0 is the returned turn; later chunks are sibling avatar turns created
  // by the worker with createdAt >= chunk 0. Find chunk 0's createdAt to anchor
  // the query, then collect the contiguous run of avatar turns from there.
  const turnsCol = db.collection(`conversations/${conversation.conversationId}/turns`);
  const chunk0Ref = turnsCol.doc(turnId);
  const startTs = (await chunk0Ref.get()).get('createdAt') as admin.firestore.Timestamp | undefined;

  interface Chunk { id: string; text: string; settled: boolean; hasAudio: boolean }

  const deadline = Date.now() + POLL_TIMEOUT_AUDIO_MS;
  let chunks: Chunk[] = [];
  let lastCount = -1;
  let stable = 0;

  while (Date.now() < deadline) {
    let q = turnsCol.orderBy('createdAt', 'asc');
    if (startTs) q = q.where('createdAt', '>=', startTs);
    const snap = await q.get();

    chunks = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.role !== 'avatar') {
        if (chunks.length > 0) break; // contiguous run ended (next user turn)
        continue;
      }
      chunks.push({
        id:       doc.id,
        text:     ((d.avatarText as string) ?? '').trim(),
        settled:  chunkSettled(d),
        hasAudio: !!d.audioStoragePath && d.status !== 'error',
      });
    }

    const allSettled = chunks.length > 0 && chunks.every((c) => c.settled);
    if (allSettled && chunks.length === lastCount) {
      if (++stable >= STABLE_ROUNDS) break;
    } else {
      stable = 0;
    }
    lastCount = chunks.length;
    await delay(POLL_INTERVAL_MS);
  }

  const mediaUrl = (id: string, kind: 'audio' | 'video') =>
    `${MASKY_API_BASE}/live-media/${conversation.viewerToken}/${id}/${kind}`;

  const text      = chunks.map((c) => c.text).filter(Boolean).join(' ').trim();
  const audioUrls = chunks.filter((c) => c.hasAudio).map((c) => mediaUrl(c.id, 'audio'));

  if (!text && audioUrls.length === 0) {
    console.warn('[masky] turn produced no media', { conversationId: conversation.conversationId, turnId });
    return null;
  }
  return { text, audioUrls };
}
