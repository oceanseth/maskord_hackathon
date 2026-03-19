import { useState, useEffect, useRef } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import {
  useUserProfiles,
  useFriendships,
  useUserGuilds,
  getFirebaseDb,
} from '@maskord/shared';
import type { GuildMember, Guild } from '@maskord/shared';
import { useAppStore } from '../../store/app';

interface Props {
  /** The user whose profile is being shown */
  userId: string;
  /** The current viewer (logged-in user) */
  viewerUid: string;
  /** Guild context — used to show join date and mutual server detection */
  guildId: string;
  /** Position anchor — popover will appear near this rect */
  anchorRect: DOMRect;
  onClose: () => void;
}

export default function UserProfilePopover({ userId, viewerUid, guildId, anchorRect, onClose }: Props) {
  const { openDm } = useAppStore();

  const profiles = useUserProfiles([userId]);
  const { friends, pendingIncoming, pendingOutgoing, sendRequest, acceptRequest } =
    useFriendships(viewerUid);
  const { guilds: myGuilds } = useUserGuilds(viewerUid);

  const [memberInfo, setMemberInfo] = useState<GuildMember | null>(null);
  const [mutualGuilds, setMutualGuilds] = useState<Guild[]>([]);
  const [mutualLoading, setMutualLoading] = useState(true);
  const [friendBusy, setFriendBusy] = useState(false);

  const isSelf   = userId === viewerUid;
  const profile  = profiles[userId];
  const isFriend = friends.some((f) => f.uids.includes(userId));
  const outgoing = pendingOutgoing.find((f) => f.uids.includes(userId));
  const incoming = pendingIncoming.find((f) => f.uids.includes(userId));
  const name     = profile?.displayName ?? profile?.twitchUsername ?? 'Unknown';

  // Load member info for current guild (join date, nickname)
  useEffect(() => {
    if (!guildId || !userId) return;
    const db = getFirebaseDb();
    getDoc(doc(db, 'guilds', guildId, 'members', userId))
      .then((snap) => { if (snap.exists()) setMemberInfo(snap.data() as GuildMember); })
      .catch(() => {});
  }, [guildId, userId]);

  // Detect mutual guilds by checking if target user is a member of each guild the viewer is in
  useEffect(() => {
    if (!myGuilds.length || !userId) { setMutualLoading(false); return; }
    const db = getFirebaseDb();
    setMutualLoading(true);
    Promise.all(
      myGuilds.map(async (guild) => {
        try {
          const snap = await getDoc(doc(db, 'guilds', guild.id, 'members', userId));
          return snap.exists() ? guild : null;
        } catch { return null; }
      }),
    ).then((results) => {
      setMutualGuilds(results.filter(Boolean) as Guild[]);
      setMutualLoading(false);
    });
  }, [myGuilds, userId]);

  // Close on outside click
  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Popover positioning: try to the right of the element, clamp to viewport
  const POPOVER_W = 280;
  const POPOVER_MAX_H = 420;
  const margin = 8;

  let left = anchorRect.right + margin;
  if (left + POPOVER_W > window.innerWidth - margin) {
    left = anchorRect.left - POPOVER_W - margin;
  }
  left = Math.max(margin, left);

  let top = anchorRect.top;
  if (top + POPOVER_MAX_H > window.innerHeight - margin) {
    top = window.innerHeight - POPOVER_MAX_H - margin;
  }
  top = Math.max(margin, top);

  async function handleAddFriend() {
    setFriendBusy(true);
    try { await sendRequest(userId); } finally { setFriendBusy(false); }
  }

  async function handleAccept() {
    if (!incoming) return;
    setFriendBusy(true);
    try { await acceptRequest(incoming.id); } finally { setFriendBusy(false); }
  }

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl shadow-2xl overflow-hidden"
      style={{ left, top, width: POPOVER_W }}
    >
      {/* Colored banner */}
      <div className="h-14 bg-gradient-to-br from-violet-900/70 to-[#0a0a0f] relative flex-shrink-0">
        <div className="absolute -bottom-7 left-4">
          <div className="w-14 h-14 rounded-full bg-violet-600/30 overflow-hidden border-4 border-[#0a0a0f] flex items-center justify-center">
            {profile?.avatarUrl
              ? <img src={profile.avatarUrl} alt={name} className="w-full h-full object-cover" />
              : <span className="text-lg font-bold text-violet-300">{name.substring(0, 2).toUpperCase()}</span>
            }
          </div>
        </div>
      </div>

      <div className="px-4 pt-10 pb-4 space-y-3">
        {/* Name + handle */}
        <div>
          <h3 className="font-bold text-white text-sm leading-tight">{name}</h3>
          {profile?.twitchUsername && profile.displayName && (
            <p className="text-[11px] text-[#6b7280]">@{profile.twitchUsername}</p>
          )}
          {profile?.bio && (
            <p className="text-xs text-[#9ca3af] mt-1 line-clamp-2">{profile.bio}</p>
          )}
        </div>

        <div className="h-px bg-[#1e1e2e]" />

        {/* Info rows */}
        <div className="space-y-2.5">
          {/* Member since */}
          {memberInfo?.joinedAt && (
            <div>
              <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider mb-0.5">
                Member Since
              </p>
              <p className="text-xs text-[#c8d0e0]">
                {memberInfo.joinedAt.toDate().toLocaleDateString([], {
                  month: 'long', day: 'numeric', year: 'numeric',
                })}
              </p>
            </div>
          )}

          {/* Mutual servers */}
          <div>
            <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider mb-0.5">
              Mutual Servers
            </p>
            {mutualLoading ? (
              <p className="text-xs text-[#4b5563]">Loading…</p>
            ) : mutualGuilds.length === 0 ? (
              <p className="text-xs text-[#4b5563]">None</p>
            ) : (
              <p className="text-xs text-[#9ca3af] truncate">
                {mutualGuilds.map((g) => g.name).join(', ')}
              </p>
            )}
          </div>

          {/* Friendship */}
          <div>
            <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider mb-0.5">
              Friendship
            </p>
            {isSelf ? (
              <p className="text-xs text-[#6b7280]">This is you</p>
            ) : isFriend ? (
              <p className="text-xs text-green-400 font-medium">Friends</p>
            ) : outgoing ? (
              <p className="text-xs text-[#9ca3af]">Request Sent</p>
            ) : incoming ? (
              <p className="text-xs text-violet-400">Incoming Request</p>
            ) : (
              <p className="text-xs text-[#6b7280]">Not Friends</p>
            )}
          </div>
        </div>

        {/* Actions */}
        {!isSelf && (
          <>
            <div className="h-px bg-[#1e1e2e]" />
            <div className="flex gap-2">
              {/* Message button */}
              <button
                onClick={() => { openDm(userId); onClose(); }}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
                </svg>
                Message
              </button>

              {/* Friend action */}
              {incoming ? (
                <button
                  onClick={handleAccept}
                  disabled={friendBusy}
                  className="px-3 py-2 rounded-lg border border-violet-600/60 hover:border-violet-500 text-violet-400 hover:text-violet-300 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  Accept
                </button>
              ) : !isFriend && !outgoing ? (
                <button
                  onClick={handleAddFriend}
                  disabled={friendBusy}
                  className="px-3 py-2 rounded-lg border border-[#2a2a3e] hover:border-violet-500/60 text-[#9ca3af] hover:text-violet-300 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  Add Friend
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
