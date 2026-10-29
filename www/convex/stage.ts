import { v } from 'convex/values';
import { makeFunctionReference } from 'convex/server';
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { appendEvent, getRoomBySlug } from './rooms';
import { callModel, hasBridge, hasInference } from './agent';

/**
 * The stage: the shared floor that the vote-the-cast game modes play on —
 * guillotine and marry/mate/murder today.
 *
 * Masky hosts. A mode puts two or three entrants up under the labels A, B and C,
 * and from there every round runs the same way:
 *
 *   speeches → each entrant gets exactly one voiceline, in label order, spoken
 *              under a system prompt the *mode* wrote (that prompt is what tells
 *              the entrant the game and that an audience is about to vote)
 *   voting   → anyone votes: buttons in the room, or chat commands from Twitch
 *   revealed → tally, majority per verb, a point to every voter who matched it,
 *              then the mode's `onReveal` decides what happens next
 *
 * The stage knows nothing about brackets or billionaires. It owns the round
 * clock, the votes and the points ledger; a mode owns who is on stage and what
 * a result means. Everything lives under `room.config.stage`, except votes and
 * points, which have tables because a Twitch chat can produce more of them than
 * one document should absorb.
 *
 * Transitions are driven by the scheduler and guarded by `step`: every
 * transition bumps it, every scheduled job carries the step it was scheduled
 * at, and a job whose step is stale does nothing. `tick` (called by every open
 * board on a timer) re-fires a transition that has overrun its deadline, so a
 * lost scheduled job delays a round rather than wedging it.
 */

// ─── Shapes ───────────────────────────────────────────────────────────────────

export type StageEntrant = {
  /** 'A' | 'B' | 'C' — what the buttons and the Twitch commands name. */
  label: string;
  /** The entrant's room member key; their line is posted under it. */
  memberKey: string;
  name: string;
  avatarUrl?: string;
  /** Shown when there is no avatar image. */
  emoji?: string;
  /** Frame accent, any CSS colour. */
  color?: string;
  /** Written by the mode: the game, the stakes, that the audience votes next. */
  system: string;
  /** Said instead when no model is reachable or the call fails. */
  fallbackLine?: string;
  /** Browser TTS reads pitch/rate when this seat has no Masky conversation. */
  voice?: { pitch?: number; rate?: number; avatarGroupId?: string; ownerUid?: string };
  /**
   * The mask's masky.ai /live conversation. The board embeds `liveUrl`; silent
   * waiting clips move the face between lines, and speak turns play on it.
   */
  live?: StageLive;
};

/** A masky.ai conversation the stage is adding turns to. `liveUrl` is the embed. */
export type StageLive = {
  conversationId: string;
  liveUrl: string;
};

export type StageLine = {
  /** An entrant's label, or 'host'. */
  label: string;
  memberKey: string;
  name: string;
  text: string;
  startedAt: number;
  /** How long the board should treat the speaker as talking. */
  durationMs: number;
  /** Bumps per line so a board can tell a new line from a re-render. */
  seq: number;
  /**
   * `live` — a speak turn was posted to the mask's /live conversation, so the
   * board must not also speak it with the browser voice.
   * `local` — browser speech synthesis.
   */
  voiced?: 'live' | 'local';
};

export type StageReveal = {
  round: number;
  /** Distinct voters this round. */
  voters: number;
  /** tallies[label][verb] = votes */
  tallies: Record<string, Record<string, number>>;
  /** The label the audience picked for each verb. Ties and silence are broken at random. */
  majority: Record<string, string>;
  /** Verbs whose pick was a coin toss (a tie, or nobody voted). No points for those. */
  byChance: string[];
  /** Voters who scored this round. */
  scorers: number;
};

export type StagePhase = 'idle' | 'speeches' | 'voting' | 'revealed' | 'over';

type Pending =
  | { kind: 'prepare' }
  | { kind: 'host' }
  | { kind: 'speak'; index: number }
  | { kind: 'openVoting' }
  | { kind: 'closeVoting' };

export type StageState = {
  phase: StagePhase;
  round: number;
  step: number;
  verbs: string[];
  /** Each voter gives every verb to a different entrant (marry/mate/murder). */
  exclusive: boolean;
  entrants: StageEntrant[];
  /** Who is talking now, if anyone. */
  line?: StageLine;
  /** Every line spoken this round, host included. */
  lines: StageLine[];
  lineSeq: number;
  voteMs: number;
  votingEndsAt?: number;
  reveal?: StageReveal;
  /** `module:export` of a mutation taking { roomId, round, reveal }. */
  onReveal?: string;
  pending?: Pending;
  /** When `pending` should have run by; `tick` re-fires it after this. */
  deadline?: number;
  /** Free text the mode wants shown on the stage ("Heat 4 · losers' bracket"). */
  caption?: string;
  /** Host Masky's /live conversation, reused across rounds of this room. */
  hostLive?: StageLive;
  /** Said by the host once the live faces are up. Cleared as it is spoken. */
  openingLine?: string;
  /** While this is in the future, a second copy of the same voice job does nothing. */
  claimedUntil?: number;
};

