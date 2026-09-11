import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { appendEvent, joinMember } from './rooms';
import { hasInference } from './agent';
import { PREGENS, SHEET_KEYS } from './wizard/pregens';
import { BEACH_ZOMBIE_START, HOUSE_MASKS, MAPS, SPELLS, STAT_BLOCKS, ZOMBIE_NAMES } from './wizard/scenario';
import {
  abilityMod,
  adjacent,
  addCondition,
  approach,
  characterAC,
  characterSpeed,
  d20,
  damageCharacter,
  damageCreature,
  deathSave,
  fmtDice,
  fmtRoll,
  healCharacter,
  isDead,
  isDown,
  matchSheet,
  nearest,
  newCharacter,
  newCreature,
  pathTo,
  reachable,
  removeCondition,
  resolveAttack,
  roll,
  savingThrow,
  sheetOf,
  type Rng,
} from './wizard/engine';
import { feet, mod, type Attack, type CharacterState, type Combatant, type CreatureState, type Fire, type Phase, type Position, type SheetKey } from './wizard/types';

/**
 * The D&D table. One `wizardGames` row per wizard room holds the whole scene:
 * who sits in which seat, every character's live sheet, the creatures, the
 * initiative order and whose turn it is. Every rule resolution happens here,
 * inside a mutation, with Convex's deterministic Math.random as the dice —
 * masks and humans alike only ever declare intent.
 *
 * Turn flow: `beginTurn` decides who acts. Humans get a prompt and act through
 * `act`. Masks get a scheduled `internal.agent.runTurn` whose tool call comes
 * back through `onToolCall`. Monsters get a scheduled `monsterTurn`. All three
 * end in `advance`, which calls `beginTurn` again. Scheduled turns carry the
 * `turnToken` they were issued for and bail if the table has moved on, and
 * every one of them checks the room is still `running` first, so a pause
 * really stops everything.
 */

type Game = Doc<'wizardGames'>;
type Seat = { ownerKey: string; ownerName: string; ownerKind: 'human' | 'mask'; confirmed: boolean; name: string };
type Seats = Partial<Record<SheetKey, Seat>>;
type TurnState = { moved: number; actionUsed: boolean; bonusUsed: boolean; dashed: boolean; startedAt: number };

const MASK_TURN_DELAY_MS = 900;
const MONSTER_TURN_DELAY_MS = 1400;
const ZOMBIES_RISE_AFTER_MS = 9000;

const rng: Rng = () => Math.random();

// ---------------------------------------------------------------------------
// Reads

export const get = query({
  args: { roomId: v.id('rooms') },
  handler: async (ctx, { roomId }) => await gameFor(ctx, roomId),
});

export const sheets = query({
  args: {},
  handler: async () => PREGENS,
});

export const houseMasks = query({
  args: {},
  handler: async () => HOUSE_MASKS,
});

async function gameFor(ctx: QueryCtx | MutationCtx, roomId: Id<'rooms'>) {
  return await ctx.db
    .query('wizardGames')
    .withIndex('by_room', (q) => q.eq('roomId', roomId))
    .unique();
}

async function ensureGame(ctx: MutationCtx, roomId: Id<'rooms'>): Promise<Game> {
  const existing = await gameFor(ctx, roomId);
  if (existing) return existing;
  const id = await ctx.db.insert('wizardGames', {
    roomId,
    phase: 'lobby' satisfies Phase,
    mapKey: 'beach',
    round: 0,
    turnIndex: 0,
    turnToken: 0,
    combatants: [],
    characters: [],
    creatures: [],
    seats: {},
    turn: { moved: 0, actionUsed: false, bonusUsed: false, dashed: false, startedAt: 0 },
    fires: [],
    xp: 0,
  });
  return (await ctx.db.get(id))!;
}

async function roomAndGame(ctx: MutationCtx, roomId: Id<'rooms'>) {
  const room = await ctx.db.get(roomId);
  if (!room) throw new Error('No such room');
  const game = await ensureGame(ctx, roomId);
  return { room, game };
}

async function memberOf(ctx: MutationCtx, roomId: Id<'rooms'>, memberKey: string) {
  return await ctx.db
    .query('roomMembers')
    .withIndex('by_room_member', (q) => q.eq('roomId', roomId).eq('memberKey', memberKey))
    .unique();
}

async function host(ctx: MutationCtx, room: Doc<'rooms'>, body: string, data?: unknown) {
  await appendEvent(ctx, room._id, { type: 'host', actorKey: 'host', actorName: room.hostName, body, data });
}

async function dice(ctx: MutationCtx, room: Doc<'rooms'>, actorName: string, actorKey: string | undefined, body: string, data?: unknown) {
  await appendEvent(ctx, room._id, { type: 'dice', actorKey, actorName, body, data });
}

async function system(ctx: MutationCtx, room: Doc<'rooms'>, body: string, data?: unknown) {
  await appendEvent(ctx, room._id, { type: 'system', actorName: 'room', body, data });
}

async function save(ctx: MutationCtx, game: Game) {
  const { _id, _creationTime, ...rest } = game;
  await ctx.db.replace(_id, rest);
}

// ---------------------------------------------------------------------------
// Lobby: seats

export const chooseSeat = mutation({
  args: { roomId: v.id('rooms'), memberKey: v.string(), sheetKey: v.string() },
  handler: async (ctx, { roomId, memberKey, sheetKey }) => {
    const { room, game } = await roomAndGame(ctx, roomId);
    const member = await memberOf(ctx, roomId, memberKey);
    if (!member || member.kind !== 'human') throw new Error('Only humans choose seats');
    if (!(SHEET_KEYS as string[]).includes(sheetKey)) throw new Error('No such sheet');
    const seats = game.seats as Seats;
    const key = sheetKey as SheetKey;
    const taken = seats[key];
    if (taken && taken.ownerKey !== memberKey && (taken.confirmed || taken.ownerKind === 'mask')) {
      throw new Error(`${taken.ownerName} already has that sheet`);
    }
    for (const k of SHEET_KEYS) {
      if (seats[k]?.ownerKey === memberKey && k !== key) delete seats[k];
    }
    seats[key] = { ownerKey: memberKey, ownerName: member.name, ownerKind: 'human', confirmed: false, name: seats[key]?.name ?? '' };
    game.seats = seats;
    await save(ctx, game);
    // Joining mid-game: the seat is live immediately, no confirm step.
    if (game.phase !== 'lobby') await seatCharacterLate(ctx, room, game, key, member.name);
  },
});

export const releaseSeat = mutation({
  args: { roomId: v.id('rooms'), memberKey: v.string() },
  handler: async (ctx, { roomId, memberKey }) => {
    const { game } = await roomAndGame(ctx, roomId);
    if (game.phase !== 'lobby') throw new Error('The game has started');
    const seats = game.seats as Seats;
    for (const k of SHEET_KEYS) if (seats[k]?.ownerKey === memberKey) delete seats[k];
    game.seats = seats;
    await save(ctx, game);
    const member = await memberOf(ctx, roomId, memberKey);
    if (member) await ctx.db.patch(member._id, { ready: false });
  },
});

export const confirmSeat = mutation({
  args: { roomId: v.id('rooms'), memberKey: v.string(), name: v.string() },
  handler: async (ctx, { roomId, memberKey, name }) => {
    const { room, game } = await roomAndGame(ctx, roomId);
    const seats = game.seats as Seats;
    const key = SHEET_KEYS.find((k) => seats[k]?.ownerKey === memberKey);
    if (!key) throw new Error('Choose a sheet first');
    const member = await memberOf(ctx, roomId, memberKey);
    if (!member) throw new Error('Not at the table');
    const charName = name.trim().slice(0, 40) || defaultName(key);
    seats[key] = { ...seats[key]!, confirmed: true, name: charName };
    game.seats = seats;
    await save(ctx, game);
    await ctx.db.patch(member._id, { ready: true, state: { ...(member.state ?? {}), sheetKey: key, characterName: charName } });
    const sheet = PREGENS[key];
    await system(ctx, room, `${member.name} will play ${charName}, the ${sheet.race} ${sheet.className}.`, { kind: 'seat', sheetKey: key });
  },
});

function defaultName(key: SheetKey): string {
  // The official sheets leave the name blank; these are ours.
  return { cleric: 'Brannor Ironvow', fighter: 'Sylvaris Thornwood', paladin: 'Adrienne Corlinn', rogue: 'Pip Underbough', wizard: 'Elandra Vess' }[key];
}

