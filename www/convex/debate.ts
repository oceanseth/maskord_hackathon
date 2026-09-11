import { v } from 'convex/values';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { api, internal } from './_generated/api';
import { TURN_CLAIM_TTL_MS, appendEvent, getRoomBySlug, joinMember, setPhase } from './rooms';
import { skillFor } from './skills';
import { HOUSE_MASKS } from './cast';
import { callModel, hasInference, judgeModel } from './agent';
import { callNebius, hasNebius, type NebiusMeasurement } from './nebius';
import { RENTED_PREFIX } from './rentable';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';

/**
 * The debate mode. Masks argue a topic in character, fact-check each other
 * through Linkup, and Masky moderates and calls it at the end.
 *
 * Everything a spectator needs is in the room's `config` and the shared event
 * log, so /debatestats.html is a pure reader — no second source of truth, and a
 * late joiner sees the same debate as someone who was there from the open.
 */

const MAX_ROUNDS = 4;

/** Bounds how fast an unauthenticated spectator can spend Linkup credit. */
const FACT_CHECK_COOLDOWN_MS = 15_000;

/**
 * Drawn 1–2 at a time to twist the goal. Kept as data rather than prose in a
 * prompt so the UI can show exactly what is in force and the judge can score
 * against the same list the debaters were given.
 */
export const RULE_DECK: Array<{ id: string; label: string; instruction: string }> = [
  { id: 'no-numbers', label: 'No statistics',
    instruction: 'You may not cite any number or statistic. Argue from principle and example only.' },
  { id: 'steelman', label: 'Steelman first',
    instruction: 'Begin every turn by stating your opponent\'s strongest point in one sentence before answering it.' },
  { id: 'one-breath', label: 'One breath',
    instruction: 'Your turn must be at most three sentences. Brevity is scored.' },
  { id: 'in-character-only', label: 'Never break character',
    instruction: 'Never acknowledge being an AI, a model, or in a demo. You are only who you are.' },
  { id: 'cite-or-concede', label: 'Cite or concede',
    instruction: 'Any factual claim you make must be backed by research you triggered, or withdrawn when challenged.' },
  { id: 'compliment', label: 'Gracious',
    instruction: 'Pay your opponent one sincere compliment each turn. It must be specific and it must be earned.' },
  { id: 'metaphor', label: 'Speak in metaphor',
    instruction: 'Make at least one point per turn entirely through metaphor or analogy.' },
];

export const SCORING_CRITERIA = [
  { id: 'entertainment', label: 'Entertainment value' },
  { id: 'argument', label: 'Argument quality' },
  { id: 'evidence', label: 'Use of evidence' },
  { id: 'character', label: 'Staying in character' },
] as const;

export type DebateConfig = {
  topic?: string;
  rules?: Array<{ id: string; label: string; instruction: string }>;
  round?: number;
  maxRounds?: number;
  /** memberKeys in speaking order, rebuilt whenever the roster changes. */
  order?: string[];
  cursor?: number;
  lastFactCheckAt?: number;
  verdict?: {
    winner: string;
    summary: string;
    scores: Array<{ memberKey: string; name: string; total: number; byCriterion: Record<string, number>; note: string }>;
    /** What the judging call cost — model, wall-clock, tokens. See `nebius.ts`. */
    measurement?: NebiusMeasurement;
  };
};

function config(room: Doc<'rooms'>): DebateConfig {
  return (room.config ?? {}) as DebateConfig;
}

type Rule = { id: string; label: string; instruction: string };

function drawRules(seed = Math.random()): Rule[] {
  const deck = [...RULE_DECK];
  const count = seed < 0.5 ? 1 : 2;
  const picked: Rule[] = [];
  for (let i = 0; i < count && deck.length; i += 1) {
    picked.push(deck.splice(Math.floor(Math.random() * deck.length), 1)[0]);
  }
  return picked;
}

