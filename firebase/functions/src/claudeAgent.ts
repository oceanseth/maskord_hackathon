import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import Anthropic from '@anthropic-ai/sdk';
import { createConversation, generateAndVoiceReply, postTurn } from './maskyConversation';
import {
  type ChannelAvatar,
  loadActiveAvatars, addActiveAvatar, removeActiveAvatar,
  splitWords, textMatchesAny, parseInviteName,
} from './channelAvatars';
import { forwardRoomEventToAgents, verifyCallbackToken } from './agentbox';

const db = admin.firestore();

// ─── Config ───────────────────────────────────────────────────────────────────

const MODEL          = 'claude-opus-4-7';
const MAX_HISTORY    = 20;     // most recent N messages used as conversation context
const MAX_TOKENS     = 1024;   // cap on each turn's response
const STREAM_FLUSH_MS = 400;   // throttle Firestore writes during streaming

// ─── Types ────────────────────────────────────────────────────────────────────

interface GuildClaudeCfg {
  enabled:        boolean;
  apiKey?:        string;
  /** masky.ai developer key (mky_…). Owns the per-channel conversation and
   *  drives chat-mode voice replies in voice channels. */
  maskyApiKey?:   string;
  avatarOwnerUid?: string;
  avatarId?:       string;
}

interface ChannelClaudeCfg {
  mode:      'off' | 'mention' | 'all';
  mediaMode: 'audio' | 'video';
}

interface AvatarMeta {
  avatarId?:         string;
  displayName:       string;
  personalityPrompt?: string;
  thumbnailUrl?:     string;
  humeVoiceId?:      string;
  /** Comma-separated wake-word alternatives configured on the avatar in masky.
   *  When set, one of these must be spoken before the avatar responds in a
   *  voice channel (in `mention` mode). Falls back to the display name. */
  wakeWord?:         string;
  /** Comma-separated goodbye-word alternatives. Speaking one dismisses the
   *  avatar from the voice channel. */
  goodbyeWord?:      string;
  /** When set, this avatar is backed by a live GMI agentbox VM. maskord forwards
   *  every channel action to its `/invoke` and the agent calls back to speak. */
  agentbox?:         { invokeUrl: string; healthUrl?: string; authToken?: string };
}

function botUidFor(guildId: string): string {
  return `bot:${guildId}`;
}

/** Per-avatar synthetic uid so multiple avatars in one channel stay distinct. */
function botUidForAvatar(guildId: string, avatarId: string): string {
  return `bot:${guildId}:${avatarId}`;
}

// ─── Loaders ──────────────────────────────────────────────────────────────────

async function loadGuildCfg(guildId: string): Promise<GuildClaudeCfg | null> {
  const snap = await db.doc(`guilds/${guildId}`).get();
  const d = snap.data();
  if (!d) return null;
  return {
    enabled:        d.claudeEnabled === true,
    apiKey:         d.claudeApiKey,
    maskyApiKey:    d.maskyApiKey,
    avatarOwnerUid: d.claudeAvatarOwnerUid,
    avatarId:       d.claudeAvatarId,
  };
}

async function loadChannelCfg(guildId: string, channelId: string): Promise<ChannelClaudeCfg> {
  const snap = await db.doc(`guilds/${guildId}/channels/${channelId}`).get();
  const d = snap.data() ?? {};
  return {
    mode:      (d.claudeMode ?? 'off') as ChannelClaudeCfg['mode'],
    mediaMode: (d.claudeMediaMode ?? 'audio') as ChannelClaudeCfg['mediaMode'],
  };
}

function avatarMetaFromDoc(avatarId: string, d: admin.firestore.DocumentData): AvatarMeta {
  const gb = d.gmiAgentbox;
  return {
    avatarId,
    displayName:       (d.displayName as string) ?? 'Masky',
    personalityPrompt: d.personalityPrompt as string | undefined,
    thumbnailUrl:      (d.cachedAvatarUrl ?? d.avatarUrl) as string | undefined,
    humeVoiceId:       d.humeVoiceId as string | undefined,
    wakeWord:          d.wakeWord as string | undefined,
    goodbyeWord:       d.goodbyeWord as string | undefined,
    agentbox:          gb && typeof gb.invokeUrl === 'string'
      ? { invokeUrl: gb.invokeUrl, healthUrl: gb.healthUrl, authToken: gb.authToken }
      : undefined,
  };
}

async function loadAvatar(ownerUid: string, avatarId: string): Promise<AvatarMeta | null> {
  const snap = await db.doc(`users/${ownerUid}/avatarGroups/${avatarId}`).get();
  const d = snap.data();
  if (!d) return null;
  return avatarMetaFromDoc(avatarId, d);
}

/**
 * Get the user's own masky `mky_` key, generating one named "maskord" on the fly
 * if they don't have one yet. This lets ANY speaker invite their OWN avatars
 * (voiced/billed on their own account), independent of the guild's key.
 *
 * Raw keys live in the server-only `maskordUserKeys/{uid}` doc (NOT on the
 * public `users/{uid}` profile). The key itself is registered the same way
 * masky.ai/developer does: `apiKeys/{sha256(key)} = { ownerUid, name, … }`.
 */