/** Add a mask to the table: the caller's masky avatar, or one of the house cast. */
export const seatMask = mutation({
  args: {
    roomId: v.id('rooms'),
    memberKey: v.string(),
    name: v.string(),
    persona: v.string(),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, memberKey, name, persona, avatarUrl }) => {
    const { room, game } = await roomAndGame(ctx, roomId);
    const seats = game.seats as Seats;
    const free = SHEET_KEYS.filter((k) => !seats[k]);
    if (free.length === 0) throw new Error('All five sheets are taken');
    await joinMember(ctx, roomId, { memberKey, kind: 'mask', name, persona, avatarUrl });
    const key = matchSheet(persona, name, free)!;
    const charName = `${name}`;
    seats[key] = { ownerKey: memberKey, ownerName: name, ownerKind: 'mask', confirmed: true, name: charName };
    game.seats = seats;
    await save(ctx, game);
    const member = await memberOf(ctx, roomId, memberKey);
    if (member) await ctx.db.patch(member._id, { state: { ...(member.state ?? {}), sheetKey: key, characterName: charName } });
    const sheet = PREGENS[key];
    await system(ctx, room, `${name} takes the ${sheet.race} ${sheet.className}'s sheet.`, { kind: 'seat', sheetKey: key });
    if (game.phase !== 'lobby') await seatCharacterLate(ctx, room, game, key, name);
    return key;
  },
});

export const unseatMask = mutation({
  args: { roomId: v.id('rooms'), memberKey: v.string() },
  handler: async (ctx, { roomId, memberKey }) => {
    const { game } = await roomAndGame(ctx, roomId);
    if (game.phase !== 'lobby') throw new Error('The game has started');
    const seats = game.seats as Seats;
    for (const k of SHEET_KEYS) if (seats[k]?.ownerKey === memberKey) delete seats[k];
    game.seats = seats;
    await save(ctx, game);
    const member = await memberOf(ctx, roomId, memberKey);
    if (member && member.kind === 'mask') await ctx.db.delete(member._id);
  },
});

/** A character who arrives after the scene opened walks in from the dock. */
async function seatCharacterLate(ctx: MutationCtx, room: Doc<'rooms'>, game: Game, key: SheetKey, ownerName: string) {
  const characters = game.characters as CharacterState[];
  if (characters.some((c) => c.sheetKey === key)) return;
  const map = MAPS[game.mapKey];
  const occupied = [...characters.map((c) => c.pos), ...(game.creatures as CreatureState[]).map((c) => c.pos)];
  const spot = map.partyStart.find((p) => !occupied.some((o) => o.x === p.x && o.y === p.y)) ?? map.partyStart[0];
  const seat = (game.seats as Seats)[key]!;
  const c = newCharacter(key, seat.name || defaultName(key), spot);
  characters.push(c);
  game.characters = characters;
  if (game.phase === 'combat') {
    const init = d20(rng, abilityMod(sheetOf(c), 'dex'));
    const combatants = game.combatants as Combatant[];
    combatants.push({ id: `pc:${key}`, name: c.name, initiative: init.total, side: 'party' });
    // Slot in behind whoever is acting so the order stays stable for everyone else.
    const active = combatants[game.turnIndex];
    combatants.sort((a, b) => b.initiative - a.initiative);
    game.turnIndex = Math.max(0, combatants.findIndex((x) => x.id === active.id));
    game.combatants = combatants;
    await dice(ctx, room, c.name, seat.ownerKey, `initiative ${fmtRoll(init)}`, { kind: 'initiative', total: init.total });
  }
  await save(ctx, game);
  await host(ctx, room, `${c.name} splashes ashore from the rowboat and joins the party. ${ownerName} is at the table.`);
}

// ---------------------------------------------------------------------------
// Start