function speakerSystemPrompt(
  member: Doc<'roomMembers'>,
  cfg: DebateConfig,
  others: string[],
): string {
  const rules = (cfg.rules ?? []).map((r) => `- ${r.label}: ${r.instruction}`).join('\n');
  return [
    `You are ${member.name}, taking part in a live debate in front of an audience.`,
    member.persona ? `Who you are: ${member.persona}` : '',
    `The motion: ${cfg.topic ?? '(not yet set)'}`,
    others.length ? `Your opponents: ${others.join(', ')}.` : '',
    rules ? `House rules in force this round — breaking one loses you points:\n${rules}` : '',
    '',
    'Argue in your own voice. Be entertaining as well as persuasive; a dull correct',
    'answer loses to a vivid one. Address what was actually said before you rather',
    'than restating your opening. Two short paragraphs at most.',
    '',
    'If you want to challenge a factual claim — your opponent\'s or your own — call',
    'the `research` tool with the claim stated plainly. Ask for it the way your',
    'character would, then carry on; the room will read the findings out.',
  ]
    .filter(Boolean)
    .join('\n');
}

const RESEARCH_TOOL = {
  name: 'research',
  description:
    'Have the room search the web for evidence about a specific factual claim, ' +
    'and report back what it finds. Use for claims that can actually be settled.',
  input_schema: {
    type: 'object',
    properties: {
      claim: { type: 'string', description: 'The claim to investigate, stated plainly.' },
    },
    required: ['claim'],
  },
};

/**
 * The house panel. Deliberately the same three characters the D&D table seats,
 * imported rather than re-described: one cast across both rooms reads as one
 * product, and a persona that has been tuned in one place stays tuned in both.
 *
 * A debate needs *someone* on the floor. `order` is built from seated masks, so
 * before this existed an empty room produced a motion, house rules, and then
 * silence — no debaters, nothing to advance, key or no key.
 */
export const cast = query({
  args: {},
  handler: async () => HOUSE_MASKS,
});

const seatArgs = {
  slug: v.string(),
  memberKey: v.string(),
  name: v.string(),
  persona: v.string(),
  avatarUrl: v.optional(v.string()),
};

type SeatArgs = {
  slug: string;
  memberKey: string;
  name: string;
  persona: string;
  avatarUrl?: string;
};

async function seat(ctx: MutationCtx, { slug, memberKey, name, persona, avatarUrl }: SeatArgs) {
  const room = await getRoomBySlug(ctx, slug);
  if (!room) throw new Error('no such room');
  await joinMember(ctx, room._id, { memberKey, kind: 'mask', name, persona, avatarUrl });
  await addToOrder(ctx, room._id, memberKey);
  return { seated: true as const };
}

/**
 * Seat one mask as a debater. Used for the house panel and for your own avatar.
 *
 * Somebody else's mask is refused here on purpose. A `rent:` key is the paid
 * feature, and the entitlement can only be checked by an action that can reach
 * RevenueCat — so that path goes through `rentable.seatRented` and this one stays
 * the free door. Without the refusal the gate would be decoration: the shelf
 * hands the client the persona, and this mutation would have seated it.
 */
export const seatMask = mutation({
  args: seatArgs,
  handler: async (ctx, args) => {
    if (args.memberKey.startsWith(RENTED_PREFIX)) {
      throw new Error('a rented mask is seated through rentable.seatRented, which verifies maskord_pro');
    }
    return await seat(ctx, args);
  },
});

/** The same seating, reached only after `rentable.seatRented` has verified the entitlement. */
export const seatMaskInternal = internalMutation({
  args: seatArgs,
  handler: async (ctx, args) => await seat(ctx, args),
});

export const unseatMask = mutation({
  args: { slug: v.string(), memberKey: v.string() },
  handler: async (ctx, { slug, memberKey }) => {
    const room = await getRoomBySlug(ctx, slug);
    if (!room) throw new Error('no such room');
    const member = await ctx.db
      .query('roomMembers')
      .withIndex('by_room_member', (q) => q.eq('roomId', room._id).eq('memberKey', memberKey))
      .unique();
    if (member && member.kind === 'mask') await ctx.db.delete(member._id);
    const cfg = config(room);
    await ctx.db.patch(room._id, {
      config: { ...(room.config ?? {}), order: (cfg.order ?? []).filter((k) => k !== memberKey) },
    });
    return { unseated: true as const };
  },
});

/**
 * Keep the speaking order in step with the roster. Appending rather than
 * rebuilding matters once a debate is under way: `cursor` indexes into this
 * list, so reordering it would hand the floor to the wrong debater.
 */
