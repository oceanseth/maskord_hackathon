import { useEffect, useRef, useState, useMemo } from 'react';
import { useAuth, useUserProfiles, createInvite, useGuild, useGuildChannels, DEFAULT_CLAUDE_AVATAR } from '@maskord/shared';
import type { ShareKind } from '@maskord/shared';
import { useTalkingHead } from '../../hooks/useTalkingHead';
import { useVoiceCtx } from './VoiceProvider';
import type { VoiceSettings, AudioDevice } from '../../hooks/useVoiceSettings';
import Modal from '../ui/Modal';
import {
  useMaskyAvatars,
  loadUseAvatarVoice, saveUseAvatarVoice,
  loadUseAvatarPersonality, saveUseAvatarPersonality,
  type MaskyAvatarGroup,
} from '../../hooks/useMaskyAvatars';
import { useAppStore } from '../../store/app';
import MobileBackButton from '../ui/MobileBackButton';
import ChatPanel from './ChatPanel';
import { useBrowserSTT } from '../../hooks/useBrowserSTT';
import { inviteUrl as buildInviteUrl } from '../../lib/appUrl';

interface Props {
  guildId: string;
  channelId: string;
  /**
   * Render as a strip above something else — a game board — rather than as the
   * whole pane. Same tiles, same controls, same avatar switcher: a table you
   * talk at should not be a second, poorer voice UI.
   */
  compact?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VoiceChannel({ guildId, channelId, compact = false }: Props) {
  const { firebaseUser } = useAuth();
  const {
    participants, localStream, isMuted, isDeafened, isConnected, localSpeaking,
    micError, voiceSettings, updateVoiceSettings, audioInputs, audioOutputs,
    refreshDevices, toggleMute, toggleDeafen, hangUp, updateInputDevice, updateMaskIdentity,
    sharing, startSharing, stopSharing,
  } = useVoiceCtx();

  /** Whose shared video is expanded, if any. */
  const [maximizedId, setMaximizedId] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen]           = useState(false);
  const [avatarSettingsOpen, setAvatarSettingsOpen] = useState(false);
  const { needsInteraction, clearNeedsInteraction } = useVoiceCtx();

  const { avatarGroups, selectedId, setSelected } =
    useMaskyAvatars(firebaseUser?.uid ?? null);

  // The user's chosen mask (if any) — drives their displayed identity in the
  // transcript, their own presence tile, AND (shared via voiceState) the left
  // channel list + everyone else's view of them.
  const selectedMask = avatarGroups.find((g) => g.id === selectedId);

  useEffect(() => {
    if (!isConnected) return;
    updateMaskIdentity(selectedMask ? { name: selectedMask.displayName, avatarUrl: selectedMask.thumbnailUrl } : null);
  }, [isConnected, selectedMask?.id, selectedMask?.displayName, selectedMask?.thumbnailUrl, updateMaskIdentity]);

  const participantIds = participants.map((p) => p.userId);
  const allIds = useMemo(() => {
    const ids = [...participantIds];
    if (firebaseUser?.uid && !ids.includes(firebaseUser.uid)) ids.push(firebaseUser.uid);
    return ids;
  }, [participantIds, firebaseUser?.uid]);

  const profiles = useUserProfiles(allIds);

  function getMemberInfo(userId: string) {
    const p = profiles[userId];
    return {
      name:      p?.displayName ?? p?.twitchUsername ?? 'Unknown',
      avatarUrl: p?.avatarUrl ?? '',
    };
  }

  const selfInfo = firebaseUser ? getMemberInfo(firebaseUser.uid) : null;

  // ─── Voice channel transcript + Claude integration ──────────────────────────
  // Active when the channel has AI assistance enabled and the guild has it on.
  const { guild } = useGuild(guildId);
  const channels  = useGuildChannels(guildId);
  const channel   = channels.find((c) => c.id === channelId);
  const transcriptOn =
    !!guild?.claudeEnabled &&
    !!channel &&
    (channel.claudeMode === 'mention' || channel.claudeMode === 'all');

  const aiAvatarOwnerUid = guild?.claudeAvatarOwnerUid ?? DEFAULT_CLAUDE_AVATAR.ownerUid;
  const aiAvatarId       = guild?.claudeAvatarId       ?? DEFAULT_CLAUDE_AVATAR.avatarId;
  const aiAvatars        = useMaskyAvatars(transcriptOn ? aiAvatarOwnerUid : null);
  const configuredPrimary = aiAvatars.avatarGroups.find((a) => a.id === aiAvatarId);

  // Avatars present in this channel. The primary isn't persisted until the first
  // utterance, so fall back to the guild-configured avatar for display.
  const displayedAvatars = useMemo(() => {
    const active = channel?.activeAvatars ?? [];
    if (active.length > 0) {
      return active.map((a) => ({
        avatarId:     a.avatarId,
        displayName:  a.displayName,
        thumbnailUrl: a.thumbnailUrl ?? '',
        liveUrl:      a.liveUrl,
        isPrimary:    !!a.isPrimary,
      }));
    }
    if (!transcriptOn) return [];
    return [{
      avatarId:     aiAvatarId,
      displayName:  configuredPrimary?.displayName ?? DEFAULT_CLAUDE_AVATAR.fallbackDisplayName,
      thumbnailUrl: configuredPrimary?.thumbnailUrl ?? '',
      liveUrl:      channel?.maskyLiveUrl,
      isPrimary:    true,
    }];
  }, [channel?.activeAvatars, channel?.maskyLiveUrl, transcriptOn, aiAvatarId, configuredPrimary]);