async function ensureUserMaskyKey(uid: string): Promise<string | null> {
  try {
    const ref = db.doc(`maskordUserKeys/${uid}`);
    const existing = (await ref.get()).data()?.apiKey;
    if (typeof existing === 'string' && existing.startsWith('mky_')) return existing;

    const raw  = 'mky_' + crypto.randomBytes(24).toString('hex');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    await db.doc(`apiKeys/${hash}`).set({
      ownerUid:   uid,
      name:       'maskord',
      createdAt:  admin.firestore.FieldValue.serverTimestamp(),
      lastUsedAt: null,
      revokedAt:  null,
    });
    await ref.set({
      apiKey:    raw,
      name:      'maskord',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return raw;
  } catch (err) {
    console.warn('[masky] ensureUserMaskyKey failed', uid, err);
    return null;
  }
}

/** The masky key that voices a given channel avatar: the guild key for the
 *  primary Masky; the inviter's own key for invited avatars. */
async function keyForAvatar(avatar: ChannelAvatar, guildKey: string): Promise<string> {
  if (avatar.isPrimary) return guildKey;
  return (await ensureUserMaskyKey(avatar.invitedBy)) ?? guildKey;
}

/**
 * Resolve a spoken name (e.g. "gary" → "Gary Grube") to an avatar, searching the
 * given owners' avatar lists in order and matching display name or any wake-word
 * alternative. Returns the avatar plus the owner it was found under (so its
 * conversation is created against the right account). Skips already-present ones.
 */
async function resolveAvatarByName(
  ownerUids: string[], name: string, exclude: Set<string>,
): Promise<{ ownerUid: string; meta: AvatarMeta } | null> {
  const lc = name.toLowerCase();
  for (const ownerUid of ownerUids) {
    const snap = await db.collection(`users/${ownerUid}/avatarGroups`).get();
    for (const doc of snap.docs) {
      if (exclude.has(doc.id)) continue;
      const meta = avatarMetaFromDoc(doc.id, doc.data());
      const dn = meta.displayName.toLowerCase();
      const nameHit = dn === lc || dn.startsWith(lc) || dn.split(/\s+/).includes(lc);
      const wakeHit = splitWords(meta.wakeWord).some((w) => w === lc || w.startsWith(lc));
      if (nameHit || wakeHit) return { ownerUid, meta };
    }
  }
  return null;
}

/**
 * Ensure a synthetic bot user doc exists so profile lookups (`useUserProfiles`)
 * render the avatar with the right name + image.
 */
async function upsertBotUser(
  uid: string, avatar: { displayName: string; thumbnailUrl?: string }, guildId: string,
): Promise<string> {
  await db.doc(`users/${uid}`).set({
    displayName:    avatar.displayName,
    avatarUrl:      avatar.thumbnailUrl ?? '',
    isBot:          true,
    guildId,
    updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return uid;
}

// ─── Mention parsing ──────────────────────────────────────────────────────────

function messageMentionsAvatar(text: string, avatarName: string): boolean {
  if (!text || !avatarName) return false;
  // Match `@Name` as a whole word, case-insensitive. Avatar names can contain
  // whitespace ("Mr 305") — treat any sequence of [A-Za-z0-9_-] after @ as a token.
  const norm = avatarName.replace(/\s+/g, '').toLowerCase();
  const re   = /@([A-Za-z0-9_-]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1].toLowerCase() === norm) return true;
  }
  return false;
}

/**
 * The wake words that activate an avatar in a voice channel: its configured
 * `wakeWord` alternatives, falling back to its display name. Works for both a
 * loaded AvatarMeta and an active ChannelAvatar.
 */
function wakeWordsFor(avatar: { wakeWord?: string; displayName: string }): string[] {
  // Always recognize the display name, plus any configured wake-word alternatives
  // (e.g. wakeWord "hey Masky" still also responds to plain "Masky").
  return [...new Set([avatar.displayName.toLowerCase(), ...splitWords(avatar.wakeWord)].filter(Boolean))];
}

/** True if the spoken text addresses the avatar by a wake word. */
function utteranceAddressesAvatar(text: string, avatar: { wakeWord?: string; displayName: string }): boolean {
  return textMatchesAny(text, wakeWordsFor(avatar));
}

/** Common spoken farewells. */
const FAREWELL_RE = /\b(goodbye|good bye|bye(?:\s*bye)?|farewell|dismiss|see\s+(?:you|ya)|sign\s+off|head\s+out|take\s+off|you\s+can\s+(?:go|leave))\b/i;

/**
 * True if the utterance dismisses this avatar from the channel.
 *  - If the avatar has a configured `goodbyeWord`: leave when it matches, or
 *    when a farewell is paired with the avatar's name/wake word.
 *  - If the avatar has NO goodbye word: any farewell ("goodbye", "bye", …)
 *    anywhere in the utterance dismisses it.
 */
function utteranceDismissesAvatar(text: string, avatar: { goodbyeWord?: string; wakeWord?: string; displayName: string }): boolean {
  const configured = splitWords(avatar.goodbyeWord);
  if (configured.length) {
    if (textMatchesAny(text, configured)) return true;
    return FAREWELL_RE.test(text) && textMatchesAny(text, wakeWordsFor(avatar));
  }
  return FAREWELL_RE.test(text);
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

interface TurnSource {
  authorId: string;
  authorName?: string;
  content: string;
  attachments?: AttachmentRef[];
}

/** A file shared into the channel. Bytes live in Convex; this is the pointer. */
interface AttachmentRef {
  url:         string;
  filename:    string;
  size:        number;
  contentType: string;
}

// ─── Attachments ──────────────────────────────────────────────────────────────
//
// Files are NOT pushed into the model on arrival — that would re-send every
// image in the history window on every turn. Instead the prompt lists what is
// available and the model pulls a file with the read_attachment tool only when
// someone actually asks it to do something with one.

/** Refuse to inline anything larger than this; base64 costs ~4/3 of the bytes. */
const MAX_ATTACHMENT_FETCH_BYTES = 5 * 1024 * 1024;
/** Cap on how much of a text file is inlined. */
const MAX_TEXT_ATTACHMENT_CHARS = 20_000;
/** Guard against a model looping on tool calls. */
const MAX_TOOL_ROUNDS = 3;

/** The only image types this SDK version can carry in a content block. */
const VISION_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type VisionMediaType = (typeof VISION_MEDIA_TYPES)[number];

function isVisionMediaType(t: string): t is VisionMediaType {
  return (VISION_MEDIA_TYPES as readonly string[]).includes(t);
}

function isTextualType(t: string): boolean {
  return t.startsWith('text/')
    || t === 'application/json'
    || t === 'application/xml'
    || t === 'application/csv';
}

// ─── Live voice presence + frame capture ──────────────────────────────────────
//
// Screen and camera shares are peer-to-peer; this function is not a peer and
// never sees the media. So capturing a frame is a round trip: the model asks,
// the sharer's browser grabs a frame, uploads it to Convex, and writes the URL
// back. Both legs travel through the sharer's own RTDB voice-state node, which
// they are already allowed to write — no rules change.

const CAPTURE_TIMEOUT_MS = 12_000;
const CAPTURE_POLL_MS    = 500;

interface VoicePresence {
  channelId: string;
  userId:    string;
  name:      string;
  sharing:   'screen' | 'camera' | null;
  muted:     boolean;
}

/** Everyone currently sitting in a voice channel in this guild. */
async function loadVoicePresence(guildId: string): Promise<VoicePresence[]> {
  try {
    const snap = await admin.database().ref(`voiceState/${guildId}`).get();
    const byChannel = (snap.val() ?? {}) as Record<string, Record<string, {
      muted?: boolean; maskName?: string; sharing?: 'screen' | 'camera' | null;
    }>>;

    const out: VoicePresence[] = [];
    for (const [channelId, users] of Object.entries(byChannel)) {
      for (const [userId, state] of Object.entries(users ?? {})) {
        out.push({
          channelId,
          userId,
          name:    state.maskName ?? await authorNameFor(userId),
          sharing: state.sharing ?? null,
          muted:   state.muted === true,
        });
      }
    }
    return out;
  } catch (err) {
    console.warn('[claudeAgent] voice presence read failed', err);
    return [];
  }
}

const CAPTURE_STREAM_TOOL: Anthropic.Tool = {
  name: 'capture_stream',
  description:
    'Take a still frame from someone who is currently sharing their screen or camera '
    + 'in a voice channel, and look at it. Use it when the conversation is about what '
    + 'is on their screen or in front of their camera. Only works for people listed as '
    + 'sharing; it asks their browser for a frame, which takes a few seconds.',
  input_schema: {
    type: 'object',
    properties: {
      userId: { type: 'string', description: 'The id of the person sharing, from the voice presence list.' },
    },
    required: ['userId'],
  },
};

/**
 * Ask a sharer's browser for a frame and wait for it. Returns tool_result
 * content either way — a timeout is reported to the model as text so it can say
 * so rather than invent what it did not see.
 */
async function captureStream(
  guildId: string,
  presence: VoicePresence[],
  userId: string,
): Promise<{ content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>; isError: boolean }> {
  const target = presence.find((p) => p.userId === userId && p.sharing);
  if (!target) {
    return {
      content: [{ type: 'text', text: 'That person is not sharing a screen or camera right now.' }],
      isError: true,
    };
  }

  const node = admin.database().ref(`voiceState/${guildId}/${target.channelId}/${userId}`);
  const requestId = crypto.randomUUID();

  try {
    await node.child('captureRequest').set({ id: requestId, at: Date.now() });
  } catch (err) {
    console.error('[claudeAgent] capture request write failed', err);
    return { content: [{ type: 'text', text: 'Could not ask for a frame.' }], isError: true };
  }

  interface CaptureResult {
    id?: string; url?: string; contentType?: string; error?: string;
  }

  const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
  let result: CaptureResult | null = null;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, CAPTURE_POLL_MS));
    const snap = await node.child('captureResult').get().catch(() => null);
    const val = snap?.val() as CaptureResult | null;
    if (val && val.id === requestId) { result = val; break; }
  }

  await node.child('captureRequest').remove().catch(() => {});

  if (!result) {
    return {
      content: [{
        type: 'text',
        text: `${target.name}'s browser did not send a frame in time. Say you could not get a look rather than guessing.`,
      }],
      isError: true,
    };
  }
  if (result.error || !result.url) {
    return {
      content: [{ type: 'text', text: `Could not capture that stream: ${result.error ?? 'no image returned'}.` }],
      isError: true,
    };
  }

  const media = result.contentType ?? 'image/jpeg';
  if (!isVisionMediaType(media)) {
    return { content: [{ type: 'text', text: `Unexpected frame format ${media}.` }], isError: true };
  }

  try {
    const res = await fetch(result.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      content: [{
        type: 'image',
        source: { type: 'base64', media_type: media, data: buf.toString('base64') },
      }],
      isError: false,
    };
  } catch (err) {
    console.error('[claudeAgent] frame download failed', err);
    return { content: [{ type: 'text', text: 'The frame could not be downloaded.' }], isError: true };
  }
}