async function addToOrder(ctx: MutationCtx, roomId: Id<'rooms'>, memberKey: string) {
  const room = await ctx.db.get(roomId);
  if (!room) return;
  const cfg = (room.config ?? {}) as DebateConfig;
  const order = cfg.order ?? [];
  if (order.includes(memberKey)) return;
  await ctx.db.patch(roomId, { config: { ...(room.config ?? {}), order: [...order, memberKey] } });
}

/**
 * A human joining or leaving the speaking order. Spectating is the default —
 * you can watch, heckle and fact-check without ever holding the floor — and
 * this is the opt-in. Scoring follows automatically: the judge is handed every
 * non-host member, so a human who argued is judged on the same four criteria
 * as the masks.
 */
export const takeFloor = mutation({
  args: { slug: v.string(), memberKey: v.string() },
  handler: async (ctx, { slug, memberKey }) => {
    const room = await getRoomBySlug(ctx, slug);
    if (!room) throw new Error('no such room');
    const member = await ctx.db
      .query('roomMembers')
      .withIndex('by_room_member', (q) => q.eq('roomId', room._id).eq('memberKey', memberKey))
      .unique();
    if (!member) throw new Error('join the room first');
    await addToOrder(ctx, room._id, memberKey);
    await appendEvent(ctx, room._id, {
      type: 'system',
      actorKey: memberKey,
      actorName: member.name,
      body: `${member.name} joined the debate.`,
      data: { kind: 'floor-join' },
    });
    return { onTheFloor: true as const };
  },
});

export const leaveFloor = mutation({
  args: { slug: v.string(), memberKey: v.string() },
  handler: async (ctx, { slug, memberKey }) => {
    const room = await getRoomBySlug(ctx, slug);
    if (!room) throw new Error('no such room');
    const cfg = config(room);
    await ctx.db.patch(room._id, {
      config: { ...(room.config ?? {}), order: (cfg.order ?? []).filter((k) => k !== memberKey) },
    });
    return { onTheFloor: false as const };
  },
});

/** Seat the whole house panel at once. Idempotent. */
export const seatHouseCast = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const room = await getRoomBySlug(ctx, slug);
    if (!room) throw new Error('no such room');
    for (const m of HOUSE_MASKS) {
      await joinMember(ctx, room._id, {
        memberKey: m.key, kind: 'mask', name: m.name, persona: m.persona,
      });
      await addToOrder(ctx, room._id, m.key);
    }
    return { seated: HOUSE_MASKS.length };
  },
});

// ─── Setup ────────────────────────────────────────────────────────────────────

export const state = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const room = await getRoomBySlug(ctx, slug);
    if (!room) return null;
    const cfg = config(room);
    return {
      topic: cfg.topic ?? null,
      rules: cfg.rules ?? [],
      round: cfg.round ?? 0,
      maxRounds: cfg.maxRounds ?? MAX_ROUNDS,
      order: cfg.order ?? [],
      cursor: cfg.cursor ?? 0,
      verdict: cfg.verdict ?? null,
      status: room.status,
      phase: room.phase ?? 'setup',
    };
  },
});

/** Phase writes for the `start` action, which cannot touch the database itself. */
export const movePhase = internalMutation({
  args: { roomId: v.id('rooms'), phase: v.string(), byName: v.string() },
  handler: async (ctx, { roomId, phase, byName }) => {
    await setPhase(ctx, roomId, phase, { byName });
  },
});

export const applyConfig = internalMutation({
  args: { roomId: v.id('rooms'), patch: v.any() },
  handler: async (ctx, { roomId, patch }) => {
    const room = await ctx.db.get(roomId);
    if (!room) throw new Error('room is gone');
    await ctx.db.patch(roomId, { config: { ...(room.config ?? {}), ...patch } });
  },
});

/**
 * Open the debate: pick a motion if none was given, draw the house rules, fix
 * the speaking order, and let the moderator set the scene.
 *
 * Safe to call twice — a debate that is already running keeps its motion.
 */
