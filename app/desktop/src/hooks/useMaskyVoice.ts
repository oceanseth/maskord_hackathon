import { useState, useEffect, useRef, useCallback } from 'react';
import { getAuth } from 'firebase/auth';
import { loadSelectedAvatarId } from './useMaskyAvatars';
import type { MaskyAvatarGroup } from './useMaskyAvatars';
import { collection, onSnapshot } from 'firebase/firestore';
import { getFirebaseDb } from '@maskord/shared';

const MASKY_API = 'https://masky.ai';

// ─── SpeechRecognition type shim ─────────────────────────────────────────────
// The Web Speech API is not consistently typed across all TS versions.
// We use a minimal interface to avoid lib.dom.d.ts version differences.

interface SpeechRecog extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecog) | null {
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecog;
    webkitSpeechRecognition?: new () => SpeechRecog;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface SpeechRecogResult {
  readonly isFinal: boolean;
  readonly [index: number]: { transcript: string };
  readonly length: number;
}
interface SpeechRecogResultList {
  readonly length: number;
  readonly [index: number]: SpeechRecogResult;
}
interface SpeechRecogEvent {
  readonly results: SpeechRecogResultList;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Masky avatar voice pipeline.
 *
 * When the user has an avatar selected (with a Hume voice ID) and is connected
 * to a voice channel, this hook:
 *   1. Listens for the user's speech via the Web Speech API
 *   2. On a final transcript, POSTs it to masky.ai/api/maskord/speak
 *   3. Decodes the returned MP3 and routes it through an AudioContext
 *   4. Calls replaceAudioTrack() to inject the avatar's voice into WebRTC
 *   5. Restores the original mic track after playback
 */
export function useMaskyVoice({
  uid,
  isConnected,
  localStream,
  replaceAudioTrack,
  onAvatarSpeakingChange,
}: {
  uid: string | null;
  isConnected: boolean;
  localStream: MediaStream | null;
  replaceAudioTrack: (track: MediaStreamTrack | null) => Promise<void>;
  onAvatarSpeakingChange: (speaking: boolean) => void;
}) {
  const [selectedGroup, setSelectedGroup] = useState<MaskyAvatarGroup | null>(null);

  // Ref so event callbacks always see the latest value without re-subscribing
  const selectedGroupRef = useRef<MaskyAvatarGroup | null>(null);
  useEffect(() => { selectedGroupRef.current = selectedGroup; }, [selectedGroup]);

  const originalTrackRef    = useRef<MediaStreamTrack | null>(null);
  const recognitionRef      = useRef<SpeechRecog | null>(null);
  const processingRef       = useRef(false); // prevent overlapping requests
  const mountedRef          = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Keep original track ref fresh
  useEffect(() => {
    if (localStream) {
      originalTrackRef.current = localStream.getAudioTracks()[0] ?? null;
    }
  }, [localStream]);

  // ── Subscribe to the user's avatar groups from Firestore ──────────────────
  // Lightweight version: only needs selectedId + the groups already cached by
  // useMaskyAvatars.  We re-resolve from Firestore here so VoiceProvider can
  // stay self-contained (doesn't need to receive avatarGroups as a prop).

  useEffect(() => {
    if (!uid) { setSelectedGroup(null); return; }

    const selectedId = loadSelectedAvatarId(uid);
    if (!selectedId) { setSelectedGroup(null); return; }

    const db = getFirebaseDb();
    const groupsRef = collection(db, 'users', uid, 'heygenAvatarGroups');

    const unsub = onSnapshot(groupsRef, (snap) => {
      const doc = snap.docs.find((d) => d.id === selectedId);
      if (!doc) { setSelectedGroup(null); return; }
      const data = doc.data();
      setSelectedGroup({
        id:                doc.id,
        displayName:       data.displayName || 'Avatar',
        personalityPrompt: data.personalityPrompt,
        humeVoiceId:       data.humeVoiceId,
        thumbnailUrl:      data.cachedAvatarUrl || data.heygenAvatarUrl || '',
      });
    }, () => setSelectedGroup(null));

    return unsub;
  }, [uid]);

  // ── Start / stop speech recognition ───────────────────────────────────────

  const startRecognition = useCallback(() => {
    const SpeechRecognitionImpl = getSpeechRecognitionCtor();
    if (!SpeechRecognitionImpl) return;
    if (recognitionRef.current) return; // already running

    const rec = new SpeechRecognitionImpl();
    rec.continuous      = true;
    rec.interimResults  = false;
    rec.lang            = 'en-US';
    rec.maxAlternatives = 1;

    rec.onresult = (e: Event) => {
      const e2 = e as unknown as SpeechRecogEvent;
      const result = e2.results[e2.results.length - 1];
      if (!result.isFinal) return;
      const transcript = result[0].transcript.trim();
      if (!transcript || processingRef.current) return;
      const group = selectedGroupRef.current;
      if (!group?.humeVoiceId || !uid) return;
      void speakAsAvatar(transcript, group, uid);
    };

    rec.onerror = () => {
      recognitionRef.current = null;
    };

    rec.onend = () => {
      // Auto-restart unless we intentionally cleared the ref
      if (recognitionRef.current === rec && mountedRef.current) {
        recognitionRef.current = null;
        startRecognition();
      }
    };

    recognitionRef.current = rec;
    try { rec.start(); } catch { recognitionRef.current = null; }
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    recognitionRef.current = null; // clear first so onend doesn't restart
    try { rec?.stop(); } catch { /* ignore */ }
  }, []);

  // Start recognition when avatar with voice is active + connected
  useEffect(() => {
    const hasVoice = !!selectedGroup?.humeVoiceId;
    if (hasVoice && isConnected) {
      startRecognition();
    } else {
      stopRecognition();
    }
    return stopRecognition;
  }, [selectedGroup?.humeVoiceId, isConnected, startRecognition, stopRecognition]);

  // ── Speak as avatar ────────────────────────────────────────────────────────

  async function speakAsAvatar(
    transcript: string,
    group: MaskyAvatarGroup,
    forUid: string,
  ) {
    if (processingRef.current) return;
    processingRef.current = true;
    onAvatarSpeakingChange(true);

    const origTrack = originalTrackRef.current;

    try {
      // Get Firebase ID token
      const auth = getAuth();
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      // Stop STT while we play back to avoid feedback
      stopRecognition();

      // Mute mic so it doesn't bleed through
      if (origTrack) origTrack.enabled = false;

      const response = await fetch(`${MASKY_API}/api/maskord/speak`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ avatarGroupId: group.id, text: transcript }),
      });