const READ_ATTACHMENT_TOOL: Anthropic.Tool = {
  name: 'read_attachment',
  description:
    'Read a file that was shared in this channel. Use it only when the conversation '
    + 'actually requires the contents — describing, summarising, analysing or answering '
    + 'a question about the file. Images come back as pictures you can see; text files '
    + 'come back as text. Do not call it just because a file was mentioned.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The attachment id from the file list, e.g. att_1.' },
    },
    required: ['id'],
  },
};

/** Human-readable size, for the manifest. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Index every attachment in the history window as att_1, att_2, … */
function indexAttachments(history: TurnSource[]): Map<string, AttachmentRef> {
  const map = new Map<string, AttachmentRef>();
  let n = 0;
  for (const h of history) {
    for (const a of h.attachments ?? []) {
      n += 1;
      map.set(`att_${n}`, a);
    }
  }
  return map;
}

/** Fetch one attachment and turn it into tool_result content. */
async function readAttachment(
  ref: AttachmentRef | undefined,
): Promise<{ content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>; isError: boolean }> {
  if (!ref) {
    return { content: [{ type: 'text', text: 'No attachment with that id.' }], isError: true };
  }
  if (ref.size > MAX_ATTACHMENT_FETCH_BYTES) {
    return {
      content: [{ type: 'text', text: `${ref.filename} is ${humanSize(ref.size)}, too large to read.` }],
      isError: true,
    };
  }

  let buf: Buffer;
  try {
    const res = await fetch(ref.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error('[claudeAgent] attachment fetch failed', ref.filename, err);
    return {
      content: [{ type: 'text', text: `Could not download ${ref.filename}.` }],
      isError: true,
    };
  }

  if (isVisionMediaType(ref.contentType)) {
    return {
      content: [{
        type: 'image',
        source: { type: 'base64', media_type: ref.contentType, data: buf.toString('base64') },
      }],
      isError: false,
    };
  }

  if (isTextualType(ref.contentType)) {
    const text = buf.toString('utf8').slice(0, MAX_TEXT_ATTACHMENT_CHARS);
    return {
      content: [{ type: 'text', text: `Contents of ${ref.filename}:\n\n${text}` }],
      isError: false,
    };
  }

  return {
    content: [{
      type: 'text',
      text: `${ref.filename} is ${ref.contentType}, which cannot be read directly. `
        + 'Say so rather than guessing at its contents.',
    }],
    isError: true,
  };
}

function buildSystemPrompt(
  avatar: AvatarMeta,
  mode: ChannelClaudeCfg['mode'],
  guildName: string,
  attachments: Map<string, AttachmentRef> = new Map(),
  presence: VoicePresence[] = [],
): string {
  const tone = avatar.personalityPrompt?.trim()
    ? `\n\nPersonality:\n${avatar.personalityPrompt.trim()}`
    : '';

  const files = attachments.size === 0 ? '' : `

Files shared in this channel:
${[...attachments.entries()]
  .map(([id, a]) => `- ${id}: ${a.filename} (${a.contentType}, ${humanSize(a.size)})`)
  .join('\n')}

You cannot see their contents until you ask for them. Call read_attachment with the id when the conversation needs what is inside a file — someone asks you to describe, summarise, check or use it. Do not call it merely because a file was posted; acknowledging an upload by name is fine on its own. Never describe a file you have not read.`;

  const sharers = presence.filter((p) => p.sharing);
  const voice = presence.length === 0 ? '' : `

In voice right now:
${presence
  .map((p) => {
    const bits = [p.muted ? 'muted' : 'unmuted'];
    if (p.sharing) bits.push(`sharing their ${p.sharing}`);
    return `- ${p.name} (${p.userId}) — ${bits.join(', ')}`;
  })
  .join('\n')}${sharers.length === 0 ? '' : `

Call capture_stream with someone's id to take a still frame of what they are sharing and look at it. It asks their browser for a frame and takes a few seconds, so only do it when the conversation is actually about what is on their screen or camera. If it fails, say you could not get a look — never guess at what is on someone's screen.`}`;
  const triggerNote = mode === 'mention'
    ? `Only respond if the latest message is directed at you (e.g. @${avatar.displayName}, addresses you by name, or clearly asks for your help). If it isn't, reply with exactly the single token NO_REPLY and nothing else.`
    : `Respond to the latest message in the channel. Stay terse unless a longer answer is required.`;
  return `You are ${avatar.displayName}, an AI member of a Maskord (chat-and-voice) server called "${guildName}".

Multiple humans share this channel. Address them by name when replying. Keep responses short and conversational unless the user asks for depth. Format using GitHub-flavored markdown.

${triggerNote}${files}${voice}${tone}`;
}

function buildMessagesArray(history: TurnSource[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  // Group consecutive messages by author into single turns. Claude expects
  // alternating user/assistant roles; we collapse human turns into one "user"
  // block per contiguous run.
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  // Attachment ids must line up with indexAttachments(), which walks the same
  // history in the same order.
  let attachmentNo = 0;
  for (const h of history) {
    const isBot = h.authorId.startsWith('bot:');
    const role  = isBot ? 'assistant' : 'user';
    // Name any files on this turn so the model knows which id to ask for. The
    // bytes are not sent — read_attachment fetches them on demand.
    const files = (h.attachments ?? [])
      .map((a) => {
        attachmentNo += 1;
        return ` [attachment att_${attachmentNo}: ${a.filename}, ${a.contentType}, ${humanSize(a.size)}]`;
      })
      .join('');
    const text  = isBot
      ? `${h.content}${files}`
      : `${h.authorName ?? 'unknown'}: ${h.content}${files}`;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content += `\n${text}`;
    } else {
      out.push({ role, content: text });
    }
  }
  // Anthropic requires the first message to be `user`. Drop any leading assistant.
  while (out.length > 0 && out[0].role === 'assistant') out.shift();
  return out;
}

/** Recent voice-channel transcript, shaped like text-channel history. */
async function loadTranscriptHistory(guildId: string, channelId: string): Promise<TurnSource[]> {
  const snap = await db.collection(`guilds/${guildId}/channels/${channelId}/transcript`)
    .orderBy('createdAt', 'desc').limit(MAX_HISTORY).get()
    .catch(() => null);
  if (!snap) return [];

  const docs = snap.docs.reverse();
  const names = new Map<string, string>();
  for (const d of docs) {
    const uid = d.data().userId as string;
    if (uid && !uid.startsWith('bot:') && !names.has(uid)) names.set(uid, await authorNameFor(uid));
  }

  return docs.map((d) => {
    const data = d.data();
    const authorId = (data.userId as string) ?? '';
    return {
      authorId,
      authorName: (data.maskName as string) ?? names.get(authorId) ?? authorId.slice(0, 8),
      content:    (data.text as string) ?? '',
      attachments: (data.attachments as AttachmentRef[] | undefined) ?? undefined,
    };
  }).filter((t) => t.content.trim().length > 0);
}

async function authorNameFor(uid: string): Promise<string> {
  const snap = await db.doc(`users/${uid}`).get();
  const d = snap.data();
  return (d?.displayName ?? d?.twitchUsername ?? uid.slice(0, 8)) as string;
}

// ─── Anthropic call + Firestore streaming ─────────────────────────────────────

async function runTurn(opts: {
  apiKey:      string;
  systemPrompt: string;
  messages:    Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Omit to generate without streaming anywhere — the voice path hands the
   *  finished text to masky to speak, so there is nothing to stream into. */
  destRef?:    admin.firestore.DocumentReference;
  destField?:  'content' | 'text';
  /** Files the model may pull with read_attachment. Omit to disable the tool. */
  attachments?: Map<string, AttachmentRef>;
  /** Guild whose voice presence capture_stream may reach into. */
  guildId?: string;
  /** Who is in voice, so capture_stream can find the sharer's channel. */
  presence?: VoicePresence[];
}): Promise<{ skipped: boolean; finalText: string }> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const attachments = opts.attachments ?? new Map<string, AttachmentRef>();
  const presence = opts.presence ?? [];
  const canCapture = Boolean(opts.guildId) && presence.some((p) => p.sharing);

  const tools: Anthropic.Tool[] = [];
  if (attachments.size > 0) tools.push(READ_ATTACHMENT_TOOL);
  if (canCapture) tools.push(CAPTURE_STREAM_TOOL);

  // Conversation grows as tool rounds are appended, so it is not the caller's
  // array.
  const convo: Anthropic.MessageParam[] = [...opts.messages];

  let acc = '';
  let lastFlush = 0;

  for (let round = 0; ; round += 1) {
    const stream = await client.messages.stream({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      system:     opts.systemPrompt,
      messages:   convo,
      ...(tools.length > 0 && round < MAX_TOOL_ROUNDS ? { tools } : {}),
    });

    for await (const evt of stream) {
      if (evt.type === 'content_block_delta' && evt.delta.type === 'text_delta') {
        acc += evt.delta.text;
        // NO_REPLY short-circuit — let the avatar stay silent
        if (acc.trim() === 'NO_REPLY' || acc.startsWith('NO_REPLY')) {
          try { stream.controller.abort(); } catch { /* noop */ }
          return { skipped: true, finalText: '' };
        }
        const now = Date.now();
        if (now - lastFlush > STREAM_FLUSH_MS) {
          lastFlush = now;
          if (opts.destRef && opts.destField) await opts.destRef.update({ [opts.destField]: acc }).catch(() => {});
        }
      }
    }

    const final = await stream.finalMessage();
    const toolUses = final.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    // No tool call: this round produced the answer.
    if (toolUses.length === 0 || round >= MAX_TOOL_ROUNDS) break;

    // Feed each requested file back in, then let the model continue.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const input = (use.input ?? {}) as { id?: string; userId?: string };
      const { content, isError } = use.name === CAPTURE_STREAM_TOOL.name
        ? await captureStream(opts.guildId ?? '', presence, input.userId ?? '')
        : await readAttachment(attachments.get(input.id ?? ''));
      results.push({ type: 'tool_result', tool_use_id: use.id, content, is_error: isError });
    }
    convo.push({ role: 'assistant', content: final.content });
    convo.push({ role: 'user', content: results });
  }

  if (opts.destRef && opts.destField) {
    await opts.destRef.update({
      [opts.destField]: acc.trim(),
      streaming: false,
    }).catch(() => {});
  }
  return { skipped: false, finalText: acc.trim() };
}