export const start = action({
  args: { slug: v.string(), topic: v.optional(v.string()) },
  handler: async (ctx, { slug, topic }): Promise<{ topic: string; rules: string[] }> => {
    const room = await ctx.runQuery(internal.debate.roomFor, { slug });
    if (!room) throw new Error(`No debate room "${slug}"`);

    const existing = (room.config ?? {}) as DebateConfig;
    if (existing.topic && room.status === 'running') {
      return { topic: existing.topic, rules: (existing.rules ?? []).map((r) => r.label) };
    }

    let motion = topic?.trim() || existing.topic;
    if (!motion) {
      const cfg0 = (room.config ?? {}) as { guildId?: string; startedBy?: string };
      motion = hasInference(cfg0.guildId)
        ? await generateTopic(room.memberNames, cfg0)
        : FALLBACK_TOPIC;
    }

    const rules = drawRules();

    // Build the order from everyone already signed up — humans who took the
    // floor before the motion was set are in `existing.order` and must survive,
    // which they did not when this rebuilt the list from masks alone.
    const already = existing.order ?? [];
    let order = [...already, ...room.speakerKeys.filter((k) => !already.includes(k))];

    // Seat the house panel when no mask is on the floor — keyed on masks, not
    // on the order being empty, because a lone human who took the floor would
    // otherwise open a debate against nobody. A debate needs opponents.
    if (room.speakerKeys.length === 0) {
      await ctx.runMutation(api.debate.seatHouseCast, { slug });
      order = [...order, ...HOUSE_MASKS.map((m) => m.key).filter((k) => !order.includes(k))];
    }

    await ctx.runMutation(internal.debate.applyConfig, {
      roomId: room._id,
      patch: { topic: motion, rules, round: 1, maxRounds: MAX_ROUNDS, order, cursor: 0 },
    });

    // The motion exists and the panel is live: that is what `arguing` means.
    await ctx.runMutation(internal.debate.movePhase, {
      roomId: room._id,
      phase: 'arguing',
      byName: room.hostName,
    });

    await ctx.runMutation(internal.agent.emitEvent, {
      roomId: room._id,
      type: 'host',
      actorKey: 'host',
      actorName: room.hostName,
      body:
        `Tonight's motion: ${motion}\n\n` +
        `House rules: ${rules.map((r) => r.label).join(' · ') || 'none'}\n` +
        `${order.length} debaters, ${MAX_ROUNDS} rounds. Let's begin.`,
      data: { kind: 'opening', topic: motion, rules },
    });

    await ctx.runMutation(internal.debate.setRunning, { roomId: room._id });
    await ctx.scheduler.runAfter(500, internal.debate.takeTurn, { roomId: room._id });

    return { topic: motion, rules: rules.map((r) => r.label) };
  },
});

const FALLBACK_TOPIC =
  'Be it resolved: a convincing lie does more good in the world than an inconvenient truth.';

async function generateTopic(
  names: string[],
  creds: { guildId?: string; startedBy?: string },
): Promise<string> {
  const reply = await callModel({
    system:
      'You write debate motions for a live, comedic, high-stakes panel show. One line, ' +
      'starting "Be it resolved:". It must be genuinely arguable from both sides, specific ' +
      'enough to produce concrete arguments, and fun. Reply with the motion only.',
    messages: [
      {
        role: 'user',
        content: `Tonight's panel: ${names.join(', ') || 'an unknown cast'}. Write a motion that will make them clash.`,
      },
    ],
    maxTokens: 200,
    guildId: creds.guildId,
    onBehalfOf: creds.startedBy,
  });
  return reply.text.split('\n')[0].trim().slice(0, 300) || FALLBACK_TOPIC;
}

export const roomFor = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const room = await getRoomBySlug(ctx, slug);
    if (!room) return null;
    const members = await ctx.db
      .query('roomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', room._id))
      .collect();
    return {
      _id: room._id,
      status: room.status,
      config: room.config,
      hostName: room.hostName,
      memberNames: members.filter((m) => m.kind !== 'host').map((m) => m.name),
      speakerKeys: members.filter((m) => m.kind === 'mask').map((m) => m.memberKey),
    };
  },
});

export const setRunning = internalMutation({
  args: { roomId: v.id('rooms') },
  handler: async (ctx, { roomId }) => {
    await ctx.db.patch(roomId, { status: 'running' });
  },
});

// ─── Running the debate ───────────────────────────────────────────────────────

/**
 * Hand the floor to whoever is next and schedule their turn. A paused room is
 * left alone — pause is what a human uses to interrupt, and a queued turn that
 * fires through a pause would talk over them.
 */