export const start = mutation({
  args: { roomId: v.id('rooms'), byKey: v.string(), guildId: v.optional(v.string()) },
  handler: async (ctx, { roomId, byKey, guildId }) => {
    const { room, game } = await roomAndGame(ctx, roomId);
    if (game.phase !== 'lobby') throw new Error('Already started');
    // The server the starter has open pays for the masks' thinking, through the
    // bridge in firebase/functions (see agent.roomCredentials).
    if (guildId) await ctx.db.patch(roomId, { config: { ...(room.config ?? {}), guildId, startedBy: byKey } });
    const members = await ctx.db
      .query('roomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();
    const cutoff = Date.now() - 45_000;
    const humansPresent = members.filter((m) => m.kind === 'human' && m.lastSeen >= cutoff);
    const seats = game.seats as Seats;
    const unconfirmed = humansPresent.filter((h) => !SHEET_KEYS.some((k) => seats[k]?.ownerKey === h.memberKey && seats[k]?.confirmed));
    if (unconfirmed.length) {
      throw new Error(`Waiting for ${unconfirmed.map((h) => h.name).join(', ')} to choose and confirm a sheet`);
    }
    if (!SHEET_KEYS.some((k) => seats[k])) throw new Error('Nobody is seated');

    const map = MAPS[game.mapKey];
    const characters: CharacterState[] = [];
    let i = 0;
    for (const key of SHEET_KEYS) {
      const seat = seats[key];
      if (!seat) continue;
      characters.push(newCharacter(key, seat.name || defaultName(key), map.partyStart[i++ % map.partyStart.length]));
    }
    game.characters = characters;
    game.phase = 'scene' satisfies Phase;
    game.round = 0;
    await save(ctx, game);
    await ctx.db.patch(roomId, { status: 'running' });

    const starter = members.find((m) => m.memberKey === byKey)?.name ?? 'the table';
    await system(ctx, room, `${starter} started the game. Unclaimed sheets are put away.`, { kind: 'status', status: 'running' });
    const roster = characters.map((c) => `${c.name} the ${PREGENS[c.sheetKey].race} ${PREGENS[c.sheetKey].className}`).join(', ');
    await host(
      ctx,
      room,
      `Dragons of Stormwreck Isle. Two sailors row you the last stretch from the ship, past black rocks slick with weed, to a rickety dock at the island's north harbor. ` +
        `Above you a switchback path climbs toward the cloister the captain called Dragon's Rest. The party: ${roster}. ` +
        `Salt wind, gull cries, the crunch of golden sand under your boots. Take a breath and look around. What do you do?`,
      { kind: 'scene', scene: 'arrival' },
    );
    await ctx.scheduler.runAfter(0, internal.wizard.narrate, {
      roomId,
      beat: 'The party has just landed on the beach at the north harbor. Set the scene in two or three sentences, in your own DM voice, then ask what they do. Do not introduce enemies yet.',
    });
    await ctx.scheduler.runAfter(ZOMBIES_RISE_AFTER_MS, internal.wizard.zombiesRise, { roomId });
  },
});

export const zombiesRise = internalMutation({
  args: { roomId: v.id('rooms') },
  handler: async (ctx, { roomId }) => {
    const { room, game } = await roomAndGame(ctx, roomId);
    if (game.phase !== 'scene') return;
    if (room.status !== 'running') {
      await ctx.scheduler.runAfter(3000, internal.wizard.zombiesRise, { roomId });
      return;
    }
    const creatures: CreatureState[] = BEACH_ZOMBIE_START.map((pos, i) =>
      newCreature('zombie', `zombie-${i + 1}`, ZOMBIE_NAMES[i], pos, rng),
    );
    game.creatures = creatures;
    await host(
      ctx,
      room,
      `Something moves among the crags. Three shapes drag themselves up out of the surf and the rocks: gray, bloated, still wearing the rags of sailors' coats. Drowned sailors, and they are walking. They are about thirty feet off and closing. Roll for initiative!`,
      { kind: 'scene', scene: 'drowned-sailors' },
    );

    const combatants: Combatant[] = [];
    for (const c of game.characters as CharacterState[]) {
      const r = d20(rng, abilityMod(sheetOf(c), 'dex'));
      combatants.push({ id: `pc:${c.sheetKey}`, name: c.name, initiative: r.total, side: 'party' });
      await dice(ctx, room, c.name, ownerOf(game, c.sheetKey), `initiative ${fmtRoll(r)}`, { kind: 'initiative', total: r.total });
    }
    // The DM rolls once for identical creatures.
    const zr = d20(rng, mod(STAT_BLOCKS.zombie.abilities.dex));
    for (const z of creatures) combatants.push({ id: `npc:${z.key}`, name: z.name, initiative: zr.total, side: 'enemy' });
    await dice(ctx, room, room.hostName, 'host', `zombies' initiative ${fmtRoll(zr)}`, { kind: 'initiative', total: zr.total });

    combatants.sort((a, b) => b.initiative - a.initiative || (a.side === 'party' ? -1 : 1));
    game.combatants = combatants;
    game.phase = 'combat' satisfies Phase;
    game.round = 1;
    game.turnIndex = 0;
    await host(ctx, room, `Order: ${combatants.map((c) => `${c.name} (${c.initiative})`).join(', ')}. Round 1.`, { kind: 'order' });
    await save(ctx, game);
    await beginTurn(ctx, room, game);
  },
});

function ownerOf(game: Game, key: SheetKey): string | undefined {
  return (game.seats as Seats)[key]?.ownerKey;
}

// ---------------------------------------------------------------------------
// Turn engine

function active(game: Game): Combatant | null {
  const cs = game.combatants as Combatant[];
  return cs.length ? cs[game.turnIndex % cs.length] : null;
}

function characterById(game: Game, id: string): CharacterState | undefined {
  return (game.characters as CharacterState[]).find((c) => `pc:${c.sheetKey}` === id);
}

function creatureById(game: Game, id: string): CreatureState | undefined {
  return (game.creatures as CreatureState[]).find((c) => `npc:${c.key}` === id);
}

function livingParty(game: Game): CharacterState[] {
  return (game.characters as CharacterState[]).filter((c) => !isDead(c) && !isDown(c));
}

function livingEnemies(game: Game): CreatureState[] {
  return (game.creatures as CreatureState[]).filter((c) => !c.conditions.includes('dead'));
}

function occupiedSquares(game: Game, except?: Position): Position[] {
  const all = [
    ...(game.characters as CharacterState[]).filter((c) => !isDead(c)).map((c) => c.pos),
    ...livingEnemies(game).map((c) => c.pos),
  ];
  return except ? all.filter((p) => !(p.x === except.x && p.y === except.y)) : all;
}

async function beginTurn(ctx: MutationCtx, room: Doc<'rooms'>, game: Game) {
  const who = active(game);
  if (!who) return;
  game.turnToken += 1;
  game.turn = { moved: 0, actionUsed: false, bonusUsed: false, dashed: false, startedAt: Date.now() } satisfies TurnState;

  if (who.side === 'enemy') {
    const z = creatureById(game, who.id)!;
    if (z.conditions.includes('dead')) {
      await save(ctx, game);
      return await advance(ctx, room, game);
    }
    await save(ctx, game);
    await ctx.scheduler.runAfter(MONSTER_TURN_DELAY_MS, internal.wizard.monsterTurn, { roomId: room._id, turnToken: game.turnToken });
    return;
  }

  const c = characterById(game, who.id)!;
  // Conditions that end at the start of your turn.
  c.conditions = removeCondition(removeCondition(c.conditions, 'dodging'), 'disengaged');
  c.conditions = removeCondition(c.conditions, 'slowed');

  if (isDead(c)) {
    await save(ctx, game);
    return await advance(ctx, room, game);
  }
  if (isDown(c)) {
    if (c.conditions.includes('stable')) {
      await host(ctx, room, `${c.name} lies stable but unconscious.`);
      await save(ctx, game);
      return await advance(ctx, room, game);
    }
    const ds = deathSave(rng, c);
    await dice(ctx, room, c.name, ownerOf(game, c.sheetKey), `death saving throw ${fmtRoll(ds.roll)} — ${ds.result}`, { kind: 'death-save', ...c.deathSaves, result: ds.result });
    const line = {
      revived: `${c.name}'s eyes snap open — a natural 20. Back to 1 hit point and back in the fight.`,
      stable: `${c.name} stabilizes. Three successes; unconscious but no longer dying.`,
      dead: `${c.name} slips away. Three failures.`,
      success: `${c.name} clings on (${c.deathSaves.successes} success${c.deathSaves.successes === 1 ? '' : 'es'}, ${c.deathSaves.failures} failure${c.deathSaves.failures === 1 ? '' : 's'}).`,
      failure: `${c.name} fades a little more (${c.deathSaves.successes} success${c.deathSaves.successes === 1 ? '' : 'es'}, ${c.deathSaves.failures} failure${c.deathSaves.failures === 1 ? '' : 's'}).`,
    }[ds.result];
    await host(ctx, room, line);
    await save(ctx, game);
    if (ds.result !== 'revived') {
      if (await checkEnd(ctx, room, game)) return;
      return await advance(ctx, room, game);
    }
  }

  await save(ctx, game);
  const seat = (game.seats as Seats)[c.sheetKey];
  if (seat?.ownerKind === 'mask') {
    await ctx.scheduler.runAfter(MASK_TURN_DELAY_MS, internal.wizard.maskTurn, { roomId: room._id, turnToken: game.turnToken });
  } else {
    await host(ctx, room, `${c.name}, it's your turn. What do you do?`, { kind: 'prompt', combatantId: who.id, turnToken: game.turnToken });
  }
}

async function advance(ctx: MutationCtx, room: Doc<'rooms'>, game: Game) {
  const cs = game.combatants as Combatant[];
  if (!cs.length) return;
  game.turnIndex += 1;
  if (game.turnIndex >= cs.length) {
    game.turnIndex = 0;
    game.round += 1;
    game.fires = (game.fires as Fire[]).filter((f) => f.untilRound >= game.round);
    await host(ctx, room, `Round ${game.round}.`, { kind: 'round', round: game.round });
  }
  await save(ctx, game);
  await beginTurn(ctx, room, game);
}

/** Victory or defeat; returns true if the fight is over. */
async function checkEnd(ctx: MutationCtx, room: Doc<'rooms'>, game: Game): Promise<boolean> {
  if (game.phase !== 'combat') return true;
  if (livingEnemies(game).length === 0) {
    game.phase = 'victory' satisfies Phase;
    game.xp += (game.creatures as CreatureState[]).length * STAT_BLOCKS.zombie.xp;
    await save(ctx, game);
    await host(
      ctx,
      room,
      `The last of the drowned sailors collapses into the sand and does not get up. The beach is quiet again but for the gulls. ` +
        `${game.xp} XP to the party. Up the path, a figure in robes is hurrying down the stairs toward you — an old woman with sharp eyes, calling out to ask if anyone is hurt. Welcome to Dragon's Rest.`,
      { kind: 'scene', scene: 'victory' },
    );
    await ctx.scheduler.runAfter(0, internal.wizard.narrate, {
      roomId: room._id,
      beat: 'The party has just defeated three zombies on the beach. Elder Runara (an elderly human woman, actually a bronze dragon in disguise — do not reveal that) comes down to greet them and invite them up to the cloister. Two or three sentences, then let the players talk.',
    });
    return true;
  }
  const alive = (game.characters as CharacterState[]).filter((c) => !isDead(c));
  if (alive.length === 0 || alive.every((c) => isDown(c))) {
    game.phase = 'defeat' satisfies Phase;
    await save(ctx, game);
    await host(ctx, room, `The party falls on the sand. The zombies shamble on up the path toward the cloister... The tale of Stormwreck Isle ends here — or begins again with a new room.`, { kind: 'scene', scene: 'defeat' });
    return true;
  }
  return false;
}

/** Re-issue the current turn's scheduled work (after a resume, or a lost job). */
export const kick = mutation({
  args: { roomId: v.id('rooms') },
  handler: async (ctx, { roomId }) => {
    const { room, game } = await roomAndGame(ctx, roomId);
    if (room.status !== 'running') return;
    if (game.phase === 'scene') {
      await ctx.scheduler.runAfter(1500, internal.wizard.zombiesRise, { roomId });
      return;
    }
    if (game.phase !== 'combat') return;
    const who = active(game);
    if (!who) return;
    if (who.side === 'enemy') {
      await ctx.scheduler.runAfter(MONSTER_TURN_DELAY_MS, internal.wizard.monsterTurn, { roomId, turnToken: game.turnToken });
      return;
    }
    const c = characterById(game, who.id)!;
    if ((game.seats as Seats)[c.sheetKey]?.ownerKind === 'mask') {
      await ctx.scheduler.runAfter(MASK_TURN_DELAY_MS, internal.wizard.maskTurn, { roomId, turnToken: game.turnToken });
    }
  },
});

/** Pause or resume the table; resuming re-kicks whoever was up. */
export const setPaused = mutation({
  args: { roomId: v.id('rooms'), memberKey: v.string(), paused: v.boolean(), reason: v.optional(v.string()) },
  handler: async (ctx, { roomId, memberKey, paused, reason }) => {
    const { room, game } = await roomAndGame(ctx, roomId);
    const member = await memberOf(ctx, roomId, memberKey);
    const name = member?.name ?? 'someone';
    if (paused && room.status === 'running') {
      await ctx.db.patch(roomId, { status: 'paused', pause: { byKey: memberKey, byName: name, reason, at: Date.now() } });
      await appendEvent(ctx, roomId, { type: 'system', actorKey: memberKey, actorName: name, body: `${name} paused the game${reason ? `: ${reason}` : ''}.`, data: { kind: 'status', status: 'paused', reason } });
      await host(ctx, room, `Of course — take your time. Everyone hold.`);
    } else if (!paused && room.status === 'paused') {
      await ctx.db.patch(roomId, { status: 'running', pause: undefined });
      await appendEvent(ctx, roomId, { type: 'system', actorKey: memberKey, actorName: name, body: `${name} resumed the game.`, data: { kind: 'status', status: 'running' } });
      const who = active(game);
      if (game.phase === 'combat' && who) await host(ctx, room, `Back to it. ${who.name} was up.`);
      await ctx.scheduler.runAfter(0, api.wizard.kick, { roomId });
    }
  },
});

// ---------------------------------------------------------------------------
// Actions

const actionArg = v.object({
  type: v.union(
    v.literal('move'),
    v.literal('attack'),
    v.literal('cast'),
    v.literal('dodge'),
    v.literal('dash'),
    v.literal('disengage'),
    v.literal('help'),
    v.literal('hide'),
    v.literal('search'),
    v.literal('useObject'),
    v.literal('secondWind'),
    v.literal('layOnHands'),
    v.literal('endTurn'),
  ),
  to: v.optional(v.object({ x: v.number(), y: v.number() })),
  attackKey: v.optional(v.string()),
  spell: v.optional(v.string()),
  targetId: v.optional(v.string()),
  targetIds: v.optional(v.array(v.string())),
  item: v.optional(v.string()),
  amount: v.optional(v.number()),
  /** Something said while doing it, kept with the action in the log. */
  say: v.optional(v.string()),
});
type Action = {
  type: 'move' | 'attack' | 'cast' | 'dodge' | 'dash' | 'disengage' | 'help' | 'hide' | 'search' | 'useObject' | 'secondWind' | 'layOnHands' | 'endTurn';
  to?: Position;
  attackKey?: string;
  spell?: string;
  targetId?: string;
  targetIds?: string[];
  item?: string;
  amount?: number;
  say?: string;
};

/** A human acts for the character they own. */
export const act = mutation({
  args: { roomId: v.id('rooms'), memberKey: v.string(), action: actionArg },
  handler: async (ctx, { roomId, memberKey, action }) => {
    const { room, game } = await roomAndGame(ctx, roomId);
    if (room.status !== 'running') throw new Error('The game is paused');
    if (game.phase !== 'combat') throw new Error('Not in combat');
    const who = active(game);
    if (!who || who.side !== 'party') throw new Error('Not your turn');
    const c = characterById(game, who.id)!;
    if (ownerOf(game, c.sheetKey) !== memberKey) throw new Error(`It's ${who.name}'s turn`);
    return await perform(ctx, room, game, c, action as Action, memberKey);
  },
});

/** The shared turn loop hands a mask's tool call here, verbatim. */
export const onToolCall = internalMutation({
  args: {
    roomId: v.id('rooms'),
    memberKey: v.string(),
    turnToken: v.optional(v.number()),
    call: v.object({ name: v.string(), input: v.any() }),
  },
  handler: async (ctx, { roomId, memberKey, turnToken, call }) => {
    const { room, game } = await roomAndGame(ctx, roomId);
    if (turnToken !== undefined && turnToken !== game.turnToken) return; // stale: the table moved on
    if (game.phase !== 'combat') return;
    const who = active(game);
    if (!who || who.side !== 'party') return;
    const c = characterById(game, who.id)!;
    if (ownerOf(game, c.sheetKey) !== memberKey) return;
    if (room.status !== 'running') {
      await ctx.scheduler.runAfter(3000, internal.wizard.maskTurn, { roomId, turnToken: game.turnToken });
      return;
    }
    if (call.name !== 'take_turn') return;
    const input = call.input as { say?: string; move_to?: Position; action?: Action };
    if (input.say) {
      await appendEvent(ctx, roomId, { type: 'say', actorKey: memberKey, actorName: c.name, body: String(input.say).slice(0, 600) });
    }
    try {
      if (input.move_to) {
        const fresh = (await gameFor(ctx, roomId))!;
        await perform(ctx, room, fresh, characterById(fresh, who.id)!, { type: 'move', to: input.move_to }, memberKey, true);
      }
      const fresh = (await gameFor(ctx, roomId))!;
      if (fresh.turnToken !== game.turnToken) return;
      const me = characterById(fresh, who.id)!;
      const action = input.action && input.action.type !== 'move' ? input.action : { type: 'endTurn' as const };
      await perform(ctx, room, fresh, me, action, memberKey, true);
    } catch (e) {
      // An illegal choice should cost the mask its action, not stall the table.
      await system(ctx, room, `${c.name} hesitates (${(e as Error).message}).`);
      const fresh = (await gameFor(ctx, roomId))!;
      if (fresh.turnToken === game.turnToken) await perform(ctx, room, fresh, characterById(fresh, who.id)!, { type: 'endTurn' }, memberKey, true);
    }
  },
});

/** If a mask's turn produced no usable tool call, fall back to a sensible move. */
export const maskFallback = internalMutation({
  args: { roomId: v.id('rooms'), turnToken: v.number() },
  handler: async (ctx, { roomId, turnToken }) => {
    const { room, game } = await roomAndGame(ctx, roomId);
    if (game.turnToken !== turnToken || game.phase !== 'combat') return;
    if (room.status !== 'running') {
      await ctx.scheduler.runAfter(3000, internal.wizard.maskTurn, { roomId, turnToken });
      return;
    }
    const who = active(game);
    if (!who || who.side !== 'party') return;
    const c = characterById(game, who.id)!;
    const owner = ownerOf(game, c.sheetKey)!;
    await autoAct(ctx, room, game, c, owner);
  },
});

/** Default policy: heal a downed friend if you can, else close and hit the nearest enemy. */
async function autoAct(ctx: MutationCtx, room: Doc<'rooms'>, game: Game, c: CharacterState, owner: string) {
  const sheet = sheetOf(c);
  const down = (game.characters as CharacterState[]).find((x) => isDown(x) && !isDead(x));
  if (down && sheet.spellcasting?.prepared.includes('cure wounds') && (c.slotsUsed[1] ?? 0) < (sheet.spellcasting.slots[1] ?? 0)) {
    if (!adjacent(c.pos, down.pos)) await perform(ctx, room, game, c, { type: 'move', to: stepToward(game, c, down.pos) }, owner, true);
    const fresh = (await gameFor(ctx, room._id))!;
    const me = characterById(fresh, `pc:${c.sheetKey}`)!;
    if (adjacent(me.pos, down.pos)) return await perform(ctx, room, fresh, me, { type: 'cast', spell: 'cure wounds', targetId: `pc:${down.sheetKey}` }, owner, true);
  }
  const enemy = nearest(c.pos, livingEnemies(game));
  if (!enemy) return await perform(ctx, room, game, c, { type: 'endTurn' }, owner, true);
  const dist = feet(c.pos, enemy.pos);
  const ranged = sheet.attacks.find((a) => a.kind === 'ranged' && (c.consumables[a.ammo ?? ''] ?? 1) > 0);
  const melee = sheet.attacks.find((a) => a.kind === 'melee' || a.kind === 'thrown');
  if (dist > 5 && ranged) return await perform(ctx, room, game, c, { type: 'attack', attackKey: ranged.key, targetId: `npc:${enemy.key}` }, owner, true);
  if (dist > 5 && sheet.spellcasting?.cantrips.includes('sacred flame')) return await perform(ctx, room, game, c, { type: 'cast', spell: 'sacred flame', targetId: `npc:${enemy.key}` }, owner, true);
  if (dist > 5 && sheet.spellcasting?.cantrips.includes('ray of frost')) return await perform(ctx, room, game, c, { type: 'cast', spell: 'ray of frost', targetId: `npc:${enemy.key}` }, owner, true);
  if (dist > 5) {
    await perform(ctx, room, game, c, { type: 'move', to: stepToward(game, c, enemy.pos) }, owner, true);
    const fresh = (await gameFor(ctx, room._id))!;
    const me = characterById(fresh, `pc:${c.sheetKey}`)!;
    if (adjacent(me.pos, enemy.pos) && melee) return await perform(ctx, room, fresh, me, { type: 'attack', attackKey: melee.key, targetId: `npc:${enemy.key}` }, owner, true);
    return await perform(ctx, room, fresh, me, { type: 'dodge' }, owner, true);
  }
  if (melee) return await perform(ctx, room, game, c, { type: 'attack', attackKey: melee.key, targetId: `npc:${enemy.key}` }, owner, true);
  return await perform(ctx, room, game, c, { type: 'dodge' }, owner, true);
}

function stepToward(game: Game, c: CharacterState, target: Position): Position {
  const map = MAPS[game.mapKey];
  const steps = Math.floor(characterSpeed(c) / 5);
  const path = approach(map, c.pos, target, occupiedSquares(game, c.pos), steps);
  return path.length ? path[path.length - 1] : c.pos;
}

/**
 * Resolve one action for a character. `auto` marks a mask/fallback action:
 * the turn ends automatically once the action is spent.
 */
async function perform(ctx: MutationCtx, room: Doc<'rooms'>, game: Game, c: CharacterState, action: Action, actorKey: string, auto = false) {
  const sheet = sheetOf(c);
  const turn = game.turn as TurnState;
  const map = MAPS[game.mapKey];
  const tag = (body: string, data?: unknown) => appendEvent(ctx, room._id, { type: 'action', actorKey, actorName: c.name, body, data });
  const say = action.say?.trim();
  if (say) await appendEvent(ctx, room._id, { type: 'say', actorKey, actorName: c.name, body: say.slice(0, 600) });

  const needAction = () => {
    if (turn.actionUsed) throw new Error('You have already used your action this turn');
    turn.actionUsed = true;
  };
  const finish = async () => {
    game.turn = turn;
    await save(ctx, game);
    if (await checkEnd(ctx, room, game)) return;
    if (auto && action.type !== 'move') await advance(ctx, room, game);
  };

  switch (action.type) {
    case 'endTurn': {
      game.turn = turn;
      await save(ctx, game);
      if (await checkEnd(ctx, room, game)) return;
      return await advance(ctx, room, game);
    }

    case 'move': {
      if (!action.to) throw new Error('Where to?');
      const speed = characterSpeed(c);
      const budget = Math.floor((speed * (turn.dashed ? 2 : 1)) / 5) - turn.moved;
      if (budget <= 0) throw new Error('No movement left this turn');
      const occupied = occupiedSquares(game, c.pos);
      const path = pathTo(map, c.pos, action.to, occupied);
      if (!path || path.length === 0) throw new Error('You cannot get there');
      if (occupied.some((p) => p.x === action.to!.x && p.y === action.to!.y)) throw new Error('That square is occupied');
      const steps = path.slice(0, budget);
      const from = { ...c.pos };
      // Opportunity attacks: leaving a zombie's reach without Disengage.
      const provokers = new Set<string>();
      let cur = from;
      for (const next of steps) {
        for (const z of livingEnemies(game)) {
          if (adjacent(cur, z.pos) && !adjacent(next, z.pos) && !c.conditions.includes('disengaged')) provokers.add(z.key);
        }
        cur = next;
      }
      c.pos = steps[steps.length - 1];
      turn.moved += steps.length;
      const fires = game.fires as Fire[];
      await tag(`moves ${steps.length * 5} ft to (${c.pos.x}, ${c.pos.y}).`, { kind: 'move', from, to: c.pos, path: steps });
      for (const zk of provokers) {
        const z = livingEnemies(game).find((x) => x.key === zk)!;
        await host(ctx, room, `${z.name} lashes out as ${c.name} pulls away — opportunity attack.`);
        await monsterAttack(ctx, room, game, z, c);
        if (isDown(c)) break;
      }
      if (fires.some((f) => f.pos.x === c.pos.x && f.pos.y === c.pos.y)) {
        const dmg = damageCharacter(c, 5);
        await host(ctx, room, `${c.name} steps into burning oil and takes ${dmg.applied} fire damage.`);
      }
      game.turn = turn;
      await save(ctx, game);
      if (await checkEnd(ctx, room, game)) return;
      if (auto && turn.actionUsed) await advance(ctx, room, game);
      return;
    }

    case 'dash': {
      needAction();
      turn.dashed = true;
      await tag(`dashes.`, { kind: 'dash' });
      return await finish();
    }

    case 'dodge': {
      needAction();
      c.conditions = addCondition(c.conditions, 'dodging');
      await tag(`takes the Dodge action, watching every swing.`, { kind: 'dodge' });
      return await finish();
    }

    case 'disengage': {
      needAction();
      c.conditions = addCondition(c.conditions, 'disengaged');
      await tag(`disengages.`, { kind: 'disengage' });
      return await finish();
    }

    case 'help': {
      needAction();
      const ally = action.targetId ? characterById(game, action.targetId) : null;
      if (!ally || ally === c) throw new Error('Help whom?');
      if (!adjacent(c.pos, ally.pos)) throw new Error('You must be within 5 ft to help');
      ally.conditions = addCondition(ally.conditions, 'helped');
      await tag(`helps ${ally.name} — advantage on their next attack.`, { kind: 'help', targetId: action.targetId });
      return await finish();
    }

    case 'hide': {
      needAction();
      const stealth = d20(rng, sheet.skills.stealth === 'expertise' ? abilityMod(sheet, 'dex') + 4 : sheet.skills.stealth ? abilityMod(sheet, 'dex') + 2 : abilityMod(sheet, 'dex'), sheet.acNote.includes('disadvantage on Stealth') ? 'disadvantage' : 'normal', c.conditions.includes('blessed'), sheet.key === 'rogue');
      const hidden = stealth.total >= 8; // zombie passive Perception 8
      await dice(ctx, room, c.name, actorKey, `Stealth ${fmtRoll(stealth)} vs passive Perception 8 — ${hidden ? 'hidden' : 'spotted'}`, { kind: 'check', skill: 'stealth', total: stealth.total });
      if (hidden) c.conditions = addCondition(c.conditions, 'hidden');
      await tag(hidden ? `ducks behind the rocks and vanishes.` : `tries to hide, but the sand gives nothing to hide behind.`, { kind: 'hide', hidden });
      return await finish();
    }

    case 'search': {
      needAction();
      const perc = d20(rng, abilityMod(sheet, 'wis') + (sheet.skills.perception ? 2 : 0), 'normal', c.conditions.includes('blessed'), sheet.key === 'rogue');
      await dice(ctx, room, c.name, actorKey, `Perception ${fmtRoll(perc)}`, { kind: 'check', skill: 'perception', total: perc.total });
      const alive = livingEnemies(game);
      const found = perc.total >= 12
        ? `${alive.length} drowned sailor${alive.length === 1 ? '' : 's'} still moving; the nearest is ${alive.length ? feet(c.pos, nearest(c.pos, alive)!.pos) : 0} ft away. Their skin is waxy and swollen — they have been in the water a long while. The path up the cliff starts at the south end of the beach.`
        : `waves, rocks, gulls. Nothing you did not already know.`;
      await host(ctx, room, `${c.name} scans the beach: ${found}`);
      return await finish();
    }

    case 'useObject': {
      needAction();
      if (action.item === 'torch') {
        if ((c.consumables.torch ?? 0) <= 0) throw new Error('No torches');
        c.resources.torchLit = 1;
        await tag(`strikes a tinderbox and lights a torch.`, { kind: 'use', item: 'torch' });
        return await finish();
      }
      throw new Error(`Cannot use ${action.item ?? 'that'} right now`);
    }

    case 'secondWind': {
      if (sheet.key !== 'fighter') throw new Error('Only the fighter has Second Wind');
      if (turn.bonusUsed) throw new Error('Bonus action already used');
      if ((c.resources.secondWind ?? 0) <= 0) throw new Error('Second Wind is spent until a rest');
      turn.bonusUsed = true;
      c.resources.secondWind = 0;
      const r = roll(rng, '1d10+1');
      const healed = healCharacter(c, r.total);
      await dice(ctx, room, c.name, actorKey, `Second Wind ${fmtDice(r)}`, { kind: 'heal', total: r.total });
      await tag(`catches a second wind and recovers ${healed} HP.`, { kind: 'secondWind' });
      game.turn = turn;
      await save(ctx, game);
      return;
    }

    case 'layOnHands': {
      if (sheet.key !== 'paladin') throw new Error('Only the paladin has Lay on Hands');
      needAction();
      const ally = action.targetId ? characterById(game, action.targetId) : c;
      if (!ally) throw new Error('Heal whom?');
      if (!adjacent(c.pos, ally.pos) && ally !== c) throw new Error('You must touch them');
      const pool = c.resources.layOnHands ?? 0;
      const amount = Math.max(1, Math.min(pool, action.amount ?? pool));
      if (pool <= 0) throw new Error('Lay on Hands is spent');
      c.resources.layOnHands = pool - amount;
      const healed = healCharacter(ally, amount);
      await tag(`lays hands on ${ally === c ? 'their own wounds' : ally.name} — ${healed} HP restored (${c.resources.layOnHands} left in the pool).`, { kind: 'layOnHands', targetId: action.targetId, amount });
      return await finish();
    }

    case 'attack': {
      needAction();
      const attack = attackFor(c, action.attackKey);
      const target = action.targetId ? creatureById(game, action.targetId) : null;
      if (!target || target.conditions.includes('dead')) throw new Error('Attack what?');
      const dist = feet(c.pos, target.pos);
      const inMelee = attack.kind === 'melee' || (attack.kind === 'thrown' && dist <= 5);
      if (inMelee && dist > (attack.reach ?? 5)) throw new Error(`${target.name} is ${dist} ft away — out of reach`);
      if (!inMelee && attack.range && dist > attack.range.long) throw new Error(`${target.name} is ${dist} ft away — out of range`);
      if (attack.ammo && (c.consumables[attack.ammo] ?? 0) <= 0) throw new Error(`Out of ${attack.ammo}s`);
      if (attack.key === 'torch' && !c.resources.torchLit) throw new Error('Light a torch first (Use an Object)');
      if (attack.ammo) c.consumables[attack.ammo] = (c.consumables[attack.ammo] ?? 0) - 1;

      // Advantage: helped, hidden, or the target can't see you; disadvantage: ranged while an enemy is adjacent.
      const adv = c.conditions.includes('helped') || c.conditions.includes('hidden');
      const dis = !inMelee && livingEnemies(game).some((z) => adjacent(z.pos, c.pos));
      c.conditions = removeCondition(removeCondition(c.conditions, 'helped'), 'hidden');
      const allyAdjacent = (game.characters as CharacterState[]).some((a) => a !== c && !isDown(a) && adjacent(a.pos, target.pos));
      const res = resolveAttack(rng, attack, STAT_BLOCKS[target.statKey].ac, {
        adv, dis,
        blessed: c.conditions.includes('blessed'),
        lucky: sheet.key === 'rogue',
        sneakAttack: sheet.key === 'rogue' && (adv || allyAdjacent) && attack.key !== 'oil',
        distanceFt: inMelee ? undefined : dist,
      });
      await dice(ctx, room, c.name, actorKey, `${attack.name} vs ${target.name} (AC ${STAT_BLOCKS[target.statKey].ac}): ${fmtRoll(res.attack)}${res.critical ? ' CRIT' : res.hit ? ' hit' : ' miss'}${res.damage ? ` — ${fmtDice(res.damage)}${res.sneak ? ` + sneak ${fmtDice(res.sneak)}` : ''} ${attack.damageType}` : ''}`, { kind: 'attack', hit: res.hit, critical: res.critical, targetId: action.targetId });

      if (!res.hit) {
        await tag(`${attackVerb(attack)} at ${target.name} and misses${res.fumble ? ' badly' : ''}.`, { kind: 'attack', targetId: action.targetId, hit: false });
        return await finish();
      }
      if (attack.key === 'oil') {
        target.conditions = addCondition(target.conditions, 'oiled');
        await tag(`hurls a flask of oil — it bursts across ${target.name}, soaking it. Fire will do 5 extra damage to it now.`, { kind: 'attack', targetId: action.targetId, hit: true, oiled: true });
        return await finish();
      }
      const total = (res.damage?.total ?? 0) + (res.sneak?.total ?? 0);
      const out = damageCreature(rng, target, total, attack.damageType, { critical: res.critical });
      await narrateHit(ctx, room, c.name, target, attack.name, out, res.critical);
      return await finish();
    }

    case 'cast': {
      const spellName = (action.spell ?? '').toLowerCase();
      const spell = SPELLS[spellName];
      const sc = sheet.spellcasting;
      if (!spell || !sc) throw new Error(`${c.name} cannot cast that`);
      if (!(sc.cantrips.includes(spellName) || sc.prepared.includes(spellName))) throw new Error(`${spell.name} is not prepared`);
      if (spell.time === 'bonus') {
        if (turn.bonusUsed) throw new Error('Bonus action already used');
        turn.bonusUsed = true;
      } else needAction();
      if (spell.level > 0) {
        const used = c.slotsUsed[spell.level] ?? 0;
        if (used >= (sc.slots[spell.level] ?? 0)) throw new Error(`No ${spell.level}st-level slots left`);
        c.slotsUsed[spell.level] = used + 1;
      }
      const castMod = abilityMod(sheet, sc.ability);
      const eff = spell.effect;
      const targetCreature = action.targetId?.startsWith('npc:') ? creatureById(game, action.targetId) : undefined;
      const targetChar = action.targetId?.startsWith('pc:') ? characterById(game, action.targetId) : undefined;

      if (eff.kind === 'flavor') {
        await tag(`casts ${spell.name}. ${spell.text}`, { kind: 'cast', spell: spellName });
      } else if (eff.kind === 'attack') {
        if (!targetCreature || targetCreature.conditions.includes('dead')) throw new Error('Target?');
        const dist = feet(c.pos, targetCreature.pos);
        if (eff.melee ? dist > 5 : dist > spell.range) throw new Error(`${targetCreature.name} is out of range (${dist} ft)`);
        const fake: Attack = { key: spellName, name: spell.name, kind: eff.melee ? 'melee' : 'ranged', toHit: sc.attackBonus, damage: eff.damage, damageType: eff.damageType as Attack['damageType'], range: { normal: spell.range, long: spell.range } };
        const dis = !eff.melee && livingEnemies(game).some((z) => adjacent(z.pos, c.pos));
        const res = resolveAttack(rng, fake, STAT_BLOCKS[targetCreature.statKey].ac, { dis, blessed: c.conditions.includes('blessed'), adv: c.conditions.includes('helped') });
        c.conditions = removeCondition(c.conditions, 'helped');
        await dice(ctx, room, c.name, actorKey, `${spell.name} vs ${targetCreature.name}: ${fmtRoll(res.attack)}${res.critical ? ' CRIT' : res.hit ? ' hit' : ' miss'}${res.damage ? ` — ${fmtDice(res.damage)} ${eff.damageType}` : ''}`, { kind: 'spell-attack', spell: spellName, hit: res.hit });
        if (!res.hit) await tag(`casts ${spell.name} at ${targetCreature.name} — it goes wide.`, { kind: 'cast', spell: spellName, hit: false });
        else {
          const out = damageCreature(rng, targetCreature, res.damage!.total, eff.damageType, { critical: res.critical });
          if (eff.slow && !out.killed) targetCreature.conditions = addCondition(targetCreature.conditions, 'slowed');
          await narrateHit(ctx, room, c.name, targetCreature, spell.name, out, res.critical);
        }
      } else if (eff.kind === 'save') {
        const targets: CreatureState[] = eff.area === 'cube15'
          ? livingEnemies(game).filter((z) => feet(c.pos, z.pos) <= 15)
          : targetCreature && !targetCreature.conditions.includes('dead') ? [targetCreature] : [];
        if (!eff.area && !targets.length) throw new Error('Target?');
        if (!eff.area && feet(c.pos, targets[0].pos) > spell.range) throw new Error(`Out of range`);
        await tag(`casts ${spell.name}${targets.length ? ` — ${targets.map((t) => t.name).join(', ')} must save` : ', but nothing is close enough to catch it'}.`, { kind: 'cast', spell: spellName });
        for (const t of targets) {
          const block = STAT_BLOCKS[t.statKey];
          const bonus = block.saves?.[eff.ability] ?? mod(block.abilities[eff.ability]);
          const st = savingThrow(rng, bonus, sc.saveDC);
          const dmg = roll(rng, eff.damage);
          const applied = st.success ? (eff.half ? Math.floor(dmg.total / 2) : 0) : dmg.total;
          await dice(ctx, room, t.name, 'host', `${eff.ability.toUpperCase()} save ${fmtRoll(st.roll)} vs DC ${st.dc} — ${st.success ? 'saved' : 'failed'}; ${fmtDice(dmg)} ${eff.damageType}${st.success && eff.half ? ' (half)' : ''}`, { kind: 'save', success: st.success });
          if (applied > 0) {
            const out = damageCreature(rng, t, applied, eff.damageType);
            await narrateHit(ctx, room, c.name, t, spell.name, out, false);
          } else await host(ctx, room, `${t.name} shrugs off the ${spell.name}.`);
          if (!st.success && eff.push && !t.conditions.includes('dead')) {
            const dx = Math.sign(t.pos.x - c.pos.x), dy = Math.sign(t.pos.y - c.pos.y);
            const pushed = { x: t.pos.x + dx * 2, y: t.pos.y + dy * 2 };
            const occ = occupiedSquares(game, t.pos);
            if (map.rows[pushed.y]?.[pushed.x] && (map.legend[map.rows[pushed.y][pushed.x]]?.passable) && !occ.some((p) => p.x === pushed.x && p.y === pushed.y)) {
              t.pos = pushed;
              await host(ctx, room, `${t.name} is hurled 10 ft back.`);
            }
          }
        }
      } else if (eff.kind === 'heal') {
        const ally = targetChar ?? c;
        if (feet(c.pos, ally.pos) > spell.range) throw new Error(`${ally.name} is too far to reach`);
        const r = roll(rng, eff.dice);
        let amount = r.total + (eff.addMod ? castMod : 0);
        if (sheet.key === 'cleric' && spell.level >= 1) amount += 2 + spell.level; // Disciple of Life
        const healed = healCharacter(ally, amount);
        await dice(ctx, room, c.name, actorKey, `${spell.name} ${fmtDice(r)} + ${castMod}${sheet.key === 'cleric' ? ` + ${2 + spell.level} (Disciple of Life)` : ''} = ${amount}`, { kind: 'heal', total: amount });
        await tag(`casts ${spell.name} on ${ally === c ? 'themself' : ally.name}: ${healed} HP restored${healed < amount ? ' (at full)' : ''}${isDown(ally) ? '' : ally.hp > 0 && healed > 0 && ally.conditions.length === 0 ? '' : ''}.`, { kind: 'cast', spell: spellName, targetId: action.targetId });
        if (healed > 0 && ally.hp > 0 && ally.hp - healed <= 0) await host(ctx, room, `${ally.name} gasps and sits up.`);
      } else if (eff.kind === 'missiles') {
        const ids = action.targetIds?.length ? action.targetIds : action.targetId ? [action.targetId, action.targetId, action.targetId] : [];
        const targets = ids.map((id) => creatureById(game, id)).filter((t): t is CreatureState => !!t && !t.conditions.includes('dead'));
        if (!targets.length) throw new Error('Target?');
        await tag(`casts ${spell.name} — three darts of force streak out.`, { kind: 'cast', spell: spellName });
        for (let i = 0; i < eff.darts; i++) {
          const t = targets[Math.min(i, targets.length - 1)];
          if (t.conditions.includes('dead')) continue;
          const r = roll(rng, eff.damage);
          const out = damageCreature(rng, t, r.total, 'force');
          await dice(ctx, room, c.name, actorKey, `dart ${i + 1} → ${t.name}: ${fmtDice(r)} force`, { kind: 'missile' });
          if (out.killed) await host(ctx, room, `${t.name} comes apart under the darts.`);
        }
      } else if (eff.kind === 'buff') {
        const chars = game.characters as CharacterState[];
        const targets = eff.condition === 'mageArmor'
          ? [targetChar ?? c]
          : (action.targetIds?.length ? action.targetIds.map((id) => characterById(game, id)).filter((x): x is CharacterState => !!x) : chars.filter((x) => !isDead(x)).sort((a, b) => feet(c.pos, a.pos) - feet(c.pos, b.pos))).slice(0, eff.targets);
        for (const t of targets) t.conditions = addCondition(t.conditions, eff.condition);
        await tag(`casts ${spell.name} on ${targets.map((t) => (t === c ? 'themself' : t.name)).join(', ')}.`, { kind: 'cast', spell: spellName });
      } else if (eff.kind === 'sleep') {
        await tag(`casts ${spell.name}. A wave of drowsiness rolls across the sand... and does nothing. The dead do not sleep.`, { kind: 'cast', spell: spellName });
        await host(ctx, room, `Undead are unaffected by sleep.`);
      }
      game.turn = turn;
      await save(ctx, game);
      if (await checkEnd(ctx, room, game)) return;
      if (auto && spell.time !== 'bonus') await advance(ctx, room, game);
      return;
    }
  }
}

function attackFor(c: CharacterState, key?: string): Attack {
  const sheet = sheetOf(c);
  if (key === 'torch') {
    return { key: 'torch', name: 'Burning torch', kind: 'melee', toHit: abilityMod(sheet, 'str'), damage: '1', damageType: 'fire', reach: 5, note: 'improvised' };
  }
  const found = sheet.attacks.find((a) => a.key === key) ?? sheet.attacks[0];
  if (!found) throw new Error('No weapon');
  return found;
}

function attackVerb(a: Attack): string {
  return a.kind === 'ranged' ? `looses ${a.name === 'Longbow' || a.name === 'Shortbow' ? 'an arrow' : a.name.toLowerCase()}` : a.kind === 'thrown' ? `throws a ${a.name.toLowerCase()}` : `swings ${a.name.toLowerCase()}`;
}

async function narrateHit(ctx: MutationCtx, room: Doc<'rooms'>, attacker: string, target: CreatureState, withWhat: string, out: ReturnType<typeof damageCreature>, critical: boolean) {
  const bits: string[] = [];
  if (critical) bits.push('A critical hit!');
  bits.push(`${attacker}'s ${withWhat.toLowerCase()} ${critical ? 'tears into' : 'strikes'} ${target.name} for ${out.applied} damage${out.oilBurst ? ' (the oil goes up in a whoosh of flame)' : ''}.`);
  if (out.fortitude) {
    bits.push(`It should drop — Undead Fortitude: CON save ${fmtRoll(out.fortitude.save)} vs DC ${out.fortitude.dc}, ${out.fortitude.success ? 'and it staggers back up with 1 hit point.' : 'failed.'}`);
  }
  if (out.killed) bits.push(`${target.name} crumples and lies still.`);
  else if (!out.fortitude) bits.push(`${target.hp}/${target.hpMax} HP left.`);
  await host(ctx, room, bits.join(' '), { kind: 'hit', targetId: `npc:${target.key}`, killed: out.killed });
}

// ---------------------------------------------------------------------------
// Monsters

export const monsterTurn = internalMutation({
  args: { roomId: v.id('rooms'), turnToken: v.number() },
  handler: async (ctx, { roomId, turnToken }) => {
    const { room, game } = await roomAndGame(ctx, roomId);
    if (game.turnToken !== turnToken || game.phase !== 'combat') return;
    if (room.status !== 'running') return; // resume re-kicks
    const who = active(game);
    if (!who || who.side !== 'enemy') return;
    const z = creatureById(game, who.id)!;
    if (z.conditions.includes('dead')) return await advance(ctx, room, game);
    const map = MAPS[game.mapKey];
    const targets = livingParty(game);
    if (!targets.length) {
      await save(ctx, game);
      if (await checkEnd(ctx, room, game)) return;
      return await advance(ctx, room, game);
    }
    const speed = z.conditions.includes('slowed') ? Math.max(0, STAT_BLOCKS[z.statKey].speed - 10) : STAT_BLOCKS[z.statKey].speed;
    z.conditions = removeCondition(z.conditions, 'slowed');
    const target = nearest(z.pos, targets)!;
    if (!adjacent(z.pos, target.pos)) {
      let steps = Math.floor(speed / 5);
      const path = approach(map, z.pos, target.pos, occupiedSquares(game, z.pos), steps);
      let dashed = false;
      if (path.length) z.pos = path[path.length - 1];
      if (!adjacent(z.pos, target.pos)) {
        // Too far to reach: Dash instead of attacking.
        const more = approach(map, z.pos, target.pos, occupiedSquares(game, z.pos), steps);
        if (more.length) z.pos = more[more.length - 1];
        dashed = true;
      }
      await appendEvent(ctx, room._id, { type: 'action', actorKey: 'host', actorName: z.name, body: `${dashed ? 'lurches' : 'shambles'} toward ${target.name}${dashed ? ', arms out, closing the distance' : ''}.`, data: { kind: 'move', to: z.pos, combatantId: who.id } });
      if (dashed) {
        await save(ctx, game);
        return await advance(ctx, room, game);
      }
    }
    await monsterAttack(ctx, room, game, z, target);
    await save(ctx, game);
    if (await checkEnd(ctx, room, game)) return;
    return await advance(ctx, room, game);
  },
});

async function monsterAttack(ctx: MutationCtx, room: Doc<'rooms'>, game: Game, z: CreatureState, target: CharacterState) {
  const slam = STAT_BLOCKS[z.statKey].attacks[0];
  const dis = target.conditions.includes('dodging');
  const res = resolveAttack(rng, slam, characterAC(target), { dis, autoCrit: isDown(target) });
  await dice(ctx, room, z.name, 'host', `${slam.name} vs ${target.name} (AC ${characterAC(target)}): ${fmtRoll(res.attack)}${res.critical ? ' CRIT' : res.hit ? ' hit' : ' miss'}${res.damage ? ` — ${fmtDice(res.damage)} ${slam.damageType}` : ''}`, { kind: 'attack', hit: res.hit, critical: res.critical, targetId: `pc:${target.sheetKey}` });
  if (!res.hit) {
    await host(ctx, room, `${z.name} swings a waterlogged fist at ${target.name} and misses.`);
    return;
  }
  const out = damageCharacter(target, res.damage!.total, { critical: res.critical, melee: true });
  let line = `${z.name}'s slam ${res.critical ? 'crashes' : 'connects'} — ${target.name} takes ${out.applied} bludgeoning${out.absorbed ? ` (${out.absorbed} absorbed)` : ''}.`;
  if (out.instantDeath) line += ` ${target.name} is killed outright.`;
  else if (out.dropped) line += ` ${target.name} drops to 0 HP and falls unconscious!`;
  else if (out.failuresAdded) line += ` ${target.name}, already down, takes ${out.failuresAdded} death save failure${out.failuresAdded > 1 ? 's' : ''}.${out.died ? ` That was the last one.` : ''}`;
  else line += ` ${target.hp}/${sheetOf(target).hpMax} HP.`;
  await host(ctx, room, line, { kind: 'hit', targetId: `pc:${target.sheetKey}`, dropped: out.dropped });
}

// ---------------------------------------------------------------------------
// Masks: hand the turn to the shared loop with a D&D-shaped prompt and one tool

export const maskTurn = internalMutation({
  args: { roomId: v.id('rooms'), turnToken: v.number() },
  handler: async (ctx, { roomId, turnToken }) => {
    const { room, game } = await roomAndGame(ctx, roomId);
    if (game.turnToken !== turnToken || game.phase !== 'combat') return;
    if (room.status !== 'running') return;
    const who = active(game);
    if (!who || who.side !== 'party') return;
    const c = characterById(game, who.id)!;
    const seat = (game.seats as Seats)[c.sheetKey];
    if (!seat || seat.ownerKind !== 'mask') return;
    const member = await memberOf(ctx, roomId, seat.ownerKey);
    if (!hasInference((room.config as { guildId?: string } | undefined)?.guildId)) {
      // No inference: the table still plays.
      await ctx.scheduler.runAfter(0, internal.wizard.maskFallback, { roomId, turnToken });
      return;
    }
    const { system: sys, prompt } = buildMaskPrompt(game, c, member?.persona ?? '', member?.name ?? c.name);
    await ctx.scheduler.runAfter(0, internal.agent.runTurn, {
      roomId,
      memberKey: seat.ownerKey,
      actorName: c.name,
      system: sys,
      prompt,
      tools: [TAKE_TURN_TOOL],
      resolver: 'wizard:onToolCall',
      turnToken,
    });
    // If the model talks but never calls the tool, the fallback keeps the round moving.
    await ctx.scheduler.runAfter(25_000, internal.wizard.maskFallback, { roomId, turnToken });
  },
});

const TAKE_TURN_TOOL = {
  name: 'take_turn',
  description: 'Take your combat turn: optionally move, then take one action. Call this exactly once. Say something short in character while you do it.',
  input_schema: {
    type: 'object',
    properties: {
      say: { type: 'string', description: 'One or two sentences, in character, said out loud at the table.' },
      move_to: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'], description: 'Optional: a square to move to first (within your speed; 5 ft per square).' },
      action: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['attack', 'cast', 'dodge', 'dash', 'disengage', 'help', 'hide', 'search', 'useObject', 'secondWind', 'layOnHands', 'endTurn'] },
          attackKey: { type: 'string', description: 'For attack: one of your attack keys.' },
          spell: { type: 'string', description: 'For cast: a spell name you have prepared or a cantrip.' },
          targetId: { type: 'string', description: 'npc:<key> for an enemy, pc:<key> for an ally.' },
          item: { type: 'string', description: 'For useObject: "torch".' },
          amount: { type: 'integer' },
        },
        required: ['type'],
      },
    },
    required: ['say', 'action'],
  },
};

