import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { useAuth, getFirebaseFunctions } from '@maskord/shared';
import { useAssemblyStreamingSTT } from '../hooks/useAssemblyStreamingSTT';

/**
 * A standalone page for exercising AssemblyAI streaming STT end to end, without
 * a guild, a voice channel or a second person in the call.
 *
 * It drives the same `useAssemblyStreamingSTT` hook VoiceProvider uses, against
 * the same `getSttToken` callable, under the same Content-Security-Policy as
 * the app — so anything that breaks here breaks in the app, and vice versa. It
 * writes nothing to Firestore: turns only land on this page.
 *
 * Published at /stt.html. Query parameters, for automated runs:
 *   ?guest=1      sign in anonymously on load
 *   ?autostart=1  open the mic and start a session as soon as there is a user
 *   ?keyterms=a,b override the keyterms list
 */

// Same constraints the real voice path asks for, so the audio the recogniser
// hears here is the audio it hears in a call.
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl:  true,
  sampleRate:       48000,
};

const DEFAULT_KEYTERMS = 'Maskord, Masky, Rachael, Seth';
const DEFAULT_PROMPT =
  'Casual voice chat between friends in a Maskord voice channel. '
  + 'An AI avatar called Masky is in the call and people address it by name.';

declare const __WEB_BUILD_DATE__: string | undefined;

const params = new URLSearchParams(window.location.search);

// ─── Presentation ─────────────────────────────────────────────────────────────
// Plain inline styles rather than Tailwind: this page is a diagnostic tool and
// should not be able to fail because of a build pipeline it does not need.

const COLOURS: Record<string, string> = {
  off: '#6b7280', connecting: '#f59e0b', live: '#22c55e', fallback: '#ef4444',
};

