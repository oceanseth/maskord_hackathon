import { useRef, useState } from 'react';
import { updateGuildSettings, setGuildAllowGuests, uploadGuildIcon, createInvite } from '@maskord/shared';
import Modal from '../ui/Modal';
import AIAssistanceTab from './AIAssistanceTab';
import { inviteUrl as buildInviteUrl } from '../../lib/appUrl';

interface Props {
  guildId: string;
  currentName: string;
  currentIconUrl: string;
  currentAllowGuests: boolean;
  inviterId: string;
  onClose: () => void;
}

type Tab = 'overview' | 'ai';

export default function ServerSettingsModal({ guildId, currentName, currentIconUrl, currentAllowGuests, inviterId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('overview');

  // ─── Name ────────────────────────────────────────────────────────────────────
  const [name, setName]     = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved]   = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim() === currentName) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateGuildSettings(guildId, { name: name.trim() });
      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 800);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  }

  // ─── Icon ─────────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [iconPreview, setIconPreview] = useState(currentIconUrl);
  const [iconUploading, setIconUploading] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);

  async function handleIconChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setIconError('Please select an image file.'); return; }
    if (file.size > 8 * 1024 * 1024) { setIconError('Image must be under 8 MB.'); return; }

    setIconUploading(true);
    setIconError(null);
    // Optimistic local preview
    const localUrl = URL.createObjectURL(file);
    setIconPreview(localUrl);

    try {
      const url = await uploadGuildIcon(guildId, file);
      setIconPreview(url);
    } catch (err) {
      setIconError(err instanceof Error ? err.message : 'Upload failed');
      setIconPreview(currentIconUrl); // revert preview
    } finally {
      setIconUploading(false);
      URL.revokeObjectURL(localUrl);
      // Reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // ─── Guests ───────────────────────────────────────────────────────────────
  // Guests are anonymous sign-ins with no way back into the account, so this is
  // off by default and the join Cloud Functions enforce it. Saves immediately —
  // a toggle that needs a separate Save button reads as already applied.
  const [allowGuests, setAllowGuests]       = useState(currentAllowGuests);
  const [guestsSaving, setGuestsSaving]     = useState(false);
  const [guestsError, setGuestsError]       = useState<string | null>(null);

  async function handleAllowGuestsChange(next: boolean) {
    const previous = allowGuests;
    setAllowGuests(next); // optimistic
    setGuestsSaving(true);
    setGuestsError(null);
    try {
      await setGuildAllowGuests(guildId, next);
    } catch (err) {
      setAllowGuests(previous);
      setGuestsError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setGuestsSaving(false);
    }
  }

  const initials = currentName.substring(0, 2).toUpperCase();

  // ─── Invite ──────────────────────────────────────────────────────────────
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteUrl, setInviteUrl]         = useState<string | null>(null);
  const [inviteError, setInviteError]     = useState<string | null>(null);
  const [copied, setCopied]               = useState(false);

  async function handleGenerateInvite() {
    if (inviteLoading) return;
    setInviteLoading(true);
    setInviteError(null);
    try {
      // channelId stored for record-keeping but navigation uses only guildId
      const code = await createInvite(guildId, '', inviterId, { expiresInHours: 24 });
      setInviteUrl(buildInviteUrl(code));
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to generate link');
    } finally {
      setInviteLoading(false);
    }
  }

  function handleCopyInvite() {
    if (!inviteUrl) return;
    copyToClipboard(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal title="Server Settings" onClose={onClose} width="max-w-2xl">
      <div className="flex border-b border-[#1e1e2e]">
        <TabBtn label="Overview"      active={tab === 'overview'} onClick={() => setTab('overview')} />
        <TabBtn label="AI Assistance" active={tab === 'ai'}       onClick={() => setTab('ai')} />
      </div>
      {tab === 'ai' && (
        <div className="px-6 py-6 max-h-[70vh] overflow-y-auto scrollable">
          <AIAssistanceTab guildId={guildId} />
        </div>
      )}
      {tab === 'overview' && (
      <div className="px-6 pb-6 pt-6 space-y-6">

        {/* ── Icon ── */}
        <div>
          <label className="block text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-3">
            Server Icon
          </label>
          <div className="flex items-center gap-4">
            {/* Clickable icon preview */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={iconUploading}
              className="relative w-16 h-16 rounded-full overflow-hidden flex-shrink-0
                bg-violet-600/30 border-2 border-violet-600/50 group hover:border-violet-400
                transition-colors disabled:opacity-70"
              title="Click to change icon"
            >
              {iconPreview
                ? <img src={iconPreview} alt="Server icon" className="w-full h-full object-cover" />
                : <span className="font-bold text-lg text-violet-300">{initials}</span>
              }
              {/* Hover/loading overlay */}
              <div className={`absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity ${
                iconUploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}>
                {iconUploading
                  ? <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  : <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                      <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.92c.04-.3.07-.62.07-.95s-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1s.03.65.07.96l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66z" />
                    </svg>
                }
              </div>
            </button>
            <div className="text-xs text-[#6b7280]">
              <p>Click to upload a new icon.</p>
              <p className="mt-1">JPG, PNG, GIF or WebP — max 8 MB.</p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleIconChange}
          />
          {iconError && (
            <p className="mt-2 text-xs text-red-400">{iconError}</p>
          )}
        </div>

        <div className="h-px bg-[#1e1e2e]" />

        {/* ── Name ── */}
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-1.5">
              Server Name
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="w-full px-3 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] focus:border-violet-600 text-white text-sm outline-none transition-colors"
            />
          </div>

          {saveError && (
            <p className="text-red-400 text-xs bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">{saveError}</p>
          )}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-[#94a3b8] hover:text-white hover:bg-[#1e1e2e] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim() || name.trim() === currentName}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                saved
                  ? 'bg-green-600 text-white'
                  : 'bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white'
              }`}
            >
              {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Name'}
            </button>
          </div>
        </form>

        <div className="h-px bg-[#1e1e2e]" />

        {/* ── Guests ── */}
        <div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={allowGuests}
              disabled={guestsSaving}
              onChange={(e) => handleAllowGuestsChange(e.target.checked)}
              className="mt-0.5 w-4 h-4 shrink-0 rounded accent-violet-600 disabled:opacity-50"
            />
            <span>
              <span className="block text-sm text-white">Allow guests</span>
              <span className="block mt-1 text-xs text-[#6b7280]">
                Lets people join this server with the guest button instead of an
                account. They can look around and take part, but they lose access
                for good once they close the browser — there are no credentials to
                sign back in with.
              </span>
            </span>
          </label>
          {guestsError && (
            <p className="mt-2 text-xs text-red-400">{guestsError}</p>
          )}
        </div>

        <div className="h-px bg-[#1e1e2e]" />

        {/* ── Invite Link ── */}
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-[#94a3b8] uppercase tracking-wide">
            Invite Link
          </label>
          <p className="text-xs text-[#6b7280]">
            Generate a link to invite people to this server.
          </p>

          {inviteUrl ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="flex-1 px-3 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-sm text-[#94a3b8] truncate select-all">
                  {inviteUrl}
                </div>
                <button
                  onClick={handleCopyInvite}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold flex-shrink-0 transition-colors ${
                    copied ? 'bg-green-600 text-white' : 'bg-violet-600 hover:bg-violet-500 text-white'
                  }`}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-[#6b7280]">
                Expires in 24 hours.{' '}
                <button
                  onClick={() => { setInviteUrl(null); setInviteError(null); }}
                  className="text-violet-400 hover:text-violet-300 underline"
                >
                  Generate new
                </button>
              </p>
            </div>
          ) : (
            <>
              {inviteError && (
                <p className="text-xs text-red-400">{inviteError}</p>
              )}
              <button
                onClick={handleGenerateInvite}
                disabled={inviteLoading}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#1e1e2e] hover:bg-[#2a2a3e] disabled:opacity-50 text-[#94a3b8] hover:text-white transition-colors"
              >
                {inviteLoading ? 'Generating…' : 'Generate Invite Link'}
              </button>
            </>
          )}
        </div>

      </div>
      )}
    </Modal>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px
        ${active
          ? 'text-white border-violet-500'
          : 'text-[#6b7280] border-transparent hover:text-[#c8d0e0]'
        }`}
    >
      {label}
    </button>
  );
}

// ─── Clipboard helper ─────────────────────────────────────────────────────────

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
