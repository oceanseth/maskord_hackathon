import { v } from 'convex/values';
import { query } from './_generated/server';

/**
 * Resolve a stored file to a servable URL. The Maskord client keeps its
 * messages in Firestore and only the bytes in Convex, so it stores this URL on
 * the message's attachment record at upload time.
 */
export const getUrl = query({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, { storageId }) => await ctx.storage.getUrl(storageId),
});