export const DEFAULT_VOTE_MS = 30_000;
const LINE_MAX_WORDS = 60;
/** Grace past a deadline before `tick` steps in — scheduled jobs are usually on time. */
const TICK_GRACE_MS = 8_000;
/** A model call that has not come back by now is treated as lost. */
const SPEAK_DEADLINE_MS = 30_000;
/** Creating the /live conversations. A few HTTP calls, no video render. */
const PREPARE_DEADLINE_MS = 40_000;
/**
 * A speak turn's talking-head video. The bridge waits ~70s for the first
 * chunks; the claim and the watchdog deadline sit past that so a slow render
 * is not posted a second time.
 */
const VOICE_DEADLINE_MS = 200_000;
const CLAIM_MS = 170_000;
/** Let open boards mount the live iframe before the first turn is posted. */
const IFRAME_LEAD_MS = 6_000;
/** A beat between one speaker finishing and the next starting. */
const GAP_MS = 900;

const EMPTY: StageState = {
  phase: 'idle',
  round: 0,
  step: 0,
  verbs: [],
  exclusive: false,
  entrants: [],
  lines: [],
  lineSeq: 0,
  voteMs: DEFAULT_VOTE_MS,
};

export function stageOf(room: Doc<'rooms'> | null | undefined): StageState {
  const s = (room?.config as { stage?: StageState } | undefined)?.stage;
  return s ? { ...EMPTY, ...s } : { ...EMPTY };
}

async function writeStage(ctx: MutationCtx, roomId: Id<'rooms'>, stage: StageState) {
  const room = await ctx.db.get(roomId);
  if (!room) return;
  await ctx.db.patch(roomId, { config: { ...(room.config ?? {}), stage } });
}

/** Roughly how long a line takes to say: ~2.6 words a second plus a breath. */
export function speakingMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(25_000, Math.max(2_500, Math.round((words / 2.6) * 1000) + 1_200));
}

function trimLine(text: string): string {
  const clean = text
    .replace(/\*[^*]*\*/g, '') // *adjusts tie* — stage directions read aloud are awful
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“]|["”]$/g, '');
  const words = clean.split(' ');
  return words.length > LINE_MAX_WORDS ? `${words.slice(0, LINE_MAX_WORDS).join(' ')}…` : clean;
}

// ─── Library: what a mode calls ───────────────────────────────────────────────

/**
 * Put entrants on stage and start a round. The mode's own mutation calls this;
 * it returns the round number. `hostLine` is said first, by Masky, before the
 * first entrant speaks.
 */
export async function openRound(
  ctx: MutationCtx,
  roomId: Id<'rooms'>,
  opts: {
    entrants: StageEntrant[];
    verbs: string[];
    exclusive?: boolean;
    voteMs?: number;
    onReveal?: string;
    hostLine?: string;
    caption?: string;
  },
): Promise<number> {
  const room = await ctx.db.get(roomId);
  if (!room) throw new Error('No such room');
  const prev = stageOf(room);
  const round = prev.round + 1;
  const step = prev.step + 1;
  const now = Date.now();

  const stage: StageState = {
    ...prev,
    phase: 'speeches',
    round,
    step,
    verbs: opts.verbs,
    exclusive: Boolean(opts.exclusive),
    entrants: withCarriedLives(prev.entrants, opts.entrants),
    hostLive: prev.hostLive,
    line: undefined,
    lines: [],
    voteMs: opts.voteMs ?? DEFAULT_VOTE_MS,
    votingEndsAt: undefined,
    reveal: undefined,
    onReveal: opts.onReveal,
    caption: opts.caption,
    openingLine: opts.hostLine,
    claimedUntil: undefined,
    pending: { kind: 'prepare' },
    deadline: now + PREPARE_DEADLINE_MS,
  };

  await writeStage(ctx, roomId, stage);
  // Faces first (silent waiting clips), then Masky's opening line, then entrants.
  await ctx.scheduler.runAfter(0, internal.stage.prepare, { roomId, step });
  return round;
}

/** Keep a mask's /live conversation when the same avatar stands again. */
function withCarriedLives(prev: StageEntrant[], next: StageEntrant[]): StageEntrant[] {
  return next.map((entrant) => {
    const id = entrant.voice?.avatarGroupId;
    if (!id) return entrant;
    const prior = prev.find((p) => p.voice?.avatarGroupId === id && p.live);
    return prior?.live ? { ...entrant, live: prior.live } : entrant;
  });
}

/**
 * Masky says something on stage — spoken by the boards, posted to the log —
 * without moving the round. Modes use it for their reveal commentary.
 * When the host has a /live conversation, the line is a speak turn on it.
 */
export async function hostSay(ctx: MutationCtx, roomId: Id<'rooms'>, text: string) {
  const room = await ctx.db.get(roomId);
  if (!room) return;
  const stage = stageOf(room);
  const voiced = stage.hostLive ? 'live' : 'local';
  await writeStage(ctx, roomId, await sayAsHost(ctx, roomId, stage, text, voiced));
  if (voiced === 'live') {
    await ctx.scheduler.runAfter(0, internal.stage.postHostTurn, { roomId, text });
  }
}

