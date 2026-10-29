import { useEffect, useRef } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { useMutation } from 'convex/react';
import { api } from '@maskord/convex';
import { getFirebaseDb, useTranscript, type Guild, type TranscriptUtterance } from '@maskord/shared';

// ─── ElevenLabs lipsync renderer ("the server host machine") ───────────────────
//
// When the guild's lipsync provider is ElevenLabs, avatar video turns are
// stamped `maskyOutput: 'eleven-video'`: masky rendered the reply's AUDIO chunks
// only. This hook runs on every connected desktop client, but exactly ONE wins
// the Convex claim per turn — the guild owner's machine gets a head start, so
// in practice the video is produced on and distributed from the server host's
// box. The winner pulls each audio chunk from the public liveTurns mirror,
// lipsyncs it against the avatar's portrait through the guild's ElevenLabs key
// (Image & Video API, model `creatify-aurora`), uploads the mp4 to Convex
// storage, and publishes it on the turn's `elevenJobs` row. Playback is
// useTalkingHead's job, on every client.
//
// Losers keep retrying the claim on a slow cadence: if the winner crashes or
// sleeps, its claim goes stale and someone else takes over, seeded with the
// clip idxs already uploaded so nothing is rendered (billed) twice. A renderer
// aborts the moment `touch` says it no longer owns the job, for the same reason.
//
// Cross-origin calls go through the Electron main process (`proxy-fetch` IPC):
// the renderer keeps webSecurity on, and neither the ElevenLabs API nor its
// storage bucket is guaranteed to send CORS headers.

const ELEVEN_API = 'https://api.elevenlabs.io/v1/flows/video';
// Tile-sized clips: 480p renders faster and bills less than aurora's 720p default.
const RESOLUTION = '480p';

// Claim pecking order, by delay before the first try: the owner's desktop app
// claims instantly, other desktop apps after 10s, web (browser SPA) clients
// last — without the Electron proxy-fetch a web client may hit CORS walls on
// the ElevenLabs download, so it only renders when no desktop client is around.
const NON_OWNER_CLAIM_DELAY_MS = 10_000;
const WEB_CLIENT_CLAIM_DELAY_MS = 30_000;
// Losing claimants retry on this cadence (must exceed the server's stale-claim
// window divided by a few, so a dead winner is picked up within ~a minute of
// going stale).
const CLAIM_RETRY_MS = 60_000;
// Mirror poll cadence while waiting for masky's audio chunks.
const MIRROR_POLL_MS = 2_500;
// Consecutive stable polls (all chunks settled, none new) = the run is complete.
const STABLE_POLLS = 4;
// ElevenLabs generation poll cadence + ceiling (docs: >=10s for video).
const GEN_POLL_MS = 10_000;
const GEN_TIMEOUT_MS = 8 * 60_000;
// Give up on a whole turn (rendering or retrying the claim) this long after
// the utterance was created.
const TURN_LIFETIME_MS = 20 * 60_000;
// Only process turns created after the hook became active (small grace for
// clock skew / snapshot latency). Everything older is some other client's
// problem — or already claimed.
const SEED_GRACE_MS = 15_000;

interface ProxyResponse { status: number; contentType: string; bodyBase64: string }

type ProxyFetchFn = (req: {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  bodyBase64?: string;
}) => Promise<ProxyResponse>;

function proxyFetchFn(): ProxyFetchFn | null {
  const w = window as unknown as { electron?: { proxyFetch?: ProxyFetchFn } };
  return w.electron?.proxyFetch ?? null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Fetch through the main process when available (no CORS), else directly. */
async function fetchBytes(
  url: string,
  init?: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: Uint8Array },
): Promise<ProxyResponse> {
  const proxy = proxyFetchFn();
  if (proxy) {
    try {
      return await proxy({
        url,
        method: init?.method ?? 'GET',
        headers: init?.headers,
        bodyBase64: init?.body ? bytesToBase64(init.body) : undefined,
      });
    } catch {
      // Host not allowlisted (e.g. an unusual avatar image host) — try directly.
    }
  }
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: init?.headers,
    body: init?.body as BodyInit | undefined,
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    bodyBase64: bytesToBase64(buf),
  };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The API accepts exactly `audio/mpeg` | `audio/wav`; normalize whatever the
 *  audio host reported (e.g. `audio/mp3`, parameters, octet-stream). */
