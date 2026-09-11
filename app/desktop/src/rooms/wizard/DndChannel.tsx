import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, useGuildChannels, sendMessage } from '@maskord/shared';
import MessageInput from '../../components/channel/MessageInput';
import MobileBackButton from '../../components/ui/MobileBackButton';
import { useAppStore } from '../../store/app';
import { DefaultEvent, MemberStrip, StatusPill } from '../RoomPanel';
import { ChannelFeed } from '../ChannelFeed';
import { useRoom, type RoomEvent, type RoomIdentity } from '../useRoom';
import { channelRoomSlug, useWizard } from './useWizard';
import { Lobby } from './Lobby';
import { GamePanel, SheetModal } from './GamePanel';
import { CampaignPick } from './CampaignPick';
import { Resolve } from './Resolve';
import { campaignLabel } from '../../../../../www/convex/wizard/campaigns';
import './theme.css';

/**
 * A D&D channel: the table rendered in place of the chat room, not beside it.
 *
 * The channel's own messages are the party's voice. What a person types in the
 * composer is sent as an ordinary channel message (so it lives in history and
 * on every other client) and, in the same breath, handed to the DM. The feed
 * is the channel's messages and the table's transcript interleaved by time,
 * so a spectator sees one conversation, not a chat and a game side by side.
 *
 * The room binds to the channel by id — slug `wizard:ch-<channelId>` — so one
 * channel is one table, permanently, with nothing to hand around.
 *
 * The channel walks four phases — ruleset, characters, play, resolve — and the
 * right-hand plate shows the one it is in: the campaign catalogue, the sheet
 * fan, the board, the recap. The host hears every message in every phase and
 * is prompted with that phase's skillfile (www/convex/skills/dnd).
 */

interface Props {
  guildId: string;
  channelId: string;
}

export default function DndChannel({ guildId, channelId }: Props) {
  const { firebaseUser, profile } = useAuth();
  const identity: RoomIdentity | null =
    firebaseUser && profile ? { key: firebaseUser.uid, name: profile.displayName, avatarUrl: profile.avatarUrl } : null;

  const channels = useGuildChannels(guildId);
  const channelName = channels.find((c) => c.id === channelId)?.name ?? '';
  const slug = channelRoomSlug(channelId);
  // The guild is known from the first render, so the room carries it from
  // creation rather than from `start`: the bridge that mirrors lines into the
  // channel reads it from the room's config.
  const config = useMemo(() => ({ guildId }), [guildId]);
  const room = useRoom({ kind: 'wizard', slug, title: channelName ? `#${channelName}` : "The Wizard's Table", config, identity });
  const wiz = useWizard(room);
  const status = room.room?.status ?? 'lobby';
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const phase = wiz.channelPhase;
  const playing = phase === 'play';

  /**
   * One send, two destinations. The channel message is the durable one; the
   * host hears the same words in every phase — while the table is choosing a
   * campaign or sheets it is the host that keeps things moving, and a "yes" in
   * chat is how a campaign gets picked without touching the catalogue.
   */
  const handleSend = useCallback(
    async (content: string) => {
      if (!firebaseUser) return;
      setSendError(null);
      await sendMessage(guildId, channelId, firebaseUser.uid, content);
      if (room.me) {
        try {
          await wiz.askDm(content);
        } catch (err) {
          setSendError(err instanceof Error ? err.message : 'The host did not hear that');
        }
      }
    },
    [firebaseUser, guildId, channelId, room.me, wiz],
  );

  const placeholder =
    phase === 'ruleset'
      ? `Pick a campaign, or ask the host — #${channelName}`
      : phase === 'characters'
        ? `Ask the host about a sheet — #${channelName}`
        : phase === 'play'
          ? `Say it in character, or ask the DM — #${channelName}`
          : `Message #${channelName}`;

  return (
    <div className="kf flex-1 flex flex-col min-h-0 min-w-0 bg-[#0e0e16] text-[#e2e8f0]">
      {/* Channel header: the normal one, plus the table's state. */}
      <div className="h-12 flex items-center gap-2 px-4 border-b border-[#1e1e2e] flex-shrink-0">
        <MobileBackButton onClick={() => useAppStore.getState().setActiveChannel(null, 'text')} />
        <span className="text-[#6b7280] text-lg">🎲</span>
        <span className="font-semibold text-white text-sm">{channelName}</span>
        <span className="text-xs text-[#8b8fa3] truncate hidden md:inline">{wiz.campaign ? campaignLabel(wiz.campaign) : 'choosing a campaign'}</span>
        <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide bg-violet-600/30 text-violet-300" title="Channel phase">{phase}</span>
        <StatusPill status={status} />
        {status === 'paused' && room.room?.pause && (
          <span className="text-xs text-[#8b8fa3] truncate">
            paused by {room.room.pause.byName}
            {room.room.pause.reason ? ` — ${room.room.pause.reason}` : ''}
          </span>
        )}
        <span className="ml-auto text-xs text-[#8b8fa3]">
          {wiz.capabilities.inference ? `AI via ${wiz.capabilities.via ?? 'deployment'}` : 'No AI key yet — masks play on a simple policy'}
        </span>
        <a className="text-xs underline text-sky-300" href={`/wizardmap.html?ch=${encodeURIComponent(channelId)}`} target="_blank" rel="noreferrer">
          Map screen
        </a>
        {wiz.mySeatKey && identity && (
          <button className="text-xs px-2 py-0.5 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e]" onClick={() => setSheetFor(identity.key)}>
            My sheet
          </button>
        )}
        {playing && status === 'running' && (
          <button className="text-xs px-2 py-0.5 rounded bg-[#2a2a3e] hover:bg-[#3a3a5e]" onClick={() => wiz.pause('looking at a character sheet')}>
            Pause
          </button>
        )}
        {status === 'paused' && (
          <button className="text-xs px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600" onClick={() => wiz.resume()}>
            Resume
          </button>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* The conversation: channel messages and the transcript, one stream. */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <MemberStrip
            members={room.members}
            meKey={room.me?.memberKey}
            extra={(m) =>
              m.kind !== 'host' && Object.values(wiz.seats).some((s) => s?.ownerKey === m.memberKey) ? (
                <button className="text-[10px] hover:text-amber-300" title="Character sheet" onClick={() => setSheetFor(m.memberKey)}>
                  📜
                </button>
              ) : null
            }
          />
          <ChannelFeed guildId={guildId} channelId={channelId} events={room.events} humanKeys={room.members.filter((m) => m.kind === 'human').map((m) => m.memberKey)} currentUserId={firebaseUser?.uid} />
          {sendError && <p className="px-4 pb-1 text-xs text-red-400">{sendError}</p>}
          {identity ? (
            <MessageInput placeholder={placeholder} onSend={handleSend} />
          ) : null}
        </div>

        {/* The table itself. */}
        {identity && (
          <aside className="kf-plate w-[480px] shrink-0 border-l border-[#1f1f2e] flex flex-col min-h-0 overflow-y-auto">
            {phase === 'ruleset' && <CampaignPick wiz={wiz} />}
            {phase === 'characters' && <Lobby room={room} wiz={{ ...wiz, start: () => wiz.start(guildId) }} uid={identity.key} />}
            {phase === 'play' && <GamePanel room={room} wiz={wiz} />}
            {phase === 'resolve' && <Resolve wiz={wiz} />}
          </aside>
        )}
      </div>

      {sheetFor && <SheetModal wiz={wiz} memberKey={sheetFor} onClose={() => setSheetFor(null)} />}
    </div>
  );
}

// ─── The feed ─────────────────────────────────────────────────────────────────