export const takeTurn = internalMutation({
  args: { roomId: v.id('rooms') },
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get(roomId);
    if (!room || room.status !== 'running') return;

    const cfg = config(room);
    const order = cfg.order ?? [];
    if (!order.length) return;

    const cursor = cfg.cursor ?? 0;
    const round = cfg.round ?? 1;

    if (round > (cfg.maxRounds ?? MAX_ROUNDS)) {
      // Close the room in the same transaction that schedules the verdict.
      // `advance` only fires while status is 'running', so this is what stops a
      // ticking client from queueing a second judgement — and the judge runs on
      // the expensive model, so a duplicate is real money rather than noise.
      await ctx.db.patch(roomId, { status: 'finished' });
      await ctx.scheduler.runAfter(0, internal.debate.verdict, { roomId });
      return;
    }

    // One speaker at a time. Every open tab runs the advance timer, so without
    // this the table and the stats screen talk over each other. The claim is a
    // lease with a TTL rather than a claim/release pair: `runTurn` is a shared
    // action that knows nothing about debates, so there is nobody to hand the
    // lease back, and a crashed turn must not wedge the room forever.
    const now = Date.now();
    const held = room.turn.claimedAt && room.turn.claimedAt + TURN_CLAIM_TTL_MS > now;
    if (held) return;
    await ctx.db.patch(roomId, {
      turn: { runnerId: 'debate', claimedAt: now, seq: room.turn.seq + 1 },
    });

    const memberKey = order[cursor % order.length];
    const member = await ctx.db
      .query('roomMembers')
      .withIndex('by_room_member', (q) => q.eq('roomId', roomId).eq('memberKey', memberKey))
      .unique();
    if (!member) return;

    const others = (
      await ctx.db.query('roomMembers').withIndex('by_room', (q) => q.eq('roomId', roomId)).collect()
    )
      .filter((m) => m.kind !== 'host' && m.memberKey !== memberKey)
      .map((m) => m.name);

    // A human on the floor is invited to speak, never spoken for. Without this
    // the model would argue *as* them the moment they joined the order, which
    // is the opposite of taking part. Their window is the turn lease: say
    // something before it expires and it lands in the transcript the judge
    // reads; stay quiet and the floor moves on, so one idle spectator cannot
    // stall the debate.
    if (member.kind === 'human') {
      await appendEvent(ctx, roomId, {
        type: 'host',
        actorKey: 'host',
        actorName: room.hostName,
        body: `${member.name}, the floor is yours.`,
        data: { kind: 'floor', memberKey, round },
      });
      await advanceCursor(ctx, roomId, order.length, cursor, round);
      return;
    }

    await ctx.scheduler.runAfter(0, internal.agent.runTurn, {
      roomId,
      memberKey,
      actorName: member.name,
      system: speakerSystemPrompt(member, cfg, others),
      prompt: `Round ${round} of ${cfg.maxRounds ?? MAX_ROUNDS}. You have the floor.`,
      tools: [RESEARCH_TOOL],
      resolver: 'debate:onToolCall',
      turnToken: room.turn.seq,
    });

    await advanceCursor(ctx, roomId, order.length, cursor, round);
  },
});

/**
 * Advance the cursor when a turn is *handed out*, not when it comes back.
 * A turn that never answers — a failed model call, a human who says nothing —
 * must not wedge the debate on one speaker.
 */
async function advanceCursor(
  ctx: MutationCtx,
  roomId: Id<'rooms'>,
  size: number,
  cursor: number,
  round: number,
) {
  const room = await ctx.db.get(roomId);
  if (!room) return;
  const next = cursor + 1;
  await ctx.db.patch(roomId, {
    config: {
      ...(room.config ?? {}),
      cursor: next % size,
      round: next >= size ? round + 1 : round,
    },
  });
}

/**
 * Tool calls from a debater. Research is the only one the debate offers — the
 * mask asks for a fact-check in character and the Linkup loop does the rest.
 */
export const onToolCall = internalMutation({
  args: {
    roomId: v.id('rooms'),
    memberKey: v.string(),
    turnToken: v.optional(v.number()),
    call: v.any(),
  },
  handler: async (ctx, { roomId, memberKey, call }) => {
    const { name, input } = call as { name: string; input: Record<string, unknown> };
    if (name !== 'research') return;

    const claim = String(input.claim ?? '').trim();
    if (!claim) return;

    const member = await ctx.db
      .query('roomMembers')
      .withIndex('by_room_member', (q) => q.eq('roomId', roomId).eq('memberKey', memberKey))
      .unique();

    await ctx.scheduler.runAfter(0, internal.research.investigate, {
      roomId,
      claim,
      askedBy: member?.name ?? memberKey,
    });
  },
});

