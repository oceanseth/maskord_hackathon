import { useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from '@maskord/shared';

/**
 * Live speech-to-text for the local user's microphone via AssemblyAI
 * Universal-Streaming.
 *
 * Why not the Web Speech API: it proxies to Google's speech servers with a key
 * only Chrome ships. Electron does not have that key, so `SpeechRecognition`
 * fails with `error: "network"` and never returns a result (electron#31732).
 * This hook works anywhere there is a microphone and a WebSocket.
 *
 * Shape of a session:
 *   1. ask our `getSttToken` callable for a single-use temporary token (the
 *      account key stays server-side);
 *   2. tap a clone of the mic track through an AudioWorklet that downsamples
 *      to 16 kHz PCM16 and posts ~100 ms frames;
 *   3. open `wss://streaming.assemblyai.com/v3/ws` and send those frames as
 *      binary messages once the server's `Begin` arrives;
 *   4. on every `Turn` with `end_of_turn && turn_is_formatted`, hand the text
 *      to `onFinalTurn`.
 *
 * The socket bills wall-clock time, not speech, so it only exists while
 * `enabled` is true — callers turn it off when muted or out of the channel.
 * `gateOpen` is cheaper than a reconnect: while it is false the session stays
 * up but receives silence (used for push-to-talk and while the avatar's voice
 * is playing, so the avatar does not transcribe itself).
 *
 * When the token callable says STT is not configured (or is not deployed) the
 * status becomes 'fallback' and callers may start the Web Speech API instead.
 */

export type SttStatus =
  | 'off'         // not enabled
  | 'connecting'  // fetching a token / opening the socket / reconnecting
  | 'live'        // session open, audio flowing
  | 'fallback';   // AssemblyAI unavailable — use Web Speech if you can

export interface TranscriptTurn {
  text: string;
  /** Server-side ordinal of the turn within this session. */
  turnOrder: number;
}

interface Args {
  localStream: MediaStream | null;
  enabled: boolean;
  gateOpen: boolean;
  /** Names worth spelling right: members, masks, the AI avatar. Read at connect time. */
  keyterms?: string[];
  /** One sentence of context for the recogniser (Universal-3.5 Pro only). */
  prompt?: string;
  onFinalTurn: (turn: TranscriptTurn) => void;
}

// Universal-3.5 Pro: 18 languages, contextual `prompt`, best accuracy, $0.45/h.
// 'universal-streaming-english' is the $0.15/h alternative if cost matters more
// than accuracy. Both take keyterms_prompt. Billing is per open-socket hour.
const SPEECH_MODEL = 'universal-3-5-pro';
const WS_URL       = 'wss://streaming.assemblyai.com/v3/ws';
const SAMPLE_RATE  = 16_000;
/** Samples per frame posted by the worklet: 100 ms at 16 kHz (API accepts 50–1000 ms). */
const FRAME_SAMPLES = 1_600;
const MAX_KEYTERMS      = 100;
const MAX_KEYTERM_CHARS = 50;
/** Keep sending real audio this long after the gate closes so the last word is not clipped. */
const GATE_TAIL_MS = 300;
/** Re-probe the token callable this often while in fallback (e.g. before the secret is set). */
const FALLBACK_RETRY_MS = 5 * 60 * 1000;
/** Consecutive connection failures before giving up on AssemblyAI for this session. */
const MAX_CONNECT_FAILURES = 3;

// Runs on the audio rendering thread. Averages the context's native rate down
// to 16 kHz (48 kHz → exactly 3:1) and posts Int16 frames of FRAME_SAMPLES.
// Output is left silent, so connecting to the destination keeps the graph
// alive without monitoring the mic locally.
const WORKLET_SOURCE = `
class MaskordPcm16Downsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options.processorOptions.targetRate;
    this.frameSamples = options.processorOptions.frameSamples;
    this.ratio = sampleRate / this.targetRate;
    this.acc = 0;       // running sum of input samples in the current window
    this.accN = 0;      // count in the current window
    this.nextEdge = this.ratio;
    this.consumed = 0;  // input samples consumed since the last window edge reset
    this.frame = new Int16Array(this.frameSamples);
    this.frameLen = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      this.accN++;
      this.consumed++;
      if (this.consumed >= this.nextEdge) {
        const v = this.acc / this.accN;
        this.frame[this.frameLen++] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
        this.acc = 0; this.accN = 0;
        this.nextEdge += this.ratio;
        if (this.nextEdge > 1e6) { this.nextEdge -= this.consumed; this.consumed = 0; }
        if (this.frameLen === this.frameSamples) {
          const out = this.frame.slice();
          this.port.postMessage(out.buffer, [out.buffer]);
          this.frameLen = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('maskord-pcm16-downsampler', MaskordPcm16Downsampler);
`;

let workletUrl: string | null = null;
function getWorkletUrl(): string {
  if (!workletUrl) {
    workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  }
  return workletUrl;
}

interface TurnMessage {
  type: 'Turn';
  turn_order: number;
  turn_is_formatted: boolean;
  end_of_turn: boolean;
  transcript: string;
  utterance?: string;
}
type ServerMessage =
  | { type: 'Begin'; id: string; expires_at: number }
  | TurnMessage
  | { type: 'Termination' }
  | { type: string };

/** Callable errors that mean "AssemblyAI is not set up here" rather than "try again". */
function isNotConfigured(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? '';
  return code.endsWith('failed-precondition')
      || code.endsWith('not-found')
      || code.endsWith('unimplemented')
      || code.endsWith('permission-denied');
}

async function fetchToken(): Promise<string> {
  const fn = httpsCallable<void, { token: string; expiresInSeconds: number }>(
    getFirebaseFunctions(), 'getSttToken',
  );
  const { data } = await fn();
  return data.token;
}

function normaliseKeyterms(terms: string[] | undefined): string[] {
  if (!terms) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const t = raw.trim();
    if (!t || t.length > MAX_KEYTERM_CHARS || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length === MAX_KEYTERMS) break;
  }
  return out;
}

