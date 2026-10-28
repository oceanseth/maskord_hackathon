import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@maskord/convex';

/**
 * The stage board: Masky hosting, two or three entrants under A/B/C, a vote
 * button per verb under each frame, live percentages, and whoever is talking
 * animated while their line plays.
 *
 * Shared by every vote-the-cast mode. The engine is `convex/stage.ts`; a mode
 * mounts this with its own verbs' styling and, optionally, a `marker` — the
 * guillotine that slides to whoever leads the Execute vote.
 *
 * Voicelines play in each viewer's own browser (speech synthesis), started by
 * the line's `seq` changing on the server. Every tab hears the same line at
 * the same moment because the server clock — not the tab — decides when a line
 * starts, and a tab that joins halfway through a line stays quiet rather than
 * starting it late.
 */

export type StageData = NonNullable<ReturnType<typeof useStageQuery>>;
export type StageEntrantView = StageData['stage']['entrants'][number];

function useStageQuery(slug: string, voterKey?: string) {
  return useQuery(api.stage.state, { slug, voterKey });
}

export interface StageVoter {
  key: string;
  name: string;
}

/** Live stage state, the vote call, and the watchdog tick. */
export function useStage(slug: string, voter: StageVoter | null) {
  const data = useStageQuery(slug, voter?.key);
  const cast = useMutation(api.stage.castVote);
  const tick = useMutation(api.stage.tick);
  const closeNow = useMutation(api.stage.closeNow);

  const running = data?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      tick({ slug }).catch(() => {});
    }, 4_000);
    return () => window.clearInterval(t);
  }, [running, slug, tick]);

  const vote = useCallback(
    async (label: string, verb: string) => {
      if (!voter) return { accepted: false as const, reason: 'signed-out' as const };
      return await cast({ slug, voterKey: voter.key, voterName: voter.name, label, verb });
    },
    [cast, slug, voter],
  );

  return { data, vote, closeNow: () => closeNow({ slug }) };
}

// ─── Voice ────────────────────────────────────────────────────────────────────

const MUTE_KEY = 'maskord.stage.muted';

function pickVoice(seed: string): SpeechSynthesisVoice | undefined {
  if (typeof window === 'undefined' || !window.speechSynthesis) return undefined;
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
  if (!voices.length) return undefined;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return voices[h % voices.length];
}

/**
 * Speak each new line once. Returns the label currently audible in this tab,
 * or null. Muted tabs still animate — from the server's timing — they just do
 * not make sound.
 */
function useStageVoice(data: StageData | null | undefined, muted: boolean): string | null {
  const [speaking, setSpeaking] = useState<string | null>(null);
  const lastSeq = useRef<number>(-1);
  const line = data?.stage.line;

  useEffect(() => {
    if (!line || line.seq === lastSeq.current) return;
    lastSeq.current = line.seq;
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || muted) return;
    // Joined mid-line: stay quiet rather than start a line late over the next one.
    if (Date.now() - line.startedAt > 2_500) return;

    const entrant = data?.stage.entrants.find((e) => e.label === line.label);
    const u = new SpeechSynthesisUtterance(line.text);
    const voice = pickVoice(line.label === 'host' ? 'masky-host' : line.name);
    if (voice) u.voice = voice;
    u.pitch = entrant?.voice?.pitch ?? (line.label === 'host' ? 1.05 : 1);
    u.rate = entrant?.voice?.rate ?? 1.05;
    u.onstart = () => setSpeaking(line.label);
    u.onend = () => setSpeaking((s) => (s === line.label ? null : s));
    u.onerror = () => setSpeaking((s) => (s === line.label ? null : s));
    synth.cancel();
    synth.speak(u);
  }, [line, muted, data?.stage.entrants]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  useEffect(() => {
    if (muted) {
      window.speechSynthesis?.cancel();
      setSpeaking(null);
    }
  }, [muted]);

  return speaking;
}

/** Re-render on a clock while something time-based is on screen. */
function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [active, ms]);
  return now;
}

// ─── Board ────────────────────────────────────────────────────────────────────

export interface VerbStyle {
  label: string;
  emoji: string;
  /** Tailwind classes for the button; `active` when it is the viewer's pick. */
  idle: string;
  active: string;
  /** Bar colour for the percentage. */
  bar: string;
}

