import { Timestamp } from 'firebase/firestore';

// ─── User ────────────────────────────────────────────────────────────────────

export interface MaskProfile {
  id: string;
  name: string;
  avatarUrl: string;
  aiPersona?: string; // future masky.ai integration
}

export interface User {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl: string;
  bio?: string;
  status?: UserStatus;
  createdAt?: Timestamp;
  masks?: MaskProfile[];
  // Twitch-specific fields written by twitchOAuth Cloud Function
  twitchId?: string;
  twitchUsername?: string;
  /** ID of the user's auto-created personal server, set when the guild is first created. */
  personalGuildId?: string;
}

export type UserStatus = 'online' | 'idle' | 'dnd' | 'offline';

// ─── Guild ───────────────────────────────────────────────────────────────────

export interface GuildSettings {
  defaultNotifications: 'all' | 'mentions';
  explicitContentFilter: 'disabled' | 'members_without_roles' | 'all_members';
  verificationLevel: 'none' | 'low' | 'medium' | 'high';
}

export interface Guild {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  ownerId: string;
  createdAt: Timestamp;
  vanityCode: string | null;
  settings: GuildSettings;
  /** AI-assist config. When `claudeEnabled` is true, the configured masky avatar
   *  acts as a bot member of this guild — referred to in chat as `@<avatar displayName>`. */
  claudeEnabled?: boolean;
  /** Anthropic API key supplied by the server owner. TODO: move to Secret Manager. */
  claudeApiKey?: string;
  /** masky.ai developer key (mky_…) supplied by the server owner. Owns the
   *  per-voice-channel conversation and drives chat-mode voice replies. */
  maskyApiKey?: string;
  /** UID of the user who owns the selected avatar. */
  claudeAvatarOwnerUid?: string;
  /** masky avatarGroup doc ID. The avatar's displayName becomes the bot's name. */
  claudeAvatarId?: string;
}

export interface GuildMember {
  userId: string;
  nickname: string | null;
  roles: string[]; // roleIds
  joinedAt: Timestamp;
  muted: boolean;
  deafened: boolean;
  pending: boolean;
}

// ─── Role ────────────────────────────────────────────────────────────────────

export interface Role {
  id: string;
  name: string;
  color: string; // hex e.g. "#5865F2"
  permissions: number; // bitfield
  position: number; // hierarchy — higher = more power
  hoist: boolean; // show separately in member list
  mentionable: boolean;
}

// ─── Channel ─────────────────────────────────────────────────────────────────

export type ChannelType = 'text' | 'voice' | 'announcement' | 'category' | 'live';

export interface PermissionOverwrite {
  allow: number; // bitfield
  deny: number;  // bitfield
}

/** An AI avatar currently present in a voice channel. Written server-side. */
export interface ChannelAvatar {
  ownerUid: string;
  avatarId: string;
  displayName: string;
  thumbnailUrl?: string;
  humeVoiceId?: string;
  wakeWord?: string;
  goodbyeWord?: string;
  isPrimary?: boolean;
  /** This avatar's masky.ai conversation in this channel. */
  conversationId?: string;
  liveUrl?: string;
  invitedBy?: string;
  joinedAt?: number;
}

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  position: number;
  topic: string | null;
  slowmode: number; // seconds
  nsfw: boolean;
  parentId: string | null; // category channel id
  permissionOverwrites: Record<string, PermissionOverwrite>; // keyed by roleId or userId
  /** Total messages ever sent in this channel — incremented server-side on each send. */
  messageCount?: number;
  /** Timestamp of the most recent message — set server-side on each send. */
  lastMessageAt?: Timestamp;
  /** When set, the guild's configured AI avatar participates in this channel.
   *  `mention` = respond only when @-mentioned. `all` = every message triggers. `off` = disabled. */
  claudeMode?: 'mention' | 'all' | 'off';
  /** Only meaningful for voice channels — whether the avatar joins with audio only
   *  or with a talking-head video stream. */
  claudeMediaMode?: 'audio' | 'video';
  /** masky.ai conversation backing this voice channel (set server-side on first
   *  AI reply). Every voice channel maps to one masky conversation. */
  maskyConversationId?: string;
  /** Public share slug (c-yy-mm-XXXX) for the channel's conversation. */
  maskyShareSlug?: string;
  /** Embeddable live URL on masky.ai that auto-plays each rendered turn. */
  maskyLiveUrl?: string;
  /** Opaque viewer token gating the conversation's live media. */
  maskyViewerToken?: string;
  /** AI avatars currently present in this voice channel (server-managed). The
   *  primary avatar is always present; others join via voice invite. */
  activeAvatars?: ChannelAvatar[];
}