function buildMaskPrompt(game: Game, c: CharacterState, persona: string, maskName: string) {
  const sheet = sheetOf(c);
  const map = MAPS[game.mapKey];
  const enemies = livingEnemies(game).map((z) => `- npc:${z.key} ${z.name} at (${z.pos.x},${z.pos.y}), ${feet(c.pos, z.pos)} ft away, ${z.hp <= 0 ? 'down' : z.hp < z.hpMax / 2 ? 'badly hurt' : z.hp < z.hpMax ? 'hurt' : 'unhurt'}${z.conditions.length ? ` [${z.conditions.join(', ')}]` : ''}`);
  const allies = (game.characters as CharacterState[]).filter((a) => a !== c).map((a) => `- pc:${a.sheetKey} ${a.name} (${PREGENS[a.sheetKey].className}) at (${a.pos.x},${a.pos.y}), ${a.hp}/${PREGENS[a.sheetKey].hpMax} HP${a.conditions.length ? ` [${a.conditions.join(', ')}]` : ''}`);
  const attacks = sheet.attacks.filter((a) => !a.ammo || (c.consumables[a.ammo] ?? 0) > 0).map((a) => `- attackKey "${a.key}": ${a.name}, ${a.kind}, +${a.toHit} to hit, ${a.damage} ${a.damageType}${a.range ? `, range ${a.range.normal}/${a.range.long} ft` : ', reach 5 ft'}${a.ammo ? ` (${c.consumables[a.ammo]} left)` : ''}${a.note ? ` — ${a.note}` : ''}`);
  if ((c.consumables.torch ?? 0) > 0) attacks.push(`- attackKey "torch": burning torch (light it first with useObject item "torch"), improvised, 1 fire damage — sets oil alight`);
  const spells = sheet.spellcasting
    ? [...sheet.spellcasting.cantrips.map((s) => `- "${s}" (cantrip): ${SPELLS[s]?.text ?? ''}`), ...sheet.spellcasting.prepared.map((s) => `- "${s}" (level ${SPELLS[s]?.level}): ${SPELLS[s]?.text ?? ''}`), `Slots: level 1 — ${(sheet.spellcasting.slots[1] ?? 0) - (c.slotsUsed[1] ?? 0)} of ${sheet.spellcasting.slots[1]} left.`]
    : ['(no spells)'];
  const speedSquares = Math.floor(characterSpeed(c) / 5);
  const reach = reachable(map, c.pos, speedSquares, occupiedSquares(game, c.pos));
  const grid = map.rows.map((row, y) => row.split('').map((t, x) => {
    const pc = (game.characters as CharacterState[]).find((a) => a.pos.x === x && a.pos.y === y);
    if (pc) return pc === c ? '@' : PREGENS[pc.sheetKey].className[0];
    const z = livingEnemies(game).find((a) => a.pos.x === x && a.pos.y === y);
    if (z) return 'Z';
    return t;
  }).join('')).join('\n');

  const system =
    `You are ${maskName}, playing Dungeons & Dragons (5th edition) at a live table with friends. Your character is ${c.name}, a ${sheet.race} ${sheet.className} (${sheet.background}, ${sheet.alignment}). ` +
    `Your personality: ${persona || 'a bold adventurer'}. Stay completely in character; speak as ${maskName} would, but play the ${sheet.className} competently and in class. ` +
    `Be brief and vivid: one or two sentences out loud, then act. Never narrate outcomes or roll dice yourself — the DM rolls. Never invent abilities you do not have. Call the take_turn tool exactly once.`;

  const prompt =
    `It is your turn. Round ${game.round}. You are at (${c.pos.x},${c.pos.y}) with ${c.hp}/${sheet.hpMax} HP${c.conditions.length ? ` [${c.conditions.join(', ')}]` : ''}. Speed ${characterSpeed(c)} ft (${speedSquares} squares). ` +
    `You may move first (move_to any square marked reachable) and take ONE action.\n\n` +
    `Map (north/sea at top; ~ sea, . sand, # rock, = dock, : stairs; @ you, Z zombie, letters allies):\n${grid}\n\n` +
    `Enemies:\n${enemies.join('\n') || '- none'}\n\nAllies:\n${allies.join('\n') || '- none'}\n\n` +
    `Your attacks:\n${attacks.join('\n')}\n\nYour spells:\n${spells.join('\n')}\n\n` +
    (sheet.key === 'rogue' ? `Sneak Attack (+1d6) applies when you have advantage or an ally is adjacent to your target. You carry ${c.consumables.oil ?? 0} flask(s) of oil (attackKey "oil").\n` : '') +
    (sheet.key === 'fighter' ? `Second Wind (bonus action, ${c.resources.secondWind ? 'available' : 'spent'}) heals 1d10+1.\n` : '') +
    (sheet.key === 'paladin' ? `Lay on Hands pool: ${c.resources.layOnHands} HP (action, touch, not on undead).\n` : '') +
    `Melee needs to be within 5 ft (adjacent square). Ranged attacks next to an enemy have disadvantage. Zombies have Undead Fortitude: radiant damage or a critical hit keeps them down.\n` +
    `Reachable squares this turn: ${[...reach.keys()].slice(0, 60).map((k) => `(${k})`).join(' ')}${reach.size > 60 ? ' …' : ''}`;
  return { system, prompt };
}

