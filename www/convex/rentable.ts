import { v } from 'convex/values';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { checkPro, hasProVerification } from './pro';

/**
 * The guest-star shelf: masks their owners have put up for rent.
 *
 * Renting somebody else's mask is what Maskord Pro buys, and `seatRented` is the
 * only way onto the floor with one: it asks RevenueCat directly, with the secret
 * key, before anything is written. The client's own entitlement read still draws
 * the paywall and the padlocks, but it decides nothing — `debate.seatMask`
 * refuses a `rent:` key outright, so skipping the UI and calling Convex by hand
 * gets you the same refusal as clicking a padlock.
 *
 * Also enforced here is ownership: only the owner can publish or withdraw their
 * own avatar, because that is the part a stranger could otherwise abuse to put
 * words in someone else's mask.
 */

/** A rented mask's member key. The prefix is what `debate.seatMask` refuses. */
export const RENTED_PREFIX = 'rent:';

function memberKeyFor(ownerUid: string, avatarId: string): string {
  return `${RENTED_PREFIX}${ownerUid}:${avatarId}`;
}

export const list = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('rentableMasks').collect())
      .sort((a, b) => b.rentals - a.rentals || a.name.localeCompare(b.name))
      .map((m) => ({
        id: m._id,
        memberKey: memberKeyFor(m.ownerUid, m.avatarId),
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
 *
 * Internal: the count is a payout figure, so it is written only on the path that
 * has already verified the entitlement, never by whoever asks.
 */
export const recordRental = internalMutation({
  args: { id: v.id('rentableMasks') },
  handler: async (ctx, { id }) => {
    const mask = await ctx.db.get(id);
    if (!mask) return { rentals: 0 };
    const rentals = mask.rentals + 1;
    await ctx.db.patch(id, { rentals });
    return { rentals };
  },
});

export const byId = internalQuery({
  args: { id: v.id('rentableMasks') },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export interface SeatRentedResult {
  seated: boolean;
  /** Why not, when `seated` is false — the paywall copy the client shows. */
  reason?: 'no_pro' | 'lapsed' | 'unverifiable' | 'gone';
  rentals?: number;
}

/**
 * Seat a rented mask, once RevenueCat says the renter may.
 *
 * `appUserId` is the RevenueCat customer, which is the Firebase uid for a
 * signed-in user and a stored anonymous id otherwise — it has to be whichever
 * one actually made the purchase, or a guest who paid would be refused their own
 * subscription.
 *
 * Fails closed when the deployment has no secret key: a gate that opens when it
 * cannot check is not a gate. `unverifiable` says so plainly instead of telling a
 * paying user they are not subscribed.
 */
export const seatRented = action({
  args: { slug: v.string(), id: v.id('rentableMasks'), appUserId: v.string() },
  handler: async (ctx, { slug, id, appUserId }): Promise<SeatRentedResult> => {
    if (!hasProVerification()) return { seated: false, reason: 'unverifiable' };

    const check = await checkPro(appUserId);
    if (!check.pro) {
      return { seated: false, reason: check.everSubscribed ? 'lapsed' : 'no_pro' };
    }

    // Read the persona server-side. Taking it from the caller would let anyone
    // with Pro seat a mask nobody published, under any owner's name.
    const mask = await ctx.runQuery(internal.rentable.byId, { id });
    if (!mask) return { seated: false, reason: 'gone' };

    await ctx.runMutation(internal.debate.seatMaskInternal, {
      slug,
      memberKey: memberKeyFor(mask.ownerUid, mask.avatarId),
      name: mask.name,
      persona: mask.persona,
      avatarUrl: mask.thumbnailUrl,
    });

    const { rentals } = await ctx.runMutation(internal.rentable.recordRental, { id });
    return { seated: true, rentals };
  },
});
