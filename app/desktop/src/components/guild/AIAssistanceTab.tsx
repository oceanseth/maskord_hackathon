import { useMemo, useState, useEffect, useRef } from 'react';
import type { Guild } from '@maskord/shared';
import {
  useAuth,
  useGuild,
  updateGuildSettings,
  DEFAULT_CLAUDE_AVATAR,
} from '@maskord/shared';
import { useMaskyAvatars, type MaskyAvatarGroup } from '../../hooks/useMaskyAvatars';

type GuildPatch = Partial<Pick<Guild,
  'claudeEnabled' | 'claudeApiKey' | 'maskyApiKey' | 'claudeAvatarOwnerUid' | 'claudeAvatarId'
>>;
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  guildId: string;
}

/**
 * Server Settings → AI Assistance.
 *
 * Server owner toggles AI on, pastes an Anthropic API key, and picks the masky
 * avatar that will appear as a bot member of this guild. The avatar's display
 * name becomes the bot's name in chat (e.g. `@Masky`), and its `humeVoiceId` /
 * `personalityPrompt` drive voice + tone in voice channels.
 */
export default function AIAssistanceTab({ guildId }: Props) {
  const { firebaseUser } = useAuth();
  const { guild } = useGuild(guildId);

  // Local form state — seeded from the live guild doc.
  const [enabled,    setEnabled]    = useState(false);
  const [apiKey,     setApiKey]     = useState('');
  const [keyDirty,   setKeyDirty]   = useState(false);
  const [maskyKey,      setMaskyKey]      = useState('');
  const [maskyKeyDirty, setMaskyKeyDirty] = useState(false);
  const [selectedOwnerUid, setSelectedOwnerUid] = useState<string>(DEFAULT_CLAUDE_AVATAR.ownerUid);
  const [selectedAvatarId, setSelectedAvatarId] = useState<string>(DEFAULT_CLAUDE_AVATAR.avatarId);

  useEffect(() => {
    if (!guild) return;
    setEnabled(!!guild.claudeEnabled);
    setApiKey(guild.claudeApiKey ?? '');
    setKeyDirty(false);
    setMaskyKey(guild.maskyApiKey ?? '');
    setMaskyKeyDirty(false);
    setSelectedOwnerUid(guild.claudeAvatarOwnerUid ?? DEFAULT_CLAUDE_AVATAR.ownerUid);
    setSelectedAvatarId(guild.claudeAvatarId ?? DEFAULT_CLAUDE_AVATAR.avatarId);
  }, [guild]);

  // Available avatars to choose from = the owner's own masky avatarGroups +
  // the shared Masky default (read from twitch:simplystrong/avatarGroups).
  // avatarGroups are public-read in masky_auth firestore rules, so this works
  // for any UID without special perms.
  const myAvatars      = useMaskyAvatars(firebaseUser?.uid ?? null);
  const defaultAvatars = useMaskyAvatars(DEFAULT_CLAUDE_AVATAR.ownerUid);

  type Choice = MaskyAvatarGroup & { ownerUid: string; isDefault?: boolean };
  const choices: Choice[] = useMemo(() => {
    const ownerUid = firebaseUser?.uid ?? '';
    const own  = myAvatars.avatarGroups.map((g): Choice => ({ ...g, ownerUid }));
    const def  = defaultAvatars.avatarGroups
      .filter((g) => g.id === DEFAULT_CLAUDE_AVATAR.avatarId
                  || own.every((o) => o.id !== g.id))
      .map((g): Choice => ({ ...g, ownerUid: DEFAULT_CLAUDE_AVATAR.ownerUid, isDefault: true }));
    return [...def, ...own];
  }, [myAvatars.avatarGroups, defaultAvatars.avatarGroups, firebaseUser?.uid]);

  const selectedChoice = choices.find(
    (c) => c.id === selectedAvatarId && c.ownerUid === selectedOwnerUid,
  );

  // Auto-save: every field change pushes its own patch to Firestore. The API
  // key field is debounced (500ms after last keystroke); the toggle and avatar
  // picker save immediately.
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error,  setError]  = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function save(patch: GuildPatch) {
    if (!guild) return;
    setStatus('saving');
    setError(null);
    try {
      await updateGuildSettings(guildId, patch);
      setStatus('saved');
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setStatus('idle'), 1500);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Failed to save');
    }
  }

  function toggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    save({ claudeEnabled: next });
  }

  function pickAvatar(c: Choice) {
    setSelectedOwnerUid(c.ownerUid);
    setSelectedAvatarId(c.id);
    save({ claudeAvatarOwnerUid: c.ownerUid, claudeAvatarId: c.id });
  }

  // Debounced API key save — only fires when the field has actually been edited.
  useEffect(() => {
    if (!keyDirty) return;
    const handle = setTimeout(() => {
      save({ claudeApiKey: apiKey.trim() });
      setKeyDirty(false);
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, keyDirty]);

  // Debounced masky.ai key save.
  useEffect(() => {
    if (!maskyKeyDirty) return;
    const handle = setTimeout(() => {
      save({ maskyApiKey: maskyKey.trim() });
      setMaskyKeyDirty(false);
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskyKey, maskyKeyDirty]);

  const mentionName = selectedChoice?.displayName ?? DEFAULT_CLAUDE_AVATAR.fallbackDisplayName;

  return (
    <div className="space-y-6">
      {/* Save status indicator — appears top-right of the panel */}
      <div className="flex items-center justify-end h-4 -mb-2">
        <StatusPill status={status} />
      </div>

      {/* ── Enable toggle + summary ── */}
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white">Enable AI assistance</h3>
          <p className="text-xs text-[#6b7280] mt-1">
            When on, the selected avatar acts as a bot member of this server. Members reference it
            in chat as <span className="text-[#c8d0e0] font-mono">@{mentionName}</span>. In voice
            channels it speaks with the avatar's configured Hume voice.
          </p>
        </div>
        <Toggle checked={enabled} onChange={toggleEnabled} />
      </div>

      <div className="h-px bg-[#1e1e2e]" />

      {/* ── Anthropic API key ── */}
      <Section label="Anthropic API key" hint="Used to invoke Claude via the Agent SDK. Stored encrypted server-side — not exposed to members.">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => { setApiKey(e.target.value); setKeyDirty(true); }}
          placeholder="sk-ant-api03-…"
          autoComplete="off"
          className="w-full px-3 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] focus:border-violet-600 text-white text-sm outline-none font-mono"
        />
      </Section>

      {/* ── masky.ai API key ── */}
      <Section label="masky.ai API key" hint="An mky_… developer key from masky.ai/developer. Drives the avatar's voice in voice channels (each channel gets its own masky conversation). The avatar owner is billed for rendering.">
        <input
          type="password"
          value={maskyKey}
          onChange={(e) => { setMaskyKey(e.target.value); setMaskyKeyDirty(true); }}
          placeholder="mky_…"
          autoComplete="off"
          className="w-full px-3 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] focus:border-violet-600 text-white text-sm outline-none font-mono"
        />
      </Section>

      {/* ── Avatar picker ── */}
      <Section label="Avatar" hint="Drives the bot's name, voice, and visual identity. Members reference it by name in chat.">
        {choices.length === 0 ? (
          <p className="text-xs text-[#6b7280] italic px-2 py-4">
            Loading avatars…
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {choices.map((c) => (
              <AvatarChoice
                key={`${c.ownerUid}:${c.id}`}
                choice={c}
                selected={c.id === selectedAvatarId && c.ownerUid === selectedOwnerUid}
                onClick={() => pickAvatar(c)}
              />
            ))}
          </div>
        )}
        <p className="text-[10px] text-[#4b5563] mt-2">
          Create more avatars at <span className="text-violet-400">masky.ai</span>. The wake word
          for voice channels is configured on the avatar itself in masky.
        </p>
      </Section>

      {error && (
        <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">{error}</p>
      )}
    </div>
  );
}

// ─── Bits ─────────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null;
  const label =
    status === 'saving' ? 'Saving…' :
    status === 'saved'  ? 'Saved'   :
    'Save failed';
  const color =
    status === 'saving' ? 'text-[#94a3b8]' :
    status === 'saved'  ? 'text-green-400' :
    'text-red-400';
  return (
    <span className={`text-[10px] font-medium uppercase tracking-wider ${color} transition-opacity`}>
      {label}
    </span>
  );
}

function Section({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {hint && <p className="text-xs text-[#6b7280] mb-2">{hint}</p>}
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0
        ${checked ? 'bg-violet-600' : 'bg-[#1e1e2e]'}`}
      aria-pressed={checked}
    >
      <span
        className={`absolute top-0.5 left-0 w-5 h-5 rounded-full bg-white transition-transform
          ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

function AvatarChoice({ choice, selected, onClick }: {
  choice: { id: string; displayName: string; thumbnailUrl?: string; isDefault?: boolean };
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors text-left
        ${selected
          ? 'bg-violet-600/15 border-violet-500'
          : 'bg-[#0a0a0f] border-[#1e1e2e] hover:border-[#3a3a5e]'}`}
    >
      <div className="w-9 h-9 rounded-full bg-violet-600/30 overflow-hidden flex-shrink-0 flex items-center justify-center">
        {choice.thumbnailUrl
          ? <img src={choice.thumbnailUrl} alt={choice.displayName} className="w-full h-full object-cover" />
          : <span className="text-xs font-bold text-violet-300">{choice.displayName.slice(0, 2).toUpperCase()}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{choice.displayName}</p>
        {choice.isDefault && (
          <p className="text-[10px] text-violet-300/80">Default</p>
        )}
      </div>
      {selected && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#a78bfa" className="flex-shrink-0">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
        </svg>
      )}
    </button>
  );
}
