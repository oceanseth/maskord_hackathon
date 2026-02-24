import { useEffect, useRef, useState, useMemo } from 'react';
import { useAuth, useUserProfiles, useVoiceChannel } from '@maskord/shared';

interface Props {
  guildId: string;
  channelId: string;
}

// ─── Join sound (Web Audio API — no file needed) ───────────────────────────────

function playJoinSound() {
  try {
    const ctx = new AudioContext();
    [880, 1100].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0,  ctx.currentTime + i * 0.13);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.13 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.13 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.13);
      osc.stop(ctx.currentTime + i * 0.13 + 0.5);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* ignore if AudioContext unavailable */ }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VoiceChannel({ guildId, channelId }: Props) {
  const { firebaseUser } = useAuth();
  const [micError, setMicError] = useState<string | null>(null);

  const {
    participants,
    localStream,
    isMuted,
    isDeafened,
    isConnected,
    join,
    leave,
    toggleMute,
    toggleDeafen,
  } = useVoiceChannel(guildId, channelId, firebaseUser?.uid ?? null);

  // Collect all participant IDs (including self) to fetch their profiles
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

  // Auto-join on mount, leave on unmount
  useEffect(() => {
    setMicError(null);
    join()
      .then(() => playJoinSound())
      .catch((err: Error) => {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setMicError('Microphone access denied. Please allow microphone access and try again.');
        } else {
          setMicError(`Could not access microphone: ${err.message}`);
        }
      });
    return () => { leave(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId, channelId]);

  const selfInfo = firebaseUser ? getMemberInfo(firebaseUser.uid) : null;

  return (
    <div className="flex-1 flex flex-col bg-[#0e0e16]">
      {/* Header */}
      <div className="h-12 flex items-center gap-2 px-4 border-b border-[#1e1e2e]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="rgba(168,85,247,0.8)">
          <path d="M12 3a9 9 0 0 1 9 9h-2a7 7 0 0 0-7-7V3zm0 4a5 5 0 0 1 5 5h-2a3 3 0 0 0-3-3V7zm-1 5.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5zM3 11h2a7 7 0 0 0 7 7v2a9 9 0 0 1-9-9z" />
        </svg>
        <span className="font-semibold text-white text-sm">Voice Channel</span>
        {isConnected && (
          <span className="ml-2 text-xs text-green-400 bg-green-900/20 px-2 py-0.5 rounded-full">
            Connected
          </span>
        )}
      </div>

      {/* Microphone error banner */}
      {micError && (
        <div className="mx-4 mt-4 px-4 py-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
          {micError}
        </div>
      )}

      {/* Participant grid */}
      <div className="flex-1 p-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-fr max-h-full">
          {/* Local user tile */}
          {selfInfo && firebaseUser && (
            <ParticipantTile
              userId={firebaseUser.uid}
              name={selfInfo.name}
              avatarUrl={selfInfo.avatarUrl}
              stream={localStream}
              isMuted={isMuted}
              isSelf
            />
          )}

          {/* Remote participants */}
          {participants
            .filter((p) => p.userId !== firebaseUser?.uid)
            .map((p) => {
              const { name, avatarUrl } = getMemberInfo(p.userId);
              return (
                <ParticipantTile
                  key={p.userId}
                  userId={p.userId}
                  name={name}
                  avatarUrl={avatarUrl}
                  stream={p.stream}
                  isMuted={p.state.muted}
                />
              );
            })}
        </div>
      </div>

      {/* Voice controls bar */}
      <div className="border-t border-[#1e1e2e] bg-[#0a0a12] px-4 py-3 flex items-center justify-center gap-4">
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

        <VoiceButton
          active={false}
          activeColor=""
          inactiveColor="bg-red-700 hover:bg-red-600"
          onClick={leave}
          title="Disconnect"
        >
          <PhoneOffIcon />
        </VoiceButton>
      </div>
    </div>
  );
}

// ─── Participant Tile ─────────────────────────────────────────────────────────

interface TileProps {
  userId: string;
  name: string;
  avatarUrl: string;
  stream: MediaStream | null | undefined;
  isMuted: boolean;
  isSelf?: boolean;
}

function ParticipantTile({ name, avatarUrl, stream, isMuted, isSelf }: TileProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const initials  = name.substring(0, 2).toUpperCase();

  useEffect(() => {
    if (audioRef.current && stream && !isSelf) {
      audioRef.current.srcObject = stream;
    }
  }, [stream, isSelf]);

  return (
    <div className={`
      aspect-square rounded-2xl flex flex-col items-center justify-center gap-3
      bg-[#12121a] border transition-colors relative overflow-hidden
      ${isSelf ? 'border-violet-700/50' : 'border-[#1e1e2e]'}
    `}>
      {!isSelf && stream && (
        <audio ref={audioRef} autoPlay playsInline className="hidden" />
      )}

      {/* Avatar */}
      <div className="w-16 h-16 rounded-full bg-violet-600/30 border-2 border-violet-600/50 overflow-hidden flex items-center justify-center flex-shrink-0">
        {avatarUrl
          ? <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
          : <span className="font-bold text-xl text-violet-300">{initials}</span>
        }
      </div>

      <span className="text-sm font-medium text-white truncate px-2 max-w-full">
        {name}{isSelf ? ' (you)' : ''}
      </span>

      {/* Muted indicator */}
      {isMuted && (
        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-700 flex items-center justify-center">
          <MutedIcon />
        </div>
      )}

      {/* Speaking indicator */}
      {!isMuted && stream && (
        <div className="absolute inset-0 rounded-2xl border-2 border-green-500/0 pointer-events-none speaking-indicator" />
      )}
    </div>
  );
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

function PhoneOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
      <path d="M23.76 14.37c.12.11.19.27.19.44v3.37c0 .35-.3.62-.64.62C10.77 18.8 5.2 13.23 5.2 6.49c0-.35.27-.64.62-.64h3.37c.17 0 .33.07.44.19.22.25.35.55.38.87l.63 3.8c.03.18-.02.36-.14.49l-2.4 2.4c1.4 2.85 4.65 6.1 7.49 7.49l2.4-2.4c.13-.12.31-.18.49-.14l3.8.63c.32.04.62.16.88.39zM1 3.27L2.73 5C1.65 6.38 1 8.12 1 10c0 1.89.65 3.62 1.73 4.99L1 16.72C-.01 14.95-.5 12.55-.5 10c0-2.55.5-4.95 1.5-6.73zm4 0L6.73 5C5.65 6.38 5 8.12 5 10c0 1.89.65 3.62 1.73 4.99L5 16.72C3.99 14.95 3.5 12.55 3.5 10c0-2.55.5-4.95 1.5-6.73z" />
    </svg>
  );
}
