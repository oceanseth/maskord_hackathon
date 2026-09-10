import { useState, useEffect, useRef, useCallback } from 'react';
import { getAuth } from 'firebase/auth';
import { loadSelectedAvatarId, loadUseAvatarPersonality, loadUseAvatarVoice } from './useMaskyAvatars';
import type { MaskyAvatarGroup } from './useMaskyAvatars';
import { collection, onSnapshot, doc, getDoc } from 'firebase/firestore';
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
  isMuted,
  localStream,
  replaceAudioTrack,
  onAvatarSpeakingChange,
}: {
  uid: string | null;
  isConnected: boolean;
  isMuted: boolean;
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
  // Cache of masky conversations per avatar (for the personality/reinterpret path).
  const convCacheRef        = useRef<Record<string, { conversationId: string; viewerToken: string }>>({});

  const isMutedRef = useRef(isMuted);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // Reactive voicing mode from the persisted toggles (updated live when the
  // Avatar Settings modal dispatches `maskord-voice-settings-changed`).
  const [voiceMode, setVoiceMode] = useState<'off' | 'voice' | 'personality'>('off');
  const voiceModeRef = useRef(voiceMode);
  useEffect(() => { voiceModeRef.current = voiceMode; }, [voiceMode]);
  useEffect(() => {
    const read = () => {
      if (!uid) return setVoiceMode('off');
      setVoiceMode(
        loadUseAvatarPersonality(uid) ? 'personality'
        : loadUseAvatarVoice(uid)     ? 'voice'
        : 'off',
      );
    };
    read();
    window.addEventListener('maskord-voice-settings-changed', read);
    return () => window.removeEventListener('maskord-voice-settings-changed', read);
  }, [uid]);

  // Avatar mode is active when a voiced mask is selected, a mode is on, we're
  // connected, and not manually muted.
  const avatarMode = voiceMode !== 'off' && !!selectedGroup?.humeVoiceId && isConnected && !isMuted;

  // While in avatar mode, keep the REAL mic silent for transmission so peers hear
  // ONLY the rendered avatar audio — never the user's own voice. (STT is driven
  // by the Web Speech API, which reads the mic independently of this flag.)
  useEffect(() => {
    const track = originalTrackRef.current;
    if (!track) return;
    if (avatarMode) track.enabled = false;
    else if (!processingRef.current) track.enabled = !isMuted; // respect manual mute
  }, [avatarMode, isMuted, localStream]);

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
    const groupsRef = collection(db, 'users', uid, 'avatarGroups');

    const unsub = onSnapshot(groupsRef, (snap) => {
      const doc = snap.docs.find((d) => d.id === selectedId);
      if (!doc) { setSelectedGroup(null); return; }
      const data = doc.data();
      setSelectedGroup({
        id:                doc.id,
        displayName:       data.displayName || 'Avatar',
        personalityPrompt: data.personalityPrompt,
        humeVoiceId:       data.humeVoiceId,
        thumbnailUrl:      data.cachedAvatarUrl || data.avatarUrl || '',
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

  // Run STT only when avatar mode is active (a voiced mask + a mode on + not
  // muted). When it's off we don't transcribe or replace anything.
  useEffect(() => {
    if (avatarMode) startRecognition();
    else            stopRecognition();
    return stopRecognition;
  }, [avatarMode, startRecognition, stopRecognition]);

  // ── Reinterpret-with-personality path (masky conversation turn) ──────────────

  /** Lazily create + cache a masky conversation for the user's own mask. */
  async function ensureConversation(
    token: string, avatarId: string,
  ): Promise<{ conversationId: string; viewerToken: string } | null> {
    const cached = convCacheRef.current[avatarId];
    if (cached) return cached;
    try {
      const res = await fetch(`${MASKY_API}/api/conversations`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ avatarOwnerUserId: uid, avatarId }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.conversationId || !data?.viewerToken) return null;
      const conv = { conversationId: data.conversationId as string, viewerToken: data.viewerToken as string };
      convCacheRef.current[avatarId] = conv;
      return conv;
    } catch { return null; }
  }

  /**
   * Speak the line through the mask's personality: inject a speak+reinterpret
   * turn (Gemini rewrites it in the avatar's persona, then Hume TTS), wait for
   * the audio to land, and return the MP3 bytes to inject into the call.
   */
  async function reinterpretViaConversation(
    token: string, avatarId: string, text: string,
  ): Promise<ArrayBuffer | null> {
    const conv = await ensureConversation(token, avatarId);
    if (!conv) return null;
    try {
      const res = await fetch(`${MASKY_API}/api/conversations/${conv.conversationId}/turn`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ userText: text, mode: 'speak', reinterpret: true, output: 'audio' }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const turnId: string | undefined = data?.turn?.id
        ?? (typeof data?.firestorePath === 'string' ? data.firestorePath.split('/').pop() : undefined);
      if (!turnId) return null;

      // Poll the turn doc (we own the conversation) until the audio is rendered.
      const turnRef = doc(getFirebaseDb(), 'conversations', conv.conversationId, 'turns', turnId);
      const deadline = Date.now() + 30_000;
      let ready = false;
      while (Date.now() < deadline && mountedRef.current) {
        const d = (await getDoc(turnRef)).data() as { status?: string; audioStoragePath?: string } | undefined;
        if (d?.status === 'error') return null;
        if (d?.audioStoragePath || d?.status === 'audio' || d?.status === 'video' || d?.status === 'ready') { ready = true; break; }
        await new Promise((r) => setTimeout(r, 700));
      }
      if (!ready) return null;

      // Durable, self-re-signing audio URL (public, gated by the viewer token).
      const audioRes = await fetch(`${MASKY_API}/api/live-media/${conv.viewerToken}/${turnId}/audio`);
      if (!audioRes.ok) return null;
      return await audioRes.arrayBuffer();
    } catch { return null; }
  }

  // ── Speak as avatar ────────────────────────────────────────────────────────

  async function speakAsAvatar(
    transcript: string,
    group: MaskyAvatarGroup,
    forUid: string,
  ) {
    if (processingRef.current) return;

    // Which voicing mode? personality (reinterpret) > voice (verbatim) > neither
    // (keep the user's real voice — don't mute or replace anything).
    const personalityOn = loadUseAvatarPersonality(forUid);
    const voiceOn       = loadUseAvatarVoice(forUid);
    if (!personalityOn && !voiceOn) return;

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

      // personality → reinterpret the line through the mask's personality
      // (conversation speak+reinterpret); else verbatim TTS in the mask's voice.
      let audioBuffer: ArrayBuffer | null;
      if (personalityOn) {
        audioBuffer = await reinterpretViaConversation(token, group.id, transcript);
      } else {
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
        audioBuffer = await response.arrayBuffer();
      }

      if (!audioBuffer) { console.warn('[masky-voice] no audio rendered'); return; }
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

      // Swap the outgoing track back to the mic — but keep it SILENT while we're
      // still in avatar mode (peers must never hear the real voice); otherwise
      // respect the user's manual mute.
      const origTrack = originalTrackRef.current;
      if (origTrack) {
        await replaceAudioTrack(origTrack);
        origTrack.enabled = voiceModeRef.current === 'off' ? !isMutedRef.current : false;
      }

      processingRef.current = false;
      onAvatarSpeakingChange(false);

      // Restart STT (only meaningful while avatar mode is on).
      startRecognition();
    }
  }

  return {
    selectedGroup,
    isAvatarActive: !!selectedGroup?.humeVoiceId,
  };
}