async function sayAsHost(
  ctx: MutationCtx,
  roomId: Id<'rooms'>,
  stage: StageState,
  text: string,
  voiced: 'live' | 'local' = 'local',
): Promise<StageState> {
  const room = await ctx.db.get(roomId);
  const hostName = room?.hostName ?? 'Masky';
  await appendEvent(ctx, roomId, {
    type: 'host',
    actorKey: 'host',
    actorName: hostName,
    body: text,
    data: { kind: 'stage-host', round: stage.round },
  });
  const line: StageLine = {
    label: 'host',
    memberKey: 'host',
    name: hostName,
    text,
    startedAt: Date.now(),
    durationMs: speakingMs(text),
    seq: stage.lineSeq + 1,
    voiced,
  };
  return { ...stage, line, lines: [...stage.lines, line], lineSeq: line.seq };
}

/** End the show: the stage stays up with its last reveal, and stops moving. */
export async function closeStage(ctx: MutationCtx, roomId: Id<'rooms'>) {
  const room = await ctx.db.get(roomId);
  if (!room) return;
  const stage = stageOf(room);
  await writeStage(ctx, roomId, {
    ...stage,
    phase: 'over',
    step: stage.step + 1,
    pending: undefined,
    deadline: undefined,
  });
}

/** Wipe the stage, its votes and its ledger, for a new game in the same room. */
export async function resetStage(ctx: MutationCtx, roomId: Id<'rooms'>) {
  const room = await ctx.db.get(roomId);
  if (!room) return;
  const prev = stageOf(room);
  for (const row of await ctx.db
    .query('stageVotes')
    .withIndex('by_room_round', (q) => q.eq('roomId', roomId))
    .collect()) {
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db
    .query('stagePoints')
    .withIndex('by_room', (q) => q.eq('roomId', roomId))
    .collect()) {
    await ctx.db.delete(row._id);
  }
  // Keep `step` climbing so anything still scheduled from the old game is stale.
  await writeStage(ctx, roomId, { ...EMPTY, step: prev.step + 1 });
}

// ─── The round clock ──────────────────────────────────────────────────────────

export const stageFor = internalQuery({
  args: { roomId: v.id('rooms') },
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return null;
    const cfg = (room.config ?? {}) as { guildId?: string; startedBy?: string };
    let startedBy = cfg.startedBy;
    if (!startedBy) {
      const human = await ctx.db
        .query('roomMembers')
        .withIndex('by_room', (q) => q.eq('roomId', roomId))
        .filter((q) => q.eq(q.field('kind'), 'human'))
        .first();
      startedBy = human?.memberKey;
    }
    return { status: room.status, stage: stageOf(room), guildId: cfg.guildId, startedBy };
  },
});

type LiveRef = { conversationId: string; liveUrl: string };

/**
 * Ask the room bridge to create or reuse a /live conversation, or to post a
 * speak turn onto one. The mky_ key stays in Firebase. Returns null when the
 * bridge is down or the server has no Masky key — the line still happens,
 * spoken by the browser.
 */
async function stageBridge(
  op: 'stage-ensure' | 'stage-speak',
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!hasBridge()) return null;
  try {
    const res = await fetch(process.env.ROOM_BRIDGE_URL as string, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-room-bridge-secret': process.env.ROOM_BRIDGE_SECRET as string,
      },
      body: JSON.stringify({ op, ...body }),
    });
    if (!res.ok) {
      console.error('stage.live', op, res.status);
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.error('stage.live', op, (err as Error).message);
    return null;
  }
}

async function ensureLive(
  guildId: string,
  memberUid: string,
  avatar?: { avatarId: string; avatarOwnerUserId: string },
): Promise<LiveRef | null> {
  const data = await stageBridge('stage-ensure', {
    guildId,
    memberUid,
    ...(avatar ?? {}),
  });
  const conversationId = data?.conversationId;
  const liveUrl = data?.liveUrl;
  if (typeof conversationId !== 'string' || typeof liveUrl !== 'string' || !liveUrl) return null;
  return { conversationId, liveUrl };
}

/** Post the line and wait (inside the bridge) until its video is ready to play. */
async function postLiveTurn(
  guildId: string,
  memberUid: string,
  conversationId: string,
  text: string,
  wait: boolean,
): Promise<boolean> {
  const data = await stageBridge('stage-speak', { guildId, memberUid, conversationId, text, wait });
  return data?.posted === true;
}

const liveValidator = v.object({
  conversationId: v.string(),
  liveUrl: v.string(),
});

/**
 * Open a /live conversation for the host and for every seated mask that has a
 * Masky avatar, turn silent waiting clips on, then start the opening line.
 */
export const prepare = internalAction({
  args: { roomId: v.id('rooms'), step: v.number() },
  handler: async (ctx, { roomId, step }) => {
    const snap = await ctx.runQuery(internal.stage.stageFor, { roomId });
    if (!snap || snap.status !== 'running') return;
    const { stage } = snap;
    if (stage.step !== step || stage.phase !== 'speeches' || stage.pending?.kind !== 'prepare') return;

    let hostLive: LiveRef | null = stage.hostLive ?? null;
    const entrantLives: Array<{ label: string } & LiveRef> = [];
    if (snap.guildId && snap.startedBy) {
      hostLive = (await ensureLive(snap.guildId, snap.startedBy)) ?? hostLive;
      for (const entrant of stage.entrants) {
        const avatarId = entrant.voice?.avatarGroupId;
        const avatarOwnerUserId = entrant.voice?.ownerUid;
        if (!avatarId || !avatarOwnerUserId) continue;
        if (entrant.live) {
          entrantLives.push({ label: entrant.label, ...entrant.live });
          continue;
        }
        const live = await ensureLive(snap.guildId, snap.startedBy, { avatarId, avatarOwnerUserId });
        if (live) entrantLives.push({ label: entrant.label, ...live });
      }
    }

    await ctx.runMutation(internal.stage.voicesReady, {
      roomId,
      step,
      hostLive,
      entrantLives,
    });
  },
});