const panel: React.CSSProperties = {
  background: '#14141c', border: '1px solid #2a2a3a', borderRadius: 10,
  padding: 16, marginBottom: 12,
};
const label: React.CSSProperties = {
  display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em',
  color: '#8b8ba3', marginBottom: 6,
};
const input: React.CSSProperties = {
  width: '100%', background: '#0b0b12', border: '1px solid #2a2a3a', borderRadius: 6,
  color: '#e6e6f0', padding: '8px 10px', font: 'inherit', fontSize: 13,
};
const button: React.CSSProperties = {
  background: '#7c3aed', border: 'none', borderRadius: 6, color: '#fff',
  padding: '9px 16px', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const ghost: React.CSSProperties = { ...button, background: 'transparent', border: '1px solid #3a3a4a', color: '#c9c9de' };

export default function SttHarness() {
  const { firebaseUser, loading, error: authError, signIn, signInWithGoogle, signInAsGuest, logOut } = useAuth();

  const [stream,   setStream]   = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [enabled,  setEnabled]  = useState(false);
  const [gateOpen, setGateOpen] = useState(true);
  const [level,    setLevel]    = useState(0);

  const [keytermsText, setKeytermsText] = useState(params.get('keyterms') ?? DEFAULT_KEYTERMS);
  const [promptText,   setPromptText]   = useState(DEFAULT_PROMPT);

  const [turns, setTurns] = useState<{ text: string; turnOrder: number; at: string }[]>([]);
  const [lines, setLines] = useState<string[]>([]);
  const [probe, setProbe] = useState<string>('not run');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const say = useCallback((line: string) => {
    const at = new Date().toLocaleTimeString();
    setLines((l) => [...l.slice(-199), `${at}  ${line}`]);
  }, []);

  // ─── Microphone ─────────────────────────────────────────────────────────────

  const startMic = useCallback(async () => {
    setMicError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
      const track = s.getAudioTracks()[0];
      setStream(s);
      say(`mic open: ${track?.label || 'unnamed device'} (${track?.getSettings().sampleRate ?? '?'} Hz)`);
      return s;
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      setMicError(msg);
      say(`mic failed: ${msg}`);
      return null;
    }
  }, [say]);

  const stopMic = useCallback(() => {
    setEnabled(false);
    setStream((s) => { s?.getTracks().forEach((t) => t.stop()); return null; });
    say('mic closed');
  }, [say]);

  // Input level, so it is obvious whether the recogniser is being fed anything.
  useEffect(() => {
    if (!stream) { setLevel(0); return; }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); source.disconnect(); ctx.close().catch(() => {}); };
  }, [stream]);

  // ─── The thing under test ───────────────────────────────────────────────────

  const keyterms = useMemo(
    () => keytermsText.split(/[,\n]/).map((t) => t.trim()).filter(Boolean),
    [keytermsText],
  );

  const { status } = useAssemblyStreamingSTT({
    localStream: stream,
    enabled:     enabled && !!firebaseUser,
    gateOpen,
    keyterms,
    prompt:      promptText.trim() || undefined,
    onFinalTurn: ({ text, turnOrder }) => {
      setTurns((t) => [...t, { text, turnOrder, at: new Date().toLocaleTimeString() }]);
      say(`turn ${turnOrder}: ${text}`);
    },
  });

  const lastStatus = useRef(status);
  useEffect(() => {
    if (status !== lastStatus.current) { say(`status: ${lastStatus.current} → ${status}`); lastStatus.current = status; }
  }, [status, say]);

  // ─── Token probe ────────────────────────────────────────────────────────────
  // The hook swallows a "not configured" answer and quietly falls back, which is
  // right in the app and unhelpful here, so ask the callable directly too.

  const runProbe = useCallback(async () => {
    setProbe('calling…');
    try {
      const fn = httpsCallable<void, { token: string; expiresInSeconds: number }>(
        getFirebaseFunctions(), 'getSttToken',
      );
      const { data } = await fn();
      const ok = `ok — ${data.token.length}-char token, expires in ${data.expiresInSeconds}s (unused, single-use)`;
      setProbe(ok);
      say(`getSttToken ${ok}`);
    } catch (e) {
      const code = (e as { code?: string })?.code ?? 'unknown';
      const msg  = e instanceof Error ? e.message : String(e);
      setProbe(`FAILED — ${code}: ${msg}`);
      say(`getSttToken failed — ${code}: ${msg}`);
    }
  }, [say]);

  // ─── Automated runs ─────────────────────────────────────────────────────────

  const autoStarted = useRef(false);
  useEffect(() => {
    if (loading || firebaseUser || !params.get('guest')) return;
    if (autoStarted.current) return;
    autoStarted.current = true;
    say('signing in anonymously (?guest=1)');
    void signInAsGuest();
  }, [loading, firebaseUser, signInAsGuest, say]);

  const autoMic = useRef(false);
  useEffect(() => {
    if (!firebaseUser || !params.get('autostart') || autoMic.current) return;
    autoMic.current = true;
    void (async () => {
      const s = await startMic();
      if (s) setEnabled(true);
    })();
  }, [firebaseUser, startMic]);

  // A stable hook for a headless driver to read without scraping the DOM.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__sttHarness = { status, turns, probe };
  }, [status, turns, probe]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const built = typeof __WEB_BUILD_DATE__ !== 'undefined' ? __WEB_BUILD_DATE__ : null;

  return (
    <div style={{
      minHeight: '100vh', background: '#08080d', color: '#e6e6f0',
      font: '14px/1.5 Inter, system-ui, sans-serif', padding: '28px 20px',
    }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
          <h1 style={{ font: '700 20px/1.2 "Space Grotesk", system-ui, sans-serif', margin: 0 }}>
            Maskord STT harness
          </h1>
          <span data-testid="status" style={{
            background: COLOURS[status], color: '#08080d', borderRadius: 999,
            padding: '2px 10px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
          }}>{status}</span>
        </header>
        <p style={{ color: '#8b8ba3', fontSize: 13, marginTop: 0, marginBottom: 20 }}>
          Drives the real <code>useAssemblyStreamingSTT</code> hook against the real{' '}
          <code>getSttToken</code> callable. Nothing is written to Firestore.
          {built ? ` Built ${new Date(built).toLocaleString()}.` : ''}
        </p>

        {/* ── 1. Sign in ── */}
        <section style={panel}>
          <span style={label}>1 · Firebase user <span style={{ textTransform: 'none', letterSpacing: 0 }}>(getSttToken refuses callers with no auth, so some kind of sign-in is required — a guest account counts)</span></span>
          {loading ? <div style={{ color: '#8b8ba3' }}>checking…</div> : firebaseUser ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span data-testid="uid" style={{ fontFamily: 'monospace', fontSize: 13 }}>
                {firebaseUser.isAnonymous ? 'guest' : (firebaseUser.email ?? firebaseUser.displayName ?? 'signed in')}
                {' · '}{firebaseUser.uid}
              </span>
              <button style={ghost} onClick={() => void logOut()}>sign out</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button style={button} onClick={() => void signInWithGoogle()}>Google</button>
              <button style={ghost} onClick={() => void signInAsGuest()}>guest</button>
              <input style={{ ...input, width: 190 }} placeholder="email" value={email}
                     onChange={(e) => setEmail(e.target.value)} />
              <input style={{ ...input, width: 150 }} placeholder="password" type="password" value={password}
                     onChange={(e) => setPassword(e.target.value)} />
              <button style={ghost} onClick={() => void signIn(email, password)}>sign in</button>
            </div>
          )}
          {authError && <div style={{ color: '#ef4444', marginTop: 8, fontSize: 13 }}>{authError}</div>}
        </section>

        {/* ── 2. Token ── */}
        <section style={panel}>
          <span style={label}>2 · getSttToken</span>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={ghost} onClick={() => void runProbe()} disabled={!firebaseUser}>mint a token</button>
            <span data-testid="probe" style={{
              fontFamily: 'monospace', fontSize: 12,
              color: probe.startsWith('FAILED') ? '#ef4444' : probe.startsWith('ok') ? '#22c55e' : '#8b8ba3',
            }}>{probe}</span>
          </div>
          <p style={{ color: '#6b7280', fontSize: 12, margin: '8px 0 0' }}>
            <code>failed-precondition</code> means the ASSEMBLYAI_API_KEY secret is not set;{' '}
            <code>not-found</code> means the function is not deployed. In the app either one
            silently drops back to the Web Speech API.
          </p>
        </section>

        {/* ── 3. Session ── */}
        <section style={panel}>
          <span style={label}>3 · Session</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            {stream
              ? <button style={ghost} onClick={stopMic}>close mic</button>
              : <button style={button} onClick={() => void startMic()}>open mic</button>}
            <button style={enabled ? ghost : button}
                    disabled={!stream || !firebaseUser}
                    onClick={() => setEnabled((e) => !e)}>
              {enabled ? 'stop session' : 'start session'}
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#c9c9de' }}>
              <input type="checkbox" checked={gateOpen} onChange={(e) => setGateOpen(e.target.checked)} />
              gate open
            </label>
            <button style={ghost}
                    onMouseDown={() => setGateOpen(false)}
                    onMouseUp={() => setGateOpen(true)}
                    onMouseLeave={() => setGateOpen(true)}
                    title="Hold to close the gate, the way push-to-talk and the avatar's own voice do">
              hold to close gate
            </button>
          </div>
          <div style={{ height: 8, background: '#0b0b12', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.round(level * 100)}%`, background: '#7c3aed', transition: 'width 60ms linear' }} />
          </div>
          {micError && <div style={{ color: '#ef4444', marginTop: 8, fontSize: 13 }}>{micError}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
            <div>
              <span style={label}>keyterms ({keyterms.length})</span>
              <textarea style={{ ...input, height: 64, resize: 'vertical' }} value={keytermsText}
                        onChange={(e) => setKeytermsText(e.target.value)} />
            </div>
            <div>
              <span style={label}>prompt</span>
              <textarea style={{ ...input, height: 64, resize: 'vertical' }} value={promptText}
                        onChange={(e) => setPromptText(e.target.value)} />
            </div>
          </div>
          <p style={{ color: '#6b7280', fontSize: 12, margin: '8px 0 0' }}>
            Both are read when the socket opens, so edits apply to the next session.
          </p>
        </section>

        {/* ── 4. Turns ── */}
        <section style={panel}>
          <span style={label}>4 · Formatted turns ({turns.length})</span>
          <div data-testid="turns" style={{ minHeight: 90 }}>
            {turns.length === 0
              ? <span style={{ color: '#6b7280', fontSize: 13 }}>nothing yet — start a session and say something</span>
              : turns.map((t, i) => (
                <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #1e1e2a' }}>
                  <span style={{ color: '#6b7280', fontFamily: 'monospace', fontSize: 11, marginRight: 10 }}>
                    #{t.turnOrder} {t.at}
                  </span>
                  {t.text}
                </div>
              ))}
          </div>
        </section>

        {/* ── 5. Log ── */}
        <section style={panel}>
          <span style={label}>5 · Log</span>
          <pre style={{
            margin: 0, maxHeight: 200, overflow: 'auto', fontSize: 12,
            color: '#8b8ba3', whiteSpace: 'pre-wrap',
          }}>{lines.join('\n') || 'nothing yet'}</pre>
        </section>
      </div>
    </div>
  );
}