// ─── Trigger: new text-channel message ────────────────────────────────────────

export const onClaudeChannelMessage = onDocumentCreated(
  {
    document: 'guilds/{guildId}/channels/{channelId}/messages/{messageId}',
    memory:   '512MiB',
    timeoutSeconds: 120,
  },
  async (event) => {
    const { guildId, channelId } = event.params;
    const msg = event.data?.data();
    if (!msg) return;
    if (typeof msg.authorId !== 'string' || msg.authorId.startsWith('bot:')) return;
    if (typeof msg.content !== 'string' || !msg.content.trim()) return;

    const guild = await loadGuildCfg(guildId);
    if (!guild?.enabled || !guild.apiKey || !guild.avatarOwnerUid || !guild.avatarId) return;

    const channel = await loadChannelCfg(guildId, channelId);
    if (channel.mode === 'off') return;

    const avatar = await loadAvatar(guild.avatarOwnerUid, guild.avatarId);
    if (!avatar) return;

    if (channel.mode === 'mention' && !messageMentionsAvatar(msg.content, avatar.displayName)) return;

    const botUid = await upsertBotUser(botUidFor(guildId), avatar, guildId);

    // Pull the last N messages for context (oldest first).
    const histSnap = await db.collection(`guilds/${guildId}/channels/${channelId}/messages`)
      .orderBy('createdAt', 'desc').limit(MAX_HISTORY).get();
    const histDocs = histSnap.docs.reverse();

    // Pre-resolve author names in parallel for humans only.
    const humanUids = [...new Set(histDocs
      .map((d) => d.data().authorId as string)
      .filter((u) => typeof u === 'string' && !u.startsWith('bot:'))
    )];
    const nameByUid: Record<string, string> = {};
    await Promise.all(humanUids.map(async (uid) => {
      nameByUid[uid] = await authorNameFor(uid);
    }));

    const history: TurnSource[] = histDocs.map((d) => {
      const data = d.data();
      const authorId = data.authorId as string;
      return {
        authorId,
        authorName: authorId.startsWith('bot:') ? avatar.displayName : nameByUid[authorId],
        content:    (data.content as string) ?? '',
        attachments: (data.attachments as AttachmentRef[] | undefined) ?? undefined,
      };
    });

    const guildName  = (await db.doc(`guilds/${guildId}`).get()).data()?.name ?? 'this server';
    const attachments  = indexAttachments(history);
    const presence     = await loadVoicePresence(guildId);
    const systemPrompt = buildSystemPrompt(avatar, channel.mode, guildName, attachments, presence);
    const messages     = buildMessagesArray(history);
    if (messages.length === 0) return;

    // Create the destination message doc up front so streaming has somewhere to flow.
    const destRef = db.collection(`guilds/${guildId}/channels/${channelId}/messages`).doc();
    await destRef.set({
      content:     '',
      authorId:    botUid,
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      editedAt:    null,
      attachments: [],
      reactions:   {},
      mentions:    [],
      pinned:      false,
      type:        'default',
      streaming:   true,
    });

    try {
      const { skipped } = await runTurn({
        apiKey:       guild.apiKey,
        systemPrompt,
        messages,
        destRef,
        destField:    'content',
        attachments,
        guildId,
        presence,
      });
      if (skipped) {
        await destRef.delete().catch(() => {});
      }
    } catch (err) {
      console.error('[claude] message turn failed:', err);
      await destRef.update({
        content:   '_(error generating response — check the Anthropic API key in Server Settings)_',
        streaming: false,
      }).catch(() => {});
    }
  },
);

