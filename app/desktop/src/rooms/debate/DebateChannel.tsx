import { useCallback, useMemo, useState } from 'react';
import { useAuth, useGuildChannels, sendMessage } from '@maskord/shared';
import { useMutation, useQuery, useAction } from 'convex/react';
import { api } from '@maskord/convex';
import MessageInput from '../../components/channel/MessageInput';
import MobileBackButton from '../../components/ui/MobileBackButton';
import { useAppStore } from '../../store/app';
import { MemberStrip, StatusPill } from '../RoomPanel';
import { ChannelFeed } from '../ChannelFeed';
import { useRoom, type RoomIdentity } from '../useRoom';

/**
 * A debate channel: the floor rendered in place of the chat room.
 *
 * Same shape as the D&D table and for the same reasons — the channel's own
 * messages are the room's voice, the feed interleaves them with the transcript,
 * and the room binds to the channel by id so one channel is one debate forever.
 *
 * The phase decides what the right-hand plate offers: a motion box while the
 * room is choosing one, the panel and the running order once it is arguing, the
 * scorecard once it is called. Masky is prompted with `skills/debate/<phase>.md`
 * for whichever phase that is.
 */

/** Mirrors `channelRoomSlug` in the D&D layer; `rooms.ensure` enforces the prefix. */
export function debateChannelSlug(channelId: string): string {
  return `debate:ch-${channelId}`;
}

interface Props {
  guildId: string;
  channelId: string;
}

export default function DebateChannel({ guildId, channelId }: Props) {
  const { firebaseUser, profile } = useAuth();
  const identity: RoomIdentity | null =
    firebaseUser && profile
      ? { key: firebaseUser.uid, name: profile.displayName, avatarUrl: profile.avatarUrl }
      : null;

  const channels = useGuildChannels(guildId);
  const channelName = channels.find((c) => c.id === channelId)?.name ?? '';
  const slug = debateChannelSlug(channelId);

  // Carried from creation, not from `start`: the bridge that spends the
  // server's key and the mirror that writes lines back into the channel both
  // read `guildId` off the room's config, and the first turn can precede a start.
  const config = useMemo(() => ({ guildId }), [guildId]);
  const room = useRoom({
    kind: 'debate',
    slug,
    title: channelName ? `#${channelName}` : 'The debate floor',
    config,
    identity,
  });

  const state = useQuery(api.debate.state, { slug });
  const cast = useQuery(api.debate.cast, {});
  const seatHouseCast = useMutation(api.debate.seatHouseCast);
  const advance = useMutation(api.debate.advance);
  const factCheck = useMutation(api.debate.factCheck);
  const start = useAction(api.debate.start);

  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = room.room?.status ?? 'lobby';
  const phase = state?.phase ?? 'setup';

  /**
   * One send, two destinations, same as the table: the channel message is the
   * durable one, and a claim typed in chat is what the room fact-checks. Before
   * the motion is set there is nothing to check, so the message is just a
   * message — which is what the `setup` skillfile tells Masky to expect.
   */
  const handleSend = useCallback(
    async (content: string) => {
      if (!firebaseUser) return;
      setError(null);
      await sendMessage(guildId, channelId, firebaseUser.uid, content);
    },
    [firebaseUser, guildId, channelId],
  );

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

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-[#0e0e16] text-[#e2e8f0]">
      <div className="h-12 flex items-center gap-2 px-4 border-b border-[#1e1e2e] flex-shrink-0">
        <MobileBackButton onClick={() => useAppStore.getState().setActiveChannel(null, 'text')} />
        <span className="text-[#6b7280] text-lg">⚖️</span>
        <span className="font-semibold text-white text-sm">{channelName}</span>
        <span className="text-xs text-[#8b8fa3] truncate hidden md:inline">
          {state?.topic ?? 'no motion yet'}
        </span>
        <span
          className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide bg-violet-600/30 text-violet-300"
          title="Channel phase"
        >
          {phase}
        </span>
        <StatusPill status={status} />
        {state && state.round > 0 && (
          <span className="ml-auto text-xs text-[#8b8fa3]">
            Round {Math.min(state.round, state.maxRounds)} of {state.maxRounds}
          </span>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <MemberStrip members={room.members} meKey={room.me?.memberKey} />
          <ChannelFeed
            guildId={guildId}
            channelId={channelId}
            events={room.events}
            humanKeys={room.members.filter((m) => m.kind === 'human').map((m) => m.memberKey)}
            currentUserId={firebaseUser?.uid}
          />
          {error && <p className="px-4 pb-1 text-xs text-red-400">{error}</p>}
          {identity ? (
            <MessageInput
              placeholder={
                phase === 'setup'
                  ? `Suggest a motion — #${channelName}`
                  : phase === 'arguing'
                    ? `Heckle, or take the floor — #${channelName}`
                    : `Message #${channelName}`
              }
              onSend={handleSend}
            />
          ) : (
            <p className="px-4 py-3 text-sm text-[#6b7280]">Sign in to join the floor.</p>
          )}
        </div>

        {/* The plate: what this phase offers. */}
        <aside className="w-72 shrink-0 border-l border-[#1f1f2e] flex flex-col min-h-0 bg-[#0c0c14] p-3 gap-3 overflow-y-auto scrollable">
          {phase === 'setup' && (
            <>
              <p className="text-xs text-[#8b8fa3]">
                A motion is one sentence, arguable both ways. Leave it blank and the host writes
                one.
              </p>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Be it resolved: …"
                className="px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] focus:border-violet-600 text-sm outline-none"
              />
              <div className="flex flex-wrap gap-1.5">
                {(cast ?? []).map((m) => (
                  <span
                    key={m.key}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-[#1e1e2e] text-[#94a3b8]"
                  >
                    {m.name}
                  </span>
                ))}
              </div>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await seatHouseCast({ slug });
                    await start({ slug, topic: topic.trim() || undefined });
                  })
                }
                className="px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-sm font-semibold"
              >
                {busy ? 'Opening…' : 'Open the debate'}
              </button>
            </>
          )}

          {phase === 'arguing' && (
            <>
              <div className="text-xs text-[#8b8fa3]">House rules in force</div>
              <div className="flex flex-wrap gap-1">
                {(state?.rules ?? []).map((r) => (
                  <span
                    key={r.id}
                    title={r.instruction}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-violet-900/40 border border-violet-700/40 text-violet-200"
                  >
                    {r.label}
                  </span>
                ))}
              </div>
              <button
                disabled={busy}
                onClick={() => run(() => advance({ slug }))}
                className="px-3 py-2 rounded-lg bg-[#2a2a3e] hover:bg-[#3a3a5e] disabled:opacity-50 text-sm"
              >
                Next turn
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  run(() => factCheck({ slug, claim: 'the last claim made on the floor' }))
                }
                className="px-3 py-2 rounded-lg bg-[#2a2a3e] hover:bg-[#3a3a5e] disabled:opacity-50 text-sm"
              >
                Fact-check the floor
              </button>
            </>
          )}

          {state?.verdict && (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-white">
                Won by {state.verdict.winner || 'nobody'}
              </div>
              {state.verdict.scores?.map((s) => (
                <div key={s.memberKey} className="text-xs text-[#94a3b8]">
                  <span className="text-[#c8d0e0]">{s.name}</span> — {s.total}
                </div>
              ))}
              {/* The judge's own cost, which is the Nebius evidence a judge reads. */}
              {state.verdict.measurement && (
                <p className="text-[10px] text-[#4b5563]">
                  scored by {state.verdict.measurement.model} in{' '}
                  {Math.round(state.verdict.measurement.latencyMs / 100) / 10}s
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