export const voicesReady = internalMutation({
  args: {
    roomId: v.id('rooms'),
    step: v.number(),
    hostLive: v.union(liveValidator, v.null()),
    entrantLives: v.array(v.object({ label: v.string(), conversationId: v.string(), liveUrl: v.string() })),
  },
  handler: async (ctx, { roomId, step, hostLive, entrantLives }) => {
    const room = await ctx.db.get(roomId);
    if (!room || room.status !== 'running') return;
    const stage = stageOf(room);
    if (stage.step !== step || stage.phase !== 'speeches' || stage.pending?.kind !== 'prepare') return;

    const byLabel = new Map(entrantLives.map((row) => [row.label, row]));
    const entrants = stage.entrants.map((entrant) => {
      const row = byLabel.get(entrant.label);
      return row ? { ...entrant, live: { conversationId: row.conversationId, liveUrl: row.liveUrl } } : entrant;
    });
    const nextHost = hostLive ?? stage.hostLive;
    const hasFace = Boolean(nextHost) || entrants.some((entrant) => entrant.live);
    const lead = hasFace ? IFRAME_LEAD_MS : 0;
    const base: StageState = {
      ...stage,
      entrants,
      ...(nextHost ? { hostLive: nextHost } : {}),
      claimedUntil: undefined,
    };

    if (stage.openingLine) {
      await writeStage(ctx, roomId, {
        ...base,
        pending: { kind: 'host' },
        deadline: Date.now() + lead + VOICE_DEADLINE_MS,
      });
      await ctx.scheduler.runAfter(lead, internal.stage.voiceHost, { roomId, step });
      return;
    }

    await writeStage(ctx, roomId, {
      ...base,
      openingLine: undefined,
      pending: { kind: 'speak', index: 0 },
      deadline: Date.now() + lead + (entrants[0]?.live ? VOICE_DEADLINE_MS : SPEAK_DEADLINE_MS),
    });
    await ctx.scheduler.runAfter(lead, internal.stage.speak, { roomId, step, index: 0 });
  },
});

/**
 * One in-flight voice job per step. A watchdog retry that arrives while the
 * first is still rendering video does not post the line again.
 */
export const claimTurn = internalMutation({
  args: {
    roomId: v.id('rooms'),
    step: v.number(),
    kind: v.union(v.literal('host'), v.literal('speak')),
    index: v.optional(v.number()),
  },
  handler: async (ctx, { roomId, step, kind, index }) => {
    const room = await ctx.db.get(roomId);
    if (!room || room.status !== 'running') return false;
    const stage = stageOf(room);
    if (stage.step !== step || stage.phase !== 'speeches' || !stage.pending) return false;
    if (kind === 'speak') {
      if (stage.pending.kind !== 'speak' || stage.pending.index !== index) return false;
    } else if (stage.pending.kind !== 'host') {
      return false;
    }
    if ((stage.claimedUntil ?? 0) > Date.now()) return false;
    await writeStage(ctx, roomId, { ...stage, claimedUntil: Date.now() + CLAIM_MS });
    return true;
  },
});

/** Masky's opening line, as a speak turn on the host's /live conversation. */
export const voiceHost = internalAction({
  args: { roomId: v.id('rooms'), step: v.number() },
  handler: async (ctx, { roomId, step }) => {
    const snap = await ctx.runQuery(internal.stage.stageFor, { roomId });
    if (!snap || snap.status !== 'running') return;
    const text = snap.stage.openingLine;
    if (!text || snap.stage.pending?.kind !== 'host') return;
    const claimed = await ctx.runMutation(internal.stage.claimTurn, { roomId, step, kind: 'host' });
    if (!claimed) return;

    let voiced: 'live' | 'local' = 'local';
    const live = snap.stage.hostLive;
    if (live && snap.guildId && snap.startedBy) {
      const posted = await postLiveTurn(snap.guildId, snap.startedBy, live.conversationId, text, true);
      if (posted) voiced = 'live';
    }
    await ctx.runMutation(internal.stage.hostLineSpoken, { roomId, step, text, voiced });
  },
});

