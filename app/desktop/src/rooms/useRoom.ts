import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@maskord/convex';
import type { Doc, Id } from '../../../../www/convex/_generated/dataModel';
import { getRunnerId } from './convex';

export type RoomKind = 'debate' | 'wizard';
export type RoomStatus = Doc<'rooms'>['status'];
export type RoomEvent = Doc<'roomEvents'>;
export type RoomEventType = RoomEvent['type'];
export type RoomMember = Doc<'roomMembers'> & { present: boolean };
export type Room = Doc<'rooms'>;

/** The signed-in human this tab represents. */
export interface RoomIdentity {
  key: string; // Firebase uid
  name: string;
  avatarUrl?: string;
}

const HEARTBEAT_MS = 15_000;

/** `?room=<name>` on the page URL picks the table; every kind has a default. */
export function roomSlugFromLocation(kind: RoomKind): string {
  const name = new URLSearchParams(window.location.search).get('room')?.trim() || 'main';
  return `${kind}:${name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40)}`;
}

export interface UseRoomOptions {
  kind: RoomKind;
  slug?: string;
  title: string;
  config?: Record<string, unknown>;
  /** Pass null to spectate without joining (a second screen, a judge's tab). */
  identity: RoomIdentity | null;
}

/**
 * One room, live. Ensures the room exists, joins the caller as a human member
 * (with a heartbeat so they show as present), and subscribes to members and
 * the event log. Kind-specific pages layer their own state on top.
 */
export function useRoom({ kind, slug, title, config, identity }: UseRoomOptions) {
  const resolvedSlug = useMemo(() => slug ?? roomSlugFromLocation(kind), [slug, kind]);

  const ensure = useMutation(api.rooms.ensure);
  const join = useMutation(api.rooms.join);
  const heartbeat = useMutation(api.rooms.heartbeat);
  const postMutation = useMutation(api.rooms.post);
  const setStatusMutation = useMutation(api.rooms.setStatus);
  const setReadyMutation = useMutation(api.rooms.setReady);
  const patchMemberState = useMutation(api.rooms.patchMemberState);
  const patchConfigMutation = useMutation(api.rooms.patchConfig);
  const claimTurnMutation = useMutation(api.rooms.claimTurn);
  const releaseTurnMutation = useMutation(api.rooms.releaseTurn);

  const room = useQuery(api.rooms.get, { slug: resolvedSlug });
  const roomId: Id<'rooms'> | undefined = room?._id;
  const members = useQuery(api.rooms.members, roomId ? { roomId } : 'skip') as
    | RoomMember[]
    | undefined;
  const events = useQuery(api.rooms.events, roomId ? { roomId } : 'skip') as
    | RoomEvent[]
    | undefined;

  // Create the room on first load. `ensure` is idempotent, so two tabs racing
  // is fine; `room === null` means the query resolved and found nothing.
  const ensured = useRef(false);
  useEffect(() => {
    if (room !== null || ensured.current) return;
    ensured.current = true;
    ensure({ slug: resolvedSlug, kind, title, config }).catch((e) => {
      ensured.current = false;
      console.error('rooms.ensure failed', e);
    });
  }, [room, resolvedSlug, kind, title, config, ensure]);

  // Join and heartbeat.
  useEffect(() => {
    if (!roomId || !identity) return;
    let cancelled = false;
    const beat = () => heartbeat({ roomId, memberKey: identity.key }).catch(() => {});
    join({
      roomId,
      memberKey: identity.key,
      kind: 'human',
      name: identity.name,
      avatarUrl: identity.avatarUrl,
    }).catch((e) => console.error('rooms.join failed', e));
    const timer = window.setInterval(() => {
      if (!cancelled) beat();
    }, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [roomId, identity?.key, identity?.name, identity?.avatarUrl, join, heartbeat]);

  const me = useMemo(
    () => (identity && members ? members.find((m) => m.memberKey === identity.key) ?? null : null),
    [members, identity],
  );

  const post = useCallback(
    (type: RoomEventType, body: string, data?: unknown) => {
      if (!roomId || !identity) return Promise.reject(new Error('Not in a room'));
      return postMutation({ roomId, memberKey: identity.key, type, body, data });
    },
    [roomId, identity, postMutation],
  );

  const setStatus = useCallback(
    (status: RoomStatus, reason?: string) => {
      if (!roomId) return Promise.reject(new Error('Not in a room'));
      return setStatusMutation({
        roomId,
        status,
        byKey: identity?.key,
        byName: identity?.name ?? 'room',
        reason,
      });
    },
    [roomId, identity, setStatusMutation],
  );

  const setReady = useCallback(
    (ready: boolean) => {
      if (!roomId || !identity) return Promise.reject(new Error('Not in a room'));
      return setReadyMutation({ roomId, memberKey: identity.key, ready });
    },
    [roomId, identity, setReadyMutation],
  );

  const patchMyState = useCallback(
    (state: Record<string, unknown>) => {
      if (!roomId || !identity) return Promise.reject(new Error('Not in a room'));
      return patchMemberState({ roomId, memberKey: identity.key, state });
    },
    [roomId, identity, patchMemberState],
  );

  const patchConfig = useCallback(
    (patch: Record<string, unknown>) => {
      if (!roomId) return Promise.reject(new Error('Not in a room'));
      return patchConfigMutation({ roomId, config: patch });
    },
    [roomId, patchConfigMutation],
  );

  const claimTurn = useCallback(() => {
    if (!roomId) return Promise.resolve({ ok: false as const, heldBy: undefined, seq: 0 });
    return claimTurnMutation({ roomId, runnerId: getRunnerId() });
  }, [roomId, claimTurnMutation]);

  const releaseTurn = useCallback(() => {
    if (!roomId) return Promise.resolve();
    return releaseTurnMutation({ roomId, runnerId: getRunnerId() });
  }, [roomId, releaseTurnMutation]);

  return {
    slug: resolvedSlug,
    room: room ?? null,
    roomId,
    loading: room === undefined || (roomId !== undefined && (members === undefined || events === undefined)),
    members: members ?? [],
    events: events ?? [],
    me,
    humans: (members ?? []).filter((m) => m.kind === 'human'),
    masks: (members ?? []).filter((m) => m.kind === 'mask'),
    host: (members ?? []).find((m) => m.kind === 'host') ?? null,
    post,
    setStatus,
    setReady,
    patchMyState,
    patchConfig,
    claimTurn,
    releaseTurn,
  };
}

export type RoomHandle = ReturnType<typeof useRoom>;