// ---------------------------------------------------------------------------
// The DM's voice, when there is a model to lend it one

export const narrate = internalMutation({
  args: { roomId: v.id('rooms'), beat: v.string() },
  handler: async (ctx, { roomId, beat }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return;
    if (!hasInference((room.config as { guildId?: string } | undefined)?.guildId)) return;
    const game = await gameFor(ctx, roomId);
    const roster = ((game?.characters ?? []) as CharacterState[]).map((c) => `${c.name} the ${PREGENS[c.sheetKey].race} ${PREGENS[c.sheetKey].className}`).join(', ');
    await ctx.scheduler.runAfter(0, internal.agent.runTurn, {
      roomId,
      memberKey: 'host',
      actorName: room.hostName,
      eventType: 'host',
      system:
        `You are ${room.hostName}, the Dungeon Master running "Dragons of Stormwreck Isle" (the 2022 D&D Starter Set) for a table of friends, some of them AI characters. ` +
        `You are warm, quick, and fair, like the experienced DMs who run the beginner adventure at game stores: you keep things moving, describe vividly in two or three sentences, ask "what do you do?", and never roll for the players or decide their actions. ` +
        `Rules are 5e 2014. All dice are rolled by the table's engine and appear in the log — never invent results. Party: ${roster || 'not seated yet'}.`,
      prompt: beat,
    });
  },
});

