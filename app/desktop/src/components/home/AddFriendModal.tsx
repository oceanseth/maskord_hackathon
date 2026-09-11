import { useEffect, useRef, useState } from 'react';
import { findUsersByHandle, useFriendships } from '@maskord/shared';
import type { User } from '@maskord/shared';
import Modal from '../ui/Modal';

/**
 * Add someone by their Masky username, display name or email.
 *
 * Sending is the existing `sendRequest`, so the other side gets a pending
 * friendship they can approve or decline — nobody is added to anyone's friend
 * list without agreeing to it. If they have already asked you, `sendRequest`
 * accepts theirs instead of opening a second one.
 */
interface Props {
  myUid: string;
  onClose: () => void;
}

type SendState = 'idle' | 'sending' | 'sent' | 'failed';

export default function AddFriendModal({ myUid, onClose }: Props) {
  const { friends, pendingOutgoing, pendingIncoming, sendRequest } = useFriendships(myUid);

  const [handle, setHandle]   = useState('');
  const [results, setResults] = useState<User[] | null>(null);
  const [busy, setBusy]       = useState(false);
  const [sendState, setSendState] = useState<Record<string, SendState>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Search as they type, but only once they have stopped: every keystroke is
  // three Firestore queries.
  useEffect(() => {
    const term = handle.trim();
    if (term.length < 2) { setResults(null); return; }
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      findUsersByHandle(term)
        .then((users) => { if (alive) setResults(users.filter((u) => u.id !== myUid)); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setBusy(false); });
    }, 300);
    return () => { alive = false; clearTimeout(t); setBusy(false); };
  }, [handle, myUid]);

  async function handleSend(user: User) {
    setSendState((s) => ({ ...s, [user.id]: 'sending' }));
    try {
      await sendRequest(user.id);
      setSendState((s) => ({ ...s, [user.id]: 'sent' }));
    } catch {
      setSendState((s) => ({ ...s, [user.id]: 'failed' }));
    }
  }

  /** What the button should say for this person right now. */
  function relationship(user: User): { label: string; disabled: boolean } {
    const state = sendState[user.id];
    if (state === 'sending') return { label: 'Sending…', disabled: true };
    if (state === 'failed')  return { label: 'Failed — retry', disabled: false };
    if (friends.some((f) => f.uids.includes(user.id)))         return { label: 'Friends', disabled: true };
    if (pendingOutgoing.some((f) => f.uids.includes(user.id))) return { label: 'Requested', disabled: true };
    if (pendingIncoming.some((f) => f.uids.includes(user.id))) return { label: 'Accept', disabled: false };
    return { label: 'Add Friend', disabled: false };
  }

  return (
    <Modal title="Add Friend" onClose={onClose}>
      <div className="px-6 pb-6 space-y-4">
        <div>
          <label className="block text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1.5">
            Masky username, display name or email
          </label>
          <input
            ref={inputRef}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="e.g. cyberseth"
            className="w-full px-3 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] focus:border-violet-600 text-white text-sm outline-none transition-colors placeholder:text-[#4b5563]"
          />
          <p className="text-[11px] text-[#4b5563] mt-1.5">
            They'll get a request to approve or decline.
          </p>
        </div>

        <div className="min-h-[120px]">
          {busy && <p className="text-xs text-[#6b7280] py-2">Searching…</p>}

          {!busy && results?.length === 0 && (
            <p className="text-xs text-[#6b7280] py-2">
              Nobody found. Display names are case-sensitive — try their exact capitalisation,
              or their Masky username.
            </p>
          )}

          {!busy && results && results.length > 0 && (
            <div className="space-y-1">
              {results.map((user) => {
                const name = user.displayName || user.twitchUsername || 'Unknown';
                const { label, disabled } = relationship(user);
                return (
                  <div key={user.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[#1a1a28]/60">
                    <div className="w-9 h-9 rounded-full bg-violet-600/30 overflow-hidden flex items-center justify-center flex-shrink-0">
                      {user.avatarUrl
                        ? <img src={user.avatarUrl} alt={name} className="w-full h-full object-cover" />
                        : <span className="text-[11px] font-bold text-violet-300">{name.substring(0, 2).toUpperCase()}</span>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{name}</p>
                      {user.twitchUsername && (
                        <p className="text-[11px] text-[#6b7280] truncate">@{user.twitchUsername}</p>
                      )}
                    </div>
                    <button
                      onClick={() => void handleSend(user)}
                      disabled={disabled}
                      className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-[#1e1e2e] disabled:text-[#6b7280] text-white text-xs font-medium transition-colors flex-shrink-0"
                    >
                      {label}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