// ─── Active-avatar helpers ──────────────────────────────────────────────────────

function channelAvatarEntry(
  meta: AvatarMeta,
  ownerUid: string,
  conv: { conversationId: string; viewerToken: string; shareSlug: string; liveUrl: string },
  opts: { isPrimary: boolean; invitedBy: string },
): ChannelAvatar {
  return {
    ownerUid,
    avatarId:          meta.avatarId ?? '',
    displayName:       meta.displayName,
    thumbnailUrl:      meta.thumbnailUrl ?? '',
    humeVoiceId:       meta.humeVoiceId ?? '',
    wakeWord:          meta.wakeWord ?? '',
    goodbyeWord:       meta.goodbyeWord ?? '',
    personalityPrompt: meta.personalityPrompt ?? '',
    isPrimary:         opts.isPrimary,
    conversationId:    conv.conversationId,
    viewerToken:       conv.viewerToken,
    shareSlug:         conv.shareSlug,
    liveUrl:           conv.liveUrl,
    invitedBy:         opts.invitedBy,
    joinedAt:          Date.now(),
    hasAgentbox:       !!meta.agentbox,
  };
}

/**
 * Have a specific avatar respond in the channel transcript. The reply is voiced
 * through that avatar's own masky conversation and attached to a per-avatar
 * `agent-reply` doc (userId = `bot:<guild>:<avatarId>`) so the right tile lights
 * up and the right name is shown.
 */
