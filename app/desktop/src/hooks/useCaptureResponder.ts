import { useEffect, useRef } from 'react';
import { getFirebaseRtdb } from '@maskord/shared';
import { ref, onValue, set, remove } from 'firebase/database';
import { uploadAttachment } from '../lib/convexUploads';

/**
 * Answers the agent's requests for a frame of what this user is sharing.
 *
 * Screen and camera shares are peer-to-peer, so the Cloud Function cannot see
 * them. When the model calls capture_stream, the function writes a request onto
 * the sharer's own voice-state node; this hook notices it, grabs a frame from
 * the local track, uploads it to Convex, and writes the URL back. Both legs go
 * through a node the user is already allowed to write.
 *
 * Only the sharer answers for their own stream: they always hold the live local
 * track, so it does not matter who happens to be watching.
 */
export function useCaptureResponder(opts: {
  guildId: string | null;
  channelId: string | null;
  userId: string | null;
  localStream: MediaStream | null;
  isSharing: boolean;
}) {
  const { guildId, channelId, userId, localStream, isSharing } = opts;

  // Read inside the listener without re-subscribing every time the stream object
  // is replaced (which happens on every share start/stop).
  const streamRef = useRef<MediaStream | null>(localStream);
  const sharingRef = useRef(isSharing);
  const handledRef = useRef<Set<string>>(new Set());
  useEffect(() => { streamRef.current = localStream; }, [localStream]);
  useEffect(() => { sharingRef.current = isSharing; }, [isSharing]);

  useEffect(() => {
    if (!guildId || !channelId || !userId) return;

    const rtdb = getFirebaseRtdb();
    const node = ref(rtdb, `voiceState/${guildId}/${channelId}/${userId}`);
    const requestRef = ref(rtdb, `voiceState/${guildId}/${channelId}/${userId}/captureRequest`);
    const resultRef  = ref(rtdb, `voiceState/${guildId}/${channelId}/${userId}/captureResult`);

    const unsub = onValue(requestRef, async (snap) => {
      const req = snap.val() as { id?: string } | null;
      const id = req?.id;
      if (!id || handledRef.current.has(id)) return;
      handledRef.current.add(id);

      const fail = (error: string) => set(resultRef, { id, error }).catch(() => {});

      if (!sharingRef.current || !streamRef.current) {
        void fail('not sharing');
        return;
      }

      try {
        const blob = await grabFrame(streamRef.current);
        if (!blob) throw new Error('no frame');
        const file = new File([blob], `frame-${Date.now()}.jpg`, { type: 'image/jpeg' });
        const attachment = await uploadAttachment(file);
        await set(resultRef, {
          id,
          url: attachment.url,
          contentType: attachment.contentType,
          size: attachment.size,
        });
      } catch (err) {
        void fail(err instanceof Error ? err.message : 'capture failed');
      }
    });

    return () => {
      unsub();
      // Leave no stale answer behind for the next session in this channel.
      remove(ref(rtdb, `${node.toString()}/captureResult`)).catch(() => {});
    };
  }, [guildId, channelId, userId]);
}

/**
 * Draw the stream's current video frame to a canvas and encode it as JPEG.
 *
 * A hidden <video> is used rather than ImageCapture.grabFrame, which Firefox
 * and Safari do not implement. MediaStream-backed video does not taint the
 * canvas, so toBlob works.
 */
async function grabFrame(stream: MediaStream): Promise<Blob | null> {
  const track = stream.getVideoTracks()[0];
  if (!track) return null;

  const video = document.createElement('video');
  video.srcObject = new MediaStream([track]);
  video.muted = true;
  video.playsInline = true;

  try {
    await video.play();
    // Wait for a frame with real dimensions — a just-started element reports 0.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && (video.videoWidth === 0 || video.readyState < 2)) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!video.videoWidth) return null;

    // Cap the long edge: the agent gets charged input tokens per pixel, and a
    // 4K screen share is no more legible than a 1280px one.
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8);
    });
  } finally {
    video.pause();
    video.srcObject = null;
  }
}
