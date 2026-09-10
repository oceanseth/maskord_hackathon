import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useTranscript, useUserProfiles, useAuth, appendTranscriptUtterance,
} from '@maskord/shared';
import type { TranscriptUtterance } from '@maskord/shared';
import { formatDistanceToNow } from 'date-fns';
import MessageInput from '../channel/MessageInput';
import MessageAttachments from '../channel/MessageAttachments';
import { uploadAttachment } from '../../lib/convexUploads';
import { avatarAudioEl } from '../../lib/avatarAudio';
import { useVoiceCtx } from './VoiceProvider';

interface AvatarInfo { avatarId: string; displayName: string; thumbnailUrl?: string }

interface Props {
  guildId:    string;
  channelId:  string;
  /** Primary avatar name — used in the header and as a fallback for bot rows. */
  avatarName: string;
  /** Active avatars keyed by avatarId, for resolving each bot reply's name/face. */
  avatarsById?: Record<string, AvatarInfo>;
  /** Live text for talking-head ("video") replies, resolved client-side from the
   *  masky liveTurns mirror (keyed by transcript utterance id). */
  textByUtterance?: Record<string, string>;
  /** The local user's selected mask — typed messages are stamped with it so the
   *  user shows as their mask, not their real name. */
  selfMask?: { name: string; avatarUrl?: string };
  /** Called with the avatarId currently speaking (or null) so the participant
   *  grid can pulse the right tile in sync with audio playback. */
  onAvatarSpeakingChange?: (avatarId: string | null) => void;
}

/** Reply docs use a bot uid of `bot:<guildId>:<avatarId>`. */
function avatarIdFromUserId(userId: string): string | null {
  const parts = userId.split(':');
  return parts[0] === 'bot' && parts.length >= 3 ? parts[2] : null;
}

/**
 * Chat panel for a voice channel. Members type messages directly; their
 * spoken words get appended automatically (browser STT, source: 'stt')
 * and are flagged with a "transcribed" badge. The AI avatar's replies
 * stream in with source 'agent-reply' and autoplay any attached audio.
 *
 * Backed by `guilds/{gid}/channels/{cid}/transcript`.
 */