export const hostLineSpoken = internalMutation({
  args: {
    roomId: v.id('rooms'),
    step: v.number(),
    text: v.string(),
    voiced: v.union(v.literal('live'), v.literal('local')),
  },
  handler: async (ctx, { roomId, step, text, voiced }) => {
    const room = await ctx.db.get(roomId);
    if (!room || room.status !== 'running') return;
    const stage = stageOf(room);
    if (stage.step !== step || stage.phase !== 'speeches' || stage.pending?.kind !== 'host') return;

    const withLine = await sayAsHost(ctx, roomId, stage, text, voiced);
    const nextStep = step + 1;
    const after = (withLine.line?.durationMs ?? 0) + GAP_MS;
    const firstLive = Boolean(withLine.entrants[0]?.live);
    await writeStage(ctx, roomId, {
      ...withLine,
      step: nextStep,
      openingLine: undefined,
      claimedUntil: undefined,
      pending: { kind: 'speak', index: 0 },
      deadline: Date.now() + after + (firstLive ? VOICE_DEADLINE_MS : SPEAK_DEADLINE_MS),
    });
    await ctx.scheduler.runAfter(after, internal.stage.speak, { roomId, step: nextStep, index: 0 });
  },
});

/**
 * Reveal commentary. The line is already on the board; this only adds the
 * speak turn so the host's live face says it. It does not move the round.
 */
export const postHostTurn = internalAction({
  args: { roomId: v.id('rooms'), text: v.string() },
  handler: async (ctx, { roomId, text }) => {
    const snap = await ctx.runQuery(internal.stage.stageFor, { roomId });
    const live = snap?.stage.hostLive;
    if (!snap?.guildId || !snap.startedBy || !live) return;
    await postLiveTurn(snap.guildId, snap.startedBy, live.conversationId, text, false);
  },
});

/**
 * One entrant's one line. An action because it calls the model; everything it
 * learns goes back through `lineSpoken`, which re-checks the step.
 */
export const speak = internalAction({
  args: { roomId: v.id('rooms'), step: v.number(), index: v.number() },
  handler: async (ctx, { roomId, step, index }) => {
    const snap = await ctx.runQuery(internal.stage.stageFor, { roomId });
    if (!snap || snap.status !== 'running') return;
    const { stage } = snap;
    if (stage.step !== step || stage.phase !== 'speeches') return;
    const entrant = stage.entrants[index];
    if (!entrant) return;
    const claimed = await ctx.runMutation(internal.stage.claimTurn, { roomId, step, kind: 'speak', index });
    if (!claimed) return;

    const rivals = stage.entrants.filter((e) => e.label !== entrant.label).map((e) => e.name);
    const said = stage.lines
      .filter((l) => l.label !== 'host')
      .map((l) => `${l.name}: ${l.text}`)
      .join('\n');

    let text = '';
    if (hasInference(snap.guildId)) {
      try {
        const reply = await callModel({
          system: entrant.system,
          messages: [
            {
              role: 'user',
              content:
                `Round ${stage.round}. On stage with you: ${rivals.join(' and ') || 'nobody'}.\n` +
                (said ? `Already said this round:\n${said}\n\n` : 'You speak first.\n\n') +
                `The audience votes right after the last line. This is your one line — say it now. ` +
                `Spoken aloud, under 45 words, no stage directions, no emoji.`,
            },
          ],
          maxTokens: 220,
          guildId: snap.guildId,
          onBehalfOf: snap.startedBy,
        });
        text = trimLine(reply.text);
      } catch (err) {
        console.error('stage.speak', (err as Error).message);
      }
    }
    if (!text) text = entrant.fallbackLine ?? `I'm ${entrant.name}, and I would very much like to keep my head.`;

    let voiced: 'live' | 'local' = 'local';
    if (entrant.live && snap.guildId && snap.startedBy) {
      const posted = await postLiveTurn(snap.guildId, snap.startedBy, entrant.live.conversationId, text, true);
      if (posted) voiced = 'live';
    }

    await ctx.runMutation(internal.stage.lineSpoken, { roomId, step, index, text, voiced });
  },
});

export const lineSpoken = internalMutation({
  args: {
    roomId: v.id('rooms'),
    step: v.number(),
    index: v.number(),
    text: v.string(),
    voiced: v.optional(v.union(v.literal('live'), v.literal('local'))),
  },
  handler: async (ctx, { roomId, step, index, text, voiced }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return;
    const stage = stageOf(room);
    if (stage.step !== step || stage.phase !== 'speeches') return;
    const entrant = stage.entrants[index];
    if (!entrant) return;

    await appendEvent(ctx, roomId, {
      type: 'say',
      actorKey: entrant.memberKey,
      actorName: entrant.name,
      body: text,
      data: { kind: 'stage-line', round: stage.round, label: entrant.label },
    });

    const line: StageLine = {
      label: entrant.label,
      memberKey: entrant.memberKey,
      name: entrant.name,
      text,
      startedAt: Date.now(),
      durationMs: speakingMs(text),
      seq: stage.lineSeq + 1,
      voiced: voiced ?? 'local',
    };
    const nextStep = step + 1;
    const after = line.durationMs + GAP_MS;
    const last = index + 1 >= stage.entrants.length;
    const pending: Pending = last ? { kind: 'openVoting' } : { kind: 'speak', index: index + 1 };
    const nextLive = !last && Boolean(stage.entrants[index + 1]?.live);

    await writeStage(ctx, roomId, {
      ...stage,
      step: nextStep,
      line,
      lines: [...stage.lines, line],
      lineSeq: line.seq,
      pending,
      claimedUntil: undefined,
      deadline: Date.now() + after + (last ? 0 : nextLive ? VOICE_DEADLINE_MS : SPEAK_DEADLINE_MS),
    });

    if (last) {
      await ctx.scheduler.runAfter(after, internal.stage.openVoting, { roomId, step: nextStep });
    } else {
      await ctx.scheduler.runAfter(after, internal.stage.speak, {
        roomId,
        step: nextStep,
        index: index + 1,
      });
    }
  },
});

