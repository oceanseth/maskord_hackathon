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
});
