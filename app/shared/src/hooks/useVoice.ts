import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ref,
  child,
  set,
  get,
  update,
  onValue,
  onChildAdded,
  push,
  onDisconnect,
  remove,
  type DatabaseReference,
} from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseRtdb, getFirebaseFunctions } from '../firebase/init';
import type { VoiceState, IceCandidate, RTCSignalDescription } from '../types';

// Fallback ICE config used only if the Cloud Function call fails.
// The getTurnCredentials Cloud Function returns TURN relays too — always prefer that.
const STUN_ONLY_FALLBACK: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 48000,
};

// Debug logger — filter by '[voice]' in the browser console
const log  = (...a: unknown[]) => console.log('[voice]', ...a);
const warn = (...a: unknown[]) => console.warn('[voice]', ...a);

export interface VoiceParticipant {
  userId: string;
  state: VoiceState;
  stream?: MediaStream;
}

export interface JoinOptions {
  deviceId?: string;
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
  // Set of peer userIds whose WebRTC negotiation is still in progress
  const [connectingPeers, setConnectingPeers] = useState<Set<string>>(new Set());

  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreams   = useRef<Map<string, MediaStream>>(new Map());
  const voiceStateRef   = useRef<DatabaseReference | null>(null);
  // Cached ICE servers (fetched once per join from getTurnCredentials Cloud Function)
  const iceServersRef    = useRef<RTCIceServer[]>(STUN_ONLY_FALLBACK);
  // Refs so closures (VAD/PTT/reconnect timers) always read current values
  const isMutedRef      = useRef(false);
  const localStreamRef  = useRef<MediaStream | null>(null);
  useEffect(() => { isMutedRef.current     = isMuted;      }, [isMuted]);
  useEffect(() => { localStreamRef.current = localStream;  }, [localStream]);

  // Fetch ICE servers (STUN + TURN) from Cloud Function; caches result for the session.
  const getIceServers = useCallback(async (): Promise<RTCIceServer[]> => {
    // Return cached value if already fetched (TURN credentials are valid for hours)
    if (iceServersRef.current !== STUN_ONLY_FALLBACK) return iceServersRef.current;
    try {
      const fn = httpsCallable<void, RTCIceServer[]>(getFirebaseFunctions(), 'getTurnCredentials');
      const result = await fn();
      log('ICE servers fetched — servers:', result.data.length);
      iceServersRef.current = result.data;
      return result.data;
    } catch (e) {
      warn('getTurnCredentials failed, using STUN-only fallback:', e);
      return STUN_ONLY_FALLBACK;
    }
  }, []);

  // ─── Participant list (RTDB presence) ────────────────────────────────────────