/** A human asks the DM something out of turn, or describes an action in prose. */
export const askDm = mutation({
  args: { roomId: v.id('rooms'), memberKey: v.string(), text: v.string() },
  handler: async (ctx, { roomId, memberKey, text }) => {
    const { room } = await roomAndGame(ctx, roomId);
    const member = await memberOf(ctx, roomId, memberKey);
    if (!member) throw new Error('Not at the table');
    await appendEvent(ctx, roomId, { type: 'say', actorKey: memberKey, actorName: member.name, body: text.trim().slice(0, 1000) });
    if (/\b(pause|hold on|wait|one sec|character sheet)\b/i.test(text) && room.status === 'running') {
      await ctx.scheduler.runAfter(0, internal.wizard.setPausedInternal, { roomId, memberKey, reason: 'asked to pause' });
      return;
    }
    await ctx.scheduler.runAfter(0, internal.wizard.narrate, {
      roomId,
      beat: `${member.name} just said: "${text.trim().slice(0, 500)}". Answer them as the DM in one to three sentences. If it is a rules question, answer accurately for 5e 2014. If they are describing an action in combat, tell them to use the action controls (the engine resolves actions) but react to their intent in character.`,
    });
  },
});

export const setPausedInternal = internalMutation({
  args: { roomId: v.id('rooms'), memberKey: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { room, game } = await roomAndGame(ctx, args.roomId);
    const member = await memberOf(ctx, args.roomId, args.memberKey);
    const name = member?.name ?? 'someone';
    if (room.status !== 'running') return;
    await ctx.db.patch(args.roomId, { status: 'paused', pause: { byKey: args.memberKey, byName: name, reason: args.reason, at: Date.now() } });
    await appendEvent(ctx, args.roomId, { type: 'system', actorKey: args.memberKey, actorName: name, body: `${name} paused the game${args.reason ? `: ${args.reason}` : ''}.`, data: { kind: 'status', status: 'paused' } });
    await host(ctx, room, `Sure — everyone hold a moment.${game.phase === 'combat' && active(game) ? ` ${active(game)!.name} is up when we're back.` : ''}`);
  },
});