  const primary        = displayedAvatars.find((a) => a.isPrimary) ?? displayedAvatars[0];
  const primaryName    = primary?.displayName ?? DEFAULT_CLAUDE_AVATAR.fallbackDisplayName;
  // `since=now` so opening the live page only plays NEW turns (no recap of the
  // whole conversation). liveUrl already carries `?token=…`, so append with `&`.
  const primaryLiveUrl = primary?.liveUrl
    ? `${primary.liveUrl}${primary.liveUrl.includes('?') ? '&' : '?'}since=now`
    : undefined;
  const avatarsById    = useMemo(
    () => Object.fromEntries(displayedAvatars.map((a) => [a.avatarId, a])),
    [displayedAvatars],
  );

  // The avatarId currently speaking (audio playing), so we pulse the right tile.
  const [speakingAvatarId, setSpeakingAvatarId] = useState<string | null>(null);

  // Talking-head video playback (when a channel is in "talking head" mode the
  // avatar reply renders a video; we play it inside the speaking avatar's tile).
  const { videoSpeakingId, videoSrc, handleVideoEnded, textByUtterance } =
    useTalkingHead(transcriptOn ? guildId : null, transcriptOn ? channelId : null);

  // Stream local STT into the channel transcript while the user is connected
  // and AI assistance is on. Other peers see your utterances appear live.
  // Pause while muted so we're not transcribing dead air or side conversations.
  useBrowserSTT({
    guildId,
    channelId,
    userId:  firebaseUser?.uid ?? null,
    enabled: transcriptOn && isConnected && !isMuted,
    maskName:      selectedMask?.displayName,
    maskAvatarUrl: selectedMask?.thumbnailUrl,
  });