export const openVoting = internalMutation({
  args: { roomId: v.id('rooms'), step: v.number() },
  handler: async (ctx, { roomId, step }) => {
    const room = await ctx.db.get(roomId);
    if (!room || room.status !== 'running') return;
    const stage = stageOf(room);
    if (stage.step !== step || stage.phase !== 'speeches') return;

    const nextStep = step + 1;
    const endsAt = Date.now() + stage.voteMs;
    await writeStage(ctx, roomId, {
      ...stage,
      phase: 'voting',
      step: nextStep,
      line: undefined,
      votingEndsAt: endsAt,
      pending: { kind: 'closeVoting' },
      deadline: endsAt,
    });
    await appendEvent(ctx, roomId, {
      type: 'system',
      actorName: 'stage',
      body: `Voting is open for ${Math.round(stage.voteMs / 1000)} seconds: ${votingHelp(stage)}`,
      data: { kind: 'stage-voting', round: stage.round, endsAt },
    });
    await ctx.scheduler.runAfter(stage.voteMs, internal.stage.closeVoting, { roomId, step: nextStep });
  },
});

function votingHelp(stage: StageState): string {
  const labels = stage.entrants.map((e) => `${e.label} = ${e.name}`).join(', ');
  const commands = stage.verbs.map((verb) => `!${verb} ${stage.entrants[0]?.label ?? 'A'}`).join(' / ');
  return `${labels}. In Twitch chat: ${commands}.`;
}

export const closeVoting = internalMutation({
  args: { roomId: v.id('rooms'), step: v.number() },
  handler: async (ctx, { roomId, step }) => {
    const room = await ctx.db.get(roomId);
    if (!room || room.status !== 'running') return;
    const stage = stageOf(room);
    if (stage.step !== step || stage.phase !== 'voting') return;

    const votes = await votesFor(ctx, roomId, stage.round);
    const tallies = tally(stage, votes);
    const { majority, byChance } = pickMajority(stage, tallies);

    // A point per verb a voter put on the audience's pick. A coin toss is
    // nobody's majority, so it scores nothing.
    const byVoter = new Map<string, { name: string; hits: number }>();
    for (const vote of votes) {
      const entry = byVoter.get(vote.voterKey) ?? { name: vote.voterName, hits: 0 };
      if (!byChance.includes(vote.verb) && majority[vote.verb] === vote.label) entry.hits += 1;
      byVoter.set(vote.voterKey, entry);
    }
    let scorers = 0;
    for (const [voterKey, { name, hits }] of byVoter) {
      if (hits > 0) scorers += 1;
      const row = await ctx.db
        .query('stagePoints')
        .withIndex('by_room_voter', (q) => q.eq('roomId', roomId).eq('voterKey', voterKey))
        .unique();
      if (row) {
        await ctx.db.patch(row._id, { points: row.points + hits, rounds: row.rounds + 1, voterName: name });
      } else {
        await ctx.db.insert('stagePoints', { roomId, voterKey, voterName: name, points: hits, rounds: 1 });
      }
    }

    const reveal: StageReveal = {
      round: stage.round,
      voters: byVoter.size,
      tallies,
      majority,
      byChance,
      scorers,
    };
    await writeStage(ctx, roomId, {
      ...stage,
      phase: 'revealed',
      step: step + 1,
      line: undefined,
      reveal,
      pending: undefined,
      deadline: undefined,
    });
    await appendEvent(ctx, roomId, {
      type: 'system',
      actorName: 'stage',
      body: `Votes are in: ${byVoter.size} voter${byVoter.size === 1 ? '' : 's'}, ${scorers} with the majority.`,
      data: { kind: 'stage-reveal', ...reveal },
    });

    if (stage.onReveal) {
      await ctx.scheduler.runAfter(0, makeFunctionReference<'mutation'>(stage.onReveal), {
        roomId,
        round: stage.round,
        reveal,
      } as never);
    }
  },
});

/**
 * The audience's pick per verb. Ties and silence are broken at random and
 * flagged as chance. In an exclusive stage the picks are assigned greedily —
 * strongest (verb, entrant) pair first, each verb and each entrant used once —
 * so nobody is both married and murdered.
 */
function pickMajority(stage: StageState, tallies: Record<string, Record<string, number>>) {
  const majority: Record<string, string> = {};
  const byChance: string[] = [];
  const usedLabels = new Set<string>();
  // Shuffle first so equal counts are ordered at random, then stable-sort by count.
  const pairs = stage.verbs
    .flatMap((verb) => stage.entrants.map((e) => ({ verb, label: e.label, n: tallies[e.label]?.[verb] ?? 0, r: Math.random() })))
    .sort((a, b) => b.n - a.n || a.r - b.r);
  const verbsLeft = new Set(stage.verbs);
  for (const p of pairs) {
    if (!verbsLeft.has(p.verb)) continue;
    if (stage.exclusive && usedLabels.has(p.label)) continue;
    // Chance if this pick has no votes, or another still-available entrant tied it.
    const rivals = pairs.filter(
      (q) => q.verb === p.verb && q.label !== p.label && q.n === p.n && !(stage.exclusive && usedLabels.has(q.label)),
    );
    if (p.n === 0 || rivals.length > 0) byChance.push(p.verb);
    majority[p.verb] = p.label;
    verbsLeft.delete(p.verb);
    usedLabels.add(p.label);
  }
  return { majority, byChance };
}

