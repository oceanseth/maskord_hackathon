import { useState, useEffect } from 'react';
import { createInvite, useGuildChannels } from '@maskord/shared';
import Modal from '../ui/Modal';
import { inviteUrl as buildInviteUrl } from '../../lib/appUrl';

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
