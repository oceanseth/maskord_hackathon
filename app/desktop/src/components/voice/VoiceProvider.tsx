import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth, useVoiceChannel } from '@maskord/shared';
import type { VoiceParticipant } from '@maskord/shared';
import { useAppStore } from '../../store/app';
import { useVoiceSettings } from '../../hooks/useVoiceSettings';
import type { VoiceSettings, AudioDevice } from '../../hooks/useVoiceSettings';

export interface VoiceContextValue {
  participants: VoiceParticipant[];
  localStream: MediaStream | null;
  isMuted: boolean;
  isDeafened: boolean;
  isConnected: boolean;
  /** True when local audio is actively being transmitted (VAD detected / PTT held) */
  localSpeaking: boolean;
  micError: string | null;
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
}

const VoiceCtx = createContext<VoiceContextValue>({
  participants: [],
  localStream: null,
  isMuted: false,
  isDeafened: false,
  isConnected: false,
  localSpeaking: false,
  micError: null,
  voiceSettings: { mode: 'vad', pttKey: 'KeyV', vadThreshold: 8, inputDeviceId: '', outputDeviceId: '' },
  updateVoiceSettings: () => {},
  audioInputs: [],
  audioOutputs: [],
  refreshDevices: async () => {},
  toggleMute: () => {},
  toggleDeafen: () => {},
  hangUp: () => {},
  updateInputDevice: async () => {},
});

