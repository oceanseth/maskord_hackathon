import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { attachmentFields } from './schema';

const MAX_BODY = 2000;
const MAX_NAME = 64;
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024; // 100 MB
const PAGE = 100;

/**
 * Newest PAGE messages for a channel, oldest first. Storage URLs are resolved
 * here so the client never has to hold a second query per attachment — a new
 * upload lands in every subscribed session in the same update as its message.
 */
export const list = query({
  args: { channel: v.string() },
  handler: async (ctx, { channel }) => {
    const rows = await ctx.db
      .query('messages')
      .withIndex('by_channel', (q) => q.eq('channel', channel))
      .order('desc')
      .take(PAGE);

    rows.reverse();

    return await Promise.all(
      rows.map(async (m) => ({
        _id: m._id,
        _creationTime: m._creationTime,
        author: m.author,
        body: m.body,
        attachment: m.attachment
          ? { ...m.attachment, url: await ctx.storage.getUrl(m.attachment.storageId) }
          : null,
      })),
    );
  },
});

export const send = mutation({
  args: {
    channel: v.string(),
    author: v.string(),
    body: v.string(),
    attachment: v.optional(attachmentFields),
  },
  handler: async (ctx, { channel, author, body, attachment }) => {
    const text = body.trim().slice(0, MAX_BODY);
    if (!text && !attachment) throw new Error('Message is empty');
    if (attachment && attachment.size > MAX_ATTACHMENT_BYTES) {
      throw new Error('Attachment is larger than 100 MB');
    }

    return await ctx.db.insert('messages', {
      channel,
      author: (author.trim() || 'anonymous').slice(0, MAX_NAME),
      body: text,
      attachment,
    });
  },
});

/**
 * A pre-signed URL the browser POSTs the file bytes to. The returned storageId
 * is then attached to a message by `send`.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});
