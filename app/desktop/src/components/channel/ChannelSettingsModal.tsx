import { useEffect, useState } from 'react';
import {
  useGuild,
  updateChannel,
  DEFAULT_CLAUDE_AVATAR,
} from '@maskord/shared';
import type { Channel, ChannelMode } from '@maskord/shared';
import Modal from '../ui/Modal';
import { useMaskyAvatars } from '../../hooks/useMaskyAvatars';

interface Props {
  guildId: string;
  channel: Channel;
  onClose: () => void;
}

type Tab = 'overview' | 'ai';

export default function ChannelSettingsModal({ guildId, channel, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('ai');

  return (
    <Modal title={`# ${channel.name}`} onClose={onClose} width="max-w-2xl">
      <div className="flex border-b border-[#1e1e2e]">
        <TabBtn label="Overview"      active={tab === 'overview'} onClick={() => setTab('overview')} />
        <TabBtn label="AI Assistance" active={tab === 'ai'}       onClick={() => setTab('ai')} />
      </div>
      <div className="px-6 py-6 max-h-[70vh] overflow-y-auto scrollable">
        {tab === 'overview' && <OverviewTab guildId={guildId} channel={channel} />}
        {tab === 'ai'       && <AITab guildId={guildId} channel={channel} />}
      </div>
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

// ─── Overview tab — placeholder for now ───────────────────────────────────────

function OverviewTab({ guildId, channel }: { guildId: string; channel: Channel }) {
  const [saving, setSaving] = useState(false);
  const mode: ChannelMode = channel.mode ?? 'default';

  async function setMode(next: ChannelMode) {
    if (next === mode) return;
    setSaving(true);
    try {
      await updateChannel(guildId, channel.id, { mode: next });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="text-sm text-[#6b7280] space-y-4">
      <p>Channel topic, slowmode, and permission overwrites will live here.</p>
      <p>Type: <span className="text-[#c8d0e0]">{channel.type}</span></p>

      {/* Switching an existing channel is the useful half: a server already has
          its channels, and nobody wants to remake one to play. */}
      {channel.type !== 'category' && (
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-[#94a3b8] uppercase tracking-wide">
            Mode
          </label>
          <select
            value={mode}
            disabled={saving}
            onChange={(e) => void setMode(e.target.value as ChannelMode)}
            className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] focus:border-violet-600 text-white text-sm outline-none disabled:opacity-50"
          >
            <option value="default">Default</option>
            <option value="debate">Debate floor</option>
            <option value="dnd">D&amp;D table</option>
          </select>
          <p className="text-xs text-[#6b7280]">
            The messages stay exactly where they are — only the view over them changes, so
            switching back leaves the channel as it was.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── AI Assistance tab — per-channel toggle + mode + voice media mode ─────────

function AITab({ guildId, channel }: { guildId: string; channel: Channel }) {
  const { guild } = useGuild(guildId);

  // Read the configured guild-level avatar so we can show its display name
  // in this UI ("@Masky responds when mentioned…").
  const ownerUid     = guild?.claudeAvatarOwnerUid ?? DEFAULT_CLAUDE_AVATAR.ownerUid;
  const guildAvatars = useMaskyAvatars(ownerUid);
  const avatarId     = guild?.claudeAvatarId ?? DEFAULT_CLAUDE_AVATAR.avatarId;
  const avatar       = guildAvatars.avatarGroups.find((a) => a.id === avatarId);
  const avatarName   = avatar?.displayName ?? DEFAULT_CLAUDE_AVATAR.fallbackDisplayName;

  const [mode,      setMode]      = useState<'off' | 'mention' | 'all'>(channel.claudeMode ?? 'off');
  const [mediaMode, setMediaMode] = useState<'audio' | 'video'>(channel.claudeMediaMode ?? 'audio');
  const [status,    setStatus]    = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error,     setError]     = useState<string | null>(null);

  useEffect(() => {
    setMode(channel.claudeMode ?? 'off');
    setMediaMode(channel.claudeMediaMode ?? 'audio');
  }, [channel.id, channel.claudeMode, channel.claudeMediaMode]);

  // Auto-save: any change is persisted immediately (no Save button).
  async function save(patch: Partial<Pick<Channel, 'claudeMode' | 'claudeMediaMode'>>) {
    setStatus('saving');
    setError(null);
    try {
      await updateChannel(guildId, channel.id, patch);
      setStatus('saved');
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1500);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Failed to save');
    }
  }

  function pickMode(next: 'off' | 'mention' | 'all') {
    setMode(next);
    save({ claudeMode: next });
  }
  function pickMedia(next: 'audio' | 'video') {
    setMediaMode(next);
    save({ claudeMediaMode: next });
  }

  const guildEnabled = !!guild?.claudeEnabled;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end h-4 -mb-2">
        <SaveStatus status={status} />
      </div>

      {!guildEnabled && (
        <div className="px-4 py-3 rounded-lg bg-amber-900/15 border border-amber-700/30 text-xs text-amber-200">
          AI assistance is disabled for this server. Enable it in <span className="font-semibold">Server Settings → AI Assistance</span> first.
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-white">
          {avatarName} in this channel
        </h3>
        <p className="text-xs text-[#6b7280] mt-1">
          Decide when <span className="text-[#c8d0e0] font-mono">@{avatarName}</span> responds to
          messages here. Everyone in the channel sees the responses.
        </p>
      </div>

      <ModeRow
        label="Off"
        desc="Members can chat freely; the avatar ignores everything in this channel."
        active={mode === 'off'}
        onClick={() => pickMode('off')}
      />
      <ModeRow
        label="Mention only"
        desc={`Replies only when a message contains @${avatarName} or, in voice channels, when someone says the avatar's wake word.`}
        active={mode === 'mention'}
        onClick={() => pickMode('mention')}
      />
      <ModeRow
        label="Listen to everything"
        desc="Replies to every message in this channel. Burns the most tokens — leave off unless this is a chat-with-AI room."
        active={mode === 'all'}
        onClick={() => pickMode('all')}
      />

      {/* Voice-only: media mode */}
      {channel.type === 'voice' && mode !== 'off' && (
        <>
          <div className="h-px bg-[#1e1e2e]" />
          <div>
            <h3 className="text-sm font-semibold text-white">Voice presence</h3>
            <p className="text-xs text-[#6b7280] mt-1">
              How the avatar appears in this voice channel when it speaks.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MediaChoice
              label="Audio only"
              desc="Spoken response only — fast and cheap."
              active={mediaMode === 'audio'}
              onClick={() => pickMedia('audio')}
            />
            <MediaChoice
              label="Talking head"
              desc="Audio + an animated avatar video. Higher latency, higher cost."
              active={mediaMode === 'video'}
              onClick={() => pickMedia('video')}
            />
          </div>
        </>
      )}

      {error && (
        <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">{error}</p>
      )}
    </div>
  );
}

function SaveStatus({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (status === 'idle') return null;
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  const color = status === 'saving' ? 'text-[#94a3b8]' : status === 'saved' ? 'text-green-400' : 'text-red-400';
  return <span className={`text-[10px] font-medium uppercase tracking-wider ${color}`}>{label}</span>;
}

function ModeRow({ label, desc, active, onClick }: {
  label: string; desc: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-3 rounded-lg border text-left transition-colors
        ${active
          ? 'bg-violet-600/15 border-violet-500'
          : 'bg-[#0a0a0f] border-[#1e1e2e] hover:border-[#3a3a5e]'}`}
    >
      <span className={`mt-1 w-3.5 h-3.5 rounded-full border-2 flex-shrink-0
        ${active ? 'bg-violet-500 border-violet-400' : 'border-[#3a3a5e]'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs text-[#6b7280] mt-0.5">{desc}</p>
      </div>
    </button>
  );
}

function MediaChoice({ label, desc, active, onClick }: {
  label: string; desc: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-start px-4 py-3 rounded-lg border text-left transition-colors
        ${active
          ? 'bg-violet-600/15 border-violet-500'
          : 'bg-[#0a0a0f] border-[#1e1e2e] hover:border-[#3a3a5e]'}`}
    >
      <p className="text-sm font-medium text-white">{label}</p>
      <p className="text-xs text-[#6b7280] mt-0.5">{desc}</p>
    </button>
  );
}