export default function ChatPanel({ guildId, channelId, avatarName, avatarsById, textByUtterance, selfMask, onAvatarSpeakingChange }: Props) {
  const { firebaseUser } = useAuth();
  const { reportAudioBlocked } = useVoiceCtx();
  const { utterances, loading } = useTranscript(guildId, channelId, 80);

  const uids = useMemo(
    () => [...new Set(utterances.map((u) => u.userId).filter(Boolean))],
    [utterances],
  );
  const profiles = useUserProfiles(uids);

  // ── Pin to bottom on new entries ──
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [utterances.length, utterances[utterances.length - 1]?.text]);

  // ── Avatar audio autoplay ──
  // Each new agent-reply is played once. Long replies are chunked by masky into
  // multiple audio URLs (`audioUrls`); we play them back-to-back so the whole
  // reply is heard in order. Falls back to the single `audioUrl`.
  const playedRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false); // history seeded so we don't replay on join
  const busyRef   = useRef(false); // a reply is currently playing
  const mountedRef = useRef(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [recheck, setRecheck] = useState(0); // bumped when a reply finishes

  useEffect(() => () => { mountedRef.current = false; }, []);

  // On join, mark every reply already in the transcript as played so we only
  // hear NEW turns — not a recap of the whole conversation. Runs before the
  // autoplay effect (declared first) so nothing historical sneaks through.
  useEffect(() => {
    if (seededRef.current || loading) return;
    for (const u of utterances) {
      if (u.source === 'agent-reply') playedRef.current.add(u.id);
    }
    seededRef.current = true;
  }, [loading, utterances]);

  useEffect(() => {
    // One reply at a time — don't interleave with an in-flight playback.
    if (!seededRef.current || busyRef.current) return;
    const next = utterances.find(
      (u) => u.source === 'agent-reply'
        && u.maskyOutput !== 'video'       // video replies play in the tile, not here
        && (u.audioUrls?.length || u.audioUrl)
        && !playedRef.current.has(u.id),
    );
    if (!next) return;
    const urls = next.audioUrls?.length ? next.audioUrls : next.audioUrl ? [next.audioUrl] : [];
    if (urls.length === 0) return;
    playedRef.current.add(next.id);
    busyRef.current = true;
    const speakingId = avatarIdFromUserId(next.userId);

    // Playback is driven by onended callbacks, NOT this effect's lifecycle, so
    // it survives transcript updates (which re-run the effect) mid-sentence.
    const finish = () => {
      busyRef.current = false;
      if (!mountedRef.current) return;
      setPlayingId((cur) => (cur === next.id ? null : cur));
      onAvatarSpeakingChange?.(null);
      setRecheck((v) => v + 1); // pick up any reply that queued while we played
    };
    const playAt = (i: number) => {
      if (!mountedRef.current || i >= urls.length) return finish();
      // One element reused for every chunk, unlocked by the first user gesture.
      // A fresh `new Audio()` per chunk is blocked outright on mobile: iOS only
      // permits playback on elements a gesture has already started, so each new
      // element was silently skipped and the avatar appeared mute.
      const el = avatarAudioEl();
      el.onended = () => playAt(i + 1);
      el.onerror = () => playAt(i + 1); // skip a failed chunk, keep the rest
      el.src = urls[i];
      el.play().catch((err) => {
        console.warn('[chat] avatar audio blocked:', err);
        // Surface it instead of swallowing it — the same banner that unlocks
        // remote peer audio also unlocks this.
        reportAudioBlocked();
        playAt(i + 1);
      });
    };

    setPlayingId(next.id);
    onAvatarSpeakingChange?.(speakingId);
    playAt(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utterances, recheck]);

  // ── Send typed message ──
  async function handleSend(text: string) {
    if (!firebaseUser) return;
    await appendTranscriptUtterance(guildId, channelId, {
      userId: firebaseUser.uid,
      text,
      source: 'typed',
      maskName:      selfMask?.name,
      maskAvatarUrl: selfMask?.avatarUrl,
    });
  }

  /**
   * Files shared into a voice channel ride on the transcript, same as typed
   * messages. The bytes go to Convex; the utterance carries the resolved URL.
   * Transcript rules require non-empty text, so the filename is the caption.
   */
  const sendFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!firebaseUser) return;
      setUploadError(null);

      for (const file of Array.from(files)) {
        setUploading(file.name);
        try {
          const attachment = await uploadAttachment(file);
          await appendTranscriptUtterance(guildId, channelId, {
            userId: firebaseUser.uid,
            text:   file.name,
            source: 'typed',
            maskName:      selfMask?.name,
            maskAvatarUrl: selfMask?.avatarUrl,
            attachments:   [attachment],
          });
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
          setUploading(null);
        }
      }
    },
    [firebaseUser, guildId, channelId, selfMask],
  );

  const dragDepth = useRef(0);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer?.types.includes('Files');

  return (
    <div
      className="relative flex-shrink-0 border-t border-[#1e1e2e] bg-[#0a0a0f] flex flex-col h-64 md:h-80"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (e.dataTransfer.files.length) void sendFiles(e.dataTransfer.files);
      }}
    >
      {dragging && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#0a0a0f]/85 backdrop-blur-sm pointer-events-none">
          <div className="px-8 py-6 rounded-2xl border-2 border-dashed border-violet-500 text-center">
            <p className="text-white font-semibold text-lg">Drop to share in chat</p>
          </div>
        </div>
      )}
      {/* Header — hidden on mobile to leave room for the participant grid + the
          voice controls bar (which is what users need to reach on small screens). */}
      <div className="hidden md:flex items-center justify-between px-4 py-2 border-b border-[#1e1e2e] flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[#6b7280] text-base leading-none">#</span>
          <span className="text-sm font-semibold text-white">Chat</span>
        </div>
        <span className="text-[10px] text-[#4b5563]">
          Spoken words are transcribed inline. Address <span className="font-mono text-[#9ca3af]">@{avatarName}</span> to involve the avatar.
        </span>
      </div>

      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollable py-2">
        {loading && (
          <p className="px-4 py-2 text-xs text-[#4b5563] italic">Loading…</p>
        )}
        {!loading && utterances.length === 0 && (
          <p className="px-4 py-2 text-xs text-[#4b5563] italic">
            No one has said anything yet. Type a message or start talking.
          </p>
        )}
        {utterances.map((u) => (
          <ChatRow
            key={u.id}
            utterance={u}
            profile={profiles[u.userId]}
            avatarName={avatarName}
            avatarsById={avatarsById}
            overrideText={textByUtterance?.[u.id]}
            isPlaying={u.id === playingId}
          />
        ))}
      </div>

      {/* Input bar — same component as text channels */}
      {uploadError && (
        <p className="px-3 pb-1 text-xs text-red-400">{uploadError}</p>
      )}
      <MessageInput
        placeholder="Send a message…"
        onSend={handleSend}
        padding="px-3 pb-3"
        disabled={!firebaseUser}
        onAttach={sendFiles}
        uploading={uploading}
      />
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function ChatRow({ utterance, profile, avatarName, avatarsById, overrideText, isPlaying }: {
  utterance: TranscriptUtterance;
  profile?:   { displayName?: string; twitchUsername?: string; avatarUrl?: string };
  avatarName: string;
  avatarsById?: Record<string, AvatarInfo>;
  overrideText?: string;
  isPlaying?: boolean;
}) {
  const isBot = utterance.userId.startsWith('bot:') || utterance.source === 'agent-reply';
  // Prefer the identity stamped on the doc (stable forever), then the live
  // avatar map, then the primary name — so a bot row never flips identity when
  // an avatar leaves/rejoins the channel.
  const botInfo = isBot
    ? avatarsById?.[utterance.avatarId ?? avatarIdFromUserId(utterance.userId) ?? '']
    : undefined;
  const name  = isBot
    ? utterance.botName ?? botInfo?.displayName ?? avatarName
    : utterance.maskName ?? profile?.displayName ?? profile?.twitchUsername ?? utterance.userId.slice(0, 6);
  const avatar = isBot
    ? (utterance.botAvatarUrl || botInfo?.thumbnailUrl)
    : (utterance.maskAvatarUrl || profile?.avatarUrl);
  // Talking-head replies stream their text in client-side via `overrideText`.
  const bodyText = overrideText && overrideText.length ? overrideText : utterance.text;
  const initials = name.substring(0, 2).toUpperCase();
  const time = utterance.createdAt
    ? formatDistanceToNow(utterance.createdAt.toDate(), { addSuffix: true })
    : '';

  return (
    <div className="group flex gap-3 px-4 py-1 hover:bg-[#1a1a28]/40 transition-colors">
      {/* Avatar */}
      <div className={`w-10 h-10 rounded-full overflow-hidden flex-shrink-0 mt-0.5 flex items-center justify-center
        ${isBot ? 'bg-violet-600/40' : 'bg-violet-600/30'}`}>
        {avatar
          ? <img src={avatar} alt={name} className="w-full h-full object-cover" />
          : <span className="text-xs font-bold text-violet-200">{initials}</span>
        }
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
          <span className={`font-semibold text-sm ${isBot ? 'text-violet-300' : 'text-white'}`}>
            {name}
          </span>
          <span className="text-[10px] text-[#4b5563]">{time}</span>
          <SourceBadge source={utterance.source} />
          {utterance.streaming && !bodyText && (
            <span className="text-[10px] text-[#4b5563] italic">
              {utterance.maskyOutput === 'video' ? 'rendering…' : 'streaming…'}
            </span>
          )}
          {isPlaying && (
            <span className="text-[10px] text-green-400 italic">speaking…</span>
          )}
        </div>
        <p className="text-sm text-[#d4d8e0] whitespace-pre-wrap break-words selectable leading-relaxed">
          {bodyText}
        </p>
        <MessageAttachments attachments={utterance.attachments} />
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: TranscriptUtterance['source'] }) {
  if (source === 'typed' || source === 'agent-reply') return null;

  if (source === 'stt') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wider text-[#6b7280] bg-[#1e1e2e] rounded px-1.5 py-0.5">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" /></svg>
        transcribed
      </span>
    );
  }

  // masky-rewrite
  return (
    <span className="text-[9px] uppercase tracking-wider text-violet-400/80 bg-violet-900/30 rounded px-1.5 py-0.5">
      mask
    </span>
  );
}
