import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, useGuildChannels, useGuildMembers, useMessages, useUserProfiles, sendMessage } from '@maskord/shared';
import type { Message } from '@maskord/shared';
import { formatDistanceToNow } from 'date-fns';
import MessageInput from '../../components/channel/MessageInput';
import MessageAttachments from '../../components/channel/MessageAttachments';
import MobileBackButton from '../../components/ui/MobileBackButton';
import { useAppStore } from '../../store/app';
import { DefaultEvent, MemberStrip, StatusPill } from '../RoomPanel';
import { useRoom, type RoomEvent, type RoomIdentity } from '../useRoom';
import { channelRoomSlug, useWizard } from './useWizard';
import { Lobby } from './Lobby';
import { GamePanel, SheetModal } from './GamePanel';
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
  const room = useRoom({ kind: 'wizard', slug, title: channelName ? `#${channelName}` : "The Wizard's Table", identity });
  const wiz = useWizard(room);
  const status = room.room?.status ?? 'lobby';
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const playing = wiz.phase !== 'lobby';

  /**
   * One send, two destinations. The channel message is the durable one; the DM
   * hears the same words. In the lobby there is no DM to hear, and the channel
   * message is enough for the table to see.
   */
  const handleSend = useCallback(
    async (content: string) => {
      if (!firebaseUser) return;
      setSendError(null);
      await sendMessage(guildId, channelId, firebaseUser.uid, content);
      if (playing && room.me) {
        try {
          await wiz.askDm(content);
        } catch (err) {
          setSendError(err instanceof Error ? err.message : 'The DM did not hear that');
        }
      }
    },
    [firebaseUser, guildId, channelId, playing, room.me, wiz],
  );

  return (
    <div className="kf flex-1 flex flex-col min-h-0 min-w-0 bg-[#0e0e16] text-[#e2e8f0]">
      {/* Channel header: the normal one, plus the table's state. */}
      <div className="h-12 flex items-center gap-2 px-4 border-b border-[#1e1e2e] flex-shrink-0">
        <MobileBackButton onClick={() => useAppStore.getState().setActiveChannel(null, 'text')} />
        <span className="text-[#6b7280] text-lg">🎲</span>
        <span className="font-semibold text-white text-sm">{channelName}</span>
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
          <Feed guildId={guildId} channelId={channelId} events={room.events} humanKeys={room.members.filter((m) => m.kind === 'human').map((m) => m.memberKey)} currentUserId={firebaseUser?.uid} />
          {sendError && <p className="px-4 pb-1 text-xs text-red-400">{sendError}</p>}
          {identity ? (
            <MessageInput
              placeholder={playing ? `Say it in character, or ask the DM — #${channelName}` : `Message #${channelName}`}
              onSend={handleSend}
            />
          ) : null}
        </div>

        {/* The table itself. */}
        {identity && (
          <aside className="kf-plate w-[480px] shrink-0 border-l border-[#1f1f2e] flex flex-col min-h-0 overflow-y-auto">
            {wiz.phase === 'lobby' ? (
              <Lobby room={room} wiz={{ ...wiz, start: () => wiz.start(guildId) }} uid={identity.key} />
            ) : (
              <GamePanel room={room} wiz={wiz} />
            )}
          </aside>
        )}
      </div>

      {sheetFor && <SheetModal wiz={wiz} memberKey={sheetFor} onClose={() => setSheetFor(null)} />}
    </div>
  );
}

// ─── The feed ─────────────────────────────────────────────────────────────────

type FeedItem = { at: number; key: string } & ({ kind: 'message'; message: Message } | { kind: 'event'; event: RoomEvent });

function Feed({
  guildId,
  channelId,
  events,
  humanKeys,
  currentUserId,
}: {
  guildId: string;
  channelId: string;
  events: RoomEvent[];
  humanKeys: string[];
  currentUserId?: string;
}) {
  const { messages, loading, hasMore, loadMore } = useMessages(guildId, channelId);
  const members = useGuildMembers(guildId);
  const authorIds = useMemo(() => [...new Set(messages.map((m) => m.authorId))], [messages]);
  const profiles = useUserProfiles(authorIds);
  const bottom = useRef<HTMLDivElement>(null);

  const items = useMemo<FeedItem[]>(() => {
    // A person's own words already arrive as a channel message; the `say`
    // event `askDm` records for the DM would show them twice. Masks and the
    // DM have no channel message, so their lines stay.
    const humans = new Set(humanKeys);
    const fromEvents: FeedItem[] = events
      .filter((e) => !(e.type === 'say' && e.actorKey && humans.has(e.actorKey)))
      .map((e) => ({ kind: 'event', at: e._creationTime, key: `e:${e._id}`, event: e }));
    const fromMessages: FeedItem[] = messages.map((m) => ({
      kind: 'message',
      at: m.createdAt ? m.createdAt.toMillis() : Date.now(),
      key: `m:${m.id}`,
      message: m,
    }));
    return [...fromMessages, ...fromEvents].sort((a, b) => a.at - b.at);
  }, [events, messages, humanKeys]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [items.length]);

  const nameFor = useCallback(
    (uid: string) => {
      const member = members.find((m) => m.userId === uid);
      const profile = profiles[uid];
      return {
        name: member?.nickname ?? profile?.displayName ?? uid.split(':').pop() ?? 'Unknown',
        avatarUrl: profile?.avatarUrl ?? '',
      };
    },
    [members, profiles],
  );

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-[#6b7280] text-sm">Loading messages...</div>;
  }

  return (
    <div className="rp-log flex-1 min-h-0 scrollable px-4 py-3 space-y-2 selectable">
      <div className="text-center py-4 text-[#6b7280] text-xs">
        {hasMore ? (
          <button className="underline hover:text-white" onClick={() => loadMore()}>
            Load older messages
          </button>
        ) : (
          'Beginning of channel'
        )}
      </div>
      {items.map((item) =>
        item.kind === 'event' ? (
          <div key={item.key}>
            <DefaultEvent e={item.event} />
          </div>
        ) : (
          <MessageLine key={item.key} message={item.message} own={item.message.authorId === currentUserId} author={nameFor(item.message.authorId)} />
        ),
      )}
      <div ref={bottom} />
    </div>
  );
}

function MessageLine({ message, own, author }: { message: Message; own: boolean; author: { name: string; avatarUrl: string } }) {
  const time = message.createdAt ? formatDistanceToNow(message.createdAt.toDate(), { addSuffix: true }) : '';
  if (message.type === 'system_join') {
    return (
      <div className="text-xs text-[#6b7280]">
        👋 <span className="text-violet-400 font-medium">{author.name}</span> joined the server.
      </div>
    );
  }
  return (
    <div className="flex gap-2 text-sm">
      {author.avatarUrl ? (
        <img src={author.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover mt-0.5 shrink-0" />
      ) : (
        <span className="w-5 h-5 rounded-full bg-violet-600/40 text-[10px] font-semibold text-violet-200 inline-flex items-center justify-center mt-0.5 shrink-0">
          {author.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <span className={`font-semibold ${own ? 'text-sky-300' : 'text-white'}`}>{author.name}</span>{' '}
        <span className="text-[10px] text-[#4b5563]">{time}</span>
        <p className="whitespace-pre-wrap break-words text-[#d4d8e0] leading-relaxed">{message.content}</p>
        <MessageAttachments attachments={message.attachments} />
      </div>
    </div>
  );
}
