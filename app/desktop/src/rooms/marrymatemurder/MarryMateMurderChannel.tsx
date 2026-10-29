import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_CLAUDE_AVATAR,
  Permission,
  computeGuildPermissions,
  hasPermission,
  sendMessage,
  useAuth,
  useGuild,
  useGuildChannels,
  useGuildMembers,
  useGuildRoles,
} from '@maskord/shared';
import type { Channel } from '@maskord/shared';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@maskord/convex';
import MessageInput from '../../components/channel/MessageInput';
import MobileBackButton from '../../components/ui/MobileBackButton';
import { useMaskyAvatars } from '../../hooks/useMaskyAvatars';
import { useAppStore } from '../../store/app';
import { ChannelFeed } from '../ChannelFeed';
import { StatusPill } from '../RoomPanel';
import { useRoom } from '../useRoom';
import { Stage, StageLeaderboard, useStage, type VerbStyle } from '../stage/Stage';

/**
 * Marry, Mate, Murder.
 *
 * The shared stage draws A, B, and C, plays the one defense each, and takes
 * marry / mate / murder. This board seats three masks the server owns and
 * starts the round. The show ends when the vote is revealed; another round
 * keeps the scoreboard.
 */

const VERBS: Record<string, VerbStyle> = {
  marry: {
    label: 'Marry',
    emoji: '💍',
    idle: 'bg-pink-950/80 hover:bg-pink-900 text-pink-100 border border-pink-800',
    active: 'bg-pink-600 text-white border border-pink-300',
    bar: 'bg-pink-500',
  },
  mate: {
    label: 'Mate',
    emoji: '💋',
    idle: 'bg-fuchsia-950/80 hover:bg-fuchsia-900 text-fuchsia-100 border border-fuchsia-800',
    active: 'bg-fuchsia-600 text-white border border-fuchsia-300',
    bar: 'bg-fuchsia-500',
  },
  murder: {
    label: 'Murder',
    emoji: '🔪',
    idle: 'bg-red-950/80 hover:bg-red-900 text-red-100 border border-red-800',
    active: 'bg-red-600 text-white border border-red-300',
    bar: 'bg-red-500',
  },
};

const LABELS = ['A', 'B', 'C'] as const;

export function marryMateMurderChannelSlug(channelId: string): string {
  return `marrymatemurder:ch-${channelId}`;
}

interface Props {
  guildId: string;
  channelId: string;
}

