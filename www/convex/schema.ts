import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const attachmentFields = v.object({
  storageId: v.id('_storage'),
  name: v.string(),
  /** MIME type as reported by the browser; drives how the chat renders it. */
  type: v.string(),
  size: v.number(),
});

export default defineSchema({
  messages: defineTable({
    channel: v.string(),
    author: v.string(),
    body: v.string(),
    attachment: v.optional(attachmentFields),
  }).index('by_channel', ['channel']),

  // A user's own server. Firestore cannot hold these: its rules block client
  // writes to guilds/*/members, roles and channels (only Cloud Functions may
  // write them) and there is no createGuild function, so nothing in the product
  // can onboard a user into their first server. Convex owns them instead.
  servers: defineTable({
    /** Firebase uid of the owner. */
    ownerId: v.string(),
    ownerName: v.string(),
    name: v.string(),
  }).index('by_owner', ['ownerId']),

  serverChannels: defineTable({
    serverId: v.id('servers'),
    name: v.string(),
    position: v.number(),
  }).index('by_server', ['serverId']),

  // Convex has no onDisconnect equivalent, so presence is a heartbeat: the
  // client refreshes lastSeen and readers treat anything older than
  // PRESENCE_TIMEOUT_MS as gone.
  presence: defineTable({
    channel: v.string(),
    sessionId: v.string(),
    name: v.string(),
    lastSeen: v.number(),
  })
    .index('by_channel', ['channel'])
    .index('by_session', ['sessionId']),

  // Agent game rooms — the debate (/debate.html) and the D&D table
  // (/wizard.html). See rooms.ts for the model; kind-specific tables point at
  // a room by id and live in their own modules.
  rooms: defineTable({
    /** URL key: /wizard.html?room=<slug>. */
    slug: v.string(),
    kind: v.union(v.literal('debate'), v.literal('wizard')),
    title: v.string(),
    status: v.union(
      v.literal('lobby'),
      v.literal('running'),
      v.literal('paused'),
      v.literal('finished'),
    ),
    /** Who paused and why, while status is 'paused'. */
    pause: v.optional(
      v.object({
        byKey: v.optional(v.string()),
        byName: v.string(),
        reason: v.optional(v.string()),
        at: v.number(),
      }),
    ),
    /** Display name of the host (Masky as DM or moderator). */
    hostName: v.string(),
    /** Kind-specific settings: debate topic and rules, D&D scenario id. */
    config: v.any(),
    /** Turn claim — see rooms.claimTurn. `seq` counts claims. */
    turn: v.object({
      runnerId: v.optional(v.string()),
      claimedAt: v.optional(v.number()),
      seq: v.number(),
    }),
  })
    .index('by_slug', ['slug'])
    .index('by_kind', ['kind']),

  roomMembers: defineTable({
    roomId: v.id('rooms'),
    /** Firebase uid for humans, mask id for masks, 'host' for the host. */
    memberKey: v.string(),
    kind: v.union(v.literal('human'), v.literal('mask'), v.literal('host')),
    name: v.string(),
    avatarUrl: v.optional(v.string()),
    /** System-prompt-level description of how a mask behaves. */
    persona: v.optional(v.string()),
    /** Lobby readiness (humans confirm a character sheet / a side). */
    ready: v.boolean(),
    lastSeen: v.number(),
    /** Kind-specific per-member state (character sheet id, debate side, score). */
    state: v.any(),
  })
    .index('by_room', ['roomId'])
    .index('by_room_member', ['roomId', 'memberKey']),

  roomEvents: defineTable({
    roomId: v.id('rooms'),
    /** Dense per-room sequence; the client renders in this order. */
    seq: v.number(),
    type: v.union(
      v.literal('say'),
      v.literal('action'),
      v.literal('host'),
      v.literal('dice'),
      v.literal('research'),
      v.literal('system'),
    ),
    actorKey: v.optional(v.string()),
    actorName: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
  }).index('by_room_seq', ['roomId', 'seq']),

  // One row per *iteration* of a research loop, not one per question. The loop
  // has to be iterative to count: each pass records what it learned and what it
  // still does not know, and `nextQuery` — chosen from those gaps — is what the
  // following pass searches for. Keeping every pass means the room can show how
  // a conclusion was reached, and the stop reason stays auditable.
  research: defineTable({
    roomId: v.id('rooms'),
    /** The claim under investigation, verbatim from whoever contested it. */
    claim: v.string(),
    /** A mask's display name, or 'room' for a between-turns background check. */
    askedBy: v.string(),
    /** 0-based; iteration 0 searches the claim itself. */
    iteration: v.number(),
    /** What this pass actually searched for. */
    query: v.string(),
    sources: v.array(
      v.object({ title: v.string(), url: v.string(), snippet: v.string() }),
    ),
    /** What this pass concluded, in a sentence or two. */
    finding: v.string(),
    /** 0..1, drives the stop condition. */
    confidence: v.number(),
    /** What is still unknown. Empty means nothing left to chase. */
    gaps: v.array(v.string()),
    /** Chosen from `gaps`; null when the loop stopped here. */
    nextQuery: v.union(v.string(), v.null()),
    /** Set only on the final iteration of a claim. */
    stopReason: v.optional(
      v.union(
        v.literal('confident'),
        v.literal('no-gaps'),
        v.literal('max-iterations'),
        v.literal('error'),
      ),
    ),
    provider: v.string(),
  })
    .index('by_room', ['roomId'])
    .index('by_room_claim', ['roomId', 'claim', 'iteration']),

  // One D&D game per wizard room. Nested state is stored as-is (see
  // wizard/types.ts for the shapes); every change to it happens inside one
  // mutation so a round never half-applies.
  wizardGames: defineTable({
    roomId: v.id('rooms'),
    phase: v.string(),
    mapKey: v.string(),
    round: v.number(),
    turnIndex: v.number(),
    /** Bumps every time a new turn begins; scheduled turns carry it and bail if stale. */
    turnToken: v.number(),
    combatants: v.any(),
    characters: v.any(),
    creatures: v.any(),
    seats: v.any(),
    turn: v.any(),
    fires: v.any(),
    xp: v.number(),
  }).index('by_room', ['roomId']),

  // A masky.ai avatar its owner has put up for rent. Deliberately a *copy* of
  // the three strings a room needs, not a pointer: avatars live at
  // `users/{uid}/avatarGroups` in Firestore, where the rules let a user read
  // only their own. Publishing is therefore the owner reading their own doc and
  // handing us the parts — so no reader ever needs another user's Firestore
  // subtree, and no rules change is required to rent a mask out.
  rentableMasks: defineTable({
    /** Firebase uid of the owner, who earns from every appearance. */
    ownerUid: v.string(),
    ownerName: v.string(),
    /** masky.ai avatarGroup id, so re-publishing updates rather than duplicates. */
    avatarId: v.string(),
    name: v.string(),
    persona: v.string(),
    thumbnailUrl: v.optional(v.string()),
    publishedAt: v.number(),
    /** Times this mask has been seated. The compensation metric. */
    rentals: v.number(),
  })
    .index('by_owner', ['ownerUid'])
    .index('by_avatar', ['ownerUid', 'avatarId']),
});
