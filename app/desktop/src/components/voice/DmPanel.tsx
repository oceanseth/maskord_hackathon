import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  useAuth,
  useUserProfiles,
  useDmMessages,
  sendDmMessage,
  useFriendships,
  useUserGuilds,
  dmChannelId,
  joinGuildAsMutualFriend,
} from '@maskord/shared';
import { useAppStore } from '../../store/app';
import { useVoiceCtx } from './VoiceProvider';
import { saveDmLastSeen } from '../../hooks/useDmUnread';
import MobileBackButton from '../ui/MobileBackButton';

interface Props {
  partnerUid: string;
}

function formatTs(ts: unknown): string {
  if (!ts) return '';
  const date = (ts as { toDate?: () => Date }).toDate?.() ?? new Date(ts as number);
  const now   = new Date();
  const today = date.toDateString() === now.toDateString();
  return today
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function DmPanel({ partnerUid }: Props) {
  const { firebaseUser, profile: myProfile } = useAuth();
  const { closeDm, setActiveGuild } = useAppStore();

  // Find the partner's server.
  // Primary: a mutual guild where they are the owner (we're already a member).
  // Fallback: their personalGuildId stored on their profile (for mutual friends not yet joined).
  const { guilds: myGuilds } = useUserGuilds(firebaseUser?.uid ?? null);
  const partnerGuild = useMemo(
    () => myGuilds.find((g) => g.ownerId === partnerUid) ?? null,
    [myGuilds, partnerUid],
  );
  const { startDmCall, isDmCall, dmCallPartnerId, dmCallStatus } = useVoiceCtx();

  const isCallWithPartner = isDmCall && dmCallPartnerId === partnerUid;
  const callLabel =
    isCallWithPartner && dmCallStatus === 'ringing'   ? 'Calling…' :
    isCallWithPartner && dmCallStatus === 'connected'  ? 'In call' : null;

  const profiles  = useUserProfiles([partnerUid, firebaseUser?.uid ?? ''].filter(Boolean));
  const { messages, loading } = useDmMessages(firebaseUser?.uid ?? null, partnerUid);

  const { friends, pendingIncoming, pendingOutgoing, sendRequest, acceptRequest } =
    useFriendships(firebaseUser?.uid ?? null);

  const isFriend = friends.some((f) => f.uids.includes(partnerUid));
  const outgoing = pendingOutgoing.find((f) => f.uids.includes(partnerUid));
  const incoming = pendingIncoming.find((f) => f.uids.includes(partnerUid));

  // Resolve the guild ID and label to use for the server button.
  // partnerGuild means we're already a member; personalGuildId is the fallback for mutual friends.
  const partnerPersonalGuildId = useMemo(
    () => profiles[partnerUid]?.personalGuildId ?? null,
    [profiles, partnerUid],
  );
  const serverGuildId   = partnerGuild?.id ?? (isFriend ? partnerPersonalGuildId : null);
  const serverGuildName = partnerGuild?.name
    ?? `${profiles[partnerUid]?.displayName ?? profiles[partnerUid]?.twitchUsername ?? 'their'}'s server`;

  const [input,       setInput]       = useState('');
  const [sending,     setSending]     = useState(false);
  const [friendBusy,  setFriendBusy]  = useState(false);
  const [joiningGuild, setJoiningGuild] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  const partner = profiles[partnerUid];
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;

  // Deterministic DM conversation ID — mark as read when panel opens
  const convId = useMemo(
    () => (firebaseUser ? dmChannelId(firebaseUser.uid, partnerUid) : null),
    [firebaseUser?.uid, partnerUid],
  );
  useEffect(() => {
    if (convId) saveDmLastSeen(convId);
  }, [convId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function getDisplayName(uid: string) {
    const p = profiles[uid] ?? (uid === firebaseUser?.uid ? myProfile : null);
    return p?.displayName ?? p?.twitchUsername ?? uid.slice(0, 6);
  }

  function getAvatar(uid: string) {
    const p = profiles[uid] ?? (uid === firebaseUser?.uid ? myProfile : null);
    return p?.avatarUrl ?? '';
  }

  const handleSend = useCallback(async () => {
    if (!input.trim() || !firebaseUser) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    try {
      await sendDmMessage(firebaseUser.uid, partnerUid, text);
    } catch {
      // Restore text so the user doesn't lose their message on a permission error
      setInput(text);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, firebaseUser, partnerUid]);

  async function handleAddFriend() {
    setFriendBusy(true);
    try { await sendRequest(partnerUid); } finally { setFriendBusy(false); }
  }

  async function handleAccept(id: string) {
    setFriendBusy(true);
    try { await acceptRequest(id); } finally { setFriendBusy(false); }
  }

  return (
    <div className="flex-1 flex flex-col bg-[#0e0e16] min-w-0">
      {/* Header */}
      <div className="h-12 flex items-center gap-3 px-4 border-b border-[#1e1e2e] flex-shrink-0">
        <MobileBackButton onClick={closeDm} />

        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-violet-600/30 overflow-hidden flex items-center justify-center flex-shrink-0">
          {partner?.avatarUrl
            ? <img src={partner.avatarUrl} alt="" className="w-full h-full object-cover" />
            : <span className="text-xs font-bold text-violet-300">
                {(partner?.displayName ?? partner?.twitchUsername ?? '?').substring(0, 2).toUpperCase()}
              </span>
          }
        </div>

        {/* Name + last message time */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-sm leading-tight truncate">
            {partner?.displayName ?? partner?.twitchUsername ?? 'Direct Message'}
          </p>
          {lastMsg && (
            <p className="text-[10px] text-[#4b5563] leading-tight">
              Last message {formatTs(lastMsg.createdAt)}
            </p>
          )}
        </div>

        {/* Partner's server button — shown if already a member, or mutual friends */}
        {serverGuildId && (
          <button
            disabled={joiningGuild}
            onClick={async () => {
              if (partnerGuild) {
                // Already a member — navigate directly
                setActiveGuild(serverGuildId);
                closeDm();
              } else {
                // Mutual friend, not yet a member — join first
                setJoiningGuild(true);
                try {
                  await joinGuildAsMutualFriend(serverGuildId);
                  setActiveGuild(serverGuildId);
                  closeDm();
                } catch {
                  // Permission error or network issue — navigate anyway (user will see preview)
                  setActiveGuild(serverGuildId);
                  closeDm();
                } finally {
                  setJoiningGuild(false);
                }
              }
            }}
            title={joiningGuild ? 'Joining…' : `Go to ${serverGuildName}`}
            className="flex-shrink-0 text-[#6b7280] hover:text-violet-300 disabled:opacity-50 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
            </svg>
          </button>
        )}

        {/* Call button / status */}
        {isCallWithPartner ? (
          <span className="text-xs font-medium text-green-400 flex-shrink-0 flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
            </svg>
            {callLabel}
          </span>
        ) : (
          <button
            onClick={() => startDmCall(partnerUid)}
            disabled={isDmCall}
            title="Start voice call"
            className="flex-shrink-0 text-[#6b7280] hover:text-violet-300 disabled:opacity-30 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
            </svg>
          </button>
        )}

        {/* Friendship status / action */}
        {isFriend ? (
          <span className="text-xs font-medium text-green-400 flex-shrink-0">Friends</span>
        ) : outgoing ? (
          <span className="text-xs text-[#6b7280] flex-shrink-0">Request Sent</span>
        ) : incoming ? (
          <button
            onClick={() => handleAccept(incoming.id)}
            disabled={friendBusy}
            className="flex-shrink-0 text-xs px-2.5 py-1 rounded-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium transition-colors"
          >
            Accept Request
          </button>
        ) : (
          <button
            onClick={handleAddFriend}
            disabled={friendBusy}
            className="flex-shrink-0 text-xs px-2.5 py-1 rounded-full border border-[#2a2a3e] hover:border-violet-500/60 text-[#9ca3af] hover:text-violet-300 disabled:opacity-50 font-medium transition-colors"
          >
            Add Friend
          </button>
        )}

        {/* Close */}
        <button
          onClick={closeDm}
          title="Close DM"
          className="flex-shrink-0 text-[#6b7280] hover:text-white transition-colors ml-1"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollable px-4 py-4 flex flex-col gap-1">
        {loading && (
          <div className="text-center text-[#6b7280] text-sm py-8">Loading messages…</div>
        )}
        {!loading && messages.length === 0 && (
          <div className="text-center text-[#6b7280] text-sm py-8">
            This is the beginning of your direct message history with{' '}
            <span className="text-white font-medium">
              {partner?.displayName ?? partner?.twitchUsername ?? 'this user'}
            </span>.
          </div>
        )}
        {messages.map((msg) => {
          // senderId is the current field; authorId is the legacy field pre-migration
          const senderUid = msg.senderId || msg.authorId || '';
          const isSelf    = senderUid === firebaseUser?.uid;
          const name      = getDisplayName(senderUid);
          const avatar    = getAvatar(senderUid);
          const initials  = name.substring(0, 2).toUpperCase();

          return (
            <div key={msg.id} className="flex items-start gap-3 py-1 group hover:bg-[#1a1a28]/40 rounded-lg px-2 -mx-2">
              <div className="w-8 h-8 rounded-full bg-violet-600/30 overflow-hidden flex-shrink-0 mt-0.5 flex items-center justify-center">
                {avatar
                  ? <img src={avatar} alt={name} className="w-full h-full object-cover" />
                  : <span className="text-xs font-bold text-violet-300">{initials}</span>
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className={`text-sm font-semibold ${isSelf ? 'text-violet-300' : 'text-white'}`}>
                    {name}
                  </span>
                  <span className="text-xs text-[#4b5563]">
                    {formatTs(msg.createdAt)}
                  </span>
                </div>
                <p className="text-sm text-[#c8d0e0] break-words">{msg.content}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-4 flex-shrink-0">
        <div className="flex items-center gap-2 bg-[#12121a] rounded-xl border border-[#1e1e2e] px-4 py-2.5">
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder-[#4b5563]"
            placeholder={`Message ${partner?.displayName ?? partner?.twitchUsername ?? 'user'}…`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            disabled={sending}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="text-violet-400 hover:text-violet-300 disabled:opacity-30 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
