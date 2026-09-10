import { useState, useEffect } from 'react';
import { createInvite, useGuildChannels } from '@maskord/shared';
import Modal from '../ui/Modal';
import { inviteUrl as buildInviteUrl } from '../../lib/appUrl';
import { useMaskyAvatars } from '../../hooks/useMaskyAvatars';
import { getFirebaseFunctions } from '@maskord/shared';
import { httpsCallable } from 'firebase/functions';

interface Props {
  guildId: string;
  inviterId: string;
  onClose: () => void;
}

function copyToClipboard(text: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => execCommandCopy(text));
  } else {
    execCommandCopy(text);
  }
}

function execCommandCopy(text: string) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(el);
  el.focus();
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

export default function InviteModal({ guildId, inviterId, onClose }: Props) {
  const channels = useGuildChannels(guildId);
  const firstTextChannel = channels.find((c) => c.type === 'text');

  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!firstTextChannel) return;
    setLoading(true);
    createInvite(guildId, firstTextChannel.id, inviterId, { expiresInHours: 24 })
      .then((c) => setCode(c))
      .finally(() => setLoading(false));
  }, [guildId, firstTextChannel?.id, inviterId]);

  const inviteUrl = code ? buildInviteUrl(code) : '';

  function handleCopy() {
    if (!inviteUrl) return;
    copyToClipboard(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleNewLink() {
    if (!firstTextChannel) return;
    setLoading(true);
    setCopied(false);
    const newCode = await createInvite(guildId, firstTextChannel.id, inviterId, { expiresInHours: 24 });
    setCode(newCode);
    setLoading(false);
  }

  return (
    <Modal title="Invite People" onClose={onClose}>
      <div className="px-6 pb-6 space-y-4">
        <p className="text-sm text-[#6b7280]">
          Share this link with others to invite them to your server.
        </p>

        <div className="flex gap-2">
          <div className="flex-1 px-3 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-sm text-[#94a3b8] truncate">
            {loading ? 'Generating link...' : (inviteUrl || '—')}
          </div>
          <button
            onClick={handleCopy}
            disabled={!inviteUrl || loading}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              copied
                ? 'bg-green-600 text-white'
                : 'bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white'
            }`}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <p className="text-xs text-[#6b7280]">
          This link expires in 24 hours.{' '}
          <button
            onClick={handleNewLink}
            disabled={loading}
            className="text-violet-400 hover:text-violet-300 underline"
          >
            Generate a new link
          </button>
        </p>

        <AvatarInviteSection inviterId={inviterId} guildId={guildId} />

        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-[#94a3b8] hover:text-white hover:bg-[#1e1e2e] transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Avatar invite ────────────────────────────────────────────────────────────

/**
 * Bring one of your own masky avatars into the voice channel you are sitting in.
 *
 * The invite itself is server-side — it needs the user's masky key to start the
 * avatar's conversation — so this calls the same function the avatar's
 * invite_avatar tool uses, rather than a parallel implementation.
 */
function AvatarInviteSection({ inviterId, guildId }: { inviterId: string; guildId: string }) {
  const { avatarGroups } = useMaskyAvatars(inviterId);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);

  const matches = avatarGroups.filter((a) =>
    a.displayName.toLowerCase().includes(query.trim().toLowerCase()),
  );

  async function invite(name: string) {
    setBusy(name);
    setStatus(null);
    try {
      const fn = httpsCallable<{ guildId: string; name: string }, { ok: boolean; message: string }>(
        getFirebaseFunctions(), 'inviteAvatarToVoice',
      );
      const res = await fn({ guildId, name });
      setStatus({ text: res.data.message || `${name} joined.`, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not invite that avatar';
      setStatus({ text: msg, ok: false });
    } finally {
      setBusy(null);
    }
  }

  if (avatarGroups.length === 0) return null;

  return (
    <div className="pt-4 border-t border-[#1e1e2e] space-y-3">
      <div>
        <p className="text-sm font-semibold text-white">Bring in an avatar</p>
        <p className="text-xs text-[#6b7280] mt-0.5">
          Joins the voice channel you are in, voiced on your own account.
        </p>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your avatars…"
        className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] focus:border-violet-700/60 focus:outline-none text-sm text-white placeholder:text-[#6b7280]"
      />

      <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
        {matches.length === 0 && (
          <p className="text-xs text-[#6b7280] px-1 py-2">No avatars match “{query}”.</p>
        )}
        {matches.map((a) => (
          <button
            key={a.id}
            onClick={() => invite(a.displayName)}
            disabled={busy !== null}
            className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[#1e1e2e] disabled:opacity-50 transition-colors text-left"
          >
            {a.thumbnailUrl ? (
              <img src={a.thumbnailUrl} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-violet-600/30 flex items-center justify-center flex-shrink-0 text-xs font-bold text-violet-200">
                {a.displayName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <span className="text-sm text-white truncate flex-1">{a.displayName}</span>
            <span className="text-xs text-violet-400 flex-shrink-0">
              {busy === a.displayName ? 'Inviting…' : 'Invite'}
            </span>
          </button>
        ))}
      </div>

      {status && (
        <p className={`text-xs ${status.ok ? 'text-green-400' : 'text-red-400'}`}>{status.text}</p>
      )}
    </div>
  );
}
