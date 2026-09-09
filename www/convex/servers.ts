import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

const DEFAULT_CHANNELS = ['general', 'files'];
const MAX_NAME = 64;

/** Every server owned by a Firebase uid, with its channels. */
export const listMine = query({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => {
    const servers = await ctx.db
      .query('servers')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .collect();

    return await Promise.all(
      servers.map(async (s) => ({
        _id: s._id,
        name: s.name,
        channels: (
          await ctx.db
            .query('serverChannels')
            .withIndex('by_server', (q) => q.eq('serverId', s._id))
            .collect()
        ).sort((a, b) => a.position - b.position),
      })),
    );
  },
});

/**
 * Onboarding: create the caller's first server with its default channels.
 * Idempotent per name, so a double-click does not produce two servers.
 */
export const create = mutation({
  args: { ownerId: v.string(), ownerName: v.string(), name: v.string() },
  handler: async (ctx, { ownerId, ownerName, name }) => {
    const serverName = (name.trim() || `${ownerName}'s server`).slice(0, MAX_NAME);

    const existing = await ctx.db
      .query('servers')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .collect();

    const duplicate = existing.find((s) => s.name === serverName);
    if (duplicate) return duplicate._id;

    const serverId = await ctx.db.insert('servers', {
      ownerId,
      ownerName: ownerName.slice(0, MAX_NAME),
      name: serverName,
    });

    for (const [position, channel] of DEFAULT_CHANNELS.entries()) {
      await ctx.db.insert('serverChannels', { serverId, name: channel, position });
    }

    return serverId;
  },
});

export const addChannel = mutation({
  args: { serverId: v.id('servers'), name: v.string() },
  handler: async (ctx, { serverId, name }) => {
    const clean = name.trim().toLowerCase().replace(/\s+/g, '-').slice(0, MAX_NAME);
    if (!clean) throw new Error('Channel name is empty');

    const siblings = await ctx.db
      .query('serverChannels')
      .withIndex('by_server', (q) => q.eq('serverId', serverId))
      .collect();

    if (siblings.some((c) => c.name === clean)) throw new Error('That channel already exists');

    return await ctx.db.insert('serverChannels', {
      serverId,
      name: clean,
      position: siblings.length,
    });
  },
});
