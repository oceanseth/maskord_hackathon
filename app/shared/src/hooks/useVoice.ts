import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ref,
  set,
  onValue,
  push,
  onDisconnect,
  serverTimestamp,
  remove,
  type DatabaseReference,
} from 'firebase/database';
import { getFirebaseRtdb } from '../firebase/init';
import type { VoiceState, IceCandidate, RTCSignalDescription } from '../types';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export interface VoiceParticipant {
  userId: string;
  state: VoiceState;
  stream?: MediaStream;
}

export function useVoiceChannel(
  guildId: string | null,
  channelId: string | null,
  localUserId: string | null,
) {
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreams = useRef<Map<string, MediaStream>>(new Map());
  const voiceStateRef = useRef<DatabaseReference | null>(null);

  // Subscribe to participant list
  useEffect(() => {
    if (!guildId || !channelId) { setParticipants([]); return; }

    const rtdb = getFirebaseRtdb();
    const channelRef = ref(rtdb, `voiceState/${guildId}/${channelId}`);

    const unsub = onValue(channelRef, (snap) => {
      const data = snap.val() as Record<string, VoiceState> | null;
      if (!data) { setParticipants([]); return; }

      setParticipants(
        Object.entries(data).map(([userId, state]) => ({
          userId,
          state,
          stream: remoteStreams.current.get(userId),
        })),
      );
    });

    return () => unsub();
  }, [guildId, channelId]);

  const join = useCallback(async () => {
    if (!guildId || !channelId || !localUserId) return;

    // Get microphone
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    setLocalStream(stream);

    const rtdb = getFirebaseRtdb();
    voiceStateRef.current = ref(rtdb, `voiceState/${guildId}/${channelId}/${localUserId}`);

    // Register presence in voice channel
    await set(voiceStateRef.current, {
      joinedAt: Date.now(),
      muted: false,
      deafened: false,
    });

    // Auto-cleanup on disconnect
    onDisconnect(voiceStateRef.current).remove();

    setIsConnected(true);

    // Start WebRTC signaling with existing participants
    const channelRef = ref(rtdb, `voiceState/${guildId}/${channelId}`);
    onValue(channelRef, async (snap) => {
      const data = snap.val() as Record<string, VoiceState> | null;
      if (!data) return;

      for (const remoteUserId of Object.keys(data)) {
        if (remoteUserId === localUserId) continue;
        if (!peerConnections.current.has(remoteUserId)) {
          await initiateCall(guildId, channelId, localUserId, remoteUserId, stream);
        }
      }
    }, { onlyOnce: true });
  }, [guildId, channelId, localUserId]);

  const leave = useCallback(async () => {
    if (!guildId || !channelId || !localUserId) return;

    // Close all peer connections
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();

    // Stop local stream
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);

    // Remove from voice state
    if (voiceStateRef.current) {
      await remove(voiceStateRef.current);
    }

    setIsConnected(false);
    setParticipants([]);
  }, [guildId, channelId, localUserId, localStream]);

  const toggleMute = useCallback(() => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = isMuted; // toggling: if currently muted, re-enable
      setIsMuted(!isMuted);
    }
    if (voiceStateRef.current) {
      set(ref(getFirebaseRtdb(), voiceStateRef.current.key + '/muted'), !isMuted);
    }
  }, [localStream, isMuted]);

  const toggleDeafen = useCallback(() => {
    remoteStreams.current.forEach((stream) => {
      stream.getAudioTracks().forEach((t) => { t.enabled = isDeafened; }); // toggle
    });
    setIsDeafened(!isDeafened);
  }, [isDeafened]);

  // Listen for incoming calls in this channel
  useEffect(() => {
    if (!guildId || !channelId || !localUserId || !localStream) return;

    const rtdb = getFirebaseRtdb();
    const signalingRef = ref(rtdb, `voiceSignaling`);

    const unsub = onValue(signalingRef, async (snap) => {
      const rooms = snap.val() as Record<string, {
        offer?: RTCSignalDescription;
        answer?: RTCSignalDescription;
        callerId: string;
        calleeId?: string;
        status: string;
      }> | null;

      if (!rooms) return;

      for (const [roomId, room] of Object.entries(rooms)) {
        // Incoming call for us
        if (room.calleeId === localUserId && room.offer && room.status === 'offer') {
          if (!peerConnections.current.has(room.callerId)) {
            await answerCall(roomId, room.callerId, localUserId, room.offer, localStream);
          }
        }
      }
    });

    return () => unsub();
  }, [guildId, channelId, localUserId, localStream]);

  async function initiateCall(
    guildId: string,
    channelId: string,
    localUserId: string,
    remoteUserId: string,
    stream: MediaStream,
  ) {
    const rtdb = getFirebaseRtdb();
    const roomRef = push(ref(rtdb, 'voiceSignaling'));
    const roomId = roomRef.key!;

    const pc = createPeerConnection(remoteUserId);
    peerConnections.current.set(remoteUserId, pc);

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        push(ref(rtdb, `voiceSignaling/${roomId}/offerCandidates`), {
          candidate: e.candidate.candidate,
          sdpMid: e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex,
        } as IceCandidate);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await set(roomRef, {
      offer: { type: offer.type, sdp: offer.sdp },
      callerId: localUserId,
      calleeId: remoteUserId,
      status: 'offer',
      createdAt: Date.now(),
      guildId,
      channelId,
    });

    // Listen for answer
    onValue(ref(rtdb, `voiceSignaling/${roomId}`), async (snap) => {
      const room = snap.val();
      if (room?.answer && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(room.answer));
      }
    });

    // Listen for answer ICE candidates
    onValue(ref(rtdb, `voiceSignaling/${roomId}/answerCandidates`), (snap) => {
      if (!snap.val()) return;
      Object.values(snap.val() as Record<string, IceCandidate>).forEach(async (candidate) => {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      });
    });
  }

  async function answerCall(
    roomId: string,
    callerId: string,
    localUserId: string,
    offer: RTCSignalDescription,
    stream: MediaStream,
  ) {
    const rtdb = getFirebaseRtdb();
    const pc = createPeerConnection(callerId);
    peerConnections.current.set(callerId, pc);

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        push(ref(rtdb, `voiceSignaling/${roomId}/answerCandidates`), {
          candidate: e.candidate.candidate,
          sdpMid: e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex,
        } as IceCandidate);
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    const roomRef = ref(rtdb, `voiceSignaling/${roomId}`);
    await set(roomRef, {
      answer: { type: answer.type, sdp: answer.sdp },
      status: 'answer',
    });

    // Listen for offer ICE candidates
    onValue(ref(rtdb, `voiceSignaling/${roomId}/offerCandidates`), (snap) => {
      if (!snap.val()) return;
      Object.values(snap.val() as Record<string, IceCandidate>).forEach(async (candidate) => {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      });
    });
  }

  function createPeerConnection(remoteUserId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      remoteStreams.current.set(remoteUserId, stream);
      setParticipants((prev) =>
        prev.map((p) => p.userId === remoteUserId ? { ...p, stream } : p),
      );
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        peerConnections.current.delete(remoteUserId);
        remoteStreams.current.delete(remoteUserId);
      }
    };

    return pc;
  }

  return {
    participants,
    localStream,
    isMuted,
    isDeafened,
    isConnected,
    join,
    leave,
    toggleMute,
    toggleDeafen,
  };
}