export default function MarryMateMurderChannel({ guildId, channelId }: Props) {
  const { firebaseUser, profile } = useAuth();
  const { guild } = useGuild(guildId);
  const members = useGuildMembers(guildId);
  const roles = useGuildRoles(guildId);
  const channels = useGuildChannels(guildId);
  const channel = channels.find((item: Channel) => item.id === channelId);
  const channelName = channel?.name ?? '';

  const identity = firebaseUser && profile
    ? { key: firebaseUser.uid, name: profile.displayName, avatarUrl: profile.avatarUrl }
    : null;

  const config = useMemo(() => ({ guildId }), [guildId]);
  const slug = marryMateMurderChannelSlug(channelId);
  const room = useRoom({
    kind: 'marrymatemurder',
    slug,
    title: channelName ? `#${channelName}` : 'Marry, Mate, Murder',
    config,
    identity,
  });

  // The ballot key is the Firebase uid. Twitch sign-in already uses
  // twitch:<numeric user id>, the same key the chat bridge writes, so a
  // viewer who votes in chat and later votes from the buttons is one voter.
  const voter = useMemo(
    () => (identity ? { key: identity.key, name: identity.name } : null),
    [identity?.key, identity?.name],
  );
  const stage = useStage(slug, voter);
  const game = useQuery(api.marrymatemurder.state, { slug });
  const seat = useMutation(api.marrymatemurder.seat);
  const unseat = useMutation(api.marrymatemurder.unseat);
  const start = useMutation(api.marrymatemurder.start);
  const reset = useMutation(api.marrymatemurder.reset);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const membership = members.find((member) => member.userId === firebaseUser?.uid);
  const perms = membership && guild ? computeGuildPermissions(membership, roles, guild.ownerId) : 0;
  const isAdmin =
    guild?.ownerId === firebaseUser?.uid ||
    hasPermission(perms, Permission.ADMINISTRATOR) ||
    hasPermission(perms, Permission.MANAGE_CHANNELS);

  const maskOwnerUid = guild?.claudeAvatarOwnerUid ?? DEFAULT_CLAUDE_AVATAR.ownerUid;
  const serverMasks = useMaskyAvatars(maskOwnerUid);

  const phase = stage.data?.stage.phase ?? 'idle';
  const round = game?.round ?? 0;
  const slots = game?.slots ?? [];
  const locked = phase === 'speeches' || phase === 'voting' || phase === 'revealed';
  const played = round > 0 || phase === 'over' || phase === 'revealed';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  const handleSend = useCallback(
    async (content: string) => {
      if (!firebaseUser) return;
      setError(null);
      await sendMessage(guildId, channelId, firebaseUser.uid, content);
    },
    [firebaseUser, guildId, channelId],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-[#0e0e16] text-[#e2e8f0]">
      <div className="h-12 flex items-center gap-2 px-4 border-b border-[#1e1e2e] flex-shrink-0">
        <MobileBackButton onClick={() => useAppStore.getState().setActiveChannel(null, 'text')} />
        <span className="text-[#6b7280] text-lg">💍</span>
        <span className="font-semibold text-white text-sm">{channelName || 'Marry, Mate, Murder'}</span>
        <StatusPill status={room.room?.status ?? 'lobby'} />
        {round > 0 && <span className="ml-auto text-xs text-[#8b8fa3]">Round {round}</span>}
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <Stage
            data={stage.data}
            vote={stage.vote}
            canVote={Boolean(identity)}
            verbStyles={VERBS}
            hostName={room.room?.hostName ?? 'Masky'}
            empty={
              <p className="text-sm text-[#8b8fa3]">
                {isAdmin
                  ? 'Seat three masks this server owns, then start the round.'
                  : 'Waiting for a server admin to seat three masks.'}
              </p>
            }
          />
          <ChannelFeed
            guildId={guildId}
            channelId={channelId}
            events={room.events}
            humanKeys={room.humans.map((member) => member.memberKey)}
            currentUserId={firebaseUser?.uid}
          />
          {error && <p className="px-4 pb-1 text-xs text-red-400">{error}</p>}
          {identity ? (
            <MessageInput placeholder={`Message #${channelName}`} onSend={handleSend} />
          ) : (
            <p className="px-4 py-3 text-sm text-[#6b7280]">Sign in to vote.</p>
          )}
        </div>

        <aside className="w-72 shrink-0 border-l border-[#1f1f2e] flex flex-col min-h-0 bg-[#0c0c14] p-3 gap-3 overflow-y-auto scrollable">
          <p className="text-xs text-[#8b8fa3]">
            Three masks this server owns. One line each, then every voter assigns marry, mate, and murder —
            one of each. A point for each verb that matches the room. The show ends when the vote is revealed.
          </p>

          {isAdmin && !locked && (
            <div className="space-y-2">
              {LABELS.map((label) => {
                const slot = slots.find((item) => item.label === label);
                const taken = new Set(
                  slots.filter((item) => item.label !== label).map((item) => item.avatarGroupId),
                );
                return (
                  <label key={label} className="block text-[11px] text-[#94a3b8]">
                    {label}
                    <select
                      disabled={busy}
                      value={slot?.avatarGroupId ?? ''}
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) {
                          void run(() => unseat({ slug, label }));
                          return;
                        }
                        const group = serverMasks.avatarGroups.find((item) => item.id === id);
                        if (!group) return;
                        void run(() =>
                          seat({
                            slug,
                            label,
                            memberKey: `mask:${group.id}`,
                            name: group.displayName,
                            persona: group.personalityPrompt ?? '',
                            avatarUrl: group.thumbnailUrl,
                            avatarGroupId: group.id,
                            ownerUid: maskOwnerUid,
                          }),
                        );
                      }}
                      className="mt-1 w-full px-2 py-1.5 rounded bg-[#0a0a0f] border border-[#1e1e2e] text-white text-xs"
                    >
                      <option value="">Empty</option>
                      {serverMasks.avatarGroups.map((group) => (
                        <option key={group.id} value={group.id} disabled={taken.has(group.id)}>
                          {group.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
              {serverMasks.avatarGroups.length === 0 && !serverMasks.loading && (
                <p className="text-[11px] text-[#8b8fa3]">
                  This server has no masks yet. Add them under the account in Server Settings → AI Assistance.
                </p>
              )}
              <button
                disabled={busy || slots.length !== 3 || !identity}
                onClick={() =>
                  void run(() =>
                    start({ slug, byName: profile?.displayName || 'admin', startedBy: identity?.key }),
                  )
                }
                className="w-full px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-sm font-semibold text-white"
              >
                {busy ? 'Starting…' : played ? 'Another round' : 'Start the round'}
              </button>
            </div>
          )}

          {!(isAdmin && !locked) && (
            <ul className="space-y-1">
              {LABELS.map((label) => {
                const slot = slots.find((item) => item.label === label);
                return (
                  <li key={label} className="flex justify-between text-xs">
                    <span className="text-rose-200">{label}</span>
                    <span className="text-[#c8d0e0] truncate ml-2">{slot?.name ?? 'Open'}</span>
                  </li>
                );
              })}
            </ul>
          )}

          {locked && (
            <p className="text-xs text-[#8b8fa3]">
              Round {round || 1} is on stage. Seating opens again when the vote is revealed.
            </p>
          )}

          {isAdmin && (locked || played) && (
            <div className="flex flex-wrap gap-1.5">
              {phase === 'voting' && (
                <button
                  disabled={busy}
                  onClick={() => void run(() => stage.closeNow())}
                  className="px-2.5 py-1 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e] text-xs"
                >
                  Lock votes
                </button>
              )}
              <button
                disabled={busy}
                onClick={() => void run(() => reset({ slug, byName: profile?.displayName || 'admin' }))}
                className="px-2.5 py-1 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e] text-xs text-red-300"
              >
                Clear scores
              </button>
            </div>
          )}

          {!isAdmin && !locked && slots.length < 3 && (
            <p className="text-xs text-[#8b8fa3]">Waiting for a server admin to seat three masks.</p>
          )}

          <StageLeaderboard data={stage.data} meKey={voter?.key} />
        </aside>
      </div>
    </div>
  );
}
