import { useEffect, useRef, useState } from 'react';
import { useAuth, useUserProfiles, useDmMessages, sendDmMessage } from '@maskord/shared';
import { useAppStore } from '../../store/app';

interface Props {
  partnerUid: string;
}

export default function DmPanel({ partnerUid }: Props) {
  const { firebaseUser }  = useAuth();
  const { closeDm }       = useAppStore();
  const profiles          = useUserProfiles([partnerUid, firebaseUser?.uid ?? ''].filter(Boolean));
  const { messages, loading } = useDmMessages(firebaseUser?.uid ?? null, partnerUid);

  const [input,     setInput]     = useState('');
  const [sending,   setSending]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const partner = profiles[partnerUid];
  const self    = firebaseUser ? profiles[firebaseUser.uid] : null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function getDisplayName(uid: string) {
    const p = profiles[uid];
    return p?.displayName ?? p?.twitchUsername ?? 'Unknown';
  }

  function getAvatar(uid: string) {
    return profiles[uid]?.avatarUrl ?? '';
  }

  async function handleSend() {
    if (!input.trim() || !firebaseUser) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    try {
      await sendDmMessage(firebaseUser.uid, partnerUid, text);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-[#0e0e16] min-w-0">
      {/* Header */}
      <div className="h-12 flex items-center gap-3 px-4 border-b border-[#1e1e2e] flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-violet-600/30 overflow-hidden flex items-center justify-center flex-shrink-0">
          {partner?.avatarUrl
            ? <img src={partner.avatarUrl} alt="" className="w-full h-full object-cover" />
            : <span className="text-xs font-bold text-violet-300">
                {(partner?.displayName ?? partner?.twitchUsername ?? '?').substring(0, 2).toUpperCase()}
              </span>
          }
        </div>
        <span className="font-semibold text-white text-sm flex-1 truncate">
          {partner?.displayName ?? partner?.twitchUsername ?? 'Direct Message'}
        </span>
        <button
          onClick={closeDm}
          title="Close DM"
          className="text-[#6b7280] hover:text-white transition-colors"
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
          const isSelf   = msg.authorId === firebaseUser?.uid;
          const name     = getDisplayName(msg.authorId);
          const avatar   = getAvatar(msg.authorId);
          const initials = name.substring(0, 2).toUpperCase();

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
                    {msg.createdAt
                      ? new Date((msg.createdAt as { toDate?: () => Date }).toDate?.() ?? msg.createdAt as unknown as number).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : ''}
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
