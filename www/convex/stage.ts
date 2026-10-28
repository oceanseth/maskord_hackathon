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
import { callModel, hasInference } from './agent';

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
  /** Passed through to the board's voice; browser TTS reads pitch/rate. */
  voice?: { pitch?: number; rate?: number; avatarGroupId?: string; ownerUid?: string };
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
};

export const DEFAULT_VOTE_MS = 30_000;
const LINE_MAX_WORDS = 60;
/** Grace past a deadline before `tick` steps in — scheduled jobs are usually on time. */
const TICK_GRACE_MS = 8_000;
/** A model call that has not come back by now is treated as lost. */
const SPEAK_DEADLINE_MS = 30_000;
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

  let stage: StageState = {
    ...prev,
    phase: 'speeches',
    round,
    step,
    verbs: opts.verbs,
    exclusive: Boolean(opts.exclusive),
    entrants: opts.entrants,
    line: undefined,
    lines: [],
    voteMs: opts.voteMs ?? DEFAULT_VOTE_MS,
    votingEndsAt: undefined,
    reveal: undefined,
    onReveal: opts.onReveal,
    caption: opts.caption,
    pending: { kind: 'speak', index: 0 },
  };

  let firstAt = 600;
  if (opts.hostLine) {
    stage = await sayAsHost(ctx, roomId, stage, opts.hostLine);
    firstAt = (stage.line?.durationMs ?? 0) + GAP_MS;
  }
  stage.deadline = now + firstAt + SPEAK_DEADLINE_MS;
  await writeStage(ctx, roomId, stage);
  await ctx.scheduler.runAfter(firstAt, internal.stage.speak, { roomId, step, index: 0 });
  return round;
}

/**
 * Masky says something on stage — spoken by the boards, posted to the log —
 * without moving the round. Modes use it for their reveal commentary.
 */
export async function hostSay(ctx: MutationCtx, roomId: Id<'rooms'>, text: string) {
  const room = await ctx.db.get(roomId);
  if (!room) return;
  await writeStage(ctx, roomId, await sayAsHost(ctx, roomId, stageOf(room), text));
}

async function sayAsHost(
  ctx: MutationCtx,
  roomId: Id<'rooms'>,
  stage: StageState,
  text: string,
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

    await ctx.runMutation(internal.stage.lineSpoken, { roomId, step, index, text });
  },
});

export const lineSpoken = internalMutation({
  args: { roomId: v.id('rooms'), step: v.number(), index: v.number(), text: v.string() },
  handler: async (ctx, { roomId, step, index, text }) => {
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
    };
    const nextStep = step + 1;
    const after = line.durationMs + GAP_MS;
    const last = index + 1 >= stage.entrants.length;
    const pending: Pending = last ? { kind: 'openVoting' } : { kind: 'speak', index: index + 1 };

    await writeStage(ctx, roomId, {
      ...stage,
      step: nextStep,
      line,
      lines: [...stage.lines, line],
      lineSeq: line.seq,
      pending,
      deadline: Date.now() + after + (last ? 0 : SPEAK_DEADLINE_MS),
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
    const majority: Record<string, string> = {};
    const byChance: string[] = [];
    for (const verb of stage.verbs) {
      const counts = stage.entrants.map((e) => ({ label: e.label, n: tallies[e.label]?.[verb] ?? 0 }));
      const top = Math.max(0, ...counts.map((c) => c.n));
      const leaders = counts.filter((c) => c.n === top);
      if (leaders.length === 0) continue;
      if (leaders.length > 1 || top === 0) byChance.push(verb);
      majority[verb] = leaders[Math.floor(Math.random() * leaders.length)].label;
    }

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
    // Push the deadline out so a room full of tabs fires this once, not once each.
    await writeStage(ctx, roomId, { ...stage, deadline: Date.now() + SPEAK_DEADLINE_MS });
    switch (stage.pending.kind) {
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
  if (stage.phase !== 'voting') return { accepted: false, reason: 'not-voting' };
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

    // System prompts are the mode's business, not the audience's.
    const entrants = stage.entrants.map(({ system: _system, fallbackLine: _f, ...rest }) => rest);

    return {
      status: room.status,
      stage: { ...stage, entrants, pending: undefined },
      tallies,
      totals,
      voters: new Set(votes.map((x) => x.voterKey)).size,
      mine,
      leaderboard,
      myPoints: me?.points ?? 0,
    };
  },
});
