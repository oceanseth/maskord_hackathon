import { useMemo } from 'react';
import {
  useAuth,
  useUserProfiles,
  useFriendships,
  useDmConversations,
  useBulkPresence,
  dmChannelId,
} from '@maskord/shared';
import type { UserStatus } from '@maskord/shared';
import { useAppStore } from '../../store/app';
import UserPanel from '../ui/UserPanel';
import { useDmUnread } from '../../hooks/useDmUnread';

function StatusDot({ status }: { status: UserStatus }) {
  const color =
    status === 'online'  ? 'bg-green-500' :
    status === 'idle'    ? 'bg-yellow-500' :
    status === 'dnd'     ? 'bg-red-500' :
    'bg-[#4b5563]';

  return (
    <span
      className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#0e0e16] ${color}`}
    />
  );
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="flex-shrink-0 text-[10px] font-bold text-white bg-green-600 rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 tabular-nums">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export default function HomePanel() {
  const { firebaseUser } = useAuth();
  const { activeDmPartnerId, openDm } = useAppStore();

  const myUid = firebaseUser?.uid ?? null;

  const { friends, getFriendUid } = useFriendships(myUid);
  const { conversations, getPartnerUid } = useDmConversations(myUid);
  const { counts: dmUnreadCounts } = useDmUnread(myUid, conversations);

  // Stable UID derivation — avoids getFriendUid function reference changing each render
  const friendUids = useMemo(
    () => friends.map((f) => f.uids.find((uid) => uid !== myUid) ?? '').filter(Boolean),
    [friends, myUid],
  );

  // DM conversations that are NOT with a friend (those already appear in Friends section)
  const nonFriendConversations = useMemo(
    () => conversations.filter((c) => {
      const partnerUid = c.participants.find((uid) => uid !== myUid) ?? '';
      return !friendUids.includes(partnerUid);
    }),
    [conversations, myUid, friendUids],
  );

  const convPartnerUids = useMemo(
    () => nonFriendConversations
      .map((c) => c.participants.find((uid) => uid !== myUid) ?? '')
      .filter(Boolean),
    [nonFriendConversations, myUid],
  );
  const allUids = useMemo(
    () => [...new Set([...friendUids, ...convPartnerUids])],
    [friendUids, convPartnerUids],
  );

  const presence = useBulkPresence(friendUids);
  const profiles = useUserProfiles(allUids);

  // Sort friends: online/idle first, then dnd, then offline
  const statusOrder: Record<string, number> = { online: 0, idle: 1, dnd: 2, offline: 3 };
  const sortedFriends = useMemo(
    () =>
      [...friends].sort((a, b) => {
        const ua = getFriendUid(a);
        const ub = getFriendUid(b);
        const sa = presence[ua] ?? 'offline';
        const sb = presence[ub] ?? 'offline';
        return (statusOrder[sa] ?? 3) - (statusOrder[sb] ?? 3);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [friends, presence],
  );

  function displayName(uid: string) {
    const p = profiles[uid];
    return p?.displayName ?? p?.twitchUsername ?? 'Unknown';
  }

  return (
    <div className="w-full md:w-60 md:flex-shrink-0 bg-[#0e0e16] md:border-r border-[#1e1e2e] flex flex-col min-w-0">
      {/* Header */}
      <div className="h-12 flex items-center px-4 border-b border-[#1e1e2e] drag-region flex-shrink-0">
        <span className="font-semibold text-white text-sm no-drag">Home</span>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto scrollable py-2">

        {/* Friends section */}
        {sortedFriends.length > 0 && (
          <>
            <div className="px-4 pt-2 pb-1">
              <span className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider">
                Friends — {sortedFriends.length}
              </span>
            </div>
            {sortedFriends.map((f) => {
              const uid    = getFriendUid(f);
              const p      = profiles[uid];
              const status = presence[uid] ?? 'offline';
              const name   = displayName(uid);
              const active = activeDmPartnerId === uid;
              const convId = myUid ? dmChannelId(myUid, uid) : null;
              const unread = convId ? (dmUnreadCounts[convId] ?? 0) : 0;

              return (
                <button
                  key={f.id}
                  onClick={() => openDm(uid)}
                  className={`
                    w-full flex items-center gap-2.5 px-2 py-1.5 mx-1 rounded-md text-sm transition-colors
                    ${active ? 'bg-[#1e1e2e] text-white' : 'text-[#9ca3af] hover:bg-[#1e1e2e]/60 hover:text-[#c8d0e0]'}
                  `}
                  style={{ width: 'calc(100% - 8px)' }}
                >
                  {/* Avatar with status dot */}
                  <div className="relative flex-shrink-0">
                    <div className="w-7 h-7 rounded-full bg-violet-600/30 overflow-hidden flex items-center justify-center">
                      {p?.avatarUrl
                        ? <img src={p.avatarUrl} alt={name} className="w-full h-full object-cover" />
                        : <span className="text-[10px] font-bold text-violet-300">
                            {name.substring(0, 2).toUpperCase()}
                          </span>
                      }
                    </div>
                    <StatusDot status={status} />
                  </div>
                  <span className="flex-1 truncate text-left">{name}</span>
                  <UnreadBadge count={unread} />
                </button>
              );
            })}
          </>
        )}

        {/* Direct Messages section — only shows non-friend conversations */}
        {nonFriendConversations.length > 0 && (
          <>
            <div className="px-4 pt-4 pb-1">
              <span className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider">
                Direct Messages
              </span>
            </div>
            {nonFriendConversations.map((conv) => {
              const uid    = getPartnerUid(conv);
              const p      = profiles[uid];
              const name   = displayName(uid);
              const active = activeDmPartnerId === uid;
              const unread = dmUnreadCounts[conv.id] ?? 0;

              return (
                <button
                  key={conv.id}
                  onClick={() => openDm(uid)}
                  className={`
                    w-full flex items-center gap-2.5 px-2 py-1.5 mx-1 rounded-md text-sm transition-colors
                    ${active ? 'bg-[#1e1e2e] text-white' : 'text-[#9ca3af] hover:bg-[#1e1e2e]/60 hover:text-[#c8d0e0]'}
                  `}
                  style={{ width: 'calc(100% - 8px)' }}
                >
                  <div className="w-7 h-7 rounded-full bg-violet-600/30 overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {p?.avatarUrl
                      ? <img src={p.avatarUrl} alt={name} className="w-full h-full object-cover" />
                      : <span className="text-[10px] font-bold text-violet-300">
                          {name.substring(0, 2).toUpperCase()}
                        </span>
                    }
                  </div>
                  <span className="flex-1 truncate text-left">{name}</span>
                  <UnreadBadge count={unread} />
                </button>
              );
            })}
          </>
        )}

        {/* Empty state */}
        {sortedFriends.length === 0 && nonFriendConversations.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-[#4b5563]">No friends or DMs yet.</p>
            <p className="text-xs text-[#374151] mt-1">Open a DM from a voice channel to get started.</p>
          </div>
        )}
      </div>

      {/* User panel */}
      {firebaseUser && <UserPanel userId={firebaseUser.uid} />}
    </div>
  );
}