  return (
    <div className={compact ? 'flex flex-col bg-[#0e0e16] border-b border-[#1e1e2e]' : 'flex-1 flex flex-col bg-[#0e0e16]'}>
      {/* Header */}
      <div className={`h-12 items-center gap-2 px-4 border-b border-[#1e1e2e] ${compact ? 'hidden' : 'flex'}`}>
        <MobileBackButton onClick={() => useAppStore.getState().setActiveChannel(null, 'voice')} />
        <svg width="18" height="18" viewBox="0 0 24 24" fill="rgba(168,85,247,0.8)">
          <path d="M12 3a9 9 0 0 1 9 9h-2a7 7 0 0 0-7-7V3zm0 4a5 5 0 0 1 5 5h-2a3 3 0 0 0-3-3V7zm-1 5.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5zM3 11h2a7 7 0 0 0 7 7v2a9 9 0 0 1-9-9z" />
        </svg>
        <span className="font-semibold text-white text-sm">Voice Channel</span>
        {isConnected && (
          <span className="ml-2 text-xs text-green-400 bg-green-900/20 px-2 py-0.5 rounded-full">
            Connected
          </span>
        )}
        {isConnected && voiceSettings.mode === 'ptt' && (
          <span className="ml-1 text-xs text-violet-400 bg-violet-900/20 px-2 py-0.5 rounded-full">
            PTT: {voiceSettings.pttKey.replace('Key', '')}
          </span>
        )}
        {primaryLiveUrl && (
          <a
            href={primaryLiveUrl}
            target="_blank"
            rel="noreferrer"
            title="Open this channel's masky.ai conversation"
            className="ml-auto text-xs text-violet-300 hover:text-violet-200 bg-violet-900/20 hover:bg-violet-900/40 px-2 py-0.5 rounded-full transition-colors flex items-center gap-1"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7zM5 5h5V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-5h-2v5H5V5z" />
            </svg>
            Live on masky.ai
          </a>
        )}
      </div>

      {/* Microphone error banner */}
      {micError && (
        <div className="mx-4 mt-4 px-4 py-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
          {micError}
        </div>
      )}

      {/* Auto-reconnect interaction prompt */}
      {needsInteraction && (
        <button
          onClick={() => {
            document.querySelectorAll<HTMLAudioElement>('audio[data-voice]').forEach((a) => {
              a.play().catch(() => {});
            });
            clearNeedsInteraction();
          }}
          className="mx-4 mt-3 px-4 py-3 w-[calc(100%-2rem)] text-left bg-violet-900/40 border border-violet-600/60 rounded-lg text-violet-200 text-sm hover:bg-violet-900/60 transition-colors flex items-center gap-3 cursor-pointer"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0 text-violet-400">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
          </svg>
          <span>
            <span className="font-semibold">Voice audio needs your permission</span>
            <span className="text-violet-300/70 ml-2">— click here to enable</span>
          </span>
        </button>
      )}

      {/* Participant grid — scrolls on its own so it never pushes the chat or
          controls off-screen as more people join (min-h-0 lets a flex child
          actually shrink + scroll instead of growing to fit its content). */}
      <div className={compact ? 'flex-shrink-0 max-h-56 overflow-y-auto p-3' : 'flex-1 min-h-0 p-6 overflow-y-auto'}>
        <div
          className={
            compact
              ? 'grid grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-2 auto-rows-fr'
              : 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-fr'
          }
        >
          {/* Local user tile — when a mask is on, show ONLY the mask identity. */}
          {selfInfo && firebaseUser && (() => {
            const selfAvatarUrl = selectedMask?.thumbnailUrl || selfInfo.avatarUrl;
            return (
              <ParticipantTile
                userId={firebaseUser.uid}
                name={selectedMask?.displayName ?? selfInfo.name}
                avatarUrl={selfAvatarUrl}
                stream={localStream}
                isMuted={isMuted}
                speaking={localSpeaking && !isMuted}
                isSelf
                onGearClick={() => setAvatarSettingsOpen(true)}
                sharing={sharing}
                onMaximize={() => setMaximizedId(firebaseUser.uid)}
              />
            );
          })()}

          {/* Remote participants — when they're masked, show ONLY their mask
              identity (shared via voiceState); never their real name/avatar. */}
          {participants
            .filter((p) => p.userId !== firebaseUser?.uid)
            .map((p) => {
              const info = getMemberInfo(p.userId);
              const name      = p.state.maskName ?? info.name;
              const avatarUrl = p.state.maskAvatarUrl ?? info.avatarUrl;
              return (
                <ParticipantTile
                  key={p.userId}
                  userId={p.userId}
                  name={name}
                  avatarUrl={avatarUrl}
                  stream={p.stream}
                  isMuted={p.state.muted}
                  sharing={p.state.sharing ?? null}
                  onMaximize={() => setMaximizedId(p.userId)}
                />
              );
            })}

          {/* AI avatars — synthetic participants (one tile each). No MediaStream;
              the audio fanout happens via the transcript panel's <audio> playback. */}
          {displayedAvatars.map((a) => (
            <ParticipantTile
              key={`bot:${a.avatarId}`}
              userId={`bot:${guildId}:${a.avatarId}`}
              name={a.displayName}
              avatarUrl={a.thumbnailUrl}
              stream={null}
              isMuted={false}
              speaking={speakingAvatarId === a.avatarId || videoSpeakingId === a.avatarId}
              videoSrc={videoSpeakingId === a.avatarId ? videoSrc : null}
              onVideoEnded={handleVideoEnded}
            />
          ))}

          {/* Invite tile */}
          {firebaseUser && (
            <InviteTile guildId={guildId} channelId={channelId} inviterId={firebaseUser.uid} />
          )}
        </div>
      </div>

      {/* Chat panel — shown when AI assistance is on for this channel.
          Never in compact: the surface underneath is the channel's one
          conversation, and a second chat above it shows every spoken line
          twice while the avatar answers into only one of them. */}
      {transcriptOn && !compact && (
        <ChatPanel
          guildId={guildId}
          channelId={channelId}
          avatarName={primaryName}
          avatarsById={avatarsById}
          textByUtterance={textByUtterance}
          selfMask={selectedMask ? { name: selectedMask.displayName, avatarUrl: selectedMask.thumbnailUrl } : undefined}
          onAvatarSpeakingChange={setSpeakingAvatarId}
        />
      )}

      {/* Expanded share. On desktop it fills the area above the chat; on mobile
          it covers the screen, since there is no room to do anything else. */}
      {maximizedId && (() => {
        const isSelfMax = maximizedId === firebaseUser?.uid;
        const maxParticipant = participants.find((p) => p.userId === maximizedId);
        const maxStream = isSelfMax ? localStream : maxParticipant?.stream ?? null;
        const maxSharing = isSelfMax ? sharing : maxParticipant?.state.sharing ?? null;
        const maxName = isSelfMax
          ? (selectedMask?.displayName ?? selfInfo?.name ?? 'You')
          : (maxParticipant?.state.maskName ?? getMemberInfo(maximizedId).name);

        // The sharer stopped while expanded — drop back to the grid.
        if (!maxStream || !maxSharing) {
          setMaximizedId(null);
          return null;
        }

        return (
          <MaximizedShare
            stream={maxStream}
            kind={maxSharing}
            name={maxName}
            onMinimize={() => setMaximizedId(null)}
          />
        );
      })()}

      {/* Voice controls bar */}
      <div className="flex-shrink-0 border-t border-[#1e1e2e] bg-[#0a0a12] px-4 py-3 flex items-center justify-center gap-4">
        <VoiceButton
          active={!isMuted}
          activeColor="bg-violet-600 hover:bg-violet-500"
          inactiveColor="bg-red-700 hover:bg-red-600"
          onClick={toggleMute}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <MutedIcon /> : <MicIcon />}
        </VoiceButton>

        <VoiceButton
          active={!isDeafened}
          activeColor="bg-[#1e1e2e] hover:bg-[#2a2a3e]"
          inactiveColor="bg-red-700 hover:bg-red-600"
          onClick={toggleDeafen}
          title={isDeafened ? 'Undeafen' : 'Deafen'}
        >
          {isDeafened ? <DeafenedIcon /> : <HeadsetIcon />}
        </VoiceButton>