async function respondAsAvatar(opts: {
  guildId:   string;
  channelId: string;
  apiKey:    string;
  avatar:    ChannelAvatar;
  userText:  string;
  mode?:     'chat' | 'speak';
  output?:   'audio' | 'video';
}): Promise<void> {
  const { guildId, channelId, avatar } = opts;
  const botUid = await upsertBotUser(botUidForAvatar(guildId, avatar.avatarId), avatar, guildId);

  // Stamp the avatar's identity on the doc so the chat log shows the right name
  // and face permanently — even after the avatar leaves the channel.
  const destRef = db.collection(`guilds/${guildId}/channels/${channelId}/transcript`).doc();
  await destRef.set({
    userId:       botUid,
    text:         '',
    source:       'agent-reply',
    avatarId:     avatar.avatarId,
    botName:      avatar.displayName,
    botAvatarUrl: avatar.thumbnailUrl ?? '',
    createdAt:    admin.firestore.FieldValue.serverTimestamp(),
    streaming:    true,
  });

  const conversation = {
    conversationId: avatar.conversationId,
    viewerToken:    avatar.viewerToken,
    shareSlug:      avatar.shareSlug,
    liveUrl:        avatar.liveUrl,
  };

  // ── Talking-head (video): non-blocking. Fire the turn and record a pointer;
  //    the client watches the public liveTurns mirror and plays each chunk's
  //    video as it renders (~30–60s/chunk). We don't tie up the function. ──
  if (opts.output === 'video') {
    const posted = await postTurn({ conversation, apiKey: opts.apiKey, userText: opts.userText, mode: opts.mode, output: 'video' });
    if (!posted) {
      await destRef.delete().catch(() => {});
      return;
    }
    await destRef.update({
      maskyOutput:       'video',
      maskyViewerToken:  avatar.viewerToken,
      maskyAnchorTurnId: posted.turnId,
      // text + streaming are resolved client-side from the mirror.
    }).catch(() => {});
    return;
  }

  // ── Audio: block briefly until the audio lands (seconds), then attach it. ──
  try {
    const reply = await generateAndVoiceReply({
      conversation,
      apiKey:   opts.apiKey,
      userText: opts.userText,
      mode:     opts.mode,
    });
    if (!reply || (!reply.text && reply.audioUrls.length === 0)) {
      await destRef.delete().catch(() => {});
      return;
    }
    await destRef.update({
      text:      reply.text || '…',
      streaming: false,
      ...(reply.audioUrls.length > 0
        ? { audioUrl: reply.audioUrls[0], audioUrls: reply.audioUrls }
        : {}),
    }).catch(() => {});
  } catch (err) {
    console.error('[masky] voice turn failed:', err);
    await destRef.update({ text: '_(error generating response)_', streaming: false }).catch(() => {});
  }
}

/** The avatar's "stay silent" sentinel: an empty reply or just the digit 0. */
function isSkip(text: string | undefined): boolean {
  const t = (text ?? '').trim();
  return t === '' || /^0[\s.!,]*$/.test(t);
}

function convOf(a: ChannelAvatar) {
  return {
    conversationId: a.conversationId,
    viewerToken:    a.viewerToken,
    shareSlug:      a.shareSlug,
    liveUrl:        a.liveUrl,
  };
}

/** Write a finished avatar reply (text + pre-rendered audio) to the transcript. */
async function writeReplyDoc(
  guildId: string, channelId: string, avatar: ChannelAvatar,
  text: string, audioUrls: string[],
): Promise<void> {
  const botUid = await upsertBotUser(botUidForAvatar(guildId, avatar.avatarId), avatar, guildId);
  await db.collection(`guilds/${guildId}/channels/${channelId}/transcript`).doc().set({
    userId:       botUid,
    text:         text || '…',
    source:       'agent-reply',
    avatarId:     avatar.avatarId,
    botName:      avatar.displayName,
    botAvatarUrl: avatar.thumbnailUrl ?? '',
    audioUrl:     audioUrls[0] ?? null,
    audioUrls,
    createdAt:    admin.firestore.FieldValue.serverTimestamp(),
    streaming:    false,
  });
}

// ─── Trigger: new voice-channel transcript utterance ──────────────────────────