  useEffect(() => {
    if (!guildId || !channelId) { setParticipants([]); return; }

    const rtdb = getFirebaseRtdb();
    const channelRef = ref(rtdb, `voiceState/${guildId}/${channelId}`);

    const unsub = onValue(channelRef, (snap) => {
      const data = snap.val() as Record<string, VoiceState> | null;

      // Proactively close PCs for participants who left the channel.
      // This eliminates the race where a reconnecting peer's new offer arrives
      // before WebRTC has detected that the old connection is dead, which would
      // cause the incoming-call handler to see a 'connected' PC and skip the offer.
      peerConnections.current.forEach((pc, userId) => {
        if (!data?.[userId]) {
          log(`Participant ${userId} removed from voiceState — closing stale PC`);
          pc.close();
          peerConnections.current.delete(userId);
          remoteStreams.current.delete(userId);
        }
      });

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

  // ─── Join ─────────────────────────────────────────────────────────────────────

  const join = useCallback(async (opts?: JoinOptions) => {
    if (!guildId || !channelId || !localUserId) return;

    log(`join() — channel ${channelId}`);

    // Mark as connected immediately — the user is on the voice channel screen.
    // Audio setup and RTDB writes happen asynchronously; we don't want async
    // failures to leave the status bar stuck on "Connecting...".
    setIsConnected(true);

    // Pre-fetch TURN credentials before getting mic so the first peer connection
    // is created with the full ICE server list (including TURN relays).
    await getIceServers();

    // Attempt to capture the microphone. On platforms where getUserMedia is not
    // available (or the user denies permission) we still join the channel as a
    // listener — presence is written to RTDB and isConnected becomes true.
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: opts?.deviceId
          ? { ...AUDIO_CONSTRAINTS, deviceId: { exact: opts.deviceId } }
          : AUDIO_CONSTRAINTS,
      });
      log('Got local stream — tracks:', stream.getTracks().map(t => `${t.kind}(${t.label || 'default'})`).join(', '));
      setLocalStream(stream);
    } catch (e) {
      warn('getUserMedia failed — joining as listener (no mic):', e);
    }

    const rtdb = getFirebaseRtdb();
    voiceStateRef.current = ref(rtdb, `voiceState/${guildId}/${channelId}/${localUserId}`);
    const voiceData: VoiceState = { joinedAt: Date.now(), muted: !stream, deafened: false };

    // Register presence — retry once if auth token hasn't propagated to RTDB yet
    const writeVoiceState = async (stateRef: DatabaseReference) => {
      try {
        await onDisconnect(stateRef).remove();
        await set(stateRef, voiceData);
        log('Voice state written to RTDB');
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          await onDisconnect(stateRef).remove();
          await set(stateRef, voiceData);
          log('Voice state written to RTDB (retry)');
        } catch (e) { warn('Failed to write voice state:', e); }
      }
    };
    await writeVoiceState(voiceStateRef.current);

    // Initiate calls to everyone already in the channel (one-shot read).
    // Skip if we have no mic stream — we'll receive audio but can't send.
    if (stream) {
      const channelRef = ref(rtdb, `voiceState/${guildId}/${channelId}`);
      onValue(channelRef, async (snap) => {
        const data = snap.val() as Record<string, VoiceState> | null;
        const others = Object.keys(data ?? {}).filter(uid => uid !== localUserId);
        log(`Participants already in channel: [${others.join(', ') || 'none'}]`);
        for (const remoteUserId of others) {
          if (!peerConnections.current.has(remoteUserId)) {
            setConnectingPeers((s) => new Set(s).add(remoteUserId));
            await initiateCall(guildId, channelId, localUserId, remoteUserId, stream);
          }
        }
      }, { onlyOnce: true });
    }
  }, [guildId, channelId, localUserId]);

  // ─── Leave ────────────────────────────────────────────────────────────────────