function audioMime(contentType: string): string {
  return /wav/i.test(contentType) ? 'audio/wav' : 'audio/mpeg';
}

/** The API accepts exactly image/jpeg|png|webp|heic. Trust a matching header,
 *  else sniff the magic bytes, else assume JPEG. */
function imageMime(contentType: string, b64: string): string {
  const m = /image\/(jpeg|png|webp|heic|heif)/i.exec(contentType);
  if (m) return `image/${m[1].toLowerCase()}`;
  const head = base64ToBytes(b64.slice(0, 24));
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) return 'image/webp';
  return 'image/jpeg';
}

interface MirrorChunk { id: string; status: string; text: string }

/** Chunk statuses that mean the audio has finished rendering. */
const settled = (s: string) => s === 'audio' || s === 'video' || s === 'ready' || s === 'error';

export function useElevenRenderer(opts: {
  guildId: string | null;
  channelId: string | null;
  guild: Guild | null;
  uid: string | null;
  active: boolean;
}) {
  const { guildId, channelId, guild, uid, active } = opts;
  const enabled = active && !!guildId && !!channelId
    && guild?.lipsyncProvider === 'elevenlabs' && !!guild?.elevenLabsApiKey;

  const { utterances } = useTranscript(enabled ? guildId : null, enabled ? channelId : null, 40);

  const claim    = useMutation(api.elevenLipsync.claim);
  const touch    = useMutation(api.elevenLipsync.touch);
  const addClip  = useMutation(api.elevenLipsync.addClip);
  const finish   = useMutation(api.elevenLipsync.finish);
  const genUploadUrl = useMutation(api.messages.generateUploadUrl);

  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const handledRef   = useRef<Set<string>>(new Set());
  const enabledAtRef = useRef<number | null>(null);
  const mountedRef   = useRef(true);
  const apiKeyRef    = useRef<string>('');
  apiKeyRef.current = guild?.elevenLabsApiKey ?? '';

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Only turns created after this client became an eligible renderer count:
  // re-rendering history after a restart would bill ElevenLabs for turns
  // nobody is waiting on. (The claims table guards double renders regardless.)
  useEffect(() => {
    if (enabled && enabledAtRef.current === null) enabledAtRef.current = Date.now();
    if (!enabled) enabledAtRef.current = null;
  }, [enabled]);

  useEffect(() => {
    if (!enabled || enabledAtRef.current === null) return;
    for (const u of utterances) {
      if (u.source !== 'agent-reply' || u.maskyOutput !== 'eleven-video') continue;
      if (!u.maskyViewerToken || !u.maskyAnchorTurnId || !u.createdAt) continue;
      if (handledRef.current.has(u.id)) continue;
      if (u.createdAt.toMillis() < enabledAtRef.current - SEED_GRACE_MS) {
        handledRef.current.add(u.id);
        continue;
      }
      handledRef.current.add(u.id);
      void runJob(u);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utterances, enabled]);

  /** Claim one turn (retrying while someone else holds it) and render it. */
  async function runJob(u: TranscriptUtterance) {
    if (!guildId || !channelId || !u.createdAt) return;
    const key = `${guildId}:${channelId}:${u.id}`;
    const sessionId = sessionIdRef.current;
    const turnDeadline = u.createdAt.toMillis() + TURN_LIFETIME_MS;

    // Pecking order: owner's desktop instantly, desktop 10s, web 30s.
    if (!proxyFetchFn()) await delay(WEB_CLIENT_CLAIM_DELAY_MS);
    else if (uid !== guild?.ownerId) await delay(NON_OWNER_CLAIM_DELAY_MS);

    // Keep (re)trying the claim until we win it, the job is finished by its
    // owner, or the turn expires. This is what rescues a crashed renderer.
    let clipIdxsDone: number[] = [];
    for (;;) {
      if (!mountedRef.current || Date.now() > turnDeadline) return;
      let res: { claimed: boolean; done: boolean; clipIdxs: number[] };
      try { res = await claim({ key, sessionId }); } catch { return; }
      if (res.done) return;
      if (res.claimed) { clipIdxsDone = res.clipIdxs; break; }
      await delay(CLAIM_RETRY_MS);
    }

    console.log('[eleven-lipsync] claimed render job', key);
    const token    = u.maskyViewerToken as string;
    const anchorId = u.maskyAnchorTurnId as string;
    const imageUrl = u.botAvatarUrl || '';

    const db = getFirebaseDb();
    const mirrorQ = query(collection(db, 'liveTurns', token, 'turns'), orderBy('createdAt', 'asc'));

    // Fetch the avatar portrait once; without one we can't lipsync at all.
    let image: { b64: string; mime: string } | null = null;
    if (imageUrl) {
      try {
        const res = await fetchBytes(imageUrl);
        if (res.status === 200) image = { b64: res.bodyBase64, mime: imageMime(res.contentType, res.bodyBase64) };
      } catch { /* handled below */ }
    }
    if (!image) {
      console.warn('[eleven-lipsync] no avatar portrait — abandoning', key);
      try { await finish({ key, sessionId, total: 0 }); } catch { /* ignore */ }
      return;
    }

    // idx → attempted; seeded with clips a previous (dead) renderer uploaded.
    const attempted = new Set<number>(clipIdxsDone);
    let stable = 0;
    let prevSettledCount = -1;

    while (mountedRef.current && Date.now() < turnDeadline) {
      // Read the contiguous run of avatar chunks starting at the anchor.
      let chunks: MirrorChunk[] = [];
      try {
        const snap = await getDocs(mirrorQ);
        const docs = snap.docs;
        const anchorIdx = docs.findIndex((d) => d.id === anchorId);
        if (anchorIdx >= 0) {
          for (let i = anchorIdx; i < docs.length; i++) {
            const d = docs[i].data();
            if (d.role !== 'avatar') break;
            chunks.push({ id: docs[i].id, status: (d.status as string) ?? 'pending', text: ((d.avatarText as string) ?? '').trim() });
          }
        }
      } catch { chunks = []; }

      // Render every settled-but-unrendered chunk, in order.
      for (let idx = 0; idx < chunks.length; idx++) {
        const c = chunks[idx];
        if (attempted.has(idx) || !settled(c.status)) continue;
        attempted.add(idx);
        if (c.status === 'error') continue; // masky failed this chunk — skip it
        try {
          await renderChunk({ key, sessionId, idx, chunk: c, token, image });
        } catch (err) {
          console.warn('[eleven-lipsync] chunk render failed', key, idx, err);
        }
        if (!mountedRef.current || Date.now() >= turnDeadline) break;
      }

      // Done when the run is non-empty, fully settled, and stable across polls.
      const settledCount = chunks.filter((c) => settled(c.status)).length;
      if (chunks.length > 0 && settledCount === chunks.length && attempted.size >= chunks.length) {
        stable = settledCount === prevSettledCount ? stable + 1 : 1;
        if (stable >= STABLE_POLLS) {
          try { await finish({ key, sessionId, total: chunks.length }); } catch { /* ignore */ }
          console.log('[eleven-lipsync] job complete', key, chunks.length, 'chunks');
          return;
        }
      } else {
        stable = 0;
      }
      prevSettledCount = settledCount;

      // Heartbeat doubles as an ownership check: if someone took the job over
      // (we were stale), stop immediately rather than render — and bill — twice.
      try { if (!(await touch({ key, sessionId }))) return; } catch { /* ignore */ }
      await delay(MIRROR_POLL_MS);
    }
    // Unmounting abandons the claim WITHOUT finishing: the heartbeat stops, the
    // claim goes stale, and a surviving client takes the job over. Only a turn
    // that outlived its whole lifetime is closed out with what it has.
    if (!mountedRef.current) return;
    try { await finish({ key, sessionId, total: attempted.size }); } catch { /* ignore */ }
  }

  /** One chunk: masky audio → creatify-aurora lipsync → Convex storage → clip row. */
  async function renderChunk(args: {
    key: string; sessionId: string; idx: number; chunk: MirrorChunk;
    token: string; image: { b64: string; mime: string };
  }) {
    const { key, sessionId, idx, chunk, token, image } = args;
    const apiKey = apiKeyRef.current;
    if (!apiKey) throw new Error('ElevenLabs key disappeared');

    // 1. The chunk's rendered audio (durable, self-re-signing masky URL).
    const audioRes = await fetchBytes(`https://masky.ai/api/live-media/${token}/${chunk.id}/audio`);
    if (audioRes.status !== 200) throw new Error(`audio fetch ${audioRes.status}`);

    // 2. Submit the lipsync generation.
    const body = new TextEncoder().encode(JSON.stringify({
      model_id: 'creatify-aurora',
      resolution: RESOLUTION,
      audio: { type: 'inline_base64', content_base64: audioRes.bodyBase64, mime_type: audioMime(audioRes.contentType) },
      image: { type: 'inline_base64', content_base64: image.b64, mime_type: image.mime },
    }));
    const createRes = await fetchBytes(ELEVEN_API, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body,
    });
    const createJson = JSON.parse(new TextDecoder().decode(base64ToBytes(createRes.bodyBase64))) as {
      id?: string; status?: string; detail?: unknown;
    };
    if (createRes.status >= 300 || !createJson.id) {
      throw new Error(`eleven create ${createRes.status}: ${JSON.stringify(createJson).slice(0, 300)}`);
    }

    // 3. Poll until the generation is terminal (docs: no faster than 10s).
    const genDeadline = Date.now() + GEN_TIMEOUT_MS;
    let contentUrl: string | null = null;
    while (mountedRef.current && Date.now() < genDeadline) {
      await delay(GEN_POLL_MS);
      // Heartbeat + ownership check — abort if the claim was taken over.
      try { if (!(await touch({ key, sessionId }))) throw new Error('claim lost'); } catch (e) {
        if (e instanceof Error && e.message === 'claim lost') throw e;
      }
      const pollRes = await fetchBytes(`${ELEVEN_API}/${createJson.id}`, {
        headers: { 'xi-api-key': apiKey },
      });
      const poll = JSON.parse(new TextDecoder().decode(base64ToBytes(pollRes.bodyBase64))) as {
        status?: string; content_url?: string; failure_reason?: string; error_message?: string;
      };
      if (poll.status === 'completed' && poll.content_url) { contentUrl = poll.content_url; break; }
      if (poll.status === 'failed') {
        throw new Error(`eleven render failed: ${poll.failure_reason ?? ''} ${poll.error_message ?? ''}`);
      }
    }
    if (!contentUrl) throw new Error('eleven render timed out');

    // 4. Download the mp4 and publish it through Convex storage.
    const videoRes = await fetchBytes(contentUrl);
    if (videoRes.status !== 200) throw new Error(`video download ${videoRes.status}`);
    const bytes = base64ToBytes(videoRes.bodyBase64);
    const uploadUrl = await genUploadUrl({});
    const up = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'video/mp4' },
      body: new Blob([bytes.buffer as ArrayBuffer], { type: 'video/mp4' }),
    });
    if (!up.ok) throw new Error(`convex upload ${up.status}`);
    const { storageId } = (await up.json()) as { storageId: string };
    await addClip({ key, sessionId, idx, storageId: storageId as never, text: chunk.text || undefined });
    console.log('[eleven-lipsync] clip ready', key, idx);
  }
}