// Voice channels are voiced through masky.ai conversations (Gemini reply in the
// avatar's personality → Hume TTS), NOT Claude. A channel can host several
// avatars at once: the guild's primary avatar is always present, others are
// invited by voice ("Masky, invite Gary") and leave on their goodbye word. Each
// avatar has its own conversation; rendered audio is attached to the transcript
// so every connected client hears it (via ChatPanel autoplay).
export const onClaudeTranscriptUtterance = onDocumentCreated(
  {
    document: 'guilds/{guildId}/channels/{channelId}/transcript/{utteranceId}',
    memory:   '512MiB',
    timeoutSeconds: 120, // only blocks on audio (seconds); video is client-watched
  },
  async (event) => {
    const { guildId, channelId } = event.params;
    const utt = event.data?.data();
    if (!utt) return;
    if (typeof utt.userId !== 'string' || utt.userId.startsWith('bot:')) return;
    if (typeof utt.text !== 'string' || !utt.text.trim()) return;

    const guild = await loadGuildCfg(guildId);
    if (!guild?.enabled || !guild.avatarOwnerUid || !guild.avatarId) return;
    if (!guild.maskyApiKey) {
      console.warn('[masky] voice reply skipped: guild has no maskyApiKey', guildId);
      return;
    }
    const apiKey = guild.maskyApiKey;

    const channel = await loadChannelCfg(guildId, channelId);
    if (channel.mode === 'off') return;

    const primaryMeta = await loadAvatar(guild.avatarOwnerUid, guild.avatarId);
    if (!primaryMeta) return;

    const text = utt.text.trim();

    // Ensure the primary avatar is present in the channel (lazily — on first
    // activity). Other avatars are added on invite.
    let active = await loadActiveAvatars(guildId, channelId);
    if (!active.some((a) => a.isPrimary)) {
      const conv = await createConversation({
        apiKey, avatarOwnerUserId: guild.avatarOwnerUid, avatarId: guild.avatarId,
      });
      if (!conv) {
        console.warn('[masky] could not establish primary conversation for', channelId);
        return;
      }
      active = await addActiveAvatar(
        guildId, channelId,
        channelAvatarEntry(primaryMeta, guild.avatarOwnerUid, conv, { isPrimary: true, invitedBy: '' }),
      );
    }

    const speakerName = await authorNameFor(utt.userId);

    // ── Live agents: forward EVERY utterance to agentbox-linked avatars (no
    //    wake-word gate — the agent reasons and decides whether to talk). ──
    await forwardRoomEventToAgents(guildId, channelId, {
      type:    'utterance',
      speaker: { userId: utt.userId, name: speakerName },
      text,
      source:  (utt.source as string) ?? 'stt',
    }).catch((e) => console.warn('[agentbox] forward utterance failed', e));

    // ── Goodbye: non-primary avatars dismissed (by their goodbye word, a
    //    "bye + name" phrase, or — when they have no goodbye word — a bare
    //    farewell) leave the channel. Remove all that match this utterance. ──
    const leaving = active.filter((a) => !a.isPrimary && utteranceDismissesAvatar(text, a));
    if (leaving.length) {
      for (const a of leaving) {
        // An agentbox avatar says its own goodbye (via the agent); built-in
        // avatars generate one IN CHARACTER (chat mode → personality + the
        // conversation history masky keeps), so it's unique and personal — not a
        // canned line.
        if (!a.hasAgentbox) {
          await respondAsAvatar({
            guildId, channelId, apiKey: await keyForAvatar(a, apiKey), avatar: a,
            // chat mode (default): Gemini writes the line using personality + history
            userText: `[System] ${speakerName} is sending you off — you're leaving the voice channel now. Say a short, warm goodbye in character (one or two sentences) with a personal callback to something from this conversation. Don't ask a question or invite further chat.`,
          });
        }
        await removeActiveAvatar(guildId, channelId, a.avatarId);
      }
      await forwardRoomEventToAgents(guildId, channelId, {
        type: 'avatar_left', avatars: leaving.map((a) => ({ avatarId: a.avatarId, name: a.displayName })),
      }).catch(() => {});
      return;
    }

    // ── Invite: addressed to the primary + an invite intent adds the avatar. ──
    // The avatar comes from the SPEAKER's own list and is voiced/billed on the
    // SPEAKER's own masky key (auto-generated if they don't have one), so anyone
    // in the channel can bring in their own avatars — not just the guild owner.
    // On success we DON'T replay the raw request to the primary (she'd treat it
    // as "go invite a human") — instead we tell her the avatar already joined.
    const primary = active.find((a) => a.isPrimary)!;
    if (utteranceAddressesAvatar(text, primary)) {
      const name = parseInviteName(text);
      if (name) {
        const speakerUid = utt.userId;
        const speakerKey = await ensureUserMaskyKey(speakerUid);
        const exclude = new Set(active.map((a) => a.avatarId));
        // Search the SPEAKER's own avatars (their key renders their avatars).
        const found = speakerKey ? await resolveAvatarByName([speakerUid], name, exclude) : null;
        console.log('[invite]', JSON.stringify({
          name, speakerUid, hasKey: !!speakerKey,
          found: found ? { ownerUid: found.ownerUid, avatarId: found.meta.avatarId } : null,
        }));

        if (speakerKey && found?.meta.avatarId) {
          const conv = await createConversation({
            apiKey: speakerKey, avatarOwnerUserId: found.ownerUid, avatarId: found.meta.avatarId,
          });
          if (!conv) console.warn('[invite] createConversation failed for', found.meta.avatarId);
          if (conv) {
            const newcomer = channelAvatarEntry(
              found.meta, found.ownerUid, conv, { isPrimary: false, invitedBy: speakerUid },
            );
            await addActiveAvatar(guildId, channelId, newcomer);

            // Tell live agents (incl. the newcomer if it's agent-backed) someone joined.
            await forwardRoomEventToAgents(guildId, channelId, {
              type: 'avatar_joined',
              avatar: { avatarId: newcomer.avatarId, name: newcomer.displayName },
              invitedBy: { userId: speakerUid, name: speakerName },
            }).catch(() => {});

            // Primary welcomes (unless it's agent-driven — then its VM reacts).
            if (!primary.hasAgentbox) {
              await respondAsAvatar({
                guildId, channelId, apiKey, avatar: primary,
                userText: `[System] ${speakerName} just brought the AI avatar "${found.meta.displayName}" into this voice channel — they're here now. Give ${found.meta.displayName} a short, warm welcome and don't mention invite links.`,
              });
            }
            // Newcomer introduces itself (built-in avatars only; agents self-drive).
            if (!newcomer.hasAgentbox) {
              await respondAsAvatar({
                guildId, channelId, apiKey: speakerKey, avatar: newcomer,
                userText: `[System] You've just joined a group voice channel. Introduce yourself to everyone in one short, friendly line, in character.`,
              });
            }
            return;
          }
        }

        // Couldn't find a matching avatar in the speaker's list — primary says so.
        await respondAsAvatar({
          guildId, channelId, apiKey, avatar: primary,
          userText: `[System] ${speakerName} asked you to invite "${name}", but you couldn't find an avatar named "${name}" on their account. Tell them briefly you couldn't find ${name}.`,
        });
        return;
      }
    }

    // ── Reasoning + one-responder-per-turn arbitration ──
    // Every present (non-agentbox) avatar sees this utterance and DECIDES for
    // itself whether to chime in (replies "0" to stay silent) — model-driven, not
    // regex, with full conversation history. But only ONE responds first; the
    // others are then told their draft was NOT heard, what was actually said, and
    // asked to re-decide — so they only pile on if they still add something.
    const present = active.filter((a) => !a.hasAgentbox);
    if (present.length === 0) return;

    const wantVideo = channel.mediaMode === 'video';
    const decideOutput: 'audio' | 'text' = wantVideo ? 'text' : 'audio';
    const guide = channel.mode === 'all'
      ? `Jump in whenever you have something useful to add.`
      : `Only reply if this is directed at you or you can clearly help; otherwise stay quiet.`;
    const decisionText =
      `${speakerName}: ${text}\n\n[You're in a group voice channel with other people and avatars. ${guide} `
      + `If it isn't your turn or you have nothing to add, reply with exactly "0" (just the digit) and nothing else.]`;

    // 1. Decision pass (parallel): who wants to talk, and what would they say?
    const candidates = (await Promise.all(present.map(async (a) => {
      const key = await keyForAvatar(a, apiKey);
      const reply = await generateAndVoiceReply({
        conversation: convOf(a), apiKey: key, userText: decisionText, mode: 'chat', output: decideOutput,
      }).catch(() => null);
      if (!reply || isSkip(reply.text)) return null;
      return { avatar: a, key, text: reply.text, audioUrls: reply.audioUrls };
    }))).filter((c): c is NonNullable<typeof c> => c !== null);

    if (candidates.length === 0) return;

    // 2. Pick the winner: a directly-addressed avatar wins, else the primary,
    //    else the first to volunteer.
    const winner = candidates.find((c) => utteranceAddressesAvatar(text, c.avatar))
      ?? candidates.find((c) => c.avatar.isPrimary)
      ?? candidates[0];

    const broadcast = async (
      c: { avatar: ChannelAvatar; key: string; text: string; audioUrls: string[] },
    ) => {
      if (wantVideo) {
        await respondAsAvatar({ guildId, channelId, apiKey: c.key, avatar: c.avatar, userText: c.text, mode: 'speak', output: 'video' });
      } else {
        await writeReplyDoc(guildId, channelId, c.avatar, c.text, c.audioUrls);
      }
    };

    // 3. Winner speaks.
    //
    // masky wrote that draft and cannot use tools, so when the room contains
    // something only a tool can see — a live screen share, a shared file — the
    // winner's words are regenerated by Claude with those tools available, and
    // masky is used purely as the voice. Otherwise the masky draft stands: it is
    // faster, and it is the character people are used to hearing.
    const presence   = await loadVoicePresence(guildId);
    const vHistory   = await loadTranscriptHistory(guildId, channelId);
    const vAttach    = indexAttachments(vHistory);
    const toolsMatter = presence.some((p) => p.sharing) || vAttach.size > 0;
    let revoiced = false;

    if (toolsMatter && guild.apiKey) {
      try {
        const { skipped, finalText } = await runTurn({
          apiKey:       guild.apiKey,
          systemPrompt: buildSystemPrompt(
            {
              avatarId:          winner.avatar.avatarId,
              displayName:       winner.avatar.displayName,
              personalityPrompt: winner.avatar.personalityPrompt,
            },
            channel.mode,
            (await db.doc(`guilds/${guildId}`).get()).data()?.name ?? 'this server',
            vAttach,
            presence,
          ),
          messages:    buildMessagesArray(vHistory),
          attachments: vAttach,
          guildId,
          presence,
        });
        if (!skipped && finalText) {
          // masky already voiced the draft it wrote, so those clips no longer
          // match. Re-voice the new words with mode: 'speak'.
          winner.text = finalText;
          await respondAsAvatar({
            guildId, channelId, apiKey: winner.key, avatar: winner.avatar,
            userText: finalText, mode: 'speak', output: wantVideo ? 'video' : 'audio',
          });
          revoiced = true;
        }
      } catch (err) {
        // Fall back to what masky already wrote rather than going silent.
        console.warn('[claudeAgent] voice tool turn failed, using masky draft', err);
      }
    }

    if (!revoiced) await broadcast(winner);
    const saidThisTurn = [{ name: winner.avatar.displayName, text: winner.text }];

    // 4. Reconcile the losers one at a time: tell each its draft wasn't heard,
    //    what HAS been said this turn, and let it re-decide (reply "0" to drop).
    for (const c of candidates) {
      if (c === winner) continue;
      const others = saidThisTurn.map((s) => `${s.name}: "${s.text}"`).join('\n');
      const reconcile =
        `[System] Your previous draft was NOT heard — these were said this turn instead:\n${others}\n\n`
        + `Decide fresh: reply ONLY if you still have something new and worth adding now; otherwise reply with exactly "0".`;
      const r = await generateAndVoiceReply({
        conversation: convOf(c.avatar), apiKey: c.key, userText: reconcile, mode: 'chat', output: decideOutput,
      }).catch(() => null);
      if (r && !isSkip(r.text)) {
        await broadcast({ avatar: c.avatar, key: c.key, text: r.text, audioUrls: r.audioUrls });
        saidThisTurn.push({ name: c.avatar.displayName, text: r.text });
      }
    }
  },
);

