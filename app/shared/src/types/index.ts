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

export type ChannelType = 'text' | 'voice' | 'announcement' | 'category';

export interface PermissionOverwrite {
  allow: number; // bitfield
  deny: number;  // bitfield
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
