import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useGuildMembers, useMessages, useUserProfiles } from '@maskord/shared';
import type { Message } from '@maskord/shared';
import { formatDistanceToNow } from 'date-fns';
import MessageAttachments from '../components/channel/MessageAttachments';
import { DefaultEvent } from './RoomPanel';
import type { RoomEvent } from './useRoom';

/**
 * One conversation: the channel's messages and the room's transcript, in time
 * order.
 *
 * Shared by every game mode rather than copied into each, because the two
 * de-duplications below are subtle and both mirror server behaviour — a second
 * copy would drift from `MIRRORED` in `www/convex/rooms.ts` the first time
 * either changed, and the symptom would be every line on screen twice.
 *
 * Extracted from the D&D channel when the debate needed the same feed. The
 * behaviour is Claude-fable-r's, unchanged.
 */

/** Event types the bridge mirrors into the channel; keep in step with `MIRRORED` in `www/convex/rooms.ts`. */
const MIRRORED: ReadonlySet<RoomEvent['type']> = new Set(['say', 'action', 'host', 'research']);

type FeedItem = { at: number; key: string } & ({ kind: 'message'; message: Message } | { kind: 'event'; event: RoomEvent });

export function ChannelFeed({
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
    // event `askDm` records for the DM would show them twice.
    const humans = new Set(humanKeys);
    const fromEvents: FeedItem[] = events
      .filter((e) => !(e.type === 'say' && e.actorKey && humans.has(e.actorKey)))
      .map((e) => ({ kind: 'event', at: e._creationTime, key: `e:${e._id}`, event: e }));
    // Mask and DM lines are mirrored into the channel as messages by a bot
    // author (`bot:<guildId>:…`) so they reach history and notifications. Here
    // the event is already on screen in transcript form, so a mirror whose
    // text matches a loaded event is skipped. Lines older than the loaded
    // events have no event to clash with and show as ordinary messages.
    const mirrored = new Set(
      events.filter((e) => MIRRORED.has(e.type) && !(e.actorKey && humans.has(e.actorKey))).map((e) => e.body),
    );
    const botPrefix = `bot:${guildId}:`;
    const fromMessages: FeedItem[] = messages
      .filter((m) => !(m.authorId.startsWith(botPrefix) && mirrored.has(m.content)))
      .map((m) => ({
        kind: 'message',
        at: m.createdAt ? m.createdAt.toMillis() : Date.now(),
        key: `m:${m.id}`,
        message: m,
      }));
    return [...fromMessages, ...fromEvents].sort((a, b) => a.at - b.at);
  }, [events, messages, humanKeys, guildId]);

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