// ─── Cleanup: clear the avatar roster when AI is turned off ──────────────────────

/** When a channel's AI mode flips to 'off', empty its active-avatar roster so no
 *  stale avatar tiles linger in the UI. */
export const onChannelAiDisabled = onDocumentUpdated(
  { document: 'guilds/{guildId}/channels/{channelId}' },
  async (event) => {
    const before = event.data?.before.data();
    const after  = event.data?.after.data();
    if (!before || !after) return;

    const wasOn      = (before.claudeMode ?? 'off') !== 'off';
    const nowOff     = (after.claudeMode ?? 'off') === 'off';
    const hasAvatars = Array.isArray(after.activeAvatars) && after.activeAvatars.length > 0;
    if (wasOn && nowOff && hasAvatars) {
      await event.data!.after.ref.set({ activeAvatars: [] }, { merge: true }).catch(() => {});
    }
  },
);

/** When AI assistance is disabled for the whole guild, clear every channel's
 *  active-avatar roster. */
export const onGuildAiDisabled = onDocumentUpdated(
  { document: 'guilds/{guildId}' },
  async (event) => {
    const before = event.data?.before.data();
    const after  = event.data?.after.data();
    if (!before || !after) return;
    if (!(before.claudeEnabled === true && after.claudeEnabled !== true)) return;

    const { guildId } = event.params;
    const chans = await db.collection(`guilds/${guildId}/channels`).get();
    await Promise.all(chans.docs.map(async (c) => {
      const av = c.data().activeAvatars;
      if (Array.isArray(av) && av.length > 0) {
        await c.ref.set({ activeAvatars: [] }, { merge: true }).catch(() => {});
      }
    }));
  },
);

// ─── Agentbox callback: an agent speaks/posts into its channel ───────────────────

// A GMI agentbox calls this with the callbackToken it received in /invoke when it
// decides it's its turn. `action`:
//   'speak' (default) — voice `text` as the avatar (transcript + audio/video)
//   'post'            — add a text-only chat line as the avatar (no voice)
// The token is HMAC-signed and scoped to {guild, channel, avatar}; we also
// re-check the avatar is still active, which gives effective revocation on leave.
export const agentSpeak = onRequest(
  { memory: '512MiB', timeoutSeconds: 120, cors: true },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

    const body = (req.body ?? {}) as { callbackToken?: string; text?: string; output?: string; action?: string };
    const claims = await verifyCallbackToken(String(body.callbackToken ?? ''));
    if (!claims) { res.status(401).json({ error: 'invalid or expired callbackToken' }); return; }

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) { res.status(400).json({ error: 'text required' }); return; }

    const { g: guildId, c: channelId, a: avatarId } = claims;
    const active = await loadActiveAvatars(guildId, channelId);
    const avatar = active.find((x) => x.avatarId === avatarId);
    if (!avatar) { res.status(410).json({ error: 'avatar no longer active in channel' }); return; }

    // Text-only chat line — no voice render.
    if (body.action === 'post') {
      const botUid = await upsertBotUser(botUidForAvatar(guildId, avatarId), avatar, guildId);
      await db.collection(`guilds/${guildId}/channels/${channelId}/transcript`).doc().set({
        userId:       botUid,
        text,
        source:       'agent-reply',
        avatarId,
        botName:      avatar.displayName,
        botAvatarUrl: avatar.thumbnailUrl ?? '',
        createdAt:    admin.firestore.FieldValue.serverTimestamp(),
        streaming:    false,
      });
      res.json({ ok: true, action: 'post' });
      return;
    }

    // Default: voice the line verbatim through the avatar's masky conversation.
    const guild = await loadGuildCfg(guildId);
    await respondAsAvatar({
      guildId, channelId,
      apiKey:   await keyForAvatar(avatar, guild?.maskyApiKey ?? ''),
      avatar,
      userText: text,
      mode:     'speak',
      output:   body.output === 'video' ? 'video' : 'audio',
    });
    res.json({ ok: true, action: 'speak' });
  },
);