export const useVoiceCtx = () => useContext(VoiceCtx);

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { firebaseUser } = useAuth();
  const userId = firebaseUser?.uid ?? null;
  const { voiceGuildId, voiceChannelId, setVoiceChannel, setActiveChannel } = useAppStore();

  const [micError, setMicError] = useState<string | null>(null);
  const [localSpeaking, setLocalSpeaking] = useState(false);

  const { settings, updateSettings, refreshDevices, inputs, outputs } = useVoiceSettings();

  const {
    participants, localStream, isMuted, isDeafened, isConnected,
    join, leave, toggleMute, toggleDeafen, updateInputDevice, updateSpeakingState,
    reconnectPeers,
  } = useVoiceChannel(voiceGuildId, voiceChannelId, userId);

  // Stable refs so RAF/event-handler closures read current values without re-subscribing
  const isMutedRef = useRef(isMuted);
  const vadThresholdRef = useRef(settings.vadThreshold);
  const pttKeyRef = useRef(settings.pttKey);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { vadThresholdRef.current = settings.vadThreshold; }, [settings.vadThreshold]);
  useEffect(() => { pttKeyRef.current = settings.pttKey; }, [settings.pttKey]);

  // ─── Join / leave ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!voiceChannelId || !userId) return;
    setMicError(null);
    join({ deviceId: settings.inputDeviceId || undefined })
      .then(async () => {
        playJoinSound();
        await refreshDevices(); // enumerate devices once we have mic permission
      })
      .catch((err: Error) => {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setMicError('Microphone access denied. Please allow microphone access and try again.');
        } else {
          setMicError(`Could not access microphone: ${err.message}`);
        }
        setVoiceChannel(null, null);
      });
    return () => { leave(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceChannelId, userId]);

  // ─── VAD — Voice Activity Detection ─────────────────────────────────────────
  // Runs only in 'vad' mode. Monitors RMS of local mic and auto-enables/disables
  // the audio track. Uses refs for threshold + mute so the RAF loop never needs
  // to be torn down just because a setting slider moved.
  //
  // Key design choices:
  //  1. We clone the send track for the analyser so its .enabled state is
  //     independent — the analyser always sees real mic audio even while the
  //     send track is gated silent between words.
  //  2. We await audioCtx.resume() because contexts created outside a direct
  //     user-gesture start in "suspended" state, causing getByteTimeDomainData
  //     to return all-128 silence and the threshold to never be met.

  useEffect(() => {
    if (!localStream || !isConnected || settings.mode !== 'vad') return;

    let audioCtx: AudioContext | null = null;
    let monitorTrack: MediaStreamTrack | null = null;
    let rafId = 0;
    let destroyed = false;

    const sendTrack = localStream.getAudioTracks()[0];
    if (!sendTrack) return;

    // Enable send track at VAD start (may have been disabled by PTT mode)
    if (!isMutedRef.current) sendTrack.enabled = true;

    try {
      // Clone so the analyser reads raw mic audio regardless of sendTrack.enabled
      monitorTrack = sendTrack.clone();
      const monitorStream = new MediaStream([monitorTrack]);

      audioCtx = new AudioContext();
      // Request resume but don't await — on auto-join there may be no user gesture
      // yet and the promise would hang indefinitely. The tick loop checks
      // audioCtx.state each frame and skips the silence/disable logic while
      // suspended, keeping the send track enabled until the context is running.
      audioCtx.resume().catch(() => {});

      const source = audioCtx.createMediaStreamSource(monitorStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      // Hold silence for ~333 ms (≈20 frames at 60 fps) before cutting the track
      const SILENCE_HOLD = 20;
      let silenceFrames = 0;

      function tick() {
        if (destroyed) return;

        // While AudioContext is suspended (waiting for user gesture to resume),
        // skip VAD gating so the send track stays enabled and audio flows.
        if (audioCtx!.state === 'running') {
          analyser.getByteTimeDomainData(data);
          // RMS of unsigned 8-bit waveform — silence sits at 128
          const rms = Math.sqrt(data.reduce((s, v) => s + (v - 128) ** 2, 0) / data.length);
          // Normalize to 0–100 with a small amplifier so normal speech hits ~20–40
          const level = Math.min(100, (rms / 128) * 500);

          if (level >= vadThresholdRef.current) {
            silenceFrames = 0;
            if (!isMutedRef.current) {
              sendTrack.enabled = true;
              setLocalSpeaking(true);
            }
          } else {
            silenceFrames++;
            if (silenceFrames >= SILENCE_HOLD) {
              sendTrack.enabled = false;
              setLocalSpeaking(false);
            }
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
  // Disables the mic track by default. The configured key temporarily enables it.

  useEffect(() => {
    if (!localStream || !isConnected || settings.mode !== 'ptt') return;

    // Start silent
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

  // ─── Sync speaking state to RTDB for sidebar indicators ─────────────────────
  // Only fires on transitions (not every VAD frame), so RTDB write frequency is low.

  useEffect(() => {
    updateSpeakingState(localSpeaking);
  }, [localSpeaking, updateSpeakingState]);

  // ─── Reconnect on mic activation ─────────────────────────────────────────────
  // On the rising edge of speaking (VAD detects voice or PTT key pressed),
  // check all channel peers and repair any broken connections before audio arrives.

  const prevSpeakingRef = useRef(false);
  useEffect(() => {
    if (localSpeaking && !prevSpeakingRef.current) {
      reconnectPeers();
    }
    prevSpeakingRef.current = localSpeaking;
  }, [localSpeaking, reconnectPeers]);

  // ─── Manual mute override ────────────────────────────────────────────────────
  // When the user hits mute, immediately silence the track regardless of VAD/PTT.

  useEffect(() => {
    if (!localStream) return;
    if (isMuted) {
      localStream.getAudioTracks().forEach((t) => { t.enabled = false; });
      setLocalSpeaking(false);
    } else if (settings.mode === 'vad') {
      // VAD will re-enable on next voice detection — nothing to do
    } else if (settings.mode === 'ptt') {
      // PTT only enables on keydown — nothing to do
    }
  }, [isMuted, localStream, settings.mode]);

  function hangUp() {
    setVoiceChannel(null, null);
    setActiveChannel(null, null);
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
      voiceSettings: settings,
      updateVoiceSettings: updateSettings,
      audioInputs: inputs,
      audioOutputs: outputs,
      refreshDevices,
      toggleMute,
      toggleDeafen,
      hangUp,
      updateInputDevice,
    }}>
      {children}
    </VoiceCtx.Provider>
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
