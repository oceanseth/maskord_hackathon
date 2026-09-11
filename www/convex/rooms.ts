import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';

/**
 * Rooms are the shared substrate for the agent game modes: the debate at
 * /debate.html and the D&D table at /wizard.html. A room has members (humans,
 * masks, and a host — Masky), an append-only event log that every screen
 * renders from, and a turn claim so exactly one runner advances the room at a
 * time even when several tabs, or a tab and a Convex action, are alive.
 *
 * Kind-specific state (debate topic and rules, the D&D encounter and character
 * sheets) lives in `config` on the room and in kind-specific tables that point
 * back at the room, not here.
 */

export const roomKind = v.union(v.literal('debate'), v.literal('wizard'));
export const roomStatus = v.union(
  v.literal('lobby'),
  v.literal('running'),
  v.literal('paused'),
  v.literal('finished'),
);
export const memberKind = v.union(v.literal('human'), v.literal('mask'), v.literal('host'));
export const eventType = v.union(
  v.literal('say'), // a member speaking in character
  v.literal('action'), // a member doing something (move, attack, cast, vote)
  v.literal('host'), // the host narrating, ruling, or moderating
  v.literal('dice'), // a roll, with the numbers in `data`
  v.literal('research'), // a research result surfaced to the room
  v.literal('system'), // joins, leaves, pauses, status changes
);

const MAX_BODY = 4000;
const MAX_NAME = 64;
const PAGE = 200;

/** A turn claim expires if the runner does not renew or release it in time. */
export const TURN_CLAIM_TTL_MS = 20_000;
/** Members that have not checked in for this long are shown as away. */
export const MEMBER_TIMEOUT_MS = 45_000;

export async function getRoomBySlug(ctx: QueryCtx | MutationCtx, slug: string) {
  return await ctx.db
    .query('rooms')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique();
}

async function nextSeq(ctx: MutationCtx, roomId: Id<'rooms'>) {
  const last = await ctx.db
    .query('roomEvents')
    .withIndex('by_room_seq', (q) => q.eq('roomId', roomId))
    .order('desc')
    .first();
  return (last?.seq ?? 0) + 1;
}

/**
 * Append to a room's log. Exported for the kind-specific modules (the D&D
 * engine, the debate moderator) so every event goes through one place.
 */
export async function appendEvent(
  ctx: MutationCtx,
  roomId: Id<'rooms'>,
  event: {
    type: Doc<'roomEvents'>['type'];
    actorKey?: string;
    actorName: string;
    body: string;
    data?: unknown;
  },
) {
  const seq = await nextSeq(ctx, roomId);
  return await ctx.db.insert('roomEvents', {
    roomId,
    seq,
    type: event.type,
    actorKey: event.actorKey,
    actorName: event.actorName.slice(0, MAX_NAME),
    body: event.body.slice(0, MAX_BODY),
    data: event.data,
  });
}

// ---------------------------------------------------------------------------
// Rooms

export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => await getRoomBySlug(ctx, slug),
});

export const list = query({
  args: { kind: v.optional(roomKind) },
  handler: async (ctx, { kind }) => {
    const rows = kind
      ? await ctx.db
          .query('rooms')
          .withIndex('by_kind', (q) => q.eq('kind', kind))
          .collect()
      : await ctx.db.query('rooms').collect();
    return rows.sort((a, b) => b._creationTime - a._creationTime);
  },
});

/**
 * Create a room, or return the existing one with that slug. Idempotent so the
 * page can call it on load: the first tab to open /wizard.html?room=x makes
 * the room, everyone after that joins it.
 */
export const ensure = mutation({
  args: {
    slug: v.string(),
    kind: roomKind,
    title: v.string(),
    hostName: v.optional(v.string()),
    config: v.optional(v.any()),
  },
  handler: async (ctx, { slug, kind, title, hostName, config }) => {
    const existing = await getRoomBySlug(ctx, slug);
    if (existing) return existing._id;

    const roomId = await ctx.db.insert('rooms', {
      slug: slug.trim().slice(0, MAX_NAME),
      kind,
      title: title.trim().slice(0, 120),
      status: 'lobby',
      hostName: (hostName ?? 'Masky').slice(0, MAX_NAME),
      config: config ?? {},
      turn: { seq: 0 },
    });

    await ctx.db.insert('roomMembers', {
      roomId,
      memberKey: 'host',
      kind: 'host',
      name: (hostName ?? 'Masky').slice(0, MAX_NAME),
      ready: true,
      lastSeen: Date.now(),
      state: {},
    });

    await appendEvent(ctx, roomId, {
      type: 'system',
      actorName: 'room',
      body: `Room "${title}" opened.`,
      data: { kind: 'opened' },
    });

    return roomId;
  },
});

