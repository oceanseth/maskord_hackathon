import type { Role, GuildMember, Channel } from '../types';

// ─── Permission Bitfield ──────────────────────────────────────────────────────

export enum Permission {
  VIEW_CHANNEL         = 1 << 0,  // 1
  SEND_MESSAGES        = 1 << 1,  // 2
  READ_MESSAGE_HISTORY = 1 << 2,  // 4
  MANAGE_MESSAGES      = 1 << 3,  // 8
  EMBED_LINKS          = 1 << 4,  // 16
  ATTACH_FILES         = 1 << 5,  // 32
  ADD_REACTIONS        = 1 << 6,  // 64
  CONNECT              = 1 << 7,  // 128  — join voice channel
  SPEAK                = 1 << 8,  // 256  — speak in voice channel
  MUTE_MEMBERS         = 1 << 9,  // 512
  DEAFEN_MEMBERS       = 1 << 10, // 1024
  MOVE_MEMBERS         = 1 << 11, // 2048
  MANAGE_CHANNELS      = 1 << 12, // 4096
  MANAGE_GUILD         = 1 << 13, // 8192
  KICK_MEMBERS         = 1 << 14, // 16384
  BAN_MEMBERS          = 1 << 15, // 32768
  MANAGE_ROLES         = 1 << 16, // 65536
  ADMINISTRATOR        = 1 << 17, // 131072 — bypasses all checks
}

// Default permissions for @everyone
export const DEFAULT_PERMISSIONS =
  Permission.VIEW_CHANNEL |
  Permission.SEND_MESSAGES |
  Permission.READ_MESSAGE_HISTORY |
  Permission.EMBED_LINKS |
  Permission.ATTACH_FILES |
  Permission.ADD_REACTIONS |
  Permission.CONNECT |
  Permission.SPEAK;

/**
 * Compute a member's effective guild-level permissions by combining
 * all role bitfields. ADMINISTRATOR bypasses everything.
 */
export function computeGuildPermissions(
  member: GuildMember,
  roles: Role[],
  guildOwnerId: string,
): number {
  if (member.userId === guildOwnerId) {
    return ~0 >>> 0; // owner has all permissions
  }

  const memberRoleSet = new Set(member.roles);
  let perms = 0;

  for (const role of roles) {
    if (memberRoleSet.has(role.id) || role.name === '@everyone') {
      perms |= role.permissions;
    }
  }

  return perms;
}

/**
 * Compute effective channel-level permissions by applying permission
 * overwrites on top of guild permissions.
 *
 * Resolution order (Discord spec):
 * 1. Guild permissions from roles
 * 2. @everyone channel overwrite
 * 3. Role-specific channel overwrites (deny before allow)
 * 4. Member-specific channel overwrite (most specific, wins)
 */
export function computeChannelPermissions(
  member: GuildMember,
  roles: Role[],
  channel: Channel,
  guildOwnerId: string,
): number {
  // ADMINISTRATOR and guild owner bypass channel overwrites
  const base = computeGuildPermissions(member, roles, guildOwnerId);
  if (member.userId === guildOwnerId) return base;
  if (hasPermission(base, Permission.ADMINISTRATOR)) return base;

  let perms = base;
  const overwrites = channel.permissionOverwrites;

  // Step 1: @everyone overwrite
  const everyoneRole = roles.find((r) => r.name === '@everyone');
  if (everyoneRole && overwrites[everyoneRole.id]) {
    const ow = overwrites[everyoneRole.id];
    perms &= ~ow.deny;
    perms |= ow.allow;
  }

  // Step 2: Role overwrites
  let roleDeny = 0;
  let roleAllow = 0;
  for (const role of roles) {
    if (member.roles.includes(role.id) && overwrites[role.id]) {
      roleDeny |= overwrites[role.id].deny;
      roleAllow |= overwrites[role.id].allow;
    }
  }
  perms &= ~roleDeny;
  perms |= roleAllow;

  // Step 3: Member-specific overwrite
  if (overwrites[member.userId]) {
    const ow = overwrites[member.userId];
    perms &= ~ow.deny;
    perms |= ow.allow;
  }

  return perms;
}

/** Check if a permissions bitfield includes a specific permission */
export function hasPermission(perms: number, flag: Permission): boolean {
  if (perms & Permission.ADMINISTRATOR) return true;
  return (perms & flag) === flag;
}
