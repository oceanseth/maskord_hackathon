import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useQuery } from 'convex/react';
import { api } from '@maskord/convex';
import { getFirebaseDb, useTranscript } from '@maskord/shared';

// ─── Talking-head (video) playback ─────────────────────────────────────────────
//
// "Talking head" replies are non-blocking: the Cloud Function fires the masky
// turn and records a pointer on the transcript doc (`maskyOutput: 'video'`,
// `maskyViewerToken`, `maskyAnchorTurnId`). We watch the PUBLIC liveTurns mirror
// (`liveTurns/{viewerToken}/turns`) and play each chunk's talking-head video in
// the speaking avatar's tile as it finishes rendering (~30–60s/chunk). The video
// carries its own audio, so audio-only playback (ChatPanel) skips these.
//
// With the guild's lipsync provider set to ElevenLabs the pointer is
// `maskyOutput: 'eleven-video'` instead: masky rendered AUDIO chunks only, and
// one connected client (useElevenRenderer) lipsyncs them into mp4 clips stored
// in Convex. Those jobs play from the Convex `elevenJobs` row — same tile, same
// one-at-a-time queue. The mirror is still watched for live captions, and if
// the job completes with no clips at all (bad key, no renderer with CORS-free
// fetch) the chunks' masky AUDIO is played instead so the reply is never lost.

const liveVideoUrl = (token: string, turnId: string) =>
  `https://masky.ai/api/live-media/${token}/${turnId}/video`;
const liveAudioUrl = (token: string, turnId: string) =>
  `https://masky.ai/api/live-media/${token}/${turnId}/audio`;

// After the last known chunk plays, wait this long for another chunk to appear
// (masky renders chunks serially, ~45s each) before considering the reply done.
const QUIET_FINISH_MS = 50_000;
// How long to wait for the FIRST chunk to show up in the mirror before giving up
// (audio stage lands in seconds; this is a safety net so the tile never sticks).
const STARTUP_MS = 90_000;
// ElevenLabs clips can take up to the renderer's full per-chunk budget (claim
// delay + an 8-minute generation ceiling), so eleven jobs wait longer before
// giving up. The renderer marking the job done ends playback early anyway.
const ELEVEN_QUIET_FINISH_MS = 9 * 60_000;
const ELEVEN_STARTUP_MS = 10 * 60_000;

interface PlayTurn {
  id: string;
  status: string;
  text: string;
  /** Explicit media src; masky mirror turns derive theirs from the viewer token. */
  src?: string;
  /** Play through a hidden Audio element (voice-only fallback) instead of the tile video. */
  audioOnly?: boolean;
}

interface Job {
  kind:        'masky' | 'eleven';
  uttId:       string;
  avatarId:    string | null;
  viewerToken: string;
  anchorId:    string;
  turns:       PlayTurn[];
  /** Eleven only: settled mirror chunks, kept for captions + audio fallback. */
  mirror:      PlayTurn[];
  /** Eleven only: the renderer marked the job complete. */
  done:        boolean;
  /** Eleven only: the job completed with zero clips, playing mirror audio instead. */
  fallback:    boolean;
  playIdx:     number;
  playing:     boolean;
  unsub:       (() => void) | null;
  quiet:       ReturnType<typeof setTimeout> | null;
}

function avatarIdFromUserId(userId: string): string | null {
  const parts = userId.split(':');
  return parts[0] === 'bot' && parts.length >= 3 ? parts[2] : null;
}

