import { useEffect, useState } from 'react';
import {
  collection, onSnapshot, orderBy, query, limit, addDoc, serverTimestamp,
  type Timestamp,
} from 'firebase/firestore';
import { getFirebaseDb } from '../firebase/init';
import type { Attachment } from '../types';

export interface TranscriptUtterance {
  id:        string;
  userId:    string;
  text:      string;
  /** Files shared into the voice channel. Bytes live in Convex storage; only
   *  the resolved URL and metadata are stored here. The transcript rules
   *  validate specific fields rather than restricting the key set, so this
   *  extra field is accepted without a rules change. */
  attachments?: Attachment[];
  /** Origin: typed message in the voice channel chat, client STT, the masky
   *  avatar rewrite pipeline, or the AI agent's reply. */
  source:    'typed' | 'stt' | 'masky-rewrite' | 'agent-reply';
  createdAt: Timestamp | null;
  /** Set by the worker when an agent reply has been synthesised into audio.
   *  Single-chunk convenience mirror of `audioUrls[0]`. */
  audioUrl?: string;
  /** Ordered audio URLs for a multi-chunk agent reply (masky auto-chunks long
   *  replies). Played back-to-back so the whole reply is heard in order. */
  audioUrls?: string[];
  /** Talking-head ("video") reply pointer. The function fires the masky turn
   *  non-blocking and records these; the client watches the public liveTurns
   *  mirror and plays each chunk's video as it renders. */
  maskyOutput?: 'audio' | 'video';
  maskyViewerToken?: string;
  maskyAnchorTurnId?: string;
  /** Which avatar produced this reply (`avatarId`), for routing to its tile. */
  avatarId?: string;
  /** Avatar identity stamped at write time, so bot rows render the right
   *  name/face permanently — even after the avatar leaves the channel. */
  botName?: string;
  botAvatarUrl?: string;
  /** When a human speaker had a mask selected, their displayed identity is the
   *  mask, not their real profile name/avatar. */
  maskName?: string;
  maskAvatarUrl?: string;
  /** True while a server-side agent reply is still streaming in. */
  streaming?: boolean;
}

/**
 * Live transcript for a voice channel. Each entry is one utterance (a member's
 * STT, the masky avatar-rewrite output, or Claude's reply text).
 *
 * Use this in voice channel UIs to render a chat panel under the video grid.
 */
export function useTranscript(
  guildId: string | null,
  channelId: string | null,
  pageSize = 50,
) {
  const [utterances, setUtterances] = useState<TranscriptUtterance[]>([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    if (!guildId || !channelId) {
      setUtterances([]);
      setLoading(false);
      return;
    }
    const db = getFirebaseDb();
    const q  = query(
      collection(db, 'guilds', guildId, 'channels', channelId, 'transcript'),
      orderBy('createdAt', 'desc'),
      limit(pageSize),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: TranscriptUtterance[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id:        d.id,
          userId:    (data.userId as string) ?? '',
          text:      (data.text as string) ?? '',
          source:    (data.source as TranscriptUtterance['source']) ?? 'stt',
          attachments: (data.attachments as Attachment[] | undefined) ?? undefined,
          createdAt: (data.createdAt as Timestamp | null) ?? null,
          audioUrl:  data.audioUrl as string | undefined,
          audioUrls: data.audioUrls as string[] | undefined,
          maskyOutput:       data.maskyOutput as 'audio' | 'video' | undefined,
          maskyViewerToken:  data.maskyViewerToken as string | undefined,
          maskyAnchorTurnId: data.maskyAnchorTurnId as string | undefined,
          avatarId:  data.avatarId as string | undefined,
          botName:      data.botName as string | undefined,
          botAvatarUrl: data.botAvatarUrl as string | undefined,
          maskName:      data.maskName as string | undefined,
          maskAvatarUrl: data.maskAvatarUrl as string | undefined,
          streaming: data.streaming === true,
        };
      });
      // oldest first
      list.reverse();
      setUtterances(list);
      setLoading(false);
    }, () => setLoading(false));

    return unsub;
  }, [guildId, channelId, pageSize]);

  return { utterances, loading };
}

/**
 * Append an utterance to the channel transcript. Called by client-side STT
 * writers and by the masky avatar rewrite pipeline.
 */
export async function appendTranscriptUtterance(
  guildId: string,
  channelId: string,
  utt: {
    userId: string;
    text:   string;
    source: 'typed' | 'stt' | 'masky-rewrite';
    /** When the speaker has a mask selected, their displayed identity is the
     *  mask (not their real profile name/avatar). */
    maskName?:      string;
    maskAvatarUrl?: string;
    /** Files shared into the channel; bytes are already in Convex storage. */
    attachments?:   Attachment[];
  },
): Promise<void> {
  if (!utt.text.trim()) return;
  const db  = getFirebaseDb();
  const ref = collection(db, 'guilds', guildId, 'channels', channelId, 'transcript');
  await addDoc(ref, {
    userId:    utt.userId,
    text:      utt.text.trim(),
    source:    utt.source,
    ...(utt.maskName ? { maskName: utt.maskName } : {}),
    ...(utt.maskAvatarUrl ? { maskAvatarUrl: utt.maskAvatarUrl } : {}),
    ...(utt.attachments?.length ? { attachments: utt.attachments } : {}),
    createdAt: serverTimestamp(),
  });
}