/** Nudge the debate on one step. The UI calls this on a timer while running. */
export const advance = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const room = await getRoomBySlug(ctx, slug);
    if (!room || room.status !== 'running') return { advanced: false };
    await ctx.scheduler.runAfter(0, internal.debate.takeTurn, { roomId: room._id });
    return { advanced: true };
  },
});

/**
 * A human taking the floor. Their message is already in the log via rooms.post;
 * this asks the room to background-check whatever they contested, which is the
 * "room fires research between turns" half of the loop.
 */
export const factCheck = mutation({
  args: { slug: v.string(), claim: v.string() },
  handler: async (ctx, { slug, claim }) => {
    const room = await getRoomBySlug(ctx, slug);
    if (!room) throw new Error('no such room');
    // Public by necessity — a spectator presses this — so it is also the one
    // place an anonymous visitor can spend Linkup credit. Two cheap bounds: the
    // debate has to be under way, and one check per room per cooldown.
    if (room.status === 'lobby') return { queued: false as const, reason: 'not-started' };
    const cfg = config(room);
    const since = Date.now() - (cfg.lastFactCheckAt ?? 0);
    if (since < FACT_CHECK_COOLDOWN_MS) {
      return { queued: false as const, reason: 'cooldown' };
    }
    await ctx.db.patch(room._id, {
      config: { ...(room.config ?? {}), lastFactCheckAt: Date.now() },
    });
    await ctx.scheduler.runAfter(0, internal.research.investigate, {
      roomId: room._id,
      claim: claim.trim().slice(0, 400),
      askedBy: 'room',
    });
    return { queued: true as const };
  },
});

// ─── Verdict ──────────────────────────────────────────────────────────────────