export function useAssemblyStreamingSTT(args: Args): { status: SttStatus } {
  const [status, setStatus] = useState<SttStatus>('off');

  // Latest values for the long-lived session closure, without restarting it.
  const onFinalTurnRef = useRef(args.onFinalTurn);
  const gateOpenRef    = useRef(args.gateOpen);
  const keytermsRef    = useRef(args.keyterms);
  const promptRef      = useRef(args.prompt);
  onFinalTurnRef.current = args.onFinalTurn;
  keytermsRef.current    = args.keyterms;
  promptRef.current      = args.prompt;

  // The socket, so the gate effect can ask the server to close a turn.
  const wsRef = useRef<WebSocket | null>(null);
  const gateClosedAtRef = useRef<number>(0);

  useEffect(() => {
    const wasOpen = gateOpenRef.current;
    gateOpenRef.current = args.gateOpen;
    if (wasOpen && !args.gateOpen) {
      gateClosedAtRef.current = performance.now();
      // Finalise whatever was said before the gate shut (PTT release, avatar
      // about to speak) instead of waiting for the silence timeout.
      const ws = wsRef.current;
      window.setTimeout(() => {
        if (ws && ws === wsRef.current && ws.readyState === WebSocket.OPEN && !gateOpenRef.current) {
          ws.send(JSON.stringify({ type: 'ForceEndpoint' }));
        }
      }, GATE_TAIL_MS);
    }
  }, [args.gateOpen]);

  const { localStream, enabled } = args;

  useEffect(() => {
    const track = localStream?.getAudioTracks()[0] ?? null;
    if (!enabled || !track) { setStatus('off'); return; }

    let cancelled = false;
    let ws: WebSocket | null = null;
    let ready = false;               // server sent Begin
    let terminating = false;         // we asked for the close
    let retryTimer: number | null = null;
    let connectFailures = 0;

    // ── Audio tap ─────────────────────────────────────────────────────────────
    // A clone is independent of the send track's `enabled` flag, which VAD, PTT
    // and avatar mode all toggle. STT must hear the mic regardless.
    const tap = track.clone();
    const ctx = new AudioContext();
    let worklet: AudioWorkletNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;

    // Resolves to false if the tap could not be built; we then never open a
    // socket, since an open socket bills whether or not audio arrives.
    const audioReady: Promise<boolean> = (async () => {
      await ctx.resume().catch(() => {});
      await ctx.audioWorklet.addModule(getWorkletUrl());
      if (cancelled) return false;
      source  = ctx.createMediaStreamSource(new MediaStream([tap]));
      worklet = new AudioWorkletNode(ctx, 'maskord-pcm16-downsampler', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: { targetRate: SAMPLE_RATE, frameSamples: FRAME_SAMPLES },
      });
      worklet.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
        if (!ws || ws.readyState !== WebSocket.OPEN || !ready) return;
        const inTail = performance.now() - gateClosedAtRef.current < GATE_TAIL_MS;
        // Silence rather than nothing: the session stays warm and turn timing
        // stays real-time, but nothing said off-gate reaches the transcript.
        ws.send(gateOpenRef.current || inTail ? data : new ArrayBuffer(data.byteLength));
      };
      source.connect(worklet).connect(ctx.destination);
      return true;
    })().catch((err) => { console.warn('[stt] audio tap failed:', err); return false; });

    // ── Session ───────────────────────────────────────────────────────────────
    const scheduleRetry = (ms: number) => {
      if (cancelled) return;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => { retryTimer = null; void connect(); }, ms);
    };

    const giveUp = () => {
      // Web Speech can take over; we quietly re-probe later in case the
      // secret was set (or the function deployed) in the meantime.
      setStatus('fallback');
      connectFailures = 0;
      scheduleRetry(FALLBACK_RETRY_MS);
    };

    const connect = async () => {
      if (cancelled) return;
      setStatus((s) => (s === 'fallback' ? s : 'connecting'));

      let token: string;
      try {
        token = await fetchToken();
      } catch (err) {
        if (cancelled) return;
        if (isNotConfigured(err)) {
          console.info('[stt] AssemblyAI not configured, using Web Speech:', (err as Error).message);
          giveUp();
          return;
        }
        console.warn('[stt] token fetch failed:', err);
        if (++connectFailures >= MAX_CONNECT_FAILURES) giveUp();
        else scheduleRetry(1000 * 2 ** connectFailures);
        return;
      }
      if (!(await audioReady)) { setStatus('fallback'); return; }
      if (cancelled) return;

      const params = new URLSearchParams({
        token,
        speech_model: SPEECH_MODEL,
        encoding:     'pcm_s16le',
        sample_rate:  String(SAMPLE_RATE),
        format_turns: 'true',
      });
      const keyterms = normaliseKeyterms(keytermsRef.current);
      if (keyterms.length) params.set('keyterms_prompt', JSON.stringify(keyterms));
      const prompt = promptRef.current?.trim();
      if (prompt) params.set('prompt', prompt);

      const sock = new WebSocket(`${WS_URL}?${params.toString()}`);
      sock.binaryType = 'arraybuffer';
      ws = sock;
      wsRef.current = sock;
      ready = false;
      terminating = false;

      sock.onmessage = (ev: MessageEvent<string>) => {
        let msg: ServerMessage;
        try { msg = JSON.parse(ev.data) as ServerMessage; } catch { return; }
        if (msg.type === 'Begin') {
          ready = true;
          connectFailures = 0;
          setStatus('live');
          return;
        }
        if (msg.type === 'Turn') {
          const t = msg as TurnMessage;
          // With format_turns the server may emit the same end-of-turn twice:
          // raw first, then punctuated. Only the formatted one is the utterance.
          if (!t.end_of_turn || !t.turn_is_formatted) return;
          const text = (t.utterance || t.transcript || '').trim();
          if (!text) return;
          onFinalTurnRef.current({ text, turnOrder: t.turn_order });
        }
      };
      sock.onerror = () => { /* onclose follows with the code */ };
      sock.onclose = (ev) => {
        if (wsRef.current === sock) wsRef.current = null;
        ws = null;
        if (cancelled || terminating) return;
        // 1000 after Termination = the 3 h session cap; anything else is a drop.
        // Either way the user is still talking, so come back with a fresh token.
        if (ready && ev.code === 1000) {
          scheduleRetry(0);
          return;
        }
        console.warn('[stt] socket closed', ev.code, ev.reason);
        if (++connectFailures >= MAX_CONNECT_FAILURES) giveUp();
        else {
          setStatus('connecting');
          scheduleRetry(1000 * 2 ** connectFailures);
        }
      };
    };

    void connect();

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (ws) {
        terminating = true;
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'Terminate' })); } catch { /* closing anyway */ }
        }
        ws.close();
        if (wsRef.current === ws) wsRef.current = null;
      }
      try { worklet?.port.close(); worklet?.disconnect(); source?.disconnect(); } catch { /* noop */ }
      ctx.close().catch(() => {});
      tap.stop();
      setStatus('off');
    };
  }, [enabled, localStream]);

  return { status };
}
