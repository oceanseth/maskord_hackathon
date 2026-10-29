import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { appendEvent, getRoomBySlug, joinMember, setPhase } from './rooms';
import { closeStage, hostSay, openRound, resetStage, stageOf, type StageEntrant } from './stage';
import {
  FRAME,
  LABELS,
  MODE,
  VERBS,
  defenseChat,
  defenseSystem,
  fallbackLine,
  hostLine,
  isLabel,
  isServerOwnedMask,
  orderSlots,
  revealSpeech,
  type Label,
  type ShowReveal,
} from './marrymatemurderShow';

/**
 * Marry, Mate, Murder on the shared stage.
 *
 * A server admin seats three masks the server owns. Starting a round hands
 * them to `openRound` — one defense each, then marry / mate / murder, one of
 * each per voter. The stage tallies, awards majority-match points, and calls
 * `onReveal`, which has Masky read the result and ends the show. Another
 * round keeps the scoreboard; reset clears it.
 */

const labelArg = v.union(v.literal('A'), v.literal('B'), v.literal('C'));

interface Slot {
  label: Label;
  memberKey: string;
  name: string;
  persona: string;
  avatarGroupId: string;
  ownerUid: string;
  avatarUrl?: string;
}

interface Mmm {
  slots: Slot[];
  round: number;
  /** The round `onReveal` is allowed to close. Cleared as it runs. */
  liveRound?: number;
}

function isSlot(value: unknown): value is Slot {
  if (!value || typeof value !== 'object') return false;
  const slot = value as Slot;
  return (
    isLabel(slot.label) &&
    typeof slot.memberKey === 'string' &&
    typeof slot.name === 'string' &&
    typeof slot.avatarGroupId === 'string' &&
    isServerOwnedMask(slot.memberKey, slot.avatarGroupId)
  );
}

function readMmm(room: Doc<'rooms'>): Mmm {
  const raw = (room.config as { mmm?: unknown } | undefined)?.mmm;
  if (!raw || typeof raw !== 'object') return { slots: [], round: 0 };
  const stored = raw as Partial<Mmm> & { slots?: unknown };
  return {
    slots: Array.isArray(stored.slots) ? stored.slots.filter(isSlot) : [],
    round: typeof stored.round === 'number' ? stored.round : 0,
    ...(typeof stored.liveRound === 'number' ? { liveRound: stored.liveRound } : {}),
  };
}

function isThisMode(room: Doc<'rooms'> | null): room is Doc<'rooms'> {
  return !!room && (room.kind as string) === MODE;
}

async function roomOf(ctx: MutationCtx, slug: string) {
  const room = await getRoomBySlug(ctx, slug);
  if (!isThisMode(room)) throw new Error('no such room');
  return room;
}

function seatingLocked(room: Doc<'rooms'>): boolean {
  const phase = stageOf(room).phase;
  return phase === 'speeches' || phase === 'voting' || phase === 'revealed';
}

async function writeMmm(ctx: MutationCtx, roomId: Id<'rooms'>, mmm: Mmm) {
  const room = await ctx.db.get(roomId);
  if (!room) throw new Error('no such room');
  await ctx.db.patch(roomId, { config: { ...(room.config ?? {}), mmm } });
}

async function dropMask(ctx: MutationCtx, roomId: Id<'rooms'>, memberKey: string) {
  const member = await ctx.db
    .query('roomMembers')
    .withIndex('by_room_member', (q) => q.eq('roomId', roomId).eq('memberKey', memberKey))
    .unique();
  if (member && member.kind === 'mask') await ctx.db.delete(member._id);
}

function publicSlot(slot: Slot) {
  return {
    label: slot.label,
    memberKey: slot.memberKey,
    name: slot.name,
    avatarUrl: slot.avatarUrl ?? null,
    avatarGroupId: slot.avatarGroupId,
  };
}

export const state = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const room = await getRoomBySlug(ctx, slug);
    if (!isThisMode(room)) return null;
    const mmm = readMmm(room);
    return {
      phase: room.phase ?? 'lobby',
      status: room.status,
      hostName: room.hostName,
      round: mmm.round,
      slots: orderSlots(mmm.slots).map(publicSlot),
    };
  },
});

export const seat = mutation({
  args: {
    slug: v.string(),
    label: labelArg,
    memberKey: v.string(),
    name: v.string(),
    persona: v.string(),
    avatarGroupId: v.string(),
    ownerUid: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const room = await roomOf(ctx, args.slug);
    if (seatingLocked(room)) throw new Error('the stage is locked while a round is on');
    if (!isServerOwnedMask(args.memberKey, args.avatarGroupId)) {
      throw new Error('only a mask the server owns can take the stage');
    }
    const mmm = readMmm(room);
    if (mmm.slots.some((slot) => slot.label !== args.label && slot.memberKey === args.memberKey)) {
      throw new Error('that mask is already on stage');
    }
    const next: Slot = {
      label: args.label,
      memberKey: args.memberKey,
      name: args.name.trim().slice(0, 64) || 'Mask',
      persona: args.persona.slice(0, 2000),
      avatarGroupId: args.avatarGroupId.trim(),
      ownerUid: (args.ownerUid ?? '').slice(0, 128),
      ...(args.avatarUrl ? { avatarUrl: args.avatarUrl } : {}),
    };
    const slots = [...mmm.slots.filter((slot) => slot.label !== args.label), next];
    await joinMember(ctx, room._id, {
      memberKey: next.memberKey,
      kind: 'mask',
      name: next.name,
      persona: next.persona,
      avatarUrl: next.avatarUrl,
    });
    const removed = mmm.slots.find((slot) => slot.label === args.label && slot.memberKey !== next.memberKey);
    if (removed && !slots.some((slot) => slot.memberKey === removed.memberKey)) {
      await dropMask(ctx, room._id, removed.memberKey);
    }
    await writeMmm(ctx, room._id, { ...mmm, slots });
    return { seated: true as const };
  },
});

