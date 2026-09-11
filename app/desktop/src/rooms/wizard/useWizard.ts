import { useCallback, useMemo } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@maskord/convex';
import type { RoomHandle } from '../useRoom';
import type { Id } from '../../../../../www/convex/_generated/dataModel';
import { dndPhase, type CharacterState, type Combatant, type CreatureState, type Fire, type Phase, type Position, type SheetKey } from '../../../../../www/convex/wizard/types';
import { CAMPAIGNS } from '../../../../../www/convex/wizard/campaigns';
import { MAPS } from '../../../../../www/convex/wizard/scenario';

export type Seat = { ownerKey: string; ownerName: string; ownerKind: 'human' | 'mask'; confirmed: boolean; name: string };
export type Seats = Partial<Record<SheetKey, Seat>>;

export interface WizardAction {
  type: 'move' | 'attack' | 'cast' | 'dodge' | 'dash' | 'disengage' | 'help' | 'hide' | 'search' | 'useObject' | 'secondWind' | 'layOnHands' | 'endTurn';
  to?: Position;
  attackKey?: string;
  spell?: string;
  targetId?: string;
  targetIds?: string[];
  item?: string;
  amount?: number;
  say?: string;
}

/** A channel in D&D mode binds to exactly one table: slug `wizard:ch-<channelId>`. */
export function channelRoomSlug(channelId: string): string {
  return `wizard:ch-${channelId}`;
}

/** The D&D layer over a room: the game document plus the mutations a page needs. */
export function useWizard(room: RoomHandle) {
  const { roomId, me } = room;
  const game = useQuery(api.wizard.get, roomId ? { roomId } : 'skip');
  const roomCfg = (room.room?.config ?? {}) as { guildId?: string; campaign?: string };
  const capabilities = useQuery(api.agent.capabilities, { guildId: roomCfg.guildId });

  const chooseSeat = useMutation(api.wizard.chooseSeat);
  const releaseSeat = useMutation(api.wizard.releaseSeat);
  const confirmSeat = useMutation(api.wizard.confirmSeat);
  const seatMask = useMutation(api.wizard.seatMask);
  const unseatMask = useMutation(api.wizard.unseatMask);
  const start = useMutation(api.wizard.start);
  const act = useMutation(api.wizard.act);
  const setPaused = useMutation(api.wizard.setPaused);
  const askDm = useMutation(api.wizard.askDm);
  const walkUp = useMutation(api.wizard.walkUp);
  const check = useMutation(api.wizard.check);
  const shortRest = useMutation(api.wizard.shortRest);
  const pickCampaign = useMutation(api.wizard.pickCampaign);
  const endSession = useMutation(api.wizard.endSession);
  const playAgain = useMutation(api.wizard.playAgain);
  const newCampaign = useMutation(api.wizard.newCampaign);

  const seats = (game?.seats ?? {}) as Seats;
  const characters = (game?.characters ?? []) as CharacterState[];
  const creatures = (game?.creatures ?? []) as CreatureState[];
  const combatants = (game?.combatants ?? []) as Combatant[];
  const fires = (game?.fires ?? []) as Fire[];
  const phase = (game?.phase ?? 'lobby') as Phase;
  /** The channel's phase (ruleset/characters/play/resolve); `phase` above is the engine's sub-state inside play. */
  const channelPhase = dndPhase(room.room?.phase, game ? phase : undefined);
  const campaign = roomCfg.campaign ? CAMPAIGNS[roomCfg.campaign] ?? null : null;
  const map = MAPS[game?.mapKey ?? 'beach'];

  const mySeatKey = useMemo(
    () => (me ? (Object.keys(seats) as SheetKey[]).find((k) => seats[k]?.ownerKey === me.memberKey) ?? null : null),
    [seats, me],
  );
  const myCharacter = mySeatKey ? characters.find((c) => c.sheetKey === mySeatKey) ?? null : null;
  const activeCombatant = combatants.length ? combatants[(game?.turnIndex ?? 0) % combatants.length] : null;
  const isMyTurn = !!(myCharacter && activeCombatant && activeCombatant.id === `pc:${myCharacter.sheetKey}` && phase === 'combat' && room.room?.status === 'running');

  const withRoom = useCallback(
    <T,>(fn: (roomId: Id<'rooms'>, memberKey: string) => Promise<T>) => {
      if (!roomId || !me) return Promise.reject(new Error('Not at the table'));
      return fn(roomId, me.memberKey);
    },
    [roomId, me],
  );

  return {
    game: game ?? null,
    loading: game === undefined,
    capabilities: capabilities ?? { inference: false, research: false, via: 'none' as const },
    seats,
    characters,
    creatures,
    combatants,
    fires,
    phase,
    channelPhase,
    campaign,
    xp: game?.xp ?? 0,
    map,
    turn: (game?.turn ?? { moved: 0, actionUsed: false, bonusUsed: false, dashed: false }) as { moved: number; actionUsed: boolean; bonusUsed: boolean; dashed: boolean },
    round: game?.round ?? 0,
    mySeatKey,
    myCharacter,
    activeCombatant,
    isMyTurn,
    chooseSeat: (sheetKey: SheetKey) => withRoom((roomId, memberKey) => chooseSeat({ roomId, memberKey, sheetKey })),
    releaseSeat: () => withRoom((roomId, memberKey) => releaseSeat({ roomId, memberKey })),
    confirmSeat: (name: string) => withRoom((roomId, memberKey) => confirmSeat({ roomId, memberKey, name })),
    seatMask: (mask: { key: string; name: string; persona: string; avatarUrl?: string }) =>
      withRoom((roomId) => seatMask({ roomId, memberKey: mask.key, name: mask.name, persona: mask.persona, avatarUrl: mask.avatarUrl })),
    unseatMask: (memberKey: string) => withRoom((roomId) => unseatMask({ roomId, memberKey })),
    start: (guildId?: string) => withRoom((roomId, memberKey) => start({ roomId, byKey: memberKey, guildId })),
    act: (action: WizardAction) => withRoom((roomId, memberKey) => act({ roomId, memberKey, action })),
    pause: (reason?: string) => withRoom((roomId, memberKey) => setPaused({ roomId, memberKey, paused: true, reason })),
    resume: () => withRoom((roomId, memberKey) => setPaused({ roomId, memberKey, paused: false })),
    askDm: (text: string) => withRoom((roomId, memberKey) => askDm({ roomId, memberKey, text })),
    walkUp: () => withRoom((roomId, memberKey) => walkUp({ roomId, memberKey })),
    check: (skill: string, about?: string) => withRoom((roomId, memberKey) => check({ roomId, memberKey, skill, about })),
    shortRest: () => withRoom((roomId, memberKey) => shortRest({ roomId, memberKey })),
    pickCampaign: (campaignId: string) => withRoom((roomId, memberKey) => pickCampaign({ roomId, memberKey, campaignId })),
    endSession: () => withRoom((roomId, memberKey) => endSession({ roomId, memberKey })),
    playAgain: () => withRoom((roomId, memberKey) => playAgain({ roomId, memberKey })),
    newCampaign: () => withRoom((roomId, memberKey) => newCampaign({ roomId, memberKey })),
  };
}

export type WizardHandle = ReturnType<typeof useWizard>;
