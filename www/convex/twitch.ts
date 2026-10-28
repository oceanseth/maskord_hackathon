import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation } from './_generated/server';
import { internal } from './_generated/api';
import { appendEvent, ensureRoom, getRoomBySlug, roomKind } from './rooms';

/**
 * The Twitch half of a stage game ("Ingest Twitch Chat" in channel settings).
 *
 * A room opts in by holding `config.twitch = { channel, enabled, generation,
 * lastAliveAt }`. While enabled, an ingest loop (`twitchIngest.ts`, a Node
 * action holding an anonymous IRC connection) feeds every chat line into
 * `ingest` below: `!execute A` / `!marry B` / `!mate A` / `!murder C` become
 * stage votes, everything else becomes a `say` event — which `appendEvent`
 * already mirrors into the bound channel, so a Twitch message reads exactly
 * like one typed into the room.
 *
 * `generation` is the only coordination there is: changing the config bumps it,
 * every loop and every ingest write carries the generation it was started for,
 * and a stale generation is dropped on arrival. That makes "turn it off", "point
 * it at another channel" and "two tabs both tried to start it" all the same
 * case: the old loop finds itself stale and dies.
 */

const MAX_TEXT = 500;
/** The loop heartbeats every ~45s; quiet for this long means it is dead. */
const STALE_MS = 3 * 60_000;

export interface TwitchConfig {
  channel: string;
  enabled: boolean;
  generation: number;
  lastAliveAt: number;
}

function twitchConfig(config: unknown): TwitchConfig | undefined {
  return (config as { twitch?: TwitchConfig } | undefined)?.twitch;
}

/** `!execute A`, `!marry B`, `!mate A`, `!murder C` — case-insensitive, label A–C. */
const VOTE = /^!(execute|marry|mate|murder)\s*([a-c])\b/i;

/**
 * Point a room at a Twitch chat, or away from one. Called by the client
 * whenever the channel's settings say so (ChannelGameView keeps them in sync);
 * idempotent, so any number of open tabs can call it with the same values. It
 * also restarts a loop that stopped heartbeating — opening the channel is the
 * repair action.
 */
export const configure = mutation({
  args: {
    slug: v.string(),
    kind: roomKind,
    guildId: v.string(),
    title: v.string(),
    twitchChannel: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const channel = args.twitchChannel.trim().toLowerCase().replace(/^#/, '');
    // A Twitch login is [a-z0-9_]; anything else would be sent as a raw IRC
    // JOIN argument, which is not a thing to do with user input.
    const valid = /^[a-z0-9_]{1,25}$/.test(channel);
    const enabled = args.enabled && valid;

    const roomId = await ensureRoom(ctx, {
      slug: args.slug,
      kind: args.kind,
      title: args.title,
      config: { guildId: args.guildId },
    });
    const room = await ctx.db.get(roomId);
    if (!room) return;

    const prev = twitchConfig(room.config);
    const unchanged = prev && prev.channel === channel && prev.enabled === enabled;
    const aliveRecently = (prev?.lastAliveAt ?? 0) > Date.now() - STALE_MS;
    if (unchanged && (!enabled || aliveRecently)) {
      // Nothing to change and nothing to revive — but an old room may predate
      // the channel binding carrying guildId, and the mirror needs it.
      const config = room.config as { guildId?: string } | undefined;
      if (!config?.guildId) {
        await ctx.db.patch(roomId, { config: { ...(room.config ?? {}), guildId: args.guildId } });
      }
      return;
    }

    const generation = (prev?.generation ?? 0) + 1;
    await ctx.db.patch(roomId, {
      config: {
        ...(room.config ?? {}),
        guildId: args.guildId,
        twitch: { channel, enabled, generation, lastAliveAt: 0 },
      },
    });

    // Say so in the log only when the setting actually flipped, not on revives:
    // a restart is maintenance, and a room that announces its maintenance reads
    // like a room that is broken.
    if (!prev || prev.enabled !== enabled || (enabled && prev.channel !== channel)) {
      await appendEvent(ctx, roomId, {
        type: 'system',
        actorName: 'room',
        body: enabled
          ? `Twitch chat from twitch.tv/${channel} now flows into this room.`
          : 'Twitch chat ingest turned off.',
        data: { kind: 'twitch', enabled, channel },
      });
    }

    if (enabled) {
      await ctx.scheduler.runAfter(0, internal.twitchIngest.ingestLoop, {
        slug: args.slug,
        generation,
      });
    }
  },
});

/** What the ingest loop needs to know to keep running — or stop. */
export const state = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const room = await getRoomBySlug(ctx, slug);
    const tw = room ? twitchConfig(room.config) : undefined;
    if (!room || !tw) return null;
    return { channel: tw.channel, enabled: tw.enabled, generation: tw.generation };
  },
});

/** The loop's heartbeat; `configure` reads it to tell a live loop from a dead one. */
export const alive = internalMutation({
  args: { slug: v.string(), generation: v.number() },
  handler: async (ctx, { slug, generation }) => {
    const room = await getRoomBySlug(ctx, slug);
    const tw = room ? twitchConfig(room.config) : undefined;
    if (!room || !tw || tw.generation !== generation) return;
    await ctx.db.patch(room._id, {
      config: { ...(room.config ?? {}), twitch: { ...tw, lastAliveAt: Date.now() } },
    });
  },
});

/**
 * One Twitch chat line lands in the room.
 *
 * A vote command becomes an `action` event with `data.kind = 'stageVote'` —
 * the seam the stage engine (convex/stage.ts) tallies from, keyed by
 * `voterKey: 'twitch:<userId>'` so a Twitch voter earns majority points under
 * the same key every round. Anything else becomes a `say` event, which
 * `appendEvent` mirrors into the bound channel; the bridge function creates a
 * `twitch:<userId>` account for the author if one does not exist yet.
 */
export const ingest = internalMutation({
  args: {
    slug: v.string(),
    generation: v.number(),
    login: v.string(),
    userId: v.string(),
    name: v.string(),
    text: v.string(),
  },
  handler: async (ctx, { slug, generation, login, userId, name, text }) => {
    const room = await getRoomBySlug(ctx, slug);
    const tw = room ? twitchConfig(room.config) : undefined;
    if (!room || !tw || !tw.enabled || tw.generation !== generation) return;
    if (!/^\d{1,20}$/.test(userId)) return;

    const body = text.trim().slice(0, MAX_TEXT);
    if (!body) return;
    const voterKey = `twitch:${userId}`;
    const voterName = (name.trim() || login).slice(0, 40);

    const vote = VOTE.exec(body);
    if (vote) {
      await appendEvent(ctx, room._id, {
        type: 'action',
        actorKey: voterKey,
        actorName: voterName,
        body,
        data: {
          kind: 'stageVote',
          verb: vote[1].toLowerCase(),
          label: vote[2].toUpperCase(),
          voterKey,
          voterName,
          source: 'twitch',
        },
      });
      return;
    }

    await appendEvent(ctx, room._id, {
      type: 'say',
      actorKey: voterKey,
      actorName: voterName,
      body,
      data: { source: 'twitch', login },
    });
  },
});