const DEFAULT_VERB: VerbStyle = {
  label: 'Vote',
  emoji: '✋',
  idle: 'bg-[#2a2a3e] hover:bg-[#3a3a5e] text-[#e2e8f0]',
  active: 'bg-violet-600 text-white',
  bar: 'bg-violet-500',
};

export interface StageMarker {
  /** The verb whose leader the marker follows. */
  verb: string;
  icon: ReactNode;
  /** Shown on the frame the audience picked, once revealed. */
  stamp: string;
}

interface StageProps {
  data: StageData | null | undefined;
  vote: (label: string, verb: string) => Promise<unknown>;
  canVote: boolean;
  verbStyles?: Record<string, VerbStyle>;
  marker?: StageMarker;
  hostName?: string;
  /** Shown when the stage has nothing on it yet. */
  empty?: ReactNode;
}

export function Stage({ data, vote, canVote, verbStyles, marker, hostName = 'Masky', empty }: StageProps) {
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTE_KEY) === '1');
  const audible = useStageVoice(data, muted);
  const stage = data?.stage;
  const phase = stage?.phase ?? 'idle';
  const now = useNow(Boolean(stage && (phase === 'speeches' || phase === 'voting' || stage.line)));
  const [error, setError] = useState<string | null>(null);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  };

  /** Whose mouth is moving: the audible line if this tab is speaking, else the server's window. */
  const talking = useMemo(() => {
    if (audible) return audible;
    const line = stage?.line;
    if (line && now < line.startedAt + line.durationMs) return line.label;
    return null;
  }, [audible, stage?.line, now]);

  if (!data || !stage || stage.entrants.length === 0) {
    return (
      <div className="relative flex flex-col items-center justify-center gap-3 py-8 bg-gradient-to-b from-[#1a1028] to-[#0e0e16] border-b border-[#1e1e2e]">
        <StageStyles />
        <HostFrame name={hostName} talking={talking === 'host'} />
        {stage?.line?.label === 'host' && <Subtitle text={stage.line.text} />}
        {empty}
      </div>
    );
  }

  const entrants = stage.entrants;
  const totals = data.totals as Record<string, number>;
  const tallies = data.tallies as Record<string, Record<string, number>>;
  const reveal = stage.reveal;
  const showReveal = phase === 'revealed' || phase === 'over';

  const share = (label: string, verb: string) => {
    const n = (showReveal ? reveal?.tallies[label]?.[verb] : tallies[label]?.[verb]) ?? 0;
    const total = showReveal
      ? Object.values(reveal?.tallies ?? {}).reduce((s, t) => s + (t[verb] ?? 0), 0)
      : (totals[verb] ?? 0);
    return { n, pct: total ? Math.round((n / total) * 100) : 0 };
  };

  // The marker sits beside the leader while votes come in, and on the
  // audience's pick once they are revealed.
  let markerIndex = -1;
  if (marker) {
    if (showReveal && reveal?.majority[marker.verb]) {
      markerIndex = entrants.findIndex((e) => e.label === reveal.majority[marker.verb]);
    } else if (phase === 'voting' && (totals[marker.verb] ?? 0) > 0) {
      let best = -1;
      entrants.forEach((e, i) => {
        const n = tallies[e.label]?.[marker.verb] ?? 0;
        if (best < 0 || n > (tallies[entrants[best].label]?.[marker.verb] ?? 0)) best = i;
      });
      markerIndex = best;
    }
  }

  const secondsLeft =
    phase === 'voting' && stage.votingEndsAt ? Math.max(0, Math.ceil((stage.votingEndsAt - now) / 1000)) : null;
  const speakingName = talking && talking !== 'host' ? entrants.find((e) => e.label === talking)?.name : null;

  const onVote = async (label: string, verb: string) => {
    setError(null);
    try {
      const r = (await vote(label, verb)) as { accepted: boolean; reason?: string } | undefined;
      if (r && !r.accepted) setError(r.reason === 'not-voting' ? 'Voting is closed right now.' : 'That vote did not count.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That vote did not count.');
    }
  };

  return (
    <div className="relative flex flex-col gap-2 px-4 pt-3 pb-4 bg-gradient-to-b from-[#1a1028] to-[#0e0e16] border-b border-[#1e1e2e] flex-shrink-0">
      <StageStyles />

      {/* Status rail: host, caption, phase, mute. */}
      <div className="flex items-center gap-3">
        <HostFrame name={hostName} talking={talking === 'host'} small />
        <div className="flex flex-col min-w-0">
          {stage.caption && (
            <span className="text-[11px] uppercase tracking-wider text-violet-300 truncate">{stage.caption}</span>
          )}
          <span className="text-sm font-semibold text-white truncate">
            {phase === 'speeches'
              ? speakingName
                ? `${speakingName} pleads their case…`
                : talking === 'host'
                  ? `${hostName} sets the stage…`
                  : 'Next up…'
              : phase === 'voting'
                ? `Vote now — ${secondsLeft ?? 0}s`
                : phase === 'revealed'
                  ? 'The votes are in'
                  : phase === 'over'
                    ? 'Show over'
                    : ''}
          </span>
        </div>
        <span className="ml-auto text-xs text-[#8b8fa3]">
          {data.voters} voter{data.voters === 1 ? '' : 's'} · you: {data.myPoints} pt{data.myPoints === 1 ? '' : 's'}
        </span>
        <button
          onClick={toggleMute}
          title={muted ? 'Unmute stage voices' : 'Mute stage voices'}
          className="text-sm px-2 py-1 rounded bg-[#1e1e2e] hover:bg-[#2a2a3e]"
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      {stage.line && talking === stage.line.label && <Subtitle text={stage.line.text} who={stage.line.name} />}

      {/* The frames. Labels above, buttons below; the marker slides along the row. */}
      <div className="flex justify-center pt-6">
      <div className="relative flex">
        {marker && markerIndex >= 0 && (
          <div
            className={`absolute top-0 z-10 text-4xl transition-all duration-700 ease-out ${showReveal ? 'stage-drop' : ''}`}
            style={{ left: `calc(${((markerIndex + 0.5) / entrants.length) * 100}% + 58px)`, top: '64px' }}
            aria-label={`${marker.verb} leader`}
          >
            {marker.icon}
          </div>
        )}

        {entrants.map((e) => {
          const isTalking = talking === e.label;
          const picked = showReveal ? Object.entries(reveal?.majority ?? {}).filter(([, l]) => l === e.label).map(([verb]) => verb) : [];
          const stamped = marker && picked.includes(marker.verb);
          return (
            <div key={e.label} className="flex flex-col items-center gap-2 w-44 px-2">
              <span
                className="text-2xl font-black leading-none px-3 py-1 rounded-lg bg-black/40 border-2"
                style={{ borderColor: e.color ?? '#8b5cf6', color: e.color ?? '#c4b5fd' }}
              >
                {e.label}
              </span>
              <EntrantFrame entrant={e} talking={isTalking} dim={phase === 'speeches' && !!talking && !isTalking} stamp={stamped ? marker!.stamp : undefined} />
              <span className="text-sm font-semibold text-white text-center leading-tight">{e.name}</span>
              <div className="flex flex-col gap-1 w-full">
                {stage.verbs.map((verb) => {
                  const st = verbStyles?.[verb] ?? { ...DEFAULT_VERB, label: verb };
                  const mine = data.mine[verb] === e.label;
                  const { n, pct } = share(e.label, verb);
                  const won = showReveal && reveal?.majority[verb] === e.label;
                  return (
                    <div key={verb} className="flex flex-col gap-0.5">
                      <button
                        disabled={!canVote || phase !== 'voting'}
                        onClick={() => onVote(e.label, verb)}
                        className={`w-full px-2 py-1.5 rounded-lg text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${mine ? st.active : st.idle} ${won ? 'ring-2 ring-white' : ''}`}
                      >
                        {st.emoji} {st.label}
                      </button>
                      {(phase === 'voting' || showReveal) && (
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-1.5 rounded bg-[#1e1e2e] overflow-hidden">
                            <div className={`h-full ${st.bar} transition-all duration-500`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[10px] text-[#94a3b8] w-12 text-right">
                            {pct}% · {n}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      </div>

      <p className="text-center text-[11px] text-[#6b7280]">
        Twitch chat: {stage.verbs.map((verb) => `!${verb} ${entrants.map((e) => e.label).join('/')}`).join(' · ')}
        {stage.exclusive ? ' — one of each, a different entrant for each' : ''}
      </p>
      {error && <p className="text-center text-xs text-red-400">{error}</p>}
    </div>
  );
}

function EntrantFrame({
  entrant,
  talking,
  dim,
  stamp,
}: {
  entrant: StageEntrantView;
  talking: boolean;
  dim: boolean;
  stamp?: string;
}) {
  const color = entrant.color ?? '#8b5cf6';
  return (
    <div
      className={`relative w-28 h-28 rounded-2xl overflow-hidden border-4 flex items-center justify-center bg-[#12121c] transition ${talking ? 'stage-talk' : ''} ${dim ? 'opacity-50' : ''}`}
      style={{ borderColor: talking ? color : '#2a2a3e', boxShadow: talking ? `0 0 24px ${color}` : undefined }}
    >
      {entrant.avatarUrl ? (
        <img src={entrant.avatarUrl} alt={entrant.name} className="w-full h-full object-cover" />
      ) : (
        <div className="flex flex-col items-center">
          <span className={`text-5xl ${talking ? 'stage-head' : ''}`}>{entrant.emoji ?? '🙂'}</span>
          <span className="text-xs font-bold mt-1" style={{ color }}>
            {initials(entrant.name)}
          </span>
        </div>
      )}
      {/* The mouth: sound bars that only move while the line plays. */}
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex items-end gap-0.5 h-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`w-1 rounded-sm ${talking ? 'stage-bar' : ''}`}
            style={{ background: color, height: talking ? undefined : 2, animationDelay: `${i * 90}ms` }}
          />
        ))}
      </div>
      {stamp && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900/60">
          <span className="text-sm font-black tracking-widest text-white border-2 border-white px-2 py-0.5 -rotate-12">
            {stamp}
          </span>
        </div>
      )}
    </div>
  );
}

function HostFrame({ name, talking, small }: { name: string; talking: boolean; small?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`${small ? 'w-10 h-10 text-2xl' : 'w-20 h-20 text-5xl'} rounded-full border-2 flex items-center justify-center bg-[#1e1430] ${talking ? 'stage-talk border-violet-400' : 'border-[#3a2a5e]'}`}
      >
        <span className={talking ? 'stage-head' : ''}>🎭</span>
      </div>
      {!small && <span className="text-sm font-semibold text-violet-200">{name}</span>}
    </div>
  );
}

function Subtitle({ text, who }: { text: string; who?: string }) {
  return (
    <p className="mx-auto max-w-2xl text-center text-sm text-[#e2e8f0] bg-black/40 rounded-lg px-3 py-1.5">
      {who && <span className="text-violet-300 font-semibold">{who}: </span>}
      {text}
    </p>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

/** Keyframes for the talking/blade animations; scoped by class name. */
function StageStyles() {
  return (
    <style>{`
      @keyframes stage-bob { 0%,100% { transform: translateY(0) rotate(0) } 25% { transform: translateY(-2px) rotate(-2deg) } 75% { transform: translateY(1px) rotate(2deg) } }
      @keyframes stage-bar { 0%,100% { height: 3px } 50% { height: 14px } }
      @keyframes stage-pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.04) } }
      @keyframes stage-drop { 0% { transform: translateY(-24px) } 60% { transform: translateY(6px) } 80% { transform: translateY(-2px) } 100% { transform: translateY(0) } }
      .stage-talk { animation: stage-pulse 0.6s ease-in-out infinite }
      .stage-head { display: inline-block; animation: stage-bob 0.35s ease-in-out infinite }
      .stage-bar { animation: stage-bar 0.4s ease-in-out infinite }
      .stage-drop { animation: stage-drop 0.6s ease-out 1 }
    `}</style>
  );
}

/** Top voters by points. */
export function StageLeaderboard({ data, meKey }: { data: StageData | null | undefined; meKey?: string }) {
  const rows = data?.leaderboard ?? [];
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-[#8b8fa3] uppercase tracking-wide">Read the room</div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-[#6b7280]">Vote with the majority to score.</p>
      ) : (
        rows.map((r, i) => (
          <div
            key={r.voterKey}
            className={`flex items-center gap-2 text-xs ${r.voterKey === meKey ? 'text-violet-200' : 'text-[#c8d0e0]'}`}
          >
            <span className="w-4 text-[#6b7280]">{i + 1}</span>
            <span className="truncate flex-1">
              {r.voterKey.startsWith('twitch:') && <span title="Twitch">🟣 </span>}
              {r.name}
            </span>
            <span className="font-semibold">{r.points}</span>
          </div>
        ))
      )}
    </div>
  );
}
