import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { getFirebaseDb, useTranscript } from '@maskord/shared';

// ─── Talking-head (video) playback ─────────────────────────────────────────────
//
// "Talking head" replies are non-blocking: the Cloud Function fires the masky
// turn and records a pointer on the transcript doc (`maskyOutput: 'video'`,
// `maskyViewerToken`, `maskyAnchorTurnId`). We watch the PUBLIC liveTurns mirror
// (`liveTurns/{viewerToken}/turns`) and play each chunk's talking-head video in
// the speaking avatar's tile as it finishes rendering (~30–60s/chunk). The video
// carries its own audio, so audio-only playback (ChatPanel) skips these.

const liveVideoUrl = (token: string, turnId: string) =>
  `https://masky.ai/api/live-media/${token}/${turnId}/video`;

// After the last known chunk plays, wait this long for another chunk to appear
// (masky renders chunks serially, ~45s each) before considering the reply done.
const QUIET_FINISH_MS = 50_000;
// How long to wait for the FIRST chunk to show up in the mirror before giving up
// (audio stage lands in seconds; this is a safety net so the tile never sticks).
const STARTUP_MS = 90_000;

interface MirrorTurn { id: string; status: string; text: string }

interface Job {
  uttId:      string;
  avatarId:   string | null;
  viewerToken: string;
  anchorId:   string;
  turns:      MirrorTurn[];
  playIdx:    number;
  playing:    boolean;
  unsub:      (() => void) | null;
  quiet:      ReturnType<typeof setTimeout> | null;
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

  const [videoSpeakingId, setVideoSpeakingId] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [textByUtterance, setTextByUtterance] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0); // bumped to look for the next job

  // On join, mark existing replies as seen so we don't replay history.
  useEffect(() => {
    if (seededRef.current || loading) return;
    for (const u of utterances) {
      if (u.source === 'agent-reply') playedRef.current.add(u.id);
    }
    seededRef.current = true;
  }, [loading, utterances]);

  const finishJob = useCallback(() => {
    const job = jobRef.current;
    if (!job) return;
    job.unsub?.();
    if (job.quiet) clearTimeout(job.quiet);
    jobRef.current = null;
    setVideoSpeakingId(null);
    setVideoSrc(null);
    setTick((t) => t + 1);
  }, []);

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
        setVideoSrc(liveVideoUrl(job.viewerToken, cur.id));
      }
      // else: chunk still rendering (pending/audio) — the next snapshot wakes us.
      return;
    }
    // No chunk at playIdx: either the first chunk hasn't appeared yet, or we've
    // played them all. Wait a bounded time for more before finishing.
    if (!job.quiet) {
      const waitMs = job.turns.length === 0 ? STARTUP_MS : QUIET_FINISH_MS;
      job.quiet = setTimeout(() => finishJob(), waitMs);
    }
  }, [finishJob]);

  useEffect(() => { advanceRef.current = advance; }, [advance]);

  const handleVideoEnded = useCallback(() => {
    const job = jobRef.current;
    if (!job) return;
    job.playing = false;
    setVideoSrc(null);
    job.playIdx += 1;
    advanceRef.current();
  }, []);

  // Start the next video job when idle.
  useEffect(() => {
    if (!seededRef.current || jobRef.current) return;
    const next = utterances.find(
      (u) => u.source === 'agent-reply'
        && u.maskyOutput === 'video'
        && u.maskyViewerToken && u.maskyAnchorTurnId
        && !playedRef.current.has(u.id),
    );
    if (!next?.maskyViewerToken || !next.maskyAnchorTurnId) return;
    playedRef.current.add(next.id);

    const job: Job = {
      uttId:       next.id,
      avatarId:    next.avatarId ?? avatarIdFromUserId(next.userId),
      viewerToken: next.maskyViewerToken,
      anchorId:    next.maskyAnchorTurnId,
      turns:       [],
      playIdx:     0,
      playing:     false,
      unsub:       null,
      quiet:       null,
    };
    jobRef.current = job;
    setVideoSpeakingId(job.avatarId);

    const db = getFirebaseDb();
    const q = query(collection(db, 'liveTurns', job.viewerToken, 'turns'), orderBy('createdAt', 'asc'));
    job.unsub = onSnapshot(q, (snap) => {
      // Collect the contiguous run of avatar turns starting at the anchor.
      const docs = snap.docs;
      const anchorIdx = docs.findIndex((d) => d.id === job.anchorId);
      const turns: MirrorTurn[] = [];
      if (anchorIdx >= 0) {
        for (let i = anchorIdx; i < docs.length; i++) {
          const d = docs[i].data();
          if (d.role !== 'avatar') break;
          turns.push({ id: docs[i].id, status: (d.status as string) ?? 'pending', text: ((d.avatarText as string) ?? '').trim() });
        }
      }
      job.turns = turns;
      const text = turns.map((t) => t.text).filter(Boolean).join(' ');
      setTextByUtterance((m) => (m[job.uttId] === text ? m : { ...m, [job.uttId]: text }));
      advanceRef.current();
    }, () => finishJob());
  }, [utterances, tick, finishJob]);

  // Cleanup on unmount.
  useEffect(() => () => { jobRef.current?.unsub?.(); if (jobRef.current?.quiet) clearTimeout(jobRef.current.quiet); }, []);

  return { videoSpeakingId, videoSrc, handleVideoEnded, textByUtterance };
}
