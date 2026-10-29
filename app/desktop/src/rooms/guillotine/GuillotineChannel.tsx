import { useCallback, useMemo, useState } from 'react';
import { useAuth, useGuildChannels, sendMessage } from '@maskord/shared';
import type { Channel } from '@maskord/shared';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@maskord/convex';
import MessageInput from '../../components/channel/MessageInput';
import MobileBackButton from '../../components/ui/MobileBackButton';
import { useAppStore } from '../../store/app';
import { StatusPill } from '../RoomPanel';
import { ChannelFeed } from '../ChannelFeed';
import { useRoom, type RoomIdentity } from '../useRoom';
import { SideShelf } from '../SideShelf';
import { Stage, StageLeaderboard, useStage, type VerbStyle } from '../stage/Stage';

/**
 * A guillotine channel: billionaires on the stage, the audience on the blade.
 *
 * Same shape as the debate floor — the channel's messages are the room's
 * voice, the feed interleaves them with the stage's lines, and the room binds
 * to the channel by id. On top sits the shared stage; on the right, the
 * bracket: who is unbeaten, who is on one strike, who has lost their head.
 */

/** Mirrors `debateChannelSlug`; `rooms.ensure` enforces the prefix. */
export function guillotineChannelSlug(channelId: string): string {
  return `guillotine:ch-${channelId}`;
}

const VERBS: Record<string, VerbStyle> = {
  execute: {
    label: 'Execute',
    emoji: '🪓',
    idle: 'bg-[#3a1418] hover:bg-[#5a1a20] text-red-200 border border-red-900/60',
    active: 'bg-red-600 text-white border border-red-400',
    bar: 'bg-red-500',
  },
};

const SIZES = [6, 8, 12, 16];

interface Props {
  guildId: string;
  channelId: string;
}

