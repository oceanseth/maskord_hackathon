import { useAuth } from '@maskord/shared';
import type { ChannelMode } from '@maskord/shared';
import type { RoomIdentity } from '../../rooms/useRoom';
import DebateChannel from '../../rooms/debate/DebateChannel';
import DndChannel from '../../rooms/wizard/DndChannel';

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

  if (mode === 'debate') return <DebateChannel guildId={guildId} channelId={channelId} />;

  // Every mode with a board returns above. Anything else is a mode somebody
  // added to the type without a view, which should say so rather than render
  // an empty column.
  return (
    <Centered>
      <p className="text-sm font-semibold text-white">Unknown mode</p>
      <p className="text-xs text-[#6b7280]">
        This channel is in <code className="text-violet-300">{mode}</code> mode, which has no
        board yet.
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