export function useTalkingHead(guildId: string | null, channelId: string | null) {
  const { utterances, loading } = useTranscript(guildId, channelId, 80);

  const playedRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const jobRef    = useRef<Job | null>(null);
  const advanceRef = useRef<() => void>(() => {});
  const audioRef  = useRef<HTMLAudioElement | null>(null);

  const [videoSpeakingId, setVideoSpeakingId] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [textByUtterance, setTextByUtterance] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0); // bumped to look for the next job
  // The Convex job key of the active eleven job, driving the clips subscription.
  const [elevenKey, setElevenKey] = useState<string | null>(null);

  // On join, mark existing replies as seen so we don't replay history.
  useEffect(() => {
    if (seededRef.current || loading) return;
    for (const u of utterances) {
      if (u.source === 'agent-reply') playedRef.current.add(u.id);
    }
    seededRef.current = true;
  }, [loading, utterances]);

  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    audioRef.current = null;
    if (a) { a.onended = null; a.onerror = null; try { a.pause(); } catch { /* ignore */ } }
  }, []);

  const finishJob = useCallback(() => {
    const job = jobRef.current;
    if (!job) return;
    job.unsub?.();
    if (job.quiet) clearTimeout(job.quiet);
    jobRef.current = null;
    stopAudio();
    setVideoSpeakingId(null);
    setVideoSrc(null);
    setElevenKey(null);
    setTick((t) => t + 1);
  }, [stopAudio]);

  const handleVideoEnded = useCallback(() => {
    const job = jobRef.current;
    if (!job) return;
    job.playing = false;
    setVideoSrc(null);
    stopAudio();
    job.playIdx += 1;
    advanceRef.current();
  }, [stopAudio]);

  // Play the next ready chunk, wait while one is still rendering, or arm a quiet
  // timer to finish once nothing more is coming.
  const advance = useCallback(() => {
    const job = jobRef.current;
    if (!job || job.playing) return;
    const cur = job.turns[job.playIdx];
    if (cur) {
      if (cur.status === 'error') { job.playIdx += 1; advance(); return; }
      if (job.quiet) { clearTimeout(job.quiet); job.quiet = null; } // a chunk exists → don't finish
      if (cur.status === 'video') {
        job.playing = true;
        if (cur.audioOnly && cur.src) {
          // Voice-only fallback: a hidden Audio element; the tile just pulses.
          const a = new Audio(cur.src);
          audioRef.current = a;
          a.onended = () => handleVideoEnded();
          a.onerror = () => handleVideoEnded();
          void a.play().catch(() => handleVideoEnded());
        } else {
          setVideoSrc(cur.src ?? liveVideoUrl(job.viewerToken, cur.id));
        }
      }
      // else: chunk still rendering (pending/audio) — the next snapshot wakes us.
      return;
    }
    // No chunk at playIdx: either the first chunk hasn't appeared yet, or we've
    // played them all.
    if (job.kind === 'eleven' && job.done) {
      // All published clips played. If none ever existed, fall back to the
      // chunks' masky audio (once) so the reply is still heard.
      if (!job.fallback && job.playIdx === 0 && job.turns.length === 0) {
        const audible = job.mirror.filter((t) => t.status !== 'error');
        if (audible.length > 0) {
          job.fallback = true;
          job.turns = audible.map((t) => ({ ...t, status: 'video', audioOnly: true }));
          advance();
          return;
        }
      }
      finishJob();
      return;
    }
    // Wait a bounded time for more before finishing.
    if (!job.quiet) {
      const waitMs = job.kind === 'eleven'
        ? (job.turns.length === 0 ? ELEVEN_STARTUP_MS : ELEVEN_QUIET_FINISH_MS)
        : (job.turns.length === 0 ? STARTUP_MS : QUIET_FINISH_MS);
      job.quiet = setTimeout(() => finishJob(), waitMs);
    }
  }, [finishJob, handleVideoEnded]);

  useEffect(() => { advanceRef.current = advance; }, [advance]);

  // Start the next video job when idle.
  useEffect(() => {
    if (!seededRef.current || jobRef.current) return;
    const next = utterances.find(
      (u) => u.source === 'agent-reply'
        && (u.maskyOutput === 'video' || u.maskyOutput === 'eleven-video')
        && u.maskyViewerToken && u.maskyAnchorTurnId
        && !playedRef.current.has(u.id),
    );
    if (!next?.maskyViewerToken || !next.maskyAnchorTurnId) return;
    playedRef.current.add(next.id);

    const job: Job = {
      kind:        next.maskyOutput === 'eleven-video' ? 'eleven' : 'masky',
      uttId:       next.id,
      avatarId:    next.avatarId ?? avatarIdFromUserId(next.userId),
      viewerToken: next.maskyViewerToken,
      anchorId:    next.maskyAnchorTurnId,
      turns:       [],
      mirror:      [],
      done:        false,
      fallback:    false,
      playIdx:     0,
      playing:     false,
      unsub:       null,
      quiet:       null,
    };
    jobRef.current = job;
    setVideoSpeakingId(job.avatarId);
    if (job.kind === 'eleven') setElevenKey(`${guildId}:${channelId}:${job.uttId}`);

    // Watch the mirror for both kinds: it drives playback for masky jobs, and
    // live captions + the audio fallback for eleven jobs (whose playable clips
    // arrive via the Convex subscription below).
    const db = getFirebaseDb();
    const q = query(collection(db, 'liveTurns', job.viewerToken, 'turns'), orderBy('createdAt', 'asc'));
    job.unsub = onSnapshot(q, (snap) => {
      // Collect the contiguous run of avatar turns starting at the anchor.
      const docs = snap.docs;
      const anchorIdx = docs.findIndex((d) => d.id === job.anchorId);
      const turns: PlayTurn[] = [];
      if (anchorIdx >= 0) {
        for (let i = anchorIdx; i < docs.length; i++) {
          const d = docs[i].data();
          if (d.role !== 'avatar') break;
          turns.push({ id: docs[i].id, status: (d.status as string) ?? 'pending', text: ((d.avatarText as string) ?? '').trim() });
        }
      }
      if (job.kind === 'eleven') {
        job.mirror = turns.map((t) => ({ ...t, src: liveAudioUrl(job.viewerToken, t.id) }));
      } else {
        job.turns = turns;
      }
      const text = turns.map((t) => t.text).filter(Boolean).join(' ');
      setTextByUtterance((m) => (m[job.uttId] === text ? m : { ...m, [job.uttId]: text }));
      advanceRef.current();
    }, () => { if (job.kind !== 'eleven') finishJob(); });
  }, [utterances, tick, finishJob, guildId, channelId]);

  // Feed the active eleven job from its Convex row: each uploaded clip becomes a
  // ready "video" turn; `done` lets playback finish without a quiet timeout.
  const elevenJob = useQuery(api.elevenLipsync.forKey, elevenKey ? { key: elevenKey } : 'skip');
  useEffect(() => {
    const job = jobRef.current;
    if (!job || job.kind !== 'eleven' || !elevenJob) return;
    if (!job.fallback) {
      job.turns = elevenJob.clips
        .filter((c) => !!c.url)
        .map((c) => ({ id: String(c.idx), status: 'video', text: (c.text ?? '').trim(), src: c.url as string }));
    }
    job.done = elevenJob.done;
    advanceRef.current();
  }, [elevenJob]);

  // Cleanup on unmount.
  useEffect(() => () => {
    jobRef.current?.unsub?.();
    if (jobRef.current?.quiet) clearTimeout(jobRef.current.quiet);
    stopAudio();
  }, [stopAudio]);

  return { videoSpeakingId, videoSrc, handleVideoEnded, textByUtterance };
}
