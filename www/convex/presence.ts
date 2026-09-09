import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/** A session is considered present if it has checked in this recently. */
export const PRESENCE_TIMEOUT_MS = 30_000;

export const heartbeat = mutation({
  args: { channel: v.string(), sessionId: v.string(), name: v.string() },
  handler: async (ctx, { channel, sessionId, name }) => {
    const existing = await ctx.db
      .query('presence')
      .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
      .unique();

    const row = { channel, sessionId, name: name.slice(0, 64), lastSeen: Date.now() };

    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert('presence', row);
    }
  },
});

export const list = query({
  args: { channel: v.string() },
  handler: async (ctx, { channel }) => {
    const cutoff = Date.now() - PRESENCE_TIMEOUT_MS;
    const rows = await ctx.db
      .query('presence')
      .withIndex('by_channel', (q) => q.eq('channel', channel))
      .collect();

    return rows
      .filter((r) => r.lastSeen >= cutoff)
      .map((r) => ({ sessionId: r.sessionId, name: r.name }));
  },
});