// ─── Message ─────────────────────────────────────────────────────────────────

export type MessageType = 'default' | 'system_join' | 'system_pin' | 'system_leave';

export interface Attachment {
  url: string;
  filename: string;
  size: number;
  contentType: string;
}

export interface Reaction {
  count: number;
  userIds: string[];
}

export interface Message {
  id: string;
  content: string;
  authorId: string;
  createdAt: Timestamp;
  editedAt: Timestamp | null;
  attachments: Attachment[];
  reactions: Record<string, Reaction>; // keyed by emoji
  mentions: string[]; // userIds
  pinned: boolean;
  type: MessageType;
}

// ─── Invite ──────────────────────────────────────────────────────────────────

export interface Invite {
  code: string;
  guildId: string;
  channelId: string;
  inviterId: string;
  uses: number;
  maxUses: number | null;
  expiresAt: Timestamp | null;
  createdAt: Timestamp;
}

// ─── Direct Messages ─────────────────────────────────────────────────────────

export interface DirectMessageConversation {
  id: string;
  participants: string[]; // [uid1, uid2]
  createdAt: Timestamp;
  lastMessageAt: Timestamp;
}

export interface DirectMessage {
  id: string;
  content: string;
  senderId: string;
  /** @deprecated stored as authorId in messages created before the senderId migration */
  authorId?: string;
  createdAt: Timestamp;
  readBy: string[];
  attachments: Attachment[];
}

// ─── Friendship ──────────────────────────────────────────────────────────────

export interface Friendship {
  id: string;
  uids: string[];
  status: 'pending' | 'accepted';
  requesterId: string;
  createdAt: Timestamp;
}

// ─── Presence (Realtime DB) ───────────────────────────────────────────────────

export interface PresenceState {
  status: 'online' | 'idle' | 'dnd';
  lastSeen: number; // unix ms
  activeGuildId: string | null;
  activeChannelId: string | null;
}

// ─── Voice State (Realtime DB) ───────────────────────────────────────────────

export interface VoiceState {
  joinedAt: number; // unix ms
  muted: boolean;
  deafened: boolean;
  speaking?: boolean; // updated by VAD/PTT client, read by sidebar for speaking indicators
  /** When the user is wearing a mask, their shared identity (so everyone — the
   *  sidebar list and remote tiles — shows the mask, not the real name). */
  maskName?: string;
  maskAvatarUrl?: string;
}

// ─── Live Channel ─────────────────────────────────────────────────────────────

/** Source platform for a live message. */
export const LiveNetwork = {
  Twitch:   0,
  YouTube:  1,
  Facebook: 2,
  Maskord:  99, // sent from within Maskord (echoed back)
} as const;
export type LiveNetworkValue = typeof LiveNetwork[keyof typeof LiveNetwork];

/**
 * A single message in a guild's #live channel.
 * Written by the Cloud Function bridge from users/{uid}/chatMessages.
 * Path: guilds/{guildId}/liveMessages/{id}
 */
export interface LiveMessage {
  id: string;
  network: LiveNetworkValue;
  /** Platform-assigned message ID (for dedup). */
  platformMsgId: string;
  /** Display name on the originating platform. */
  senderName: string;
  /** Platform user ID (e.g. Twitch chatter_user_id). */
  senderPlatformId: string;
  /** Maskord UID if this platform user is also a Maskord user, else null. */
  senderMaskordUid: string | null;
  text: string;
  /** Twitch emote fragments, if present. */
  fragments: Array<{ type: string; text: string; emote?: { id: string } }> | null;
  timestamp: Timestamp;
  lang: string | null;
}

/**
 * Live streaming status for a guild owner's stream.
 * Path: guilds/{guildId}/liveStatus
 */
export interface LiveStatus {
  isLive: boolean;
  network: LiveNetworkValue;
  streamTitle: string;
  viewerCount: number;
  /** e.g. "https://www.twitch.tv/username" */
  streamUrl: string;
  /** Twitch login name (used for embed player). */
  twitchLogin: string | null;
  thumbnailUrl: string;
  startedAt: Timestamp | null;
  updatedAt: Timestamp;
}

// ─── Voice Signaling (Realtime DB) ───────────────────────────────────────────

export interface RTCSignalDescription {
  type: RTCSdpType;
  sdp: string;
}

export interface IceCandidate {
  candidate: string;
  sdpMid: string;
  sdpMLineIndex: number;
}

export interface VoiceRoom {
  offer?: RTCSignalDescription;
  answer?: RTCSignalDescription;
  callerId: string;
  status: 'offer' | 'answer' | 'ended';
  createdAt: number;
}