/**
 * Pick a round back up after a pause. Scheduled transitions that landed during
 * the pause did nothing, so re-fire whatever is pending now; a vote that was
 * interrupted gets back the time it had left (at least ten seconds).
 */
export async function resumeStage(ctx: MutationCtx, roomId: Id<'rooms'>, pausedAt?: number) {
  const room = await ctx.db.get(roomId);
  if (!room) return;
  const stage = stageOf(room);
  if (!stage.pending) return;
  const step = stage.step + 1;
  const now = Date.now();
  if (stage.pending.kind === 'closeVoting') {
    const left = stage.votingEndsAt ? stage.votingEndsAt - (pausedAt ?? now) : stage.voteMs;
    const endsAt = now + Math.max(10_000, left);
    await writeStage(ctx, roomId, { ...stage, step, votingEndsAt: endsAt, deadline: endsAt });
    await ctx.scheduler.runAfter(endsAt - now, internal.stage.closeVoting, { roomId, step });
    return;
  }
  const voiceWait =
    stage.pending.kind === 'host' ||
    (stage.pending.kind === 'speak' && Boolean(stage.entrants[stage.pending.index]?.live));
  await writeStage(ctx, roomId, {
    ...stage,
    step,
    claimedUntil: undefined,
    deadline: now + (voiceWait ? VOICE_DEADLINE_MS : SPEAK_DEADLINE_MS),
  });
  if (stage.pending.kind === 'prepare') {
    await ctx.scheduler.runAfter(0, internal.stage.prepare, { roomId, step });
  } else if (stage.pending.kind === 'host') {
    await ctx.scheduler.runAfter(0, internal.stage.voiceHost, { roomId, step });
  } else if (stage.pending.kind === 'speak') {
    await ctx.scheduler.runAfter(0, internal.stage.speak, { roomId, step, index: stage.pending.index });
  } else {
    await ctx.scheduler.runAfter(0, internal.stage.openVoting, { roomId, step });
  }
}

/**
 * The watchdog. Every open board calls this every few seconds; it does nothing
 * unless the pending transition is past its deadline, in which case it fires it
 * again. The step guard makes a double fire harmless.
 */
export const tick = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const room = await getRoomBySlug(ctx, slug);
    if (!room || room.status !== 'running') return { fired: false };
    const stage = stageOf(room);
    if (!stage.pending || !stage.deadline || Date.now() < stage.deadline + TICK_GRACE_MS) {
      return { fired: false };
    }
    const roomId = room._id;
    const step = stage.step;
    // A render still inside its claim is not lost. Push the watchdog to the
    // claim so a room full of tabs does not post the same line again.
    if ((stage.claimedUntil ?? 0) > Date.now()) {
      await writeStage(ctx, roomId, { ...stage, deadline: stage.claimedUntil });
      return { fired: false };
    }
    const voiceJob =
      stage.pending.kind === 'prepare' ||
      stage.pending.kind === 'host' ||
      (stage.pending.kind === 'speak' && Boolean(stage.entrants[stage.pending.index]?.live));
    // Push the deadline out so a room full of tabs fires this once, not once each.
    await writeStage(ctx, roomId, {
      ...stage,
      claimedUntil: undefined,
      deadline: Date.now() + (voiceJob ? VOICE_DEADLINE_MS : SPEAK_DEADLINE_MS),
    });
    switch (stage.pending.kind) {
      case 'prepare':
        await ctx.scheduler.runAfter(0, internal.stage.prepare, { roomId, step });
        break;
      case 'host':
        await ctx.scheduler.runAfter(0, internal.stage.voiceHost, { roomId, step });
        break;
      case 'speak':
        await ctx.scheduler.runAfter(0, internal.stage.speak, { roomId, step, index: stage.pending.index });
        break;
      case 'openVoting':
        await ctx.scheduler.runAfter(0, internal.stage.openVoting, { roomId, step });
        break;
      case 'closeVoting':
        await ctx.scheduler.runAfter(0, internal.stage.closeVoting, { roomId, step });
        break;
    }
    return { fired: true, pending: stage.pending.kind };
  },
});

/** Cut the voting short — the host's "lock it in". */
export const closeNow = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const room = await getRoomBySlug(ctx, slug);
    if (!room) return;
    const stage = stageOf(room);
    if (stage.phase !== 'voting') return;
    await ctx.scheduler.runAfter(0, internal.stage.closeVoting, { roomId: room._id, step: stage.step });
  },
});

// ─── Votes ────────────────────────────────────────────────────────────────────

async function votesFor(ctx: QueryCtx | MutationCtx, roomId: Id<'rooms'>, round: number) {
  return await ctx.db
    .query('stageVotes')
    .withIndex('by_room_round', (q) => q.eq('roomId', roomId).eq('round', round))
    .collect();
}

