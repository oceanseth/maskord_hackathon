import { useAuth } from '@maskord/shared';
import type { ChannelMode } from '@maskord/shared';
import type { RoomIdentity } from '../../rooms/useRoom';

/**
 * What a game board is handed when a channel is in one of the game modes.
 *
 * The board derives its own room slug from `channelId` — `<kind>:ch-<channelId>`,
 * which satisfies the prefix rule `rooms.ensure` enforces — so one channel is one
 * table, permanently, with no `?room=` to pass around.
 */
export interface ChannelGameProps {
  guildId: string;
  channelId: string;
  identity: RoomIdentity;
}

interface Props {
  guildId: string;
  channelId: string;
  mode: ChannelMode;
}

/**
 * A channel whose mode replaces the chatroom with a game.
 *
 * This is only the mount point and the sign-in gate: the channel stays an
 * ordinary text channel underneath — same messages, same permissions — and the
 * mode decides what is rendered over it. Boards are mounted here rather than
 * reached at their own URL, which is the whole point of the change: the game is
 * the channel, not a panel beside it.
 */
export default function ChannelGameView({ guildId, channelId, mode }: Props) {
  const { firebaseUser, profile } = useAuth();

  const identity: RoomIdentity | null =
    firebaseUser && profile
      ? { key: firebaseUser.uid, name: profile.displayName, avatarUrl: profile.avatarUrl }
      : null;

  // A seat at a table has to belong to somebody: the engine keys members by uid,
  // and a guest who has not landed yet has no uid to key them by.
  if (!identity) {
    return (
      <Centered>
        <p className="text-sm text-[#9ca3af]">Sign in to take a seat at this table.</p>
      </Centered>
    );
  }

  // Boards mount here, and the swap is one line:
  //
  //   if (mode === 'dnd') return <DndChannel guildId={guildId} channelId={channelId} />;
  //
  // from `app/desktop/src/rooms/wizard/DndChannel.tsx` (PR #33). It takes only
  // those two props and derives the room slug itself. Until that lands the
  // channel says what it is rather than rendering an empty column.
  return (
    <Centered>
      <p className="text-sm font-semibold text-white">
        {mode === 'dnd' ? 'D&D table' : 'Debate floor'}
      </p>
      <p className="text-xs text-[#6b7280] max-w-sm text-center">
        This channel is in {mode === 'dnd' ? 'D&D' : 'debate'} mode. The board mounts here — until
        it lands, the table is reachable at{' '}
        <code className="text-violet-300">
          /{mode === 'dnd' ? 'wizard' : 'debate'}.html?room=ch-{channelId}
        </code>
        .
      </p>
      <p className="text-[11px] text-[#4b5563]">
        guild {guildId.slice(0, 8)}… · seat {identity.name}
      </p>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 bg-[#0e0e16] min-w-0">
      {children}
    </div>
  );
}
