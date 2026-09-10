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
 * Run browser STT for the local user while in a voice channel, writing each
 * finalised utterance to the channel transcript. Speaker attribution is free
 * — the writer's UID is attached to every line.
 *
 * Use Web Speech API (Chrome/Edge/Safari). Firefox without webkit shim → no-op.
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
    rec.interimResults = false;
    rec.lang           = 'en-US';
    recRef.current     = rec;
    stoppedRef.current = false;

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r.isFinal) continue;
        const text = r[0]?.transcript?.trim() ?? '';
        if (!text) continue;
        appendTranscriptUtterance(guildId, channelId, {
          userId,
          text,
          source: 'stt',
          maskName:      maskRef.current.name,
          maskAvatarUrl: maskRef.current.avatarUrl,
        }).catch((err) => console.error('[stt] write failed:', err));
      }
    };
    rec.onerror = (ev) => console.warn('[stt] error:', ev);
    rec.onend   = () => {
      // Chrome auto-stops every minute or so; restart unless we explicitly stopped.
      if (!stoppedRef.current) {
        try { rec.start(); } catch { /* already started */ }
      }
    };

    try { rec.start(); } catch (err) {
      console.warn('[stt] start failed:', err);
    }

    return () => {
      stoppedRef.current = true;
      try { rec.stop(); } catch { /* noop */ }
      recRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.guildId, args.channelId, args.userId, args.enabled]);
}