      if (!response.ok) {
        console.warn('[masky-voice] speak API error', response.status);
        return;
      }

      const audioBuffer = await response.arrayBuffer();
      if (!mountedRef.current) return;

      // Decode MP3 → play via AudioContext → inject into WebRTC
      const audioCtx = new AudioContext();
      const decoded  = await audioCtx.decodeAudioData(audioBuffer);
      const dest     = audioCtx.createMediaStreamDestination();
      const source   = audioCtx.createBufferSource();
      source.buffer  = decoded;
      source.connect(dest);
      source.connect(audioCtx.destination); // optional: local monitor (commented out below)

      const avatarTrack = dest.stream.getAudioTracks()[0];
      await replaceAudioTrack(avatarTrack);

      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start(0);
      });

      await audioCtx.close();
    } catch (err) {
      console.warn('[masky-voice] Error:', err);
    } finally {
      if (!mountedRef.current) return;

      // Restore original mic track
      const origTrack = originalTrackRef.current;
      if (origTrack) {
        origTrack.enabled = !false; // re-enable (VAD will gate it again)
        await replaceAudioTrack(origTrack);
        origTrack.enabled = true;
      }

      processingRef.current = false;
      onAvatarSpeakingChange(false);

      // Restart STT
      if (selectedGroupRef.current?.humeVoiceId && isConnected) {
        startRecognition();
      }
    }
  }

  return {
    selectedGroup,
    isAvatarActive: !!selectedGroup?.humeVoiceId,
  };
}