export const setStatus = mutation({
  args: {
    roomId: v.id('rooms'),
    status: roomStatus,
    byKey: v.optional(v.string()),
    byName: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, status, byKey, byName, reason }) => {
    const room = await ctx.db.get(roomId);
    if (!room) throw new Error('No such room');
    if (room.status === status) return;

    await ctx.db.patch(roomId, {
      status,
      pause: status === 'paused' ? { byKey, byName, reason, at: Date.now() } : undefined,
    });

    const verb =
      status === 'paused'
        ? `paused the game${reason ? `: ${reason}` : ''}`
        : status === 'running'
          ? room.status === 'paused'
            ? 'resumed the game'
            : 'started the game'
          : status === 'finished'
            ? 'ended the game'
            : 'reopened the lobby';

    await appendEvent(ctx, roomId, {
      type: 'system',
      actorKey: byKey,
      actorName: byName,
      body: `${byName} ${verb}.`,
      data: { kind: 'status', status, reason },
    });
  },
});

export const patchConfig = mutation({
  args: { roomId: v.id('rooms'), config: v.any() },
  handler: async (ctx, { roomId, config }) => {
    const room = await ctx.db.get(roomId);
    if (!room) throw new Error('No such room');
    await ctx.db.patch(roomId, { config: { ...(room.config ?? {}), ...config } });
  },
});

// ---------------------------------------------------------------------------
// Members

export const members = query({
  args: { roomId: v.id('rooms') },
  handler: async (ctx, { roomId }) => {
    const cutoff = Date.now() - MEMBER_TIMEOUT_MS;
    const rows = await ctx.db
      .query('roomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();
    return rows.map((m) => ({
      ...m,
      // Masks and the host are driven by the runner, so they never go away.
      present: m.kind !== 'human' || m.lastSeen >= cutoff,
    }));
  },
});

/**
 * Join, or check in. Humans call this on load and then on a heartbeat; the
 * runner registers masks with it once. `memberKey` is whatever identifies the
 * member across tabs: a Firebase uid for humans, a mask id for masks.
 */
export const join = mutation({
  args: {
    roomId: v.id('rooms'),
    memberKey: v.string(),
    kind: memberKind,
    name: v.string(),
    avatarUrl: v.optional(v.string()),
    persona: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, memberKey, kind, name, avatarUrl, persona }) => {
    const existing = await ctx.db
      .query('roomMembers')
      .withIndex('by_room_member', (q) => q.eq('roomId', roomId).eq('memberKey', memberKey))
      .unique();

    const now = Date.now();
    if (existing) {
      const wasAway = kind === 'human' && existing.lastSeen < now - MEMBER_TIMEOUT_MS;
      await ctx.db.patch(existing._id, {
        name: name.slice(0, MAX_NAME),
        avatarUrl: avatarUrl ?? existing.avatarUrl,
        persona: persona ?? existing.persona,
        lastSeen: now,
      });
      if (wasAway) {
        await appendEvent(ctx, roomId, {
          type: 'system',
          actorKey: memberKey,
          actorName: name,
          body: `${name} is back.`,
          data: { kind: 'rejoin' },
        });
      }
      return existing._id;
    }

    const id = await ctx.db.insert('roomMembers', {
      roomId,
      memberKey,
      kind,
      name: name.slice(0, MAX_NAME),
      avatarUrl,
      persona,
      ready: kind !== 'human',
      lastSeen: now,
      state: {},
    });

    await appendEvent(ctx, roomId, {
      type: 'system',
      actorKey: memberKey,
      actorName: name,
      body: `${name} joined${kind === 'mask' ? ' (mask)' : ''}.`,
      data: { kind: 'join', memberKind: kind },
    });

    return id;
  },
});

