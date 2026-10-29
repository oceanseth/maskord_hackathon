import { useEffect, useRef, useState } from 'react';
import { useTranscript } from '@maskord/shared';
import { avatarAudioEl } from '../lib/avatarAudio';
import { useVoiceCtx } from '../components/voice/VoiceProvider';

/** Reply docs use a bot uid of `bot:<guildId>:<avatarId>`. */
function avatarIdFromUserId(userId: string): string | null {
  const parts = userId.split(':');
  return parts[0] === 'bot' && parts.length >= 3 ? parts[2] : null;
}

/**
 * Play each new avatar reply's rendered audio, one at a time.
 *
 * Voice tiles do not carry a MediaStream — the table hears masks because this
 * hook fetches the masky audio and plays it locally. ChatPanel used to own
 * that, but a campaign channel runs VoiceChannel compact and hides ChatPanel,
 * so the player has to live at the voice surface or seated avatars stay mute.
 */
export function useAvatarReplyPlayback(opts: {
  guildId: string;
  channelId: string;
  enabled: boolean;
  onAvatarSpeakingChange?: (avatarId: string | null) => void;
}): { playingId: string | null } {
  const { reportAudioBlocked } = useVoiceCtx();
  const { utterances, loading } = useTranscript(
    opts.enabled ? opts.guildId : null,
    opts.enabled ? opts.channelId : null,
    80,
  );

  const playedRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [recheck, setRecheck] = useState(0);
  const onSpeak = opts.onAvatarSpeakingChange;

  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    seededRef.current = false;
    playedRef.current = new Set();
    busyRef.current = false;
  }, [opts.guildId, opts.channelId, opts.enabled]);

  useEffect(() => {
    if (!opts.enabled || seededRef.current || loading) return;
    for (const u of utterances) {
      if (u.source === 'agent-reply') playedRef.current.add(u.id);
    }
    seededRef.current = true;
  }, [opts.enabled, loading, utterances]);

  useEffect(() => {
    if (!opts.enabled || !seededRef.current || busyRef.current) return;
    const next = utterances.find(
      (u) => u.source === 'agent-reply'
        && u.maskyOutput !== 'video'
        && (u.audioUrls?.length || u.audioUrl)
        && !playedRef.current.has(u.id),
    );
    if (!next) return;
    const urls = next.audioUrls?.length ? next.audioUrls : next.audioUrl ? [next.audioUrl] : [];
    if (urls.length === 0) return;
    playedRef.current.add(next.id);
    busyRef.current = true;
    const speakingId = avatarIdFromUserId(next.userId);

    const finish = () => {
      busyRef.current = false;
      if (!mountedRef.current) return;
      setPlayingId((cur) => (cur === next.id ? null : cur));
      onSpeak?.(null);
      setRecheck((v) => v + 1);
    };
    const playAt = (i: number) => {
      if (!mountedRef.current || i >= urls.length) return finish();
      const el = avatarAudioEl();
      el.onended = () => playAt(i + 1);
      el.onerror = () => playAt(i + 1);
      el.src = urls[i];
      el.play().catch((err) => {
        console.warn('[voice] avatar audio blocked:', err);
        reportAudioBlocked();
        playAt(i + 1);
      });
    };

    setPlayingId(next.id);
    onSpeak?.(speakingId);
    playAt(0);
    // Playback continues via onended; recheck picks up anything queued meanwhile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, utterances, recheck]);

  return { playingId };
}