  const leave = useCallback(async () => {
    log('leave()');
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    remoteStreams.current.clear();

    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);

    const rtdb = getFirebaseRtdb();
    if (voiceStateRef.current) {
      await remove(voiceStateRef.current);
      voiceStateRef.current = null;
    }
    // Clean up any pending inbox entries for this user
    if (localUserId) {
      remove(ref(rtdb, `voiceInbox/${localUserId}`)).catch(() => {});
    }

    setIsConnected(false);
    setIsMuted(false);
    setIsDeafened(false);
    setParticipants([]);
    setConnectingPeers(new Set());
  }, [guildId, channelId, localUserId, localStream]);

  // ─── Mute / deafen ───────────────────────────────────────────────────────────

  const toggleMute = useCallback(() => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = isMuted; // toggling: if muted, re-enable
      setIsMuted(!isMuted);
    }
    if (voiceStateRef.current) set(child(voiceStateRef.current, 'muted'), !isMuted);
  }, [localStream, isMuted]);

  const toggleDeafen = useCallback(() => {
    remoteStreams.current.forEach((stream) => {
      stream.getAudioTracks().forEach((t) => { t.enabled = isDeafened; });
    });
    setIsDeafened(!isDeafened);
  }, [isDeafened]);

  // ─── Hot-swap input device ────────────────────────────────────────────────────

  const updateInputDevice = useCallback(async (deviceId: string) => {
    if (!localStream) return;

    let newStream: MediaStream;
    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId
          ? { ...AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } }
          : AUDIO_CONSTRAINTS,
      });
    } catch {
      newStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
    }

    localStream.getTracks().forEach((t) => t.stop());

    const newTrack = newStream.getAudioTracks()[0];
    if (newTrack) {
      newTrack.enabled = !isMutedRef.current;
      peerConnections.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
        if (sender) sender.replaceTrack(newTrack);
      });
    }

    setLocalStream(newStream);
  }, [localStream]);

  // ─── Replace audio track in all peer connections ─────────────────────────────
  // Used by the avatar voice system to inject synthesized audio mid-call.

  const replaceAudioTrack = useCallback(async (newTrack: MediaStreamTrack | null) => {
    const replacements: Promise<void>[] = [];
    peerConnections.current.forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
      if (sender) replacements.push(sender.replaceTrack(newTrack).catch(() => {}));
    });
    await Promise.all(replacements);
  }, []);

  // ─── Speaking state → RTDB (for sidebar indicators) ─────────────────────────

  const updateSpeakingState = useCallback((speaking: boolean) => {
    if (!voiceStateRef.current) return;
    set(child(voiceStateRef.current, 'speaking'), speaking).catch(() => {});
  }, []);

  // ─── Mask identity → RTDB (so everyone shows the mask, not the real name) ────
  const updateMaskIdentity = useCallback((mask: { name: string; avatarUrl?: string } | null) => {
    const stateRef = voiceStateRef.current;
    if (!stateRef) return;
    set(child(stateRef, 'maskName'),      mask?.name ?? null).catch(() => {});
    set(child(stateRef, 'maskAvatarUrl'), mask?.avatarUrl ?? null).catch(() => {});
  }, []);

  // ─── Listen for incoming calls via per-user inbox ─────────────────────────────
  // Reading the entire voiceSignaling tree is blocked by RTDB rules (root .read: false,
  // individual rooms only readable at $roomId level). Instead the caller writes a small
  // notification to voiceInbox/{calleeId}/{roomId} which the callee can read privately,
  // then does a targeted one-shot read of the specific room.

  useEffect(() => {
    if (!guildId || !channelId || !localUserId || !localStream) return;

    const rtdb = getFirebaseRtdb();
    log('Listening for incoming calls on inbox for', localUserId);

    const unsub = onChildAdded(ref(rtdb, `voiceInbox/${localUserId}`), async (snap) => {
      const roomId = snap.key!;
      log('Inbox notification for room', roomId);

      // One-shot read of the specific signaling room (we have permission at $roomId level)
      const roomSnap = await get(ref(rtdb, `voiceSignaling/${roomId}`));
      const room = roomSnap.val() as {
        offer?: RTCSignalDescription;
        callerId: string;
        calleeId?: string;
        status: string;
      } | null;

      if (!room?.offer || room.status !== 'offer' || room.calleeId !== localUserId) {
        log('Inbox entry', roomId, 'is stale or not for us — skipping');
        return;
      }
      if (peerConnections.current.has(room.callerId)) {
        log('Already connected to', room.callerId, '— skipping duplicate offer');
        return;
      }

      log('Answering call from', room.callerId, 'in room', roomId);
      setConnectingPeers((s) => new Set(s).add(room.callerId));
      await answerCall(roomId, room.callerId, localUserId, room.offer, localStream);

      // Remove inbox entry now that we've handled it
      remove(ref(rtdb, `voiceInbox/${localUserId}/${roomId}`)).catch(() => {});
    });

    return () => unsub();
  }, [guildId, channelId, localUserId, localStream]);

  // ─── Reconnect signal listener ───────────────────────────────────────────────
  // A peer writes voiceReconnectRequest/{ourId}/{theirId} when they detect a broken
  // connection and we are the designated caller (our userId > theirs). We respond by
  // initiating a fresh call to them.

  useEffect(() => {
    if (!guildId || !channelId || !localUserId || !localStream) return;
    const rtdb = getFirebaseRtdb();
    const requestsRef = ref(rtdb, `voiceReconnectRequest/${localUserId}`);

    const unsub = onChildAdded(requestsRef, async (snap) => {
      const requesterId = snap.key!;
      const signalTime = snap.val() as number;

      // Discard stale entries left over from previous sessions
      if (!signalTime || Date.now() - signalTime > 30_000) {
        remove(snap.ref).catch(() => {});
        return;
      }

      remove(snap.ref).catch(() => {});
      log(`Reconnect signal from ${requesterId}`);
      if (peerConnections.current.has(requesterId)) {
        log(`Already connected to ${requesterId} — ignoring signal`);
        return;
      }
      const stream = localStreamRef.current;
      if (!stream) return;
      log(`Initiating reconnect call to ${requesterId}`);
      await initiateCall(guildId, channelId, localUserId, requesterId, stream);
    });

    return () => {
      unsub();
      remove(requestsRef).catch(() => {}); // clean up on leave
    };
  }, [guildId, channelId, localUserId, localStream]);

  // ─── Reconnect all peers with no active connection ────────────────────────────
  // Called externally (e.g. on mic activation) so idle connections are repaired
  // before the user's audio reaches the remote peer.

  const reconnectPeers = useCallback(async () => {
    if (!guildId || !channelId || !localUserId) return;
    const rtdb = getFirebaseRtdb();
    const snap = await get(ref(rtdb, `voiceState/${guildId}/${channelId}`));
    const data = snap.val() as Record<string, VoiceState> | null;
    if (!data) return;

    for (const remoteUserId of Object.keys(data)) {
      if (remoteUserId === localUserId) continue;
      const pc = peerConnections.current.get(remoteUserId);
      if (pc && (pc.connectionState === 'connected' || pc.connectionState === 'connecting')) continue;

      log(`[reconnect] No live connection to ${remoteUserId}`);
      if (localUserId > remoteUserId) {
        if (peerConnections.current.has(remoteUserId)) continue; // already being set up
        const stream = localStreamRef.current;
        if (!stream) continue;
        log(`[reconnect] Calling ${remoteUserId}`);
        await initiateCall(guildId, channelId, localUserId, remoteUserId, stream);
      } else {
        log(`[reconnect] Signaling ${remoteUserId} to call us`);
        await set(ref(rtdb, `voiceReconnectRequest/${remoteUserId}/${localUserId}`), Date.now());
      }
    }
  }, [guildId, channelId, localUserId]);

  // ─── WebRTC — initiate call (we are the caller) ───────────────────────────────

  async function initiateCall(
    guildId: string,
    channelId: string,
    localUserId: string,
    remoteUserId: string,
    stream: MediaStream,
  ) {
    const rtdb = getFirebaseRtdb();
    const roomRef = push(ref(rtdb, 'voiceSignaling'));
    const roomId  = roomRef.key!;

    log(`initiateCall → room ${roomId} | ${localUserId} → ${remoteUserId}`);

    const pc = createPeerConnection(remoteUserId, iceServersRef.current);
    peerConnections.current.set(remoteUserId, pc);

    stream.getTracks().forEach((track) => {
      // Force-enable the track regardless of current VAD state — VAD may have
      // silenced it between join and this call. The remote peer needs an enabled
      // track at connection time; VAD will gate it again once speech is detected.
      track.enabled = true;
      pc.addTrack(track, stream);
      log('  addTrack:', track.kind, '| enabled:', track.enabled);
    });

    pc.onicecandidate = (e) => {
      if (!e.candidate) { log('  offer-side ICE gathering complete'); return; }
      log(`  offer-side ICE candidate: ${e.candidate.type} ${e.candidate.protocol}`);
      push(ref(rtdb, `voiceSignaling/${roomId}/offerCandidates`), {
        candidate:      e.candidate.candidate,
        sdpMid:         e.candidate.sdpMid,
        sdpMLineIndex:  e.candidate.sdpMLineIndex,
      } as IceCandidate);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    log('  offer created — writing to Firebase');

    await set(roomRef, {
      offer:     { type: offer.type, sdp: offer.sdp },
      callerId:  localUserId,
      calleeId:  remoteUserId,
      status:    'offer',
      createdAt: Date.now(),
      guildId,
      channelId,
    });

    // Notify the callee via their private inbox — they can read this but not the
    // whole voiceSignaling tree (root-level .read: false in RTDB rules).
    await set(ref(rtdb, `voiceInbox/${remoteUserId}/${roomId}`), roomId);
    log('  inbox notification sent to', remoteUserId, '— waiting for answer');

    // onValue fires on EVERY change to the room (answer written, then each ICE candidate
    // written to answerCandidates). Using pc.currentRemoteDescription as the guard races:
    // a second onValue callback can fire before the first setRemoteDescription() promise
    // resolves, pass the null check, and then fail with "Called in wrong state: stable" —
    // which corrupts Chrome's internal ICE state even though it throws.
    // Fix: flip a synchronous boolean BEFORE the await so no second call can sneak in.
    let answerHandled = false;
    const unsubRoom = onValue(ref(rtdb, `voiceSignaling/${roomId}`), async (snap) => {
      const room = snap.val();
      if (!room?.answer || answerHandled) return;
      answerHandled = true; // synchronous — blocks any concurrent onValue fire

      // PC may have been closed by the participant-left cleanup before the answer arrived
      if (pc.signalingState === 'closed') {
        warn('  PC already closed — discarding answer from', remoteUserId);
        unsubRoom();
        return;
      }

      log('  got answer from', remoteUserId, '— setting remote description');
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(room.answer));
        log('  remote desc set — unsubscribing room listener, registering answer candidates');
        unsubRoom(); // no more room updates needed after answer is processed

        // onChildAdded fires once per child (existing + new) — no duplicates
        onChildAdded(ref(rtdb, `voiceSignaling/${roomId}/answerCandidates`), async (snap) => {
          const c = snap.val() as IceCandidate;
          log('  adding answer ICE candidate from', remoteUserId);
          try {
            await pc.addIceCandidate(new RTCIceCandidate(c));
          } catch (e) {
            warn('  addIceCandidate(answer) failed:', e);
          }
        });
      } catch (e) {
        warn('  setRemoteDescription(answer) failed:', e);
        answerHandled = false; // allow retry on transient error
      }
    });
  }

  // ─── WebRTC — answer call (we are the callee) ─────────────────────────────────

  async function answerCall(
    roomId: string,
    callerId: string,
    localUserId: string,
    offer: RTCSignalDescription,
    stream: MediaStream,
  ) {
    const rtdb = getFirebaseRtdb();
    const pc = createPeerConnection(callerId, iceServersRef.current);
    peerConnections.current.set(callerId, pc);

    stream.getTracks().forEach((track) => {
      // Force-enable: VAD may have disabled this track during silence before the
      // call arrived. Ensure the remote peer gets an audible track from the start.
      track.enabled = true;
      pc.addTrack(track, stream);
      log('  addTrack (answer):', track.kind, '| enabled:', track.enabled);
    });

    pc.onicecandidate = (e) => {
      if (!e.candidate) { log('  answer-side ICE gathering complete'); return; }
      log(`  answer-side ICE candidate: ${e.candidate.type} ${e.candidate.protocol}`);
      push(ref(rtdb, `voiceSignaling/${roomId}/answerCandidates`), {
        candidate:      e.candidate.candidate,
        sdpMid:         e.candidate.sdpMid,
        sdpMLineIndex:  e.candidate.sdpMLineIndex,
      } as IceCandidate);
    };

    log(`answerCall — room ${roomId} | offer from ${callerId}`);

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      log('  remote desc set (offer from', callerId, ')');
    } catch (e) {
      warn('  setRemoteDescription(offer) failed:', e);
      peerConnections.current.delete(callerId);
      pc.close();
      return;
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    log('  answer created — writing to Firebase');

    // update() not set() — preserves offerCandidates node
    await update(ref(rtdb, `voiceSignaling/${roomId}`), {
      answer: { type: answer.type, sdp: answer.sdp },
      status: 'answer',
    });

    log('  answer written — registering offer candidate listener');

    // setRemoteDescription(offer) was already awaited above, so it's safe to
    // start adding offer-side candidates now.
    // onChildAdded catches any candidates already in Firebase + future ones.
    onChildAdded(ref(rtdb, `voiceSignaling/${roomId}/offerCandidates`), async (snap) => {
      const c = snap.val() as IceCandidate;
      log('  adding offer ICE candidate from', callerId);
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) {
        warn('  addIceCandidate(offer) failed:', e);
      }
    });
  }

  // ─── PeerConnection factory ───────────────────────────────────────────────────

  function createPeerConnection(remoteUserId: string, iceServers: RTCIceServer[]): RTCPeerConnection {
    log(`createPeerConnection [${remoteUserId}] — ICE servers: ${iceServers.length}`);
    const pc = new RTCPeerConnection({ iceServers });

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      log(`ontrack [${remoteUserId}] kind=${e.track.kind} streams=${e.streams.length} stream-id=${stream?.id?.substring(0, 8)}`);
      if (!stream) return;
      remoteStreams.current.set(remoteUserId, stream);
      setParticipants((prev) =>
        prev.map((p) => p.userId === remoteUserId ? { ...p, stream } : p),
      );
    };

    pc.oniceconnectionstatechange = () => {
      log(`ICE [${remoteUserId}]:`, pc.iceConnectionState);
    };

    pc.onicecandidateerror = (e) => {
      // errorCode 701 = TURN allocation failed; 401 = auth error
      warn(`ICE candidate error [${remoteUserId}]: ${e.url} code=${e.errorCode} "${e.errorText}"`);
    };

    pc.onicegatheringstatechange = () => {
      log(`ICE gathering [${remoteUserId}]:`, pc.iceGatheringState);
    };

    pc.onconnectionstatechange = () => {
      log(`Connection [${remoteUserId}]:`, pc.connectionState);

      if (pc.connectionState === 'connected') {
        setConnectingPeers((s) => { const n = new Set(s); n.delete(remoteUserId); return n; });
      }

      if (pc.connectionState === 'failed') {
        peerConnections.current.delete(remoteUserId);
        remoteStreams.current.delete(remoteUserId);
        if (!localUserId || !guildId || !channelId) return;

        // After a short delay, attempt reconnect. The higher userId calls directly;
        // the lower userId signals the higher side via RTDB so only one side calls.
        setTimeout(async () => {
          if (peerConnections.current.has(remoteUserId)) return; // already recovered
          const rtdb = getFirebaseRtdb();
          const snap = await get(ref(rtdb, `voiceState/${guildId}/${channelId}/${remoteUserId}`));
          if (!snap.exists()) return; // peer left
          if (localUserId > remoteUserId) {
            const stream = localStreamRef.current;
            if (!stream) return;
            log(`[${remoteUserId}] Auto-reconnecting (caller) after failure`);
            await initiateCall(guildId, channelId, localUserId, remoteUserId, stream);
          } else {
            log(`[${remoteUserId}] Signaling reconnect request after failure`);
            await set(ref(rtdb, `voiceReconnectRequest/${remoteUserId}/${localUserId}`), Date.now());
          }
        }, 2000);
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
    connectingPeers,
    join,
    leave,
    toggleMute,
    toggleDeafen,
    updateInputDevice,
    replaceAudioTrack,
    updateSpeakingState,
    updateMaskIdentity,
    reconnectPeers,
  };
}

// ─── Guild-wide voice state ────────────────────────────────────────────────────
// Returns { [channelId]: { [userId]: VoiceState } } for a whole guild.
// Used by ChannelSidebar to show who's in each voice channel.

export function useGuildVoiceState(
  guildId: string | null,
): Record<string, Record<string, VoiceState>> {
  const [state, setState] = useState<Record<string, Record<string, VoiceState>>>({});
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!guildId) { setState({}); return; }
    const rtdb = getFirebaseRtdb();
    const guildRef = ref(rtdb, `voiceState/${guildId}`);

    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const unsub = onValue(
      guildRef,
      (snap) => {
        const val = snap.val() as Record<string, Record<string, VoiceState>> | null;
        setState(val ?? {});
      },
      (_err) => {
        retryTimer = setTimeout(() => setRetryKey((k) => k + 1), 3000);
      },
    );

    return () => {
      unsub();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [guildId, retryKey]);

  return state;
}