        {/* Share screen — toggles off when already sharing one */}
        <VoiceButton
          active={sharing === 'screen'}
          activeColor="bg-violet-600 hover:bg-violet-500"
          inactiveColor="bg-[#1e1e2e] hover:bg-[#2a2a3e]"
          onClick={() => {
            if (sharing === 'screen') void stopSharing();
            else void startSharing('screen');
          }}
          title={sharing === 'screen' ? 'Stop sharing screen' : 'Share screen'}
        >
          <ScreenShareIcon />
        </VoiceButton>

        {/* Share camera */}
        <VoiceButton
          active={sharing === 'camera'}
          activeColor="bg-violet-600 hover:bg-violet-500"
          inactiveColor="bg-[#1e1e2e] hover:bg-[#2a2a3e]"
          onClick={() => {
            if (sharing === 'camera') void stopSharing();
            else void startSharing('camera');
          }}
          title={sharing === 'camera' ? 'Stop camera' : 'Share camera'}
        >
          <CameraIcon />
        </VoiceButton>

        {/* Settings */}
        <VoiceButton
          active={settingsOpen}
          activeColor="bg-violet-700 hover:bg-violet-600"
          inactiveColor="bg-[#1e1e2e] hover:bg-[#2a2a3e]"
          onClick={() => {
            if (!settingsOpen) refreshDevices();
            setSettingsOpen((v) => !v);
          }}
          title="Voice Settings"
        >
          <GearIcon />
        </VoiceButton>

        <VoiceButton
          active={false}
          activeColor=""
          inactiveColor="bg-red-700 hover:bg-red-600"
          onClick={hangUp}
          title="Disconnect"
        >
          <PhoneHangUpIcon />
        </VoiceButton>
      </div>