export const verdict = internalAction({
  args: { roomId: v.id('rooms') },
  handler: async (ctx, { roomId }): Promise<{ called: boolean }> => {
    const brief = await ctx.runQuery(internal.debate.verdictBrief, { roomId });
    if (!brief) return { called: false };

    const creds = await ctx.runQuery(internal.agent.roomCredentials, { roomId });
    if (!hasInference(creds.guildId)) {
      await ctx.runMutation(internal.agent.emitEvent, {
        roomId, type: 'system', actorName: 'room',
        body: 'Cannot call the debate: no AI key is reachable for this room.',
        data: { kind: 'missing-capability', capability: 'inference' },
      });
      return { called: false };
    }

    const criteria = SCORING_CRITERIA.map((c) => `${c.id} (${c.label})`).join(', ');
    const judgeSystem =
      `${skillFor('debate', 'verdict', { host: brief.hostName })}

` +
      `You are ${brief.hostName}, moderating a live debate, and you are calling it. ` +
      `Score every debater 0-10 on each of: ${criteria}. Reward wit and specificity; ` +
      `penalise breaking a house rule in force, and reward claims that were actually ` +
      `researched over claims merely asserted. Reply only with JSON matching ` +
      `{"winner":string,"summary":string,"scores":[{"name":string,"byCriterion":{"entertainment":number,` +
      `"argument":number,"evidence":number,"character":number},"note":string}]}. ` +
      `"summary" is two sentences, said out loud to the room, in your voice.`;

    const judgeUser =
      `Motion: ${brief.topic}\n` +
      `House rules: ${brief.rules.join(' · ') || 'none'}\n` +
      `Debaters: ${brief.debaters.map((d) => d.name).join(', ')}\n` +
      `Research the room ran: ${brief.researchCount} passes over ${brief.claims.length} claims` +
      `${brief.claims.length ? ` (${brief.claims.join('; ')})` : ''}\n\n` +
      `Transcript:\n${brief.transcript}`;

    // Nebius judges. The debaters speak through the room's own key; scoring runs
    // on a separate model on purpose, so the panel is never marking its own
    // homework. The cost is recorded either way — a refusal is a measurement
    // too, and the room falls back to the debaters' model rather than ending
    // with no verdict at all.
    let measurement: NebiusMeasurement | undefined;
    let reply: { text: string };

    const judgeWithRoomModel = () =>
      callModel({
        model: judgeModel(),
        system: judgeSystem,
        messages: [{ role: 'user' as const, content: judgeUser }],
        maxTokens: 1500,
        guildId: creds.guildId,
        onBehalfOf: creds.startedBy,
      });

    if (hasNebius()) {
      const scored = await callNebius({ system: judgeSystem, user: judgeUser, maxTokens: 1500 });
      measurement = scored.measurement;
      if (scored.measurement.ok) {
        reply = { text: scored.text };
      } else {
        await ctx.runMutation(internal.agent.emitEvent, {
          roomId,
          type: 'system',
          actorName: 'room',
          body: `The judge (${scored.measurement.model}) did not answer: ${scored.measurement.error}. Falling back.`,
          data: { kind: 'judge-fallback', measurement: scored.measurement },
        });
        reply = await judgeWithRoomModel();
      }
    } else {
      reply = await judgeWithRoomModel();
    }

    let parsed: {
      winner?: string;
      summary?: string;
      scores?: Array<{ name?: string; byCriterion?: Record<string, number>; note?: string }>;
    };
    try {
      parsed = JSON.parse(reply.text.replace(/^```(?:json)?|```$/gm, '').trim());
    } catch {
      await ctx.runMutation(internal.agent.emitEvent, {
        roomId, type: 'host', actorKey: 'host', actorName: brief.hostName,
        body: reply.text.slice(0, 2000),
      });
      await ctx.runMutation(internal.debate.finish, { roomId, verdict: null });
      return { called: true };
    }

    const scores = (parsed.scores ?? []).map((s) => {
      const by = s.byCriterion ?? {};
      const match = brief.debaters.find((d) => d.name === s.name);
      return {
        memberKey: match?.memberKey ?? s.name ?? 'unknown',
        name: s.name ?? 'unknown',
        byCriterion: by,
        total: SCORING_CRITERIA.reduce((sum, c) => sum + Number(by[c.id] ?? 0), 0),
        note: String(s.note ?? '').slice(0, 400),
      };
    });

    await ctx.runMutation(internal.agent.emitEvent, {
      roomId, type: 'host', actorKey: 'host', actorName: brief.hostName,
      body: `${parsed.summary ?? ''}\n\nThe debate goes to ${parsed.winner ?? 'nobody'}.`.trim(),
      data: { kind: 'verdict', winner: parsed.winner, scores, measurement },
    });

    await ctx.runMutation(internal.debate.finish, {
      roomId,
      verdict: { winner: parsed.winner ?? '', summary: parsed.summary ?? '', scores, measurement },
    });
    return { called: true };
  },
});

export const verdictBrief = internalQuery({
  args: { roomId: v.id('rooms') },
  handler: async (ctx, { roomId }: { roomId: Id<'rooms'> }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return null;
    const cfg = config(room);

    const members = await ctx.db
      .query('roomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();

    const events = await ctx.db
      .query('roomEvents')
      .withIndex('by_room_seq', (q) => q.eq('roomId', roomId))
      .collect();

    const findings = await ctx.db
      .query('research')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();

    return {
      topic: cfg.topic ?? '',
      rules: (cfg.rules ?? []).map((r) => `${r.label}: ${r.instruction}`),
      hostName: room.hostName,
      debaters: members
        .filter((m) => m.kind !== 'host')
        .map((m) => ({ memberKey: m.memberKey, name: m.name })),
      researchCount: findings.length,
      claims: [...new Set(findings.map((f) => f.claim))].slice(0, 10),
      transcript: events
        .filter((e) => e.type !== 'system')
        .map((e) => `${e.actorName}: ${e.body}`)
        .join('\n')
        .slice(-20000),
    };
  },
});

export const finish = internalMutation({
  args: { roomId: v.id('rooms'), verdict: v.any() },
  handler: async (ctx, { roomId, verdict: result }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return;
    await ctx.db.patch(roomId, {
      status: 'finished',
      config: { ...(room.config ?? {}), ...(result ? { verdict: result } : {}) },
    });
    // Closed, not merely stopped: Masky answers questions about the result
    // rather than reopening the argument.
    await setPhase(ctx, roomId, 'closed', { byName: room.hostName });
  },
});
