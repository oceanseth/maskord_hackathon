import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import {
  ref as rtdbRef,
  set as rtdbSet,
  remove as rtdbRemove,
  onChildAdded,
  onValue,
} from 'firebase/database';
import {
  useAuth,
  useVoiceChannel,
  useUserProfiles,
  dmChannelId as mkDmChannelId,
  getFirebaseRtdb,
} from '@maskord/shared';
import type { VoiceParticipant } from '@maskord/shared';
import { useAppStore } from '../../store/app';
import { useVoiceSettings } from '../../hooks/useVoiceSettings';
import type { VoiceSettings, AudioDevice } from '../../hooks/useVoiceSettings';
import { useMaskyVoice } from '../../hooks/useMaskyVoice';

export interface VoiceContextValue {
  participants: VoiceParticipant[];
  localStream: MediaStream | null;
  isMuted: boolean;
  isDeafened: boolean;
  isConnected: boolean;
  /** True when local audio is actively being transmitted (VAD detected / PTT held) */
  localSpeaking: boolean;
  micError: string | null;
  /** True when remote audio playback was blocked by browser autoplay policy */
  needsInteraction: boolean;
  clearNeedsInteraction: () => void;
  voiceSettings: VoiceSettings;
  updateVoiceSettings: (patch: Partial<VoiceSettings>) => void;
  audioInputs: AudioDevice[];
  audioOutputs: AudioDevice[];
  refreshDevices: () => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  hangUp: () => void;
  /** Hot-swap the input device mid-call */
  updateInputDevice: (deviceId: string) => Promise<void>;
  /** Replace the outgoing audio track in all peer connections (avatar voice injection) */
  replaceAudioTrack: (track: MediaStreamTrack | null) => Promise<void>;
  /** Publish the user's current mask identity so everyone (sidebar + tiles) shows it. */
  updateMaskIdentity: (mask: { name: string; avatarUrl?: string } | null) => void;
  /** True while the avatar's synthesized voice is being transmitted */
  isAvatarSpeaking: boolean;
  // DM calling
  isDmCall: boolean;
  dmCallPartnerId: string | null;
  /** 'ringing' = waiting for partner to join; 'connected' = both in call */
  dmCallStatus: 'ringing' | 'connected' | null;
  startDmCall: (partnerUid: string) => Promise<void>;
}

const DEFAULT_SETTINGS: VoiceSettings = {
  mode: 'vad', pttKey: 'KeyV', vadThreshold: 8, inputDeviceId: '', outputDeviceId: '',
};

const VoiceCtx = createContext<VoiceContextValue>({
  participants: [],
  localStream: null,
  isMuted: false,
  isDeafened: false,
  isConnected: false,
  localSpeaking: false,
  micError: null,
  needsInteraction: false,
  clearNeedsInteraction: () => {},
  voiceSettings: DEFAULT_SETTINGS,
  updateVoiceSettings: () => {},
  audioInputs: [],
  audioOutputs: [],
  refreshDevices: async () => {},
  toggleMute: () => {},
  toggleDeafen: () => {},
  hangUp: () => {},
  updateInputDevice: async () => {},
  replaceAudioTrack: async () => {},
  updateMaskIdentity: () => {},
  isAvatarSpeaking: false,
  isDmCall: false,
  dmCallPartnerId: null,
  dmCallStatus: null,
  startDmCall: async () => {},
});