      {/* Settings panel */}
      {settingsOpen && (
        <VoiceSettingsPanel
          settings={voiceSettings}
          inputs={audioInputs}
          outputs={audioOutputs}
          onUpdate={updateVoiceSettings}
          onInputDeviceChange={updateInputDevice}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Avatar settings */}
      {avatarSettingsOpen && firebaseUser && (
        <AvatarSettingsModal
          uid={firebaseUser.uid}
          avatarGroups={avatarGroups}
          selectedId={selectedId}
          onSelect={setSelected}
          onClose={() => setAvatarSettingsOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Voice Settings Panel ─────────────────────────────────────────────────────

interface SettingsPanelProps {
  settings: VoiceSettings;
  inputs: AudioDevice[];
  outputs: AudioDevice[];
  onUpdate: (patch: Partial<VoiceSettings>) => void;
  onInputDeviceChange: (deviceId: string) => Promise<void>;
  onClose: () => void;
}

function VoiceSettingsPanel({ settings, inputs, outputs, onUpdate, onInputDeviceChange, onClose }: SettingsPanelProps) {
  const [bindingPtt, setBindingPtt] = useState(false);

  // Capture next keypress as the new PTT key
  useEffect(() => {
    if (!bindingPtt) return;
    function capture(e: KeyboardEvent) {
      e.preventDefault();
      onUpdate({ pttKey: e.code });
      setBindingPtt(false);
    }
    window.addEventListener('keydown', capture, { once: true });
    return () => window.removeEventListener('keydown', capture);
  }, [bindingPtt, onUpdate]);

  async function handleInputChange(deviceId: string) {
    onUpdate({ inputDeviceId: deviceId });
    await onInputDeviceChange(deviceId);
  }

  return (
    <div className="absolute bottom-[72px] left-1/2 -translate-x-1/2 w-80 bg-[#12121f] border border-[#2a2a3e] rounded-2xl shadow-2xl z-50 p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-semibold text-white text-sm">Voice Settings</span>
        <button onClick={onClose} className="text-[#6b7280] hover:text-white transition-colors">
          <CloseIcon />
        </button>
      </div>

      {/* Mode toggle */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-[#6b7280] uppercase tracking-wider">Input Mode</label>
        <div className="flex rounded-lg overflow-hidden border border-[#2a2a3e]">
          <ModeButton
            active={settings.mode === 'vad'}
            onClick={() => onUpdate({ mode: 'vad' })}
          >
            Voice Activity
          </ModeButton>
          <ModeButton
            active={settings.mode === 'ptt'}
            onClick={() => onUpdate({ mode: 'ptt' })}
          >
            Push to Talk
          </ModeButton>
        </div>
      </div>

      {/* VAD threshold */}
      {settings.mode === 'vad' && (
        <div className="space-y-2">
          <div className="flex justify-between">
            <label className="text-xs font-medium text-[#6b7280] uppercase tracking-wider">
              Sensitivity
            </label>
            <span className="text-xs text-violet-400">
              {settings.vadThreshold < 5 ? 'High' : settings.vadThreshold < 15 ? 'Medium' : 'Low'}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={30}
            value={settings.vadThreshold}
            onChange={(e) => onUpdate({ vadThreshold: Number(e.target.value) })}
            className="w-full accent-violet-500"
          />
          <div className="flex justify-between text-[10px] text-[#4a4a5e]">
            <span>More sensitive</span>
            <span>Less sensitive</span>
          </div>
        </div>
      )}

      {/* PTT key binding */}
      {settings.mode === 'ptt' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-[#6b7280] uppercase tracking-wider">
            Push to Talk Key
          </label>
          <button
            onClick={() => setBindingPtt(true)}
            className={`w-full py-2.5 rounded-lg border text-sm font-mono font-semibold transition-colors ${
              bindingPtt
                ? 'border-violet-500 bg-violet-900/30 text-violet-300 animate-pulse'
                : 'border-[#2a2a3e] bg-[#0a0a12] text-white hover:border-violet-600/60'
            }`}
          >
            {bindingPtt ? 'Press any key…' : settings.pttKey.replace('Key', '')}
          </button>
          <p className="text-[11px] text-[#4a4a5e]">Click above then press the key you want to use.</p>
        </div>
      )}

      {/* Input device */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-[#6b7280] uppercase tracking-wider">Microphone</label>
        <DeviceSelect
          devices={inputs}
          value={settings.inputDeviceId}
          onChange={handleInputChange}
          placeholder="System Default"
        />
      </div>

      {/* Output device */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-[#6b7280] uppercase tracking-wider">Speaker</label>
        {typeof HTMLAudioElement !== 'undefined' && 'setSinkId' in HTMLAudioElement.prototype ? (
          <DeviceSelect
            devices={outputs}
            value={settings.outputDeviceId}
            onChange={(id) => onUpdate({ outputDeviceId: id })}
            placeholder="System Default"
          />
        ) : (
          <p className="text-xs text-[#4a4a5e]">Output selection requires Chrome or Edge.</p>
        )}
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 text-xs font-semibold transition-colors ${
        active
          ? 'bg-violet-600 text-white'
          : 'bg-[#0a0a12] text-[#6b7280] hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function DeviceSelect({ devices, value, onChange, placeholder }: {
  devices: { deviceId: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 rounded-lg bg-[#0a0a12] border border-[#2a2a3e] text-sm text-white
        focus:outline-none focus:border-violet-600/60 appearance-none cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {devices.map((d) => (
        <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
      ))}
    </select>
  );
}

// ─── Maximized share ──────────────────────────────────────────────────────────

/**
 * An expanded screen or camera feed. Absolutely positioned inside the voice
 * channel column, so on desktop it covers the participant grid and leaves the
 * chat panel and controls reachable; on mobile it goes fixed and takes the
 * whole screen, where there is no room for anything else.
 */
function MaximizedShare({ stream, kind, name, onMinimize }: {
  stream: MediaStream;
  kind: ShareKind;
  name: string;
  onMinimize: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => {});
    return () => { el.srcObject = null; };
  }, [stream]);

  // Escape minimizes, which is what anything fullscreen-shaped should do.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onMinimize(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onMinimize]);

  return (
    <div className="fixed inset-0 z-50 bg-black md:absolute md:inset-x-0 md:top-0 md:bottom-auto md:h-full">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        className={`w-full h-full ${kind === 'screen' ? 'object-contain' : 'object-cover'}`}
      />

      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/70 to-transparent">
        <span className="text-sm font-medium text-white truncate">
          {name} — {kind === 'screen' ? 'screen' : 'camera'}
        </span>
        <button
          onClick={onMinimize}
          title="Minimize"
          className="w-8 h-8 rounded-lg bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-colors flex-shrink-0"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M6 10h4V4H8v4H6v2zm10 0h-4V4h2v4h2v2zM6 14h4v6H8v-4H6v-2zm10 0h-4v6h2v-4h2v-2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function ScreenShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M20 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6v2H8v2h8v-2h-2v-2h6a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 12H4V5h16v10zm-8-9l-4 4h2.5v3h3v-3H16l-4-4z" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
    </svg>
  );
}

// ─── Participant Tile ─────────────────────────────────────────────────────────

interface TileProps {
  userId: string;
  name: string;
  avatarUrl: string;
  stream: MediaStream | null | undefined;
  isMuted: boolean;
  speaking?: boolean;   // explicit override (local user / AI avatars)
  isSelf?: boolean;
  maskName?: string;
  onGearClick?: () => void;
  videoSrc?: string | null;        // talking-head video to play in this tile
  onVideoEnded?: () => void;
  /** Set when this participant is sharing a screen or camera. */
  sharing?: ShareKind;
  /** Expand this tile's shared video. Omitted when there is nothing to expand. */
  onMaximize?: () => void;
}

function ParticipantTile({ name, avatarUrl, stream, isMuted, speaking: speakingOverride, isSelf, maskName, onGearClick, videoSrc, onVideoEnded, sharing, onMaximize }: TileProps) {
  const initials = name.substring(0, 2).toUpperCase();
  const liveVideoRef = useRef<HTMLVideoElement>(null);

  // A shared screen/camera arrives on the same MediaStream as the audio. It is
  // only rendered when the sender says they are sharing — the placeholder track
  // that holds the video m-line open is otherwise indistinguishable from a feed.
  const showLiveVideo = Boolean(sharing) && Boolean(stream);

  useEffect(() => {
    const el = liveVideoRef.current;
    if (!el || !showLiveVideo || !stream) return;
    el.srcObject = stream;
    el.play().catch(() => {});
    return () => { el.srcObject = null; };
  }, [showLiveVideo, stream]);

  // For remote participants: detect speaking locally via AudioContext
  const remoteSpeaking = useSpeakingDetector(isSelf ? null : stream);
  // An explicit override (local user, AI avatars) wins; otherwise use detection.
  const speaking = speakingOverride ?? (remoteSpeaking && !isMuted);

  // Note: audio playback is handled by PersistentAudio inside VoiceProvider so it
  // survives switching to text channels. No <audio> element is needed here.

  return (
    <div className={`
      aspect-square rounded-2xl border transition-all relative overflow-hidden bg-violet-600/20
      ${isSelf ? 'border-violet-700/50' : 'border-[#1e1e2e]'}
      ${speaking ? 'ring-2 ring-green-500 ring-offset-2 ring-offset-[#0e0e16]' : ''}
    `}>

      {/* A live screen/camera share takes the whole tile, replacing the avatar.
          Muted: the audio for this peer already plays through PersistentAudio. */}
      {showLiveVideo ? (
        <video
          ref={liveVideoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 w-full h-full bg-black ${sharing === 'screen' ? 'object-contain' : 'object-cover'}`}
        />
      ) : videoSrc ? (
        <video
          key={videoSrc}
          src={videoSrc}
          autoPlay
          playsInline
          onEnded={onVideoEnded}
          onError={onVideoEnded}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : avatarUrl ? (
        <img src={avatarUrl} alt={name} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-violet-600/30">
          <span className="font-bold text-5xl text-violet-200">{initials}</span>
        </div>
      )}

      {/* Name bar — sits on top of the image */}
      <div className="absolute left-0 right-0 bottom-0 bg-black/65 backdrop-blur-sm px-3 py-2">
        <p className="text-sm font-medium text-white truncate leading-tight">
          {name}{isSelf ? ' (you)' : ''}
        </p>
        {maskName && (
          <p className="text-[11px] text-violet-300 truncate leading-tight">{maskName}</p>
        )}
      </div>

      {/* Maximize — only when there is a live share to expand */}
      {showLiveVideo && onMaximize && (
        <button
          onClick={onMaximize}
          title="Maximize"
          className="absolute top-2 left-2 w-7 h-7 rounded-lg bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z" />
          </svg>
        </button>
      )}

      {/* Muted indicator */}
      {isMuted && (
        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-700 flex items-center justify-center shadow-lg">
          <MutedIcon />
        </div>
      )}

      {/* Gear button (self only) — top-left so it doesn't fight with name bar or mute */}
      {isSelf && onGearClick && (
        <button
          onClick={onGearClick}
          title="Avatar Settings"
          className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/55 backdrop-blur-sm border border-white/15
            flex items-center justify-center text-white hover:bg-violet-600/80 hover:border-violet-400 transition-colors"
        >
          <GearIcon />
        </button>
      )}
    </div>
  );
}

// ─── Speaking detector ────────────────────────────────────────────────────────
// Monitors a MediaStream with an AnalyserNode and returns true when audio is
// detected above a fixed RMS threshold. Only triggers setState on transitions
// to avoid excessive re-renders.

function useSpeakingDetector(stream: MediaStream | null | undefined): boolean {
  const [speaking, setSpeaking] = useState(false);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!stream) { setSpeaking(false); return; }

    let audioCtx: AudioContext | null = null;
    let destroyed = false;
    try {
      audioCtx = new AudioContext();
      // Non-blocking resume — same pattern as VAD. If suspended (no user gesture yet),
      // the tick loop skips detection until the context is running.
      audioCtx.resume().catch(() => {});

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let last = false;

      function tick() {
        if (destroyed) return;
        if (audioCtx!.state === 'running') {
          analyser.getByteTimeDomainData(data);
          const rms = Math.sqrt(data.reduce((s, v) => s + (v - 128) ** 2, 0) / data.length);
          const isSpeaking = rms > 4;
          if (isSpeaking !== last) {
            last = isSpeaking;
            setSpeaking(isSpeaking);
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      }

      rafRef.current = requestAnimationFrame(tick);
    } catch { /* AudioContext unavailable */ }

    return () => {
      destroyed = true;
      cancelAnimationFrame(rafRef.current);
      audioCtx?.close();
      setSpeaking(false);
    };
  }, [stream]);

  return speaking;
}

// ─── Voice Button ─────────────────────────────────────────────────────────────

function VoiceButton({
  children, active, activeColor, inactiveColor, onClick, title,
}: {
  children: React.ReactNode;
  active: boolean;
  activeColor: string;
  inactiveColor: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-12 h-12 rounded-full flex items-center justify-center text-white transition-colors ${active ? activeColor : inactiveColor}`}
    >
      {children}
    </button>
  );
}

// ─── Invite Tile ──────────────────────────────────────────────────────────────

function InviteTile({ guildId, channelId, inviterId }: { guildId: string; channelId: string; inviterId: string }) {
  const [loading, setLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleOpen() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const code = await createInvite(guildId, channelId, inviterId);
      setInviteUrl(buildInviteUrl(code, channelId));
    } catch {
      setError('Failed to generate invite link. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setInviteUrl(null);
    setError(null);
    setCopied(false);
  }

  async function handleCopy() {
    if (!inviteUrl) return;
    copyToClipboard(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <button
        onClick={handleOpen}
        disabled={loading}
        className="aspect-square rounded-2xl flex flex-col items-center justify-center gap-3
          bg-[#12121a] border border-dashed border-[#2a2a3e] hover:border-violet-600/60
          hover:bg-[#1a1a28] transition-colors relative overflow-hidden disabled:opacity-50"
      >
        <div className="w-16 h-16 rounded-full bg-violet-600/10 border-2 border-violet-600/30
          flex items-center justify-center flex-shrink-0">
          {loading
            ? <div className="w-6 h-6 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
            : <LinkIcon />
          }
        </div>
        <span className="text-sm font-medium text-[#6b7280] truncate px-2 max-w-full">
          {loading ? 'Generating...' : 'Invite'}
        </span>
      </button>

      {(inviteUrl !== null || error !== null) && (
        <Modal title="Invite to Voice" onClose={handleClose}>
          <div className="px-6 pb-6 space-y-4">
            {error ? (
              <p className="text-sm text-red-400">{error}</p>
            ) : (
              <>
                <p className="text-sm text-[#6b7280]">
                  Share this link to invite someone directly into this voice channel.
                </p>
                <div className="flex gap-2">
                  <div className="flex-1 px-3 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-sm text-[#94a3b8] truncate select-all">
                    {inviteUrl}
                  </div>
                  <button
                    onClick={handleCopy}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex-shrink-0 ${
                      copied
                        ? 'bg-green-600 text-white'
                        : 'bg-violet-600 hover:bg-violet-500 text-white'
                    }`}
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </>
            )}
            <div className="pt-1 flex justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-sm text-[#94a3b8] hover:text-white hover:bg-[#1e1e2e] transition-colors"
              >
                {error ? 'Close' : 'Done'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
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

// ─── Avatar Settings Modal ────────────────────────────────────────────────────

interface AvatarSettingsModalProps {
  uid: string;
  avatarGroups: MaskyAvatarGroup[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}

function AvatarSettingsModal({ uid, avatarGroups, selectedId, onSelect, onClose }: AvatarSettingsModalProps) {
  const [talkingAvatar,  setTalkingAvatar]  = useState(false);
  // Persisted voicing modes for the user's own mask.
  const [useAvatarVoice, setUseAvatarVoice]  = useState(() => loadUseAvatarVoice(uid));
  const [usePersonality, setUsePersonality]  = useState(() => loadUseAvatarPersonality(uid));

  const selectedAvatar = avatarGroups.find((g) => g.id === selectedId);

  function requireVoiceCapableMask(): boolean {
    if (!selectedAvatar) { alert('Select a mask first to use its voice.'); return false; }
    if (!selectedAvatar.humeVoiceId) {
      alert('This avatar doesn\'t have a voice set up yet. Add one at masky.ai first.');
      return false;
    }
    return true;
  }

  function toggleUseAvatarVoice() {
    if (!useAvatarVoice && !requireVoiceCapableMask()) return;
    setUseAvatarVoice((v) => {
      const next = !v;
      saveUseAvatarVoice(uid, next);
      // personality and verbatim are mutually exclusive modes; turning one on
      // turns the other off so the reactive mode is unambiguous.
      if (next && usePersonality) { setUsePersonality(false); saveUseAvatarPersonality(uid, false); }
      window.dispatchEvent(new Event('maskord-voice-settings-changed'));
      return next;
    });
  }

  function toggleUsePersonality() {
    if (!usePersonality && !requireVoiceCapableMask()) return;
    setUsePersonality((v) => {
      const next = !v;
      saveUseAvatarPersonality(uid, next);
      if (next && useAvatarVoice) { setUseAvatarVoice(false); saveUseAvatarVoice(uid, false); }
      window.dispatchEvent(new Event('maskord-voice-settings-changed'));
      return next;
    });
  }

  function handleTalkingAvatar() {
    if (!talkingAvatar) {
      const upgrade = window.confirm(
        'Talking Avatar requires an active masky.ai membership.\n\nOpen masky.ai to upgrade?',
      );
      if (upgrade) window.open('https://masky.ai', '_blank');
      return;
    }
    setTalkingAvatar((v) => !v);
  }

  return (
    <Modal title="Avatar Settings" onClose={onClose}>
      <div className="px-6 pb-6 space-y-6 max-h-[80vh] overflow-y-auto">

        {/* Mask features — at the top so they're visible above a long mask list */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Mask Features</p>
          <div className="space-y-1.5">
            <CheckboxRow
              label="Use Avatar Voice"
              sublabel="Speak your exact words in this mask's voice"
              checked={useAvatarVoice}
              onToggle={toggleUseAvatarVoice}
            />
            <CheckboxRow
              label="Use Avatar personality"
              sublabel="Reinterpret what you say through this mask's personality, then speak it in its voice"
              checked={usePersonality}
              onToggle={toggleUsePersonality}
            />
            <ToggleOptionRow
              label="Talking Avatar"
              sublabel="Animate your mask in video (Pro)"
              value={talkingAvatar}
              onToggle={handleTalkingAvatar}
              proFeature
            />
          </div>
        </div>

        {/* Mask selector */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Active Mask</p>
          <div className="space-y-1.5">
            {/* None option */}
            <AvatarOptionRow
              label="None"
              sublabel="Use your real identity"
              selected={!selectedId}
              onSelect={() => onSelect(null)}
            />
            {avatarGroups.length === 0 ? (
              <div className="px-4 py-3 rounded-xl bg-[#0a0a12] border border-[#1e1e2e] text-sm text-[#6b7280]">
                No avatars found.{' '}
                <a
                  href="https://masky.ai"
                  target="_blank"
                  rel="noreferrer"
                  className="text-violet-400 hover:underline"
                >
                  Create one at masky.ai →
                </a>
              </div>
            ) : (
              avatarGroups.map((g) => (
                <AvatarOptionRow
                  key={g.id}
                  thumbnailUrl={g.thumbnailUrl}
                  label={g.displayName}
                  sublabel={g.personalityPrompt?.slice(0, 72) ?? 'No personality set'}
                  hasVoice={!!g.humeVoiceId}
                  selected={selectedId === g.id}
                  onSelect={() => onSelect(g.id)}
                />
              ))
            )}
          </div>
        </div>

        <div className="flex justify-end pt-1">
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

function AvatarOptionRow({
  thumbnailUrl, label, sublabel, hasVoice, selected, onSelect,
}: {
  thumbnailUrl?: string;
  label: string;
  sublabel?: string;
  hasVoice?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const initials = label.substring(0, 2).toUpperCase();
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
        selected
          ? 'border-violet-600/50 bg-violet-900/10'
          : 'border-[#1e1e2e] bg-[#0a0a12] hover:border-violet-600/30'
      }`}
    >
      <div className="w-9 h-9 rounded-full bg-violet-600/20 border border-violet-600/30 overflow-hidden flex items-center justify-center flex-shrink-0">
        {thumbnailUrl
          ? <img src={thumbnailUrl} alt={label} className="w-full h-full object-cover" />
          : <span className="text-xs font-bold text-violet-300">{initials}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold truncate ${selected ? 'text-white' : 'text-[#94a3b8]'}`}>
            {label}
          </span>
          {hasVoice && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-900/30 text-violet-400 flex-shrink-0">
              Voice
            </span>
          )}
        </div>
        {sublabel && (
          <span className="text-xs text-[#4b5563] truncate block">{sublabel}</span>
        )}
      </div>
      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
        selected ? 'border-violet-500' : 'border-[#2a2a3e]'
      }`}>
        {selected && <div className="w-2 h-2 rounded-full bg-violet-500" />}
      </div>
    </button>
  );
}

function CheckboxRow({
  label, sublabel, checked, onToggle,
}: {
  label: string;
  sublabel?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
        checked ? 'border-violet-500 bg-violet-900/10' : 'border-[#1e1e2e] bg-[#0a0a12] hover:border-violet-600/30'
      }`}
    >
      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
        checked ? 'border-violet-500 bg-violet-600' : 'border-[#2a2a3e] bg-transparent'
      }`}>
        {checked && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-semibold text-white">{label}</span>
        {sublabel && <span className="text-xs text-[#4b5563] block leading-snug mt-0.5">{sublabel}</span>}
      </div>
    </button>
  );
}

function ToggleOptionRow({
  label, sublabel, value, onToggle, proFeature,
}: {
  label: string;
  sublabel?: string;
  value: boolean;
  onToggle: () => void;
  proFeature?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[#1e1e2e] bg-[#0a0a12] hover:border-violet-600/30 text-left transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#e2e8f0]">{label}</span>
          {proFeature && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-900/20 text-amber-400 flex-shrink-0">
              PRO
            </span>
          )}
        </div>
        {sublabel && (
          <span className="text-xs text-[#4b5563]">{sublabel}</span>
        )}
      </div>
      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
        value ? 'border-violet-500 bg-violet-600' : 'border-[#2a2a3e] bg-transparent'
      }`}>
        {value && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="white">
            <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </button>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
      <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
    </svg>
  );
}

function HeadsetIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
      <path d="M12 3C6.48 3 2 7.48 2 13v4c0 1.1.9 2 2 2h1c1.1 0 2-.9 2-2v-3c0-1.1-.9-2-2-2H4v-1c0-4.42 3.58-8 8-8s8 3.58 8 8v1h-1c-1.1 0-2 .9-2 2v3c0 1.1.9 2 2 2h1c1.1 0 2-.9 2-2v-4c0-5.52-4.48-10-10-10z" />
    </svg>
  );
}

function DeafenedIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
      <path d="M12 3C6.48 3 2 7.48 2 13v4c0 1.1.9 2 2 2h1c1.1 0 2-.9 2-2v-3c0-1.1-.9-2-2-2H4v-1c0-4.42 3.58-8 8-8s8 3.58 8 8v1h-1c-1.1 0-2 .9-2 2v3c0 1.1.9 2 2 2h1c1.1 0 2-.9 2-2v-4c0-5.52-4.48-10-10-10zm-1 9v6h2v-6h-2z" />
    </svg>
  );
}

function PhoneHangUpIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
      <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08C.11 12.9 0 12.65 0 12.38c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="rgba(167,139,250,0.8)">
      <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
    </svg>
  );
}
