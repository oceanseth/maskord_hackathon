import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

// ─── ElevenLabs lipsync render jobs ─────────────────────────────────────────────
//
// When a guild's lipsync provider is `elevenlabs`, the cloud function renders a
// talking-head avatar turn as masky AUDIO chunks only and stamps the transcript
// doc `maskyOutput: 'eleven-video'`. Exactly one connected desktop client (the
// "server host machine") claims the job here, lipsyncs each audio chunk through
// the guild's ElevenLabs key (creatify-aurora), uploads the mp4s to Convex
// storage, and every client plays the clips via `forKey`.

/** A renderer that hasn't heartbeated for this long is presumed dead and its
 *  claim can be taken over. Renders poll every ~10s and touch the row. */
const STALE_CLAIM_MS = 3 * 60_000;

/**
 * Claim the render job for one avatar turn. First caller wins; the same session
 * re-claiming is a no-op success; a stale unfinished claim is taken over.
 * `clipIdxs` lets a takeover skip chunks the dead renderer already uploaded,
 * and `done` tells losing retriers to stop asking.
 */
export const claim = mutation({
  args: { key: v.string(), sessionId: v.string() },
  handler: async (
    ctx, { key, sessionId },
  ): Promise<{ claimed: boolean; done: boolean; clipIdxs: number[] }> => {
    const now = Date.now();
    const existing = await ctx.db
      .query('elevenJobs')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique();
    if (!existing) {
      await ctx.db.insert('elevenJobs', {
        key, claimedBy: sessionId, updatedAt: now, clips: [], done: false,
      });
      return { claimed: true, done: false, clipIdxs: [] };
    }
    const clipIdxs = existing.clips.map((c) => c.idx);
    if (existing.done) return { claimed: false, done: true, clipIdxs };
    if (existing.claimedBy === sessionId) {
      await ctx.db.patch(existing._id, { updatedAt: now });
      return { claimed: true, done: false, clipIdxs };
    }
    if (now - existing.updatedAt > STALE_CLAIM_MS) {
      await ctx.db.patch(existing._id, { claimedBy: sessionId, updatedAt: now });
      return { claimed: true, done: false, clipIdxs };
    }
    return { claimed: false, done: false, clipIdxs };
  },
});

/** Heartbeat while a render is in flight, so the claim isn't taken over.
 *  Returns whether the session still owns the job — a renderer that lost its
 *  claim (laptop slept, someone took over) must stop, or chunks bill twice. */
export const touch = mutation({
  args: { key: v.string(), sessionId: v.string() },
  handler: async (ctx, { key, sessionId }): Promise<boolean> => {
    const job = await ctx.db
      .query('elevenJobs')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique();
    if (!job || job.claimedBy !== sessionId || job.done) return false;
    await ctx.db.patch(job._id, { updatedAt: Date.now() });
    return true;
  },
});

/** Attach one rendered chunk. Idempotent on idx; clips stay sorted. */
export const addClip = mutation({
  args: {
    key: v.string(),
    sessionId: v.string(),
    idx: v.number(),
    storageId: v.id('_storage'),
    text: v.optional(v.string()),
  },
  handler: async (ctx, { key, sessionId, idx, storageId, text }) => {
    const job = await ctx.db
      .query('elevenJobs')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique();
    if (!job || job.claimedBy !== sessionId) return;
    if (job.clips.some((c) => c.idx === idx)) return;
    const clips = [...job.clips, { idx, storageId, text }].sort((a, b) => a.idx - b.idx);
    await ctx.db.patch(job._id, { clips, updatedAt: Date.now() });
  },
});

/** Mark the job complete: `total` chunks exist and all renderable ones are in. */
export const finish = mutation({
  args: { key: v.string(), sessionId: v.string(), total: v.number() },
  handler: async (ctx, { key, sessionId, total }) => {
    const job = await ctx.db
      .query('elevenJobs')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique();
    if (!job || job.claimedBy !== sessionId) return;
    await ctx.db.patch(job._id, { total, done: true, updatedAt: Date.now() });
  },
});

export interface ElevenClip { idx: number; url: string | null; text?: string }

/** The playable state of one turn's job, clip URLs resolved. */
export const forKey = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const job = await ctx.db
      .query('elevenJobs')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique();
    if (!job) return null;
    const clips: ElevenClip[] = await Promise.all(
      job.clips.map(async (c) => ({
        idx: c.idx,
        url: await ctx.storage.getUrl(c.storageId),
        text: c.text,
      })),
    );
    return { done: job.done, total: job.total ?? null, clips };
  },
});