export default function GuillotineChannel({ guildId, channelId }: Props) {
  const { firebaseUser, profile } = useAuth();
  const identity: RoomIdentity | null =
    firebaseUser && profile
      ? { key: firebaseUser.uid, name: profile.displayName, avatarUrl: profile.avatarUrl }
      : null;

  const channels = useGuildChannels(guildId);
  const channel = channels.find((c: Channel) => c.id === channelId);
  const channelName = channel?.name ?? '';
  const slug = guillotineChannelSlug(channelId);

  const config = useMemo(() => ({ guildId }), [guildId]);
  const room = useRoom({
    kind: 'guillotine',
    slug,
    title: channelName ? `#${channelName}` : 'Guillotine',
    config,
    identity,
  });

  const voter = useMemo(() => (identity ? { key: identity.key, name: identity.name } : null), [identity?.key, identity?.name]);
  const stage = useStage(slug, voter);
  const game = useQuery(api.guillotine.state, { slug });
  const start = useMutation(api.guillotine.start);
  const reset = useMutation(api.guillotine.reset);
  const resume = useMutation(api.guillotine.resume);

  const [size, setSize] = useState(8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = room.room?.status ?? 'lobby';
  const phase = stage.data?.stage.phase ?? 'idle';

  const handleSend = useCallback(
    async (content: string) => {
      if (!firebaseUser) return;
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

  const roster = game?.roster ?? [];
  const unbeaten = roster.filter((r) => !r.out && r.strikes === 0);
  const struck = roster.filter((r) => !r.out && r.strikes > 0);
  const out = roster.filter((r) => r.out).sort((a, b) => (b.outAt ?? 0) - (a.outAt ?? 0));
  const onStage = new Set(game?.liveHeat?.keys ?? []);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-[#0e0e16] text-[#e2e8f0]">
      <div className="h-12 flex items-center gap-2 px-4 border-b border-[#1e1e2e] flex-shrink-0">
        <MobileBackButton onClick={() => useAppStore.getState().setActiveChannel(null, 'text')} />
        <span className="text-lg">🪓</span>
        <span className="font-semibold text-white text-sm">{channelName}</span>
        <span className="text-xs text-[#8b8fa3] truncate hidden md:inline">
          {game?.champion
            ? `Champion: ${game.champion}`
            : game?.started
              ? `Heat ${game.heat} · ${roster.length - out.length} of ${roster.length} still have heads`
              : 'Billionaires, one blade'}
        </span>
        <StatusPill status={status} />
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {game?.champion && (
            <div className="px-4 py-2 text-center text-sm font-semibold bg-amber-900/30 border-b border-amber-700/40 text-amber-200">
              👑 {game.champion} survived the blade and wins Guillotine!
            </div>
          )}
          <Stage
            data={stage.data}
            vote={stage.vote}
            canVote={Boolean(identity)}
            verbStyles={VERBS}
            hostName={room.room?.hostName ?? 'Masky'}
            className="max-h-[62vh]"
            marker={{ verb: 'execute', icon: <span title="The guillotine">🗡️⛓️</span>, stamp: 'EXECUTED' }}
            empty={
              <p className="text-sm text-[#8b8fa3]">
                {game?.champion
                  ? `${game.champion} survived the blade.`
                  : 'Start a game to bring the billionaires on stage.'}
              </p>
            }
          />
          <div className="flex-1 min-h-[8.5rem] min-w-0 flex flex-col">
          <ChannelFeed
            guildId={guildId}
            channelId={channelId}
            events={room.events}
            humanKeys={room.members.filter((m) => m.kind === 'human').map((m) => m.memberKey)}
            currentUserId={firebaseUser?.uid}
          />
          </div>
          {identity ? (
            <MessageInput placeholder={`Heckle the billionaires — #${channelName}`} onSend={handleSend} />
          ) : (
            <p className="px-4 py-3 text-sm text-[#6b7280]">Sign in to vote.</p>
          )}
        </div>

        <SideShelf label="Bracket" bodyClassName="gap-4 p-3">
          {(!game?.started || game.champion) && (
            <div className="space-y-2">
              <p className="text-xs text-[#8b8fa3]">
                Double elimination. Three billionaires a heat, one line each, then the room and Twitch vote
                who gets executed. Two strikes and you're out.
              </p>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#8b8fa3]">Billionaires</span>
                {SIZES.map((n) => (
                  <button
                    key={n}
                    onClick={() => setSize(n)}
                    className={`px-2 py-0.5 rounded ${size === n ? 'bg-red-600 text-white' : 'bg-[#1e1e2e] text-[#94a3b8]'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <button
                disabled={busy || !identity}
                onClick={() => run(() => start({ slug, size, startedBy: identity?.key }))}
                className="w-full px-3 py-2 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-50 text-sm font-semibold"
              >
                {busy ? 'Sharpening…' : game?.champion ? 'New game' : 'Start Guillotine'}
              </button>
            </div>
          )}

          {game?.started && !game.champion && (
            <div className="flex flex-wrap gap-1.5">
              {status === 'running' ? (
                <button
                  disabled={busy}
                  onClick={() => run(() => room.setStatus('paused', 'host break'))}
                  className="px-2.5 py-1 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e] text-xs"
                >
                  Pause
                </button>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => run(() => resume({ slug }))}
                  className="px-2.5 py-1 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e] text-xs"
                >
                  Resume
                </button>
              )}
              {phase === 'voting' && (
                <button
                  disabled={busy}
                  onClick={() => run(() => stage.closeNow())}
                  className="px-2.5 py-1 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e] text-xs"
                >
                  Lock votes
                </button>
              )}
              <button
                disabled={busy}
                onClick={() => {
                  if (window.confirm('End this game and clear the bracket?')) run(() => reset({ slug }));
                }}
                className="px-2.5 py-1 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e] text-xs text-red-300"
              >
                Reset
              </button>
            </div>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}

          {game?.started && (
            <div className="space-y-3">
              <BracketGroup title="Unbeaten" rows={unbeaten} onStage={onStage} champion={game.championKey} />
              <BracketGroup title="One strike" rows={struck} onStage={onStage} champion={game.championKey} />
              <BracketGroup title="Lost their heads" rows={out} onStage={onStage} champion={game.championKey} />
            </div>
          )}

          <StageLeaderboard data={stage.data} meKey={identity?.key} />

          {game && game.history.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-[#8b8fa3] uppercase tracking-wide">Executions</div>
              {[...game.history].reverse().slice(0, 12).map((h) => (
                <div key={h.heat} className="text-[11px] text-[#94a3b8]">
                  <span className="text-[#6b7280]">H{h.heat}</span> 🪓{' '}
                  <span className="text-red-300">{h.executedName}</span>
                  {h.byChance && <span title="Tie or no votes"> 🎲</span>}
                </div>
              ))}
            </div>
          )}
        </SideShelf>
      </div>
    </div>
  );
}

type RosterRow = {
  key: string;
  name: string;
  emoji: string;
  color: string;
  strikes: number;
  out: boolean;
};

function BracketGroup({
  title,
  rows,
  onStage,
  champion,
}: {
  title: string;
  rows: RosterRow[];
  onStage: Set<string>;
  champion: string | null;
}) {
  if (!rows.length) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-[#8b8fa3] uppercase tracking-wide">
        {title} <span className="text-[#4b5563]">{rows.length}</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.key}
          className={`flex items-center gap-2 text-xs ${r.out ? 'opacity-40 line-through' : ''} ${onStage.has(r.key) ? 'text-white' : 'text-[#c8d0e0]'}`}
        >
          <span>{r.emoji}</span>
          <span className="truncate flex-1" style={{ color: onStage.has(r.key) ? r.color : undefined }}>
            {r.name}
          </span>
          {champion === r.key && <span title="Champion">👑</span>}
          {onStage.has(r.key) && <span className="text-[10px] text-violet-300">on stage</span>}
          <span className="text-red-400">{'🪓'.repeat(r.strikes)}</span>
        </div>
      ))}
    </div>
  );
}