export const useVoiceCtx = () => useContext(VoiceCtx);

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { firebaseUser } = useAuth();
  const userId = firebaseUser?.uid ?? null;
  const {
    voiceGuildId, voiceChannelId, setVoiceChannel, setActiveChannel,
    dmCallPartnerId, setDmCallPartner,
  } = useAppStore();

  const [micError, setMicError]             = useState<string | null>(null);
  const [localSpeaking, setLocalSpeaking]   = useState(false);
  const [needsInteraction, setNeedsInteraction] = useState(false);
  const [incomingCall, setIncomingCall]     = useState<{ callerId: string; callId: string } | null>(null);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);

  const { settings, updateSettings, refreshDevices, inputs, outputs } = useVoiceSettings();

  const {
    participants, localStream, isMuted, isDeafened, isConnected,
    join, leave, toggleMute, toggleDeafen, updateInputDevice, replaceAudioTrack,
    updateSpeakingState, updateMaskIdentity, reconnectPeers,
  } = useVoiceChannel(voiceGuildId, voiceChannelId, userId);

  useMaskyVoice({
    uid:                   userId,
    isConnected,
    isMuted,
    localStream,
    replaceAudioTrack,
    onAvatarSpeakingChange: setIsAvatarSpeaking,
  });

  const isDmCall = voiceGuildId === '__dm__';

  // Derived: 'ringing' until partner joins, then 'connected'
  const dmCallStatus: 'ringing' | 'connected' | null = isDmCall && dmCallPartnerId
    ? (participants.some((p) => p.userId === dmCallPartnerId) ? 'connected' : 'ringing')
    : null;

  // Stable refs so RAF/event-handler closures read current values without re-subscribing
  const isMutedRef      = useRef(isMuted);
  const vadThresholdRef = useRef(settings.vadThreshold);
  const pttKeyRef       = useRef(settings.pttKey);
  useEffect(() => { isMutedRef.current     = isMuted;              }, [isMuted]);
  useEffect(() => { vadThresholdRef.current = settings.vadThreshold; }, [settings.vadThreshold]);
  useEffect(() => { pttKeyRef.current       = settings.pttKey;      }, [settings.pttKey]);

  // ─── Join / leave ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!voiceChannelId || !userId) return;
    setMicError(null);
    setNeedsInteraction(false);
    join({ deviceId: settings.inputDeviceId || undefined })
      .then(async () => {
        playJoinSound();
        await refreshDevices();
      })
      .catch((err: Error) => {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setMicError('Microphone access denied. Please allow microphone access and try again.');
        } else {
          setMicError(`Could not access microphone: ${err.message}`);
        }
        setVoiceChannel(null, null);
        setDmCallPartner(null);
      });
    return () => { leave(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceChannelId, userId]);

  // ─── VAD — Voice Activity Detection ─────────────────────────────────────────

  useEffect(() => {
    if (!localStream || !isConnected || settings.mode !== 'vad') return;

    let audioCtx: AudioContext | null = null;
    let monitorTrack: MediaStreamTrack | null = null;
    let rafId = 0;
    let destroyed = false;

    const sendTrack = localStream.getAudioTracks()[0];
    if (!sendTrack) return;

    if (!isMutedRef.current) sendTrack.enabled = true;

    try {
      monitorTrack = sendTrack.clone();
      const monitorStream = new MediaStream([monitorTrack]);
      audioCtx = new AudioContext();
      audioCtx.resume().catch(() => {});

      const source   = audioCtx.createMediaStreamSource(monitorStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const SILENCE_HOLD = 20;
      let silenceFrames = 0;

      function tick() {
        if (destroyed) return;
        if (audioCtx!.state === 'running') {
          analyser.getByteTimeDomainData(data);
          const rms   = Math.sqrt(data.reduce((s, v) => s + (v - 128) ** 2, 0) / data.length);
          const level = Math.min(100, (rms / 128) * 500);

          if (level >= vadThresholdRef.current) {
            silenceFrames = 0;
            if (!isMutedRef.current) { sendTrack.enabled = true; setLocalSpeaking(true); }
          } else {
            silenceFrames++;
            if (silenceFrames >= SILENCE_HOLD) { sendTrack.enabled = false; setLocalSpeaking(false); }
          }
        }
        rafId = requestAnimationFrame(tick);
      }

      rafId = requestAnimationFrame(tick);
    } catch (e) {
      console.warn('[voice] VAD setup failed:', e);
    }

    return () => {
      destroyed = true;
      cancelAnimationFrame(rafId);
      audioCtx?.close();
      monitorTrack?.stop();
      setLocalSpeaking(false);
    };
  }, [localStream, isConnected, settings.mode]);

  // ─── PTT — Push to Talk ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!localStream || !isConnected || settings.mode !== 'ptt') return;

    localStream.getAudioTracks().forEach((t) => { t.enabled = false; });
    setLocalSpeaking(false);

    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== pttKeyRef.current || e.repeat || isMutedRef.current) return;
      localStream!.getAudioTracks().forEach((t) => { t.enabled = true; });
      setLocalSpeaking(true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== pttKeyRef.current) return;
      localStream!.getAudioTracks().forEach((t) => { t.enabled = false; });
      setLocalSpeaking(false);
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      setLocalSpeaking(false);
    };
  }, [localStream, isConnected, settings.mode]);

  // ─── Sync speaking state to RTDB (skip when alone — no one to notify) ────────

  useEffect(() => {
    const hasOthers = participants.some((p) => p.userId !== userId);
    if (!hasOthers) return;
    updateSpeakingState(localSpeaking);
  }, [localSpeaking, updateSpeakingState, participants, userId]);

  // ─── Reconnect on mic activation (skip when alone) ───────────────────────────

  const prevSpeakingRef = useRef(false);
  useEffect(() => {
    if (localSpeaking && !prevSpeakingRef.current) {
      const hasOthers = participants.some((p) => p.userId !== userId);
      if (hasOthers) reconnectPeers();
    }
    prevSpeakingRef.current = localSpeaking;
  }, [localSpeaking, reconnectPeers, participants, userId]);

  // ─── Manual mute override ────────────────────────────────────────────────────

  useEffect(() => {
    if (!localStream) return;
    if (isMuted) {
      localStream.getAudioTracks().forEach((t) => { t.enabled = false; });
      setLocalSpeaking(false);
    }
  }, [isMuted, localStream, settings.mode]);

  // ─── DM call: 30-second ring timeout ─────────────────────────────────────────

  useEffect(() => {
    if (!isDmCall || !dmCallPartnerId || dmCallStatus !== 'ringing') return;
    const capturedPartnerId = dmCallPartnerId;
    const capturedUserId    = userId;
    const timer = setTimeout(() => {
      if (capturedUserId && capturedPartnerId) {
        const rtdb   = getFirebaseRtdb();
        const callId = mkDmChannelId(capturedUserId, capturedPartnerId);
        rtdbRemove(rtdbRef(rtdb, `dmRing/${capturedPartnerId}/${callId}`)).catch(() => {});
      }
      setVoiceChannel(null, null);
      setDmCallPartner(null);
    }, 30_000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDmCall, dmCallPartnerId, dmCallStatus]);

  // ─── Listen for incoming DM ring notifications ───────────────────────────────

  useEffect(() => {
    if (!userId) return;
    const rtdb  = getFirebaseRtdb();
    const unsub = onChildAdded(rtdbRef(rtdb, `dmRing/${userId}`), (snap) => {
      const val = snap.val() as { callerId: string; ts: number } | null;
      if (!val) return;
      // Ignore stale rings from previous sessions (older than 60 s)
      if (Date.now() - val.ts > 60_000) { rtdbRemove(snap.ref).catch(() => {}); return; }
      // Ignore if already in a call with this person
      if (isDmCall && dmCallPartnerId === val.callerId) { rtdbRemove(snap.ref).catch(() => {}); return; }
      setIncomingCall({ callerId: val.callerId, callId: snap.key! });
    });
    return () => unsub();
  // Only re-subscribe when userId changes — stale isDmCall/dmCallPartnerId is fine
  // because we do the freshness check with Date.now()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ─── Watch for decline response on outgoing DM call ──────────────────────────

  useEffect(() => {
    if (!userId || !isDmCall || !dmCallPartnerId) return;
    const rtdb        = getFirebaseRtdb();
    const callId      = mkDmChannelId(userId, dmCallPartnerId);
    const responseRef = rtdbRef(rtdb, `dmRingResponse/${userId}/${callId}`);
    const unsub       = onValue(responseRef, (snap) => {
      if (snap.val() === 'declined') {
        rtdbRemove(responseRef).catch(() => {});
        setVoiceChannel(null, null);
        setDmCallPartner(null);
      }
    });
    return () => unsub();
  }, [userId, isDmCall, dmCallPartnerId]);

  // ─── DM call actions ─────────────────────────────────────────────────────────

  const startDmCall = useCallback(async (partnerUid: string) => {
    if (!userId) return;
    const callId = mkDmChannelId(userId, partnerUid);
    // setVoiceChannel triggers join (which leaves any current guild channel first)
    setVoiceChannel('__dm__', callId);
    setDmCallPartner(partnerUid);
    // Notify callee
    const rtdb = getFirebaseRtdb();
    await rtdbSet(rtdbRef(rtdb, `dmRing/${partnerUid}/${callId}`), {
      callerId: userId,
      ts: Date.now(),
    });
  }, [userId, setVoiceChannel, setDmCallPartner]);

  function acceptIncomingCall() {
    if (!incomingCall || !userId) return;
    const { callerId, callId } = incomingCall;
    const rtdb = getFirebaseRtdb();
    rtdbRemove(rtdbRef(rtdb, `dmRing/${userId}/${callId}`)).catch(() => {});
    setIncomingCall(null);
    // Join voice channel — leaving any current channel is handled by the join/leave effect
    setVoiceChannel('__dm__', callId);
    setDmCallPartner(callerId);
  }

  function declineIncomingCall() {
    if (!incomingCall || !userId) return;
    const { callerId, callId } = incomingCall;
    const rtdb = getFirebaseRtdb();
    rtdbRemove(rtdbRef(rtdb, `dmRing/${userId}/${callId}`)).catch(() => {});
    rtdbSet(rtdbRef(rtdb, `dmRingResponse/${callerId}/${callId}`), 'declined').catch(() => {});
    setIncomingCall(null);
  }

  function hangUp() {
    if (isDmCall) {
      if (userId && dmCallPartnerId) {
        const rtdb   = getFirebaseRtdb();
        const callId = mkDmChannelId(userId, dmCallPartnerId);
        rtdbRemove(rtdbRef(rtdb, `dmRing/${dmCallPartnerId}/${callId}`)).catch(() => {});
        rtdbRemove(rtdbRef(rtdb, `dmRingResponse/${userId}/${callId}`)).catch(() => {});
      }
      setVoiceChannel(null, null);
      setDmCallPartner(null);
    } else {
      setVoiceChannel(null, null);
      setActiveChannel(null, null);
    }
  }

  return (
    <VoiceCtx.Provider value={{
      participants,
      localStream,
      isMuted,
      isDeafened,
      isConnected,
      localSpeaking,
      micError,
      needsInteraction,
      clearNeedsInteraction: () => setNeedsInteraction(false),
      voiceSettings: settings,
      updateVoiceSettings: updateSettings,
      audioInputs: inputs,
      audioOutputs: outputs,
      refreshDevices,
      toggleMute,
      toggleDeafen,
      hangUp,
      updateInputDevice,
      replaceAudioTrack,
      updateMaskIdentity,
      isAvatarSpeaking,
      isDmCall,
      dmCallPartnerId,
      dmCallStatus,
      startDmCall,
    }}>
      {children}

      {/* ── Persistent audio elements ───────────────────────────────────────────
          Rendered here (outside VoiceChannel) so they survive switching to text
          channels. VoiceChannel no longer renders <audio> elements directly.   */}
      {participants
        .filter((p) => p.userId !== userId && p.stream)
        .map((p) => (
          <PersistentAudio
            key={p.userId}
            stream={p.stream!}
            outputDeviceId={settings.outputDeviceId}
            onNeedsInteraction={() => setNeedsInteraction(true)}
          />
        ))}

      {/* ── Incoming DM call notification ──────────────────────────────────── */}
      {incomingCall && (
        <IncomingCallBanner
          callerId={incomingCall.callerId}
          onAccept={acceptIncomingCall}
          onDecline={declineIncomingCall}
        />
      )}

      {/* ── Floating DM call bar (visible regardless of active view) ───────── */}
      {isDmCall && dmCallPartnerId && (
        <DmCallBar
          partnerId={dmCallPartnerId}
          status={dmCallStatus}
          isMuted={isMuted}
          needsInteraction={needsInteraction}
          onToggleMute={toggleMute}
          onHangUp={hangUp}
          onClearNeedsInteraction={() => setNeedsInteraction(false)}
        />
      )}
    </VoiceCtx.Provider>
  );
}

// ─── Persistent audio element ─────────────────────────────────────────────────
// Renders a hidden <audio> for one remote participant. Stays mounted as long as
// VoiceProvider is mounted (i.e. forever), so audio continues during tab switches.

function PersistentAudio({
  stream,
  outputDeviceId,
  onNeedsInteraction,
}: {
  stream: MediaStream;
  outputDeviceId: string;
  onNeedsInteraction: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current as
      (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!audio) return;
    audio.srcObject = stream;
    const play = async () => {
      if (outputDeviceId && audio.setSinkId) {
        await audio.setSinkId(outputDeviceId).catch(() => {});
      }
      if (audio.paused) {
        await audio.play().catch(() => { onNeedsInteraction(); });
      }
    };
    play();
  }, [stream, outputDeviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <audio ref={audioRef} autoPlay playsInline data-voice className="hidden" aria-hidden />;
}

// ─── Incoming call banner ─────────────────────────────────────────────────────

function IncomingCallBanner({
  callerId,
  onAccept,
  onDecline,
}: {
  callerId: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const profiles  = useUserProfiles([callerId]);
  const p         = profiles[callerId];
  const name      = p?.displayName ?? p?.twitchUsername ?? '…';
  const avatar    = p?.avatarUrl;
  const initials  = name.substring(0, 2).toUpperCase();

  return (
    <div className="fixed bottom-6 right-6 z-50 w-72 bg-[#12121f] border border-[#2a2a3e] rounded-2xl shadow-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-violet-600/30 overflow-hidden flex items-center justify-center">
            {avatar
              ? <img src={avatar} alt={name} className="w-full h-full object-cover" />
              : <span className="text-sm font-bold text-violet-300">{initials}</span>
            }
          </div>
          {/* Pulsing ring to indicate incoming call */}
          <span className="absolute inset-0 rounded-full animate-ping bg-green-500/30" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[#6b7280] font-medium uppercase tracking-wide">Incoming call</p>
          <p className="text-sm font-semibold text-white truncate">{name}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onDecline}
          className="flex-1 py-2 rounded-xl bg-red-700/80 hover:bg-red-600 text-white text-sm font-semibold transition-colors"
        >
          Decline
        </button>
        <button
          onClick={onAccept}
          className="flex-1 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-semibold transition-colors"
        >
          Accept
        </button>
      </div>
    </div>
  );
}

// ─── DM call floating bar ─────────────────────────────────────────────────────

function DmCallBar({
  partnerId,
  status,
  isMuted,
  needsInteraction,
  onToggleMute,
  onHangUp,
  onClearNeedsInteraction,
}: {
  partnerId: string;
  status: 'ringing' | 'connected' | null;
  isMuted: boolean;
  needsInteraction: boolean;
  onToggleMute: () => void;
  onHangUp: () => void;
  onClearNeedsInteraction: () => void;
}) {
  const profiles  = useUserProfiles([partnerId]);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (status !== 'connected') { setElapsed(0); return; }
    const iv = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(iv);
  }, [status]);

  const p       = profiles[partnerId];
  const name    = p?.displayName ?? p?.twitchUsername ?? '…';
  const avatar  = p?.avatarUrl;
  const initials = name.substring(0, 2).toUpperCase();

  const subtitle =
    status === 'connected'
      ? `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}`
      : 'Calling…';

  return (
    <div className="fixed bottom-6 left-6 z-40 flex flex-col gap-1.5">
      {needsInteraction && (
        <button
          onClick={() => {
            document.querySelectorAll<HTMLAudioElement>('audio[data-voice]')
              .forEach((a) => a.play().catch(() => {}));
            onClearNeedsInteraction();
          }}
          className="px-3 py-2 bg-violet-900/90 border border-violet-600/60 rounded-xl text-violet-200 text-xs font-medium hover:bg-violet-900 transition-colors flex items-center gap-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
          </svg>
          Click to enable audio
        </button>
      )}

      <div className="bg-[#12121f] border border-[#2a2a3e] rounded-2xl shadow-xl px-4 py-3 flex items-center gap-3 min-w-[220px]">
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-violet-600/30 overflow-hidden flex items-center justify-center flex-shrink-0">
          {avatar
            ? <img src={avatar} alt={name} className="w-full h-full object-cover" />
            : <span className="text-[10px] font-bold text-violet-300">{initials}</span>
          }
        </div>

        {/* Name + status */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white truncate">{name}</p>
          <p className="text-[10px] text-[#6b7280]">{subtitle}</p>
        </div>

        {/* Mute */}
        <button
          onClick={onToggleMute}
          title={isMuted ? 'Unmute' : 'Mute'}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ${
            isMuted ? 'bg-red-700 hover:bg-red-600' : 'bg-[#1e1e2e] hover:bg-[#2a2a3e]'
          }`}
        >
          {isMuted ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" />
            </svg>
          )}
        </button>

        {/* Hang up */}
        <button
          onClick={onHangUp}
          title="End call"
          className="w-8 h-8 rounded-full bg-red-700 hover:bg-red-600 flex items-center justify-center transition-colors flex-shrink-0"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08C.11 12.9 0 12.65 0 12.38c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Join sound ───────────────────────────────────────────────────────────────

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