export const unseat = mutation({
  args: { slug: v.string(), label: labelArg },
  handler: async (ctx, { slug, label }) => {
    const room = await roomOf(ctx, slug);
    if (seatingLocked(room)) throw new Error('the stage is locked while a round is on');
    const mmm = readMmm(room);
    const slot = mmm.slots.find((item) => item.label === label);
    if (!slot) return { seated: false as const };
    const slots = mmm.slots.filter((item) => item.label !== label);
    await dropMask(ctx, room._id, slot.memberKey);
    await writeMmm(ctx, room._id, { ...mmm, slots });
    return { seated: false as const };
  },
});

export const start = mutation({
  args: { slug: v.string(), byName: v.string(), startedBy: v.optional(v.string()) },
  handler: async (ctx, { slug, byName, startedBy }) => {
    const room = await roomOf(ctx, slug);
    const stage = stageOf(room);
    if (stage.phase === 'speeches' || stage.phase === 'voting' || stage.phase === 'revealed') {
      throw new Error('a round is already on');
    }
    const mmm = readMmm(room);
    const slots = orderSlots(mmm.slots);
    if (slots.length !== LABELS.length) throw new Error('seat three masks the server owns');
    if (new Set(slots.map((slot) => slot.memberKey)).size !== slots.length) {
      throw new Error('seat three different masks');
    }

    for (const slot of slots) {
      await joinMember(ctx, room._id, {
        memberKey: slot.memberKey,
        kind: 'mask',
        name: slot.name,
        persona: slot.persona,
        avatarUrl: slot.avatarUrl,
      });
    }

    // speak() refuses to advance a room that is not running. startedBy is who
    // the model call is billed to; the stage falls back to any human if absent.
    await ctx.db.patch(room._id, {
      status: 'running',
      ...(startedBy
        ? { config: { ...(room.config ?? {}), startedBy: startedBy.slice(0, 128) } }
        : {}),
    });
    const round = stage.round + 1;
    const entrants: StageEntrant[] = slots.map((slot) => ({
      label: slot.label,
      memberKey: slot.memberKey,
      name: slot.name,
      avatarUrl: slot.avatarUrl,
      emoji: FRAME[slot.label].emoji,
      color: FRAME[slot.label].color,
      system: defenseSystem(
        slot.name,
        slot.persona,
        slots.filter((other) => other.label !== slot.label).map((other) => other.name),
      ),
      // The mask's own /live conversation reasons the line; `system` is the fallback.
      chatPrompt: defenseChat(
        slots.filter((other) => other.label !== slot.label).map((other) => other.name),
      ),
      fallbackLine: fallbackLine(slot.name),
      voice: {
        pitch: FRAME[slot.label].pitch,
        rate: 1.05,
        avatarGroupId: slot.avatarGroupId,
        ...(slot.ownerUid ? { ownerUid: slot.ownerUid } : {}),
      },
    }));

    const opened = await openRound(ctx, room._id, {
      entrants,
      verbs: [...VERBS],
      exclusive: true,
      onReveal: 'marrymatemurder:onReveal',
      hostLine: hostLine(round, slots),
      caption: `Round ${round}`,
    });
    await writeMmm(ctx, room._id, { ...mmm, slots, round: opened, liveRound: opened });
    await setPhase(ctx, room._id, 'playing', { byName: byName.slice(0, 64) || room.hostName });
    return { started: true as const, round: opened };
  },
});

/** The stage's `onReveal`: say who the room picked, then end the show. */
export const onReveal = internalMutation({
  args: { roomId: v.id('rooms'), round: v.number(), reveal: v.any() },
  handler: async (ctx, { roomId, round, reveal }) => {
    const room = await ctx.db.get(roomId);
    if (!room || (room.kind as string) !== MODE) return;
    const mmm = readMmm(room);
    if (mmm.liveRound !== round) return;
    const stage = stageOf(room);
    await writeMmm(ctx, roomId, { slots: mmm.slots, round: mmm.round });
    await hostSay(ctx, roomId, revealSpeech(reveal as ShowReveal, stage.entrants));
    await closeStage(ctx, roomId);
    await setPhase(ctx, roomId, 'reveal', { byName: room.hostName });
    await ctx.db.patch(roomId, { status: 'finished' });
  },
});

/** Wipe the stage and the scoreboard. The three masks stay seated. */
export const reset = mutation({
  args: { slug: v.string(), byName: v.string() },
  handler: async (ctx, { slug, byName }) => {
    const room = await roomOf(ctx, slug);
    const mmm = readMmm(room);
    await resetStage(ctx, room._id);
    await writeMmm(ctx, room._id, { slots: mmm.slots, round: 0 });
    await ctx.db.patch(room._id, { status: 'lobby' });
    await setPhase(ctx, room._id, 'lobby', { byName: byName.slice(0, 64) || room.hostName });
    await appendEvent(ctx, room._id, {
      type: 'system',
      actorName: byName.slice(0, 64) || room.hostName,
      body: `${byName || room.hostName} cleared the stage and the scoreboard. The masks stay seated.`,
    });
    return { reset: true as const };
  },
});
