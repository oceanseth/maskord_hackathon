import { useAuth, useUserProfiles, useFriendships } from '@maskord/shared';
import { useAppStore } from '../../store/app';

export default function HomeDashboard() {
  const { firebaseUser } = useAuth();
  const { openDm } = useAppStore();

  const { pendingIncoming, pendingOutgoing, getFriendUid, acceptRequest, rejectRequest } =
    useFriendships(firebaseUser?.uid ?? null);

  // Both directions need names, and an outgoing request is addressed to the
  // *other* uid on the doc rather than to its requester — which is you.
  const requesterUids = pendingIncoming.map((f) => f.requesterId);
  const addresseeUids = pendingOutgoing.map((f) => getFriendUid(f));
  const profiles = useUserProfiles([...new Set([...requesterUids, ...addresseeUids])]);

  function displayName(uid: string) {
    const p = profiles[uid];
    return p?.displayName ?? p?.twitchUsername ?? 'Unknown';
  }

  return (
    <div className="flex-1 flex flex-col bg-[#0e0e16] min-w-0 overflow-hidden">
      {/* Header */}
      <div className="h-12 flex items-center gap-3 px-6 border-b border-[#1e1e2e] flex-shrink-0">
        <span className="font-semibold text-white text-sm">Friend Requests</span>
        {pendingIncoming.length > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
            {pendingIncoming.length}
          </span>
        )}
      </div>

      {/* Request list */}
      <div className="flex-1 overflow-y-auto scrollable px-4 py-4">
        {pendingIncoming.length === 0 && pendingOutgoing.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <span className="text-4xl">👋</span>
            <p className="text-[#9ca3af] text-sm font-medium">No pending friend requests</p>
            <p className="text-[#4b5563] text-xs">
              Requests you send and requests you receive both appear here until they are answered.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-w-lg">
            {pendingIncoming.length > 0 && (
              <p className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider mt-1">
                Incoming — {pendingIncoming.length}
              </p>
            )}
            {pendingIncoming.map((f) => {
              const uid  = f.requesterId;
              const p    = profiles[uid];
              const name = displayName(uid);

              return (
                <div
                  key={f.id}
                  className="flex items-center gap-4 p-4 rounded-xl bg-[#12121a] border border-[#1e1e2e]"
                >
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-violet-600/30 overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {p?.avatarUrl
                      ? <img src={p.avatarUrl} alt={name} className="w-full h-full object-cover" />
                      : <span className="text-sm font-bold text-violet-300">
                          {name.substring(0, 2).toUpperCase()}
                        </span>
                    }
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{name}</p>
                    <p className="text-xs text-[#6b7280]">Incoming Friend Request</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={async () => {
                        await acceptRequest(f.id);
                        openDm(getFriendUid(f));
                      }}
                      className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => rejectRequest(f.id)}
                      className="px-3 py-1.5 rounded-lg bg-[#1e1e2e] hover:bg-red-900/40 text-[#9ca3af] hover:text-red-400 text-xs font-semibold transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Requests you have sent. Nothing to accept here — the only action
                is taking it back, which is the same delete the recipient's
                "Reject" performs. */}
            {pendingOutgoing.length > 0 && (
              <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider mt-3">
                Sent — {pendingOutgoing.length}
              </p>
            )}
            {pendingOutgoing.map((f) => {
              const uid  = getFriendUid(f);
              const p    = profiles[uid];
              const name = displayName(uid);

              return (
                <div
                  key={f.id}
                  className="flex items-center gap-4 p-4 rounded-xl bg-[#12121a] border border-[#1e1e2e]"
                >
                  <div className="w-10 h-10 rounded-full bg-[#1e1e2e] overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {p?.avatarUrl
                      ? <img src={p.avatarUrl} alt={name} className="w-full h-full object-cover" />
                      : <span className="text-sm font-bold text-[#6b7280]">
                          {name.substring(0, 2).toUpperCase()}
                        </span>
                    }
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{name}</p>
                    <p className="text-xs text-[#6b7280]">Sent · waiting for them to accept</p>
                  </div>

                  <button
                    onClick={() => rejectRequest(f.id)}
                    className="px-3 py-1.5 rounded-lg bg-[#1e1e2e] hover:bg-red-900/40 text-[#9ca3af] hover:text-red-400 text-xs font-semibold transition-colors flex-shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
