import { useAuth, useGuildChannels } from '@maskord/shared';
import type { Channel } from '@maskord/shared';
import { useVoiceCtx } from '../voice/VoiceProvider';
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
  const channels = useGuildChannels(guildId);
  const isVoice = channels.find((c: Channel) => c.id === channelId)?.type === 'voice';

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

  // A voice game channel is a table you talk at: the call is already joined by
  // the sidebar, so all the board owes the room is the controls it would
  // otherwise have lost with the participant grid.
  const board =
    mode === 'dnd' ? (
      <DndChannel guildId={guildId} channelId={channelId} />
    ) : mode === 'debate' ? (
      <DebateChannel guildId={guildId} channelId={channelId} />
    ) : null;

  if (board) {
    return isVoice ? (
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        <VoiceBar />
        {board}
      </div>
    ) : (
      board
    );
  }

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

/**
 * The strip a voice game channel keeps when the participant grid gives way to a
 * board: who is in the call, and the two buttons nobody should have to leave
 * the table to reach.
 */
function VoiceBar() {
  const { participants, isMuted, isDeafened, isConnected, toggleMute, toggleDeafen, hangUp } =
    useVoiceCtx();
  if (!isConnected) return null;
  return (
    <div className="h-9 flex items-center gap-2 px-3 border-b border-[#1e1e2e] bg-[#0a0a12] flex-shrink-0 text-xs">
      <span className="text-emerald-400">● live</span>
      <span className="text-[#8b8fa3] truncate">
        {participants.length} in the call
        {participants.some((p) => p.state?.speaking) ? ' · someone is speaking' : ''}
      </span>
      <button
        onClick={toggleMute}
        className={`ml-auto px-2 py-0.5 rounded ${isMuted ? 'bg-red-900/50 text-red-200' : 'bg-[#2a2a3e] text-[#cbd5e1]'}`}
      >
        {isMuted ? 'Unmute' : 'Mute'}
      </button>
      <button
        onClick={toggleDeafen}
        className={`px-2 py-0.5 rounded ${isDeafened ? 'bg-red-900/50 text-red-200' : 'bg-[#2a2a3e] text-[#cbd5e1]'}`}
      >
        {isDeafened ? 'Undeafen' : 'Deafen'}
      </button>
      <button onClick={hangUp} className="px-2 py-0.5 rounded bg-[#2a2a3e] hover:bg-red-900/50 text-[#cbd5e1]">
        Leave
      </button>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 bg-[#0e0e16] min-w-0">
      {children}
    </div>
  );
}
