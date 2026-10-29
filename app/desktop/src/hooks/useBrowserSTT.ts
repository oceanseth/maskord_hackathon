import { useEffect, useRef } from 'react';
import { appendTranscriptUtterance } from '@maskord/shared';

interface SpeechRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResult };
}
interface SpeechRecognition extends EventTarget {
  continuous:     boolean;
  interimResults: boolean;
  lang:           string;
  start(): void;
  stop():  void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror:  ((e: Event) => void) | null;
  onend:    (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognition;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?:        SpeechRecognitionCtor;
    webkitSpeechRecognition?:  SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Backup commit when Chrome never marks the line final. Shorter than this and
 * the interim text posts, then the real final posts a second line.
 */
const SILENCE_COMMIT_MS = 2_200;
/** Ignore a second copy of the same line from isFinal and onend racing. */
const DEDUPE_MS = 1500;

/**
 * Run browser STT for the local user while in a voice channel, writing each
 * finished utterance to the channel transcript. Speaker attribution is free
 * — the writer's UID is attached to every line.
 *
 * Chrome ends a "continuous" session on the first quiet stretch and throws if
 * `start()` is called from inside `onend`. The line is posted from that quiet
 * stretch (a final result, or the interim text still in hand when the session
 * dies), then the recogniser is started again on a timer.
 *
 * Web Speech API (Chrome/Edge/Safari). Firefox without the webkit shim, and
 * Electron (no Google speech key), are a no-op.
 */
export function useBrowserSTT(args: {
  guildId:   string | null;
  channelId: string | null;
  userId:    string | null;
  enabled:   boolean;
  /** When the user has a mask selected, stamp it so the transcript shows the
   *  mask identity instead of their real name/avatar. */
  maskName?:      string;
  maskAvatarUrl?: string;
}) {
  const recRef     = useRef<SpeechRecognition | null>(null);
  const stoppedRef = useRef(false);
  // Keep the latest mask in a ref so we don't restart STT when it changes.
  const maskRef    = useRef<{ name?: string; avatarUrl?: string }>({});
  maskRef.current = { name: args.maskName, avatarUrl: args.maskAvatarUrl };

  useEffect(() => {
    const { guildId, channelId, userId, enabled } = args;
    if (!enabled || !guildId || !channelId || !userId) return;

    const Ctor = getCtor();
    if (!Ctor) {
      console.warn('[stt] Web Speech API not available in this browser');
      return;
    }

    const rec: SpeechRecognition = new Ctor();
    rec.continuous     = true;
    rec.interimResults = true;
    rec.lang           = 'en-US';
    recRef.current     = rec;
    stoppedRef.current = false;

    let pending = '';
    let lastPosted = { text: '', at: 0 };
    let silenceTimer = 0;
    let restartTimer = 0;
    let networkFailures = 0;

    const post = (text: string) => {
      const clean = text.replace(/\s+/g, ' ').trim();
      if (!clean) return;
      const now = Date.now();
      if (clean === lastPosted.text && now - lastPosted.at < DEDUPE_MS) return;
      lastPosted = { text: clean, at: now };
      pending = '';
      window.clearTimeout(silenceTimer);
      appendTranscriptUtterance(guildId, channelId, {
        userId,
        text: clean,
        source: 'stt',
        maskName:      maskRef.current.name,
        maskAvatarUrl: maskRef.current.avatarUrl,
      }).catch((err) => console.error('[stt] write failed:', err));
    };

    const armSilence = () => {
      window.clearTimeout(silenceTimer);
      silenceTimer = window.setTimeout(() => {
        if (pending) post(pending);
      }, SILENCE_COMMIT_MS);
    };

    const restart = () => {
      if (stoppedRef.current) return;
      window.clearTimeout(restartTimer);
      // start() inside onend throws InvalidStateError; wait until the session is fully down.
      restartTimer = window.setTimeout(() => {
        if (stoppedRef.current) return;
        try { rec.start(); } catch (err) {
          console.warn('[stt] restart failed:', err);
        }
      }, 250);
    };

    rec.onresult = (e) => {
      networkFailures = 0;
      let finals = '';
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? '';
        if (r.isFinal) finals += text;
        else interim += text;
      }
      if (finals.trim()) post(finals);
      pending = interim;
      if (pending.trim()) armSilence();
      else window.clearTimeout(silenceTimer);
    };
    rec.onerror = (ev) => {
      const code = (ev as Event & { error?: string }).error ?? '';
      // no-speech is the quiet stretch between lines. not-allowed / network will never recover here.
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        stoppedRef.current = true;
        console.warn('[stt] speech recognition blocked:', code);
        return;
      }
      if (code === 'network') {
        networkFailures += 1;
        if (networkFailures >= 2) {
          stoppedRef.current = true;
          console.warn('[stt] speech recognition has no network (Electron has no Google speech key)');
        }
        return;
      }
      if (code && code !== 'no-speech' && code !== 'aborted') console.warn('[stt] error:', code);
    };
    rec.onend = () => {
      if (pending.trim()) post(pending);
      restart();
    };

    try { rec.start(); } catch (err) {
      console.warn('[stt] start failed:', err);
    }

    return () => {
      stoppedRef.current = true;
      window.clearTimeout(silenceTimer);
      window.clearTimeout(restartTimer);
      // Mute and leaving the channel both stop the recogniser before it can
      // mark the line final. Post whatever was already heard.
      if (pending.trim()) post(pending);
      try { rec.stop(); } catch { /* noop */ }
      recRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.guildId, args.channelId, args.userId, args.enabled]);
}