function tally(stage: StageState, votes: Doc<'stageVotes'>[]) {
  const out: Record<string, Record<string, number>> = {};
  for (const e of stage.entrants) {
    out[e.label] = Object.fromEntries(stage.verbs.map((verb) => [verb, 0]));
  }
  for (const vote of votes) {
    if (out[vote.label] && vote.verb in out[vote.label]) out[vote.label][vote.verb] += 1;
  }
  return out;
}

export type VoteResult =
  | { accepted: true }
  | { accepted: false; reason: 'no-room' | 'not-voting' | 'bad-label' | 'bad-verb' };

/**
 * Record one vote. The single path for both the buttons and Twitch.
 *
 * `voterKey` is deliberately not checked against the room's members: a Twitch
 * viewer votes as `twitch:<login>` and never joins. Voting again replaces your
 * vote for that verb — still one vote per voter per verb per round. In an
 * exclusive stage (marry/mate/murder) giving a verb to an entrant also takes
 * away whatever other verb you had given that entrant, so each voter ends with
 * at most one verb per entrant.
 */
export async function recordVote(
  ctx: MutationCtx,
  args: { slug: string; voterKey: string; voterName?: string; label: string; verb: string },
): Promise<VoteResult> {
  const room = await getRoomBySlug(ctx, args.slug);
  if (!room) return { accepted: false, reason: 'no-room' };
  const stage = stageOf(room);
  if (room.status !== 'running' || stage.phase !== 'voting') return { accepted: false, reason: 'not-voting' };
  const label = args.label.trim().toUpperCase();
  const verb = args.verb.trim().toLowerCase();
  if (!stage.entrants.some((e) => e.label === label)) return { accepted: false, reason: 'bad-label' };
  if (!stage.verbs.includes(verb)) return { accepted: false, reason: 'bad-verb' };

  const voterKey = args.voterKey.trim().slice(0, 128);
  const voterName = (args.voterName ?? voterKey).trim().slice(0, 64) || voterKey;
  const mine = await ctx.db
    .query('stageVotes')
    .withIndex('by_room_round_voter', (q) =>
      q.eq('roomId', room._id).eq('round', stage.round).eq('voterKey', voterKey),
    )
    .collect();
  for (const row of mine) {
    if (row.verb === verb || (stage.exclusive && row.label === label)) await ctx.db.delete(row._id);
  }
  await ctx.db.insert('stageVotes', {
    roomId: room._id,
    round: stage.round,
    voterKey,
    voterName,
    verb,
    label,
  });
  return { accepted: true };
}

export const castVote = mutation({
  args: {
    slug: v.string(),
    voterKey: v.string(),
    voterName: v.optional(v.string()),
    label: v.string(),
    verb: v.string(),
  },
  handler: async (ctx, args): Promise<VoteResult> => await recordVote(ctx, args),
});

/** Same as `castVote`, for server-side callers (the Twitch bridge). */
export const castVoteInternal = internalMutation({
  args: {
    slug: v.string(),
    voterKey: v.string(),
    voterName: v.optional(v.string()),
    label: v.string(),
    verb: v.string(),
  },
  handler: async (ctx, args): Promise<VoteResult> => await recordVote(ctx, args),
});

// ─── What the board reads ─────────────────────────────────────────────────────

/**
 * Everything a stage board renders. `tallies` are live during voting — the
 * percentages under each frame move as votes land — and `mine` is the caller's
 * own votes this round, keyed by verb.
 */
export const state = query({
  args: { slug: v.string(), voterKey: v.optional(v.string()) },
  handler: async (ctx, { slug, voterKey }) => {
    const room = await getRoomBySlug(ctx, slug);
    if (!room) return null;
    const stage = stageOf(room);
    const votes = stage.round > 0 ? await votesFor(ctx, room._id, stage.round) : [];
    const tallies = tally(stage, votes);
    const totals: Record<string, number> = Object.fromEntries(
      stage.verbs.map((verb) => [verb, votes.filter((x) => x.verb === verb).length]),
    );
    const mine: Record<string, string> = {};
    if (voterKey) for (const x of votes) if (x.voterKey === voterKey) mine[x.verb] = x.label;

    const ledger = await ctx.db
      .query('stagePoints')
      .withIndex('by_room', (q) => q.eq('roomId', room._id))
      .collect();
    const leaderboard = ledger
      .sort((a, b) => b.points - a.points || a.rounds - b.rounds)
      .slice(0, 10)
      .map((r) => ({ voterKey: r.voterKey, name: r.voterName, points: r.points, rounds: r.rounds }));
    const me = voterKey ? ledger.find((r) => r.voterKey === voterKey) : undefined;

    // System prompts are the mode's business, not the audience's. The opening
    // line and the claim are the clock's, not the board's.
    const entrants = stage.entrants.map(({ system: _system, fallbackLine: _f, ...rest }) => rest);
    const { pending: _pending, openingLine: _opening, claimedUntil: _claimed, ...board } = stage;

    return {
      status: room.status,
      stage: { ...board, entrants },
      tallies,
      totals,
      voters: new Set(votes.map((x) => x.voterKey)).size,
      mine,
      leaderboard,
      myPoints: me?.points ?? 0,
    };
  },
});