export const heartbeat = mutation({
  args: { roomId: v.id('rooms'), memberKey: v.string() },
  handler: async (ctx, { roomId, memberKey }) => {
    const existing = await ctx.db
      .query('roomMembers')
      .withIndex('by_room_member', (q) => q.eq('roomId', roomId).eq('memberKey', memberKey))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { lastSeen: Date.now() });
  },
});

export const setReady = mutation({
  args: { roomId: v.id('rooms'), memberKey: v.string(), ready: v.boolean() },
  handler: async (ctx, { roomId, memberKey, ready }) => {
    const existing = await ctx.db
      .query('roomMembers')
      .withIndex('by_room_member', (q) => q.eq('roomId', roomId).eq('memberKey', memberKey))
      .unique();
    if (!existing) throw new Error('Not a member of this room');
    await ctx.db.patch(existing._id, { ready });
  },
});

/** Kind-specific per-member state: a character sheet, a debate side, a score. */
export const patchMemberState = mutation({
  args: { roomId: v.id('rooms'), memberKey: v.string(), state: v.any() },
  handler: async (ctx, { roomId, memberKey, state }) => {
    const existing = await ctx.db
      .query('roomMembers')
      .withIndex('by_room_member', (q) => q.eq('roomId', roomId).eq('memberKey', memberKey))
      .unique();
    if (!existing) throw new Error('Not a member of this room');
    await ctx.db.patch(existing._id, { state: { ...(existing.state ?? {}), ...state } });
  },
});

// ---------------------------------------------------------------------------
// Events

export const events = query({
  args: { roomId: v.id('rooms'), afterSeq: v.optional(v.number()) },
  handler: async (ctx, { roomId, afterSeq }) => {
    const rows =
      afterSeq !== undefined
        ? await ctx.db
            .query('roomEvents')
            .withIndex('by_room_seq', (q) => q.eq('roomId', roomId).gt('seq', afterSeq))
            .take(PAGE)
        : await ctx.db
            .query('roomEvents')
            .withIndex('by_room_seq', (q) => q.eq('roomId', roomId))
            .order('desc')
            .take(PAGE);
    if (afterSeq === undefined) rows.reverse();
    return rows;
  },
});

/** A human (or a mask, via the runner) speaks or acts. */
export const post = mutation({
  args: {
    roomId: v.id('rooms'),
    memberKey: v.string(),
    type: eventType,
    body: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, { roomId, memberKey, type, body, data }) => {
    const member = await ctx.db
      .query('roomMembers')
      .withIndex('by_room_member', (q) => q.eq('roomId', roomId).eq('memberKey', memberKey))
      .unique();
    if (!member) throw new Error('Not a member of this room');
    const text = body.trim();
    if (!text) throw new Error('Message is empty');
    return await appendEvent(ctx, roomId, {
      type,
      actorKey: memberKey,
      actorName: member.name,
      body: text,
      data,
    });
  },
});

// ---------------------------------------------------------------------------
// Turn claim
//
// Whoever holds the claim is the only party allowed to advance the room: run
// the next mask's turn, resolve dice, move the encounter on. Claims expire, so
// a closed tab or a crashed action frees the room within TURN_CLAIM_TTL_MS.

export const claimTurn = mutation({
  args: { roomId: v.id('rooms'), runnerId: v.string() },
  handler: async (ctx, { roomId, runnerId }) => {
    const room = await ctx.db.get(roomId);
    if (!room) throw new Error('No such room');
    const now = Date.now();
    const { turn } = room;
    const held = turn.runnerId && turn.claimedAt && turn.claimedAt + TURN_CLAIM_TTL_MS > now;
    if (held && turn.runnerId !== runnerId) {
      return { ok: false as const, heldBy: turn.runnerId, seq: turn.seq };
    }
    const seq = held ? turn.seq : turn.seq + 1;
    await ctx.db.patch(roomId, { turn: { runnerId, claimedAt: now, seq } });
    return { ok: true as const, seq };
  },
});

export const releaseTurn = mutation({
  args: { roomId: v.id('rooms'), runnerId: v.string() },
  handler: async (ctx, { roomId, runnerId }) => {
    const room = await ctx.db.get(roomId);
    if (!room || room.turn.runnerId !== runnerId) return;
    await ctx.db.patch(roomId, { turn: { seq: room.turn.seq } });
  },
});
