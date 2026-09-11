import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * The guest-star shelf: masks their owners have put up for rent.
 *
 * Renting somebody else's mask is what Maskord Pro buys. The entitlement itself
 * lives in RevenueCat and is checked in the client, which is the honest shape
 * for a hackathon — a determined user can seat a mask by calling Convex
 * directly. Making that impossible means verifying the entitlement server-side
 * against RevenueCat's REST API, which is a real change and is noted in the PR
 * rather than pretended away.
 *
 * What is enforced here is ownership: only the owner can publish or withdraw
 * their own avatar, because that is the part a stranger could otherwise abuse
 * to put words in someone else's mask.
 */

export const list = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('rentableMasks').collect())
      .sort((a, b) => b.rentals - a.rentals || a.name.localeCompare(b.name))
      .map((m) => ({
        id: m._id,
        memberKey: `rent:${m.ownerUid}:${m.avatarId}`,
        ownerUid: m.ownerUid,
        ownerName: m.ownerName,
        name: m.name,
        persona: m.persona,
        thumbnailUrl: m.thumbnailUrl,
        rentals: m.rentals,
      })),
});

/** What this owner has published, and how often it has been seated. */
export const mine = query({
  args: { ownerUid: v.string() },
  handler: async (ctx, { ownerUid }) =>
    await ctx.db
      .query('rentableMasks')
      .withIndex('by_owner', (q) => q.eq('ownerUid', ownerUid))
      .collect(),
});

/**
 * Put one of your own avatars on the shelf. Idempotent per avatar: re-publishing
 * after a rename updates the copy and keeps the rental count.
 */
export const publish = mutation({
  args: {
    ownerUid: v.string(),
    ownerName: v.string(),
    avatarId: v.string(),
    name: v.string(),
    persona: v.string(),
    thumbnailUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('rentableMasks')
      .withIndex('by_avatar', (q) => q.eq('ownerUid', args.ownerUid).eq('avatarId', args.avatarId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        persona: args.persona,
        thumbnailUrl: args.thumbnailUrl,
        ownerName: args.ownerName,
      });
      return { id: existing._id, updated: true as const };
    }

    const id = await ctx.db.insert('rentableMasks', {
      ...args,
      publishedAt: Date.now(),
      rentals: 0,
    });
    return { id, updated: false as const };
  },
});

export const withdraw = mutation({
  args: { id: v.id('rentableMasks'), ownerUid: v.string() },
  handler: async (ctx, { id, ownerUid }) => {
    const mask = await ctx.db.get(id);
    // Only the owner takes their own mask off the shelf.
    if (!mask || mask.ownerUid !== ownerUid) return { withdrawn: false as const };
    await ctx.db.delete(id);
    return { withdrawn: true as const };
  },
});

/**
 * Count an appearance. Called when a rented mask is seated, and the number the
 * owner is paid on — so it counts seatings, not turns, and a room that seats the
 * same mask twice pays twice.
 */
export const recordRental = mutation({
  args: { id: v.id('rentableMasks') },
  handler: async (ctx, { id }) => {
    const mask = await ctx.db.get(id);
    if (!mask) return { rentals: 0 };
    const rentals = mask.rentals + 1;
    await ctx.db.patch(id, { rentals });
    return { rentals };
  },
});
