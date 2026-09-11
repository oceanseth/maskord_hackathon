import {
  chebyshev,
  mod,
  type Ability,
  type Attack,
  type CharacterState,
  type Condition,
  type CreatureState,
  type Position,
  type Sheet,
  type TileMap,
} from './types';
import { PREGENS } from './pregens';
import { STAT_BLOCKS } from './scenario';

/**
 * The rules, as pure functions. Nothing here touches the database; the Convex
 * module (../wizard.ts) calls these and writes the results. Every random
 * number comes through `Rng` so a mutation can pass Convex's deterministic
 * Math.random and a test can pass a seeded one.
 */
export type Rng = () => number;

export function d(rng: Rng, sides: number): number {
  return 1 + Math.floor(rng() * sides);
}

export interface RollResult {
  expr: string;
  rolls: number[];
  bonus: number;
  total: number;
}

/** Roll a dice expression like "2d6+1", "1d8", "4", "1d4+3". */
export function roll(rng: Rng, expr: string, times = 1): RollResult {
  const clean = expr.replace(/\s+/g, '');
  const m = /^(?:(\d*)d(\d+))?([+-]\d+)?$/.exec(clean);
  if (!m) throw new Error(`Bad dice expression: ${expr}`);
  const count = m[2] ? (m[1] ? parseInt(m[1], 10) : 1) * times : 0;
  const sides = m[2] ? parseInt(m[2], 10) : 0;
  const bonus = m[3] ? parseInt(m[3], 10) : 0;
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(d(rng, sides));
  const total = Math.max(0, rolls.reduce((a, b) => a + b, 0) + bonus + (count === 0 && !m[3] ? parseInt(clean, 10) || 0 : 0));
  return { expr: times > 1 ? `${count}d${sides}${m[3] ?? ''}` : clean, rolls, bonus, total };
}

export type AdvState = 'normal' | 'advantage' | 'disadvantage';

export function combineAdv(adv: boolean, dis: boolean): AdvState {
  if (adv && dis) return 'normal';
  if (adv) return 'advantage';
  if (dis) return 'disadvantage';
  return 'normal';
}

export interface D20Result {
  natural: number;
  rolls: number[];
  adv: AdvState;
  bonus: number;
  blessDie?: number;
  total: number;
}

export function d20(rng: Rng, bonus: number, adv: AdvState = 'normal', blessed = false, lucky = false): D20Result {
  let rolls = adv === 'normal' ? [d(rng, 20)] : [d(rng, 20), d(rng, 20)];
  let natural = adv === 'advantage' ? Math.max(...rolls) : adv === 'disadvantage' ? Math.min(...rolls) : rolls[0];
  // Halfling Lucky: reroll a natural 1, must use the new roll.
  if (lucky && natural === 1) {
    const reroll = d(rng, 20);
    rolls = [...rolls, reroll];
    natural = reroll;
  }
  const blessDie = blessed ? d(rng, 4) : undefined;
  return { natural, rolls, adv, bonus, blessDie, total: natural + bonus + (blessDie ?? 0) };
}

// ---------------------------------------------------------------------------
// Characters

export function sheetOf(c: CharacterState): Sheet {
  return PREGENS[c.sheetKey];
}

export function abilityMod(sheet: Sheet, ability: Ability): number {
  return mod(sheet.abilities[ability]);
}

export function saveBonus(sheet: Sheet, ability: Ability): number {
  return abilityMod(sheet, ability) + (sheet.saveProficiencies.includes(ability) ? sheet.proficiencyBonus : 0);
}

export function skillBonus(sheet: Sheet, skill: keyof Sheet['skills']): number {
  const entry = sheet.skills[skill];
  const ability = ({
    acrobatics: 'dex', animalHandling: 'wis', arcana: 'int', athletics: 'str', deception: 'cha', history: 'int',
    insight: 'wis', intimidation: 'cha', investigation: 'int', medicine: 'wis', nature: 'int', perception: 'wis',
    performance: 'cha', persuasion: 'cha', religion: 'int', sleightOfHand: 'dex', stealth: 'dex', survival: 'wis',
  } as const)[skill];
  const base = abilityMod(sheet, ability);
  return base + (entry === 'expertise' ? sheet.proficiencyBonus * 2 : entry === 'proficient' ? sheet.proficiencyBonus : 0);
}

export function passivePerception(sheet: Sheet): number {
  return 10 + skillBonus(sheet, 'perception');
}

export function characterAC(c: CharacterState): number {
  const sheet = sheetOf(c);
  if (c.conditions.includes('mageArmor') && sheet.key === 'wizard') return 13 + abilityMod(sheet, 'dex');
  if (c.conditions.includes('shieldDown')) return sheet.ac - 2;
  return sheet.ac;
}

export function characterSpeed(c: CharacterState): number {
  const sheet = sheetOf(c);
  let speed = sheet.speed;
  if (c.conditions.includes('slowed')) speed = Math.max(0, speed - 10);
  return speed;
}

export function isDown(c: CharacterState): boolean {
  return c.hp <= 0;
}

export function isDead(c: CharacterState): boolean {
  return c.conditions.includes('dead');
}

export function newCharacter(sheetKey: Sheet['key'], name: string, pos: Position): CharacterState {
  const sheet = PREGENS[sheetKey];
  return {
    sheetKey,
    name,
    hp: sheet.hpMax,
    tempHp: 0,
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    slotsUsed: {},
    consumables: { ...sheet.consumables },
    resources: { ...sheet.resources },
    pos,
  };
}

export function newCreature(statKey: string, key: string, name: string, pos: Position, rng: Rng, rollHp = false): CreatureState {
  const block = STAT_BLOCKS[statKey];
  const hp = rollHp ? roll(rng, block.hpDice).total : block.hpAverage;
  return { key, statKey, name, hp, hpMax: hp, conditions: [], pos };
}

export function addCondition(conds: Condition[], c: Condition): Condition[] {
  return conds.includes(c) ? conds : [...conds, c];
}

export function removeCondition(conds: Condition[], c: Condition): Condition[] {
  return conds.filter((x) => x !== c);
}

// ---------------------------------------------------------------------------
// Damage

export interface DamageOutcome {
  /** What was actually subtracted from HP after temp HP. */
  applied: number;
  /** Zombie Undead Fortitude kept it up. */
  fortitude?: { dc: number; save: D20Result; success: boolean };
  dropped: boolean;
  killed: boolean;
  /** Oil on the target added 5 fire. */
  oilBurst?: boolean;
}

/** Apply damage to a creature, honoring immunities and Undead Fortitude. */
export function damageCreature(
  rng: Rng,
  target: CreatureState,
  amount: number,
  damageType: string,
  opts: { critical?: boolean } = {},
): DamageOutcome {
  const block = STAT_BLOCKS[target.statKey];
  if (block.immunities?.includes(damageType as never)) {
    return { applied: 0, dropped: false, killed: false };
  }
  let total = amount;
  let oilBurst = false;
  if (damageType === 'fire' && target.conditions.includes('oiled')) {
    total += 5;
    oilBurst = true;
    target.conditions = removeCondition(target.conditions, 'oiled');
  }
  target.hp -= total;
  const out: DamageOutcome = { applied: total, dropped: false, killed: false, oilBurst };
  if (target.hp <= 0) {
    const hasFortitude = block.traits.some((t) => t.name === 'Undead Fortitude');
    if (hasFortitude && damageType !== 'radiant' && !opts.critical) {
      const dc = 5 + total;
      const save = d20(rng, mod(block.abilities.con));
      const success = save.total >= dc;
      out.fortitude = { dc, save, success };
      if (success) {
        target.hp = 1;
        return out;
      }
    }
    target.hp = 0;
    target.conditions = addCondition(target.conditions, 'dead');
    out.dropped = true;
    out.killed = true;
  }
  return out;
}

export interface CharacterDamageOutcome {
  applied: number;
  absorbed: number;
  dropped: boolean;
  instantDeath: boolean;
  /** Damage while already at 0 HP counts as death save failures. */
  failuresAdded: number;
  died: boolean;
}

export function damageCharacter(
  c: CharacterState,
  amount: number,
  opts: { critical?: boolean; melee?: boolean } = {},
): CharacterDamageOutcome {
  const sheet = sheetOf(c);
  const out: CharacterDamageOutcome = { applied: 0, absorbed: 0, dropped: false, instantDeath: false, failuresAdded: 0, died: false };
  if (isDead(c)) return out;
  if (c.hp <= 0) {
    // Already down: no HP to lose, but each hit is a failed death save (two on a crit).
    out.failuresAdded = opts.critical ? 2 : 1;
    c.deathSaves.failures += out.failuresAdded;
    if (c.deathSaves.failures >= 3) {
      c.conditions = addCondition(c.conditions, 'dead');
      out.died = true;
    }
    return out;
  }
  const absorbed = Math.min(c.tempHp, amount);
  c.tempHp -= absorbed;
  const remaining = amount - absorbed;
  out.absorbed = absorbed;
  out.applied = remaining;
  const overflow = remaining - c.hp;
  c.hp = Math.max(0, c.hp - remaining);
  if (c.hp === 0) {
    out.dropped = true;
    c.conditions = removeCondition(c.conditions, 'dodging');
    if (overflow >= sheet.hpMax) {
      out.instantDeath = true;
      out.died = true;
      c.conditions = addCondition(c.conditions, 'dead');
    } else {
      c.conditions = addCondition(c.conditions, 'unconscious');
      c.deathSaves = { successes: 0, failures: 0 };
    }
  }
  return out;
}

export function healCharacter(c: CharacterState, amount: number): number {
  if (isDead(c)) return 0;
  const sheet = sheetOf(c);
  const before = c.hp;
  c.hp = Math.min(sheet.hpMax, c.hp + amount);
  if (before <= 0 && c.hp > 0) {
    c.conditions = removeCondition(removeCondition(c.conditions, 'unconscious'), 'stable');
    c.deathSaves = { successes: 0, failures: 0 };
  }
  return c.hp - before;
}

export interface DeathSaveOutcome {
  roll: D20Result;
  result: 'success' | 'failure' | 'stable' | 'dead' | 'revived';
}

export function deathSave(rng: Rng, c: CharacterState): DeathSaveOutcome {
  const r = d20(rng, 0, 'normal', false, c.sheetKey === 'rogue');
  if (r.natural === 20) {
    c.hp = 1;
    c.conditions = removeCondition(removeCondition(c.conditions, 'unconscious'), 'stable');
    c.deathSaves = { successes: 0, failures: 0 };
    return { roll: r, result: 'revived' };
  }
  if (r.natural === 1) c.deathSaves.failures += 2;
  else if (r.total >= 10) c.deathSaves.successes += 1;
  else c.deathSaves.failures += 1;
  if (c.deathSaves.failures >= 3) {
    c.conditions = addCondition(c.conditions, 'dead');
    return { roll: r, result: 'dead' };
  }
  if (c.deathSaves.successes >= 3) {
    c.conditions = addCondition(c.conditions, 'stable');
    return { roll: r, result: 'stable' };
  }
  return { roll: r, result: r.total >= 10 ? 'success' : 'failure' };
}

// ---------------------------------------------------------------------------
// Attacks

export interface AttackResolution {
  attack: D20Result;
  hit: boolean;
  critical: boolean;
  fumble: boolean;
  damage?: RollResult;
  sneak?: RollResult;
  damageType: string;
  rangeBand?: 'normal' | 'long' | 'out';
}

/**
 * Resolve an attack roll and its damage dice. The caller applies the damage
 * (so it can route to a character or a creature) and narrates.
 */
export function resolveAttack(
  rng: Rng,
  attack: Attack,
  targetAC: number,
  opts: {
    adv?: boolean;
    dis?: boolean;
    blessed?: boolean;
    lucky?: boolean;
    sneakAttack?: boolean;
    distanceFt?: number;
    autoCrit?: boolean;
  } = {},
): AttackResolution {
  let adv = !!opts.adv;
  let dis = !!opts.dis;
  let rangeBand: AttackResolution['rangeBand'];
  if (attack.kind !== 'melee' && opts.distanceFt !== undefined && attack.range) {
    if (opts.distanceFt > attack.range.long) rangeBand = 'out';
    else if (opts.distanceFt > attack.range.normal) {
      rangeBand = 'long';
      dis = true;
    } else rangeBand = 'normal';
  }
  const r = d20(rng, attack.toHit, combineAdv(adv, dis), opts.blessed, opts.lucky);
  const critical = r.natural === 20 || (!!opts.autoCrit && r.natural !== 1);
  const fumble = r.natural === 1;
  const hit = rangeBand !== 'out' && !fumble && (critical || r.total >= targetAC);
  const out: AttackResolution = { attack: r, hit, critical, fumble, damageType: attack.damageType, rangeBand };
  if (hit) {
    out.damage = roll(rng, attack.damage, critical ? 2 : 1);
    if (opts.sneakAttack) out.sneak = roll(rng, '1d6', critical ? 2 : 1);
  }
  return out;
}

export function savingThrow(rng: Rng, bonus: number, dc: number, opts: { adv?: boolean; dis?: boolean; blessed?: boolean; lucky?: boolean } = {}) {
  const r = d20(rng, bonus, combineAdv(!!opts.adv, !!opts.dis), opts.blessed, opts.lucky);
  return { roll: r, dc, success: r.total >= dc };
}

// ---------------------------------------------------------------------------
// The grid

export function tileAt(map: TileMap, p: Position): string | null {
  if (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) return null;
  return map.rows[p.y][p.x];
}

export function passable(map: TileMap, p: Position): boolean {
  const t = tileAt(map, p);
  return t !== null && (map.legend[t]?.passable ?? false);
}

/**
 * Squares reachable within `steps` moves (8-directional, each square 5 ft —
 * the simple diagonal rule from the Basic Rules), not passing through
 * occupied squares. Returns a map of "x,y" -> steps taken.
 */
export function reachable(map: TileMap, from: Position, steps: number, occupied: Position[]): Map<string, number> {
  const key = (p: Position) => `${p.x},${p.y}`;
  const blocked = new Set(occupied.map(key));
  blocked.delete(key(from));
  const seen = new Map<string, number>([[key(from), 0]]);
  const queue: Position[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    const dist = seen.get(key(cur))!;
    if (dist >= steps) continue;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const next = { x: cur.x + dx, y: cur.y + dy };
        const k = key(next);
        if (seen.has(k) || !passable(map, next) || blocked.has(k)) continue;
        seen.set(k, dist + 1);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Shortest path (list of squares after `from`) to `to`, or null. */
export function pathTo(map: TileMap, from: Position, to: Position, occupied: Position[], maxSteps = 200): Position[] | null {
  const key = (p: Position) => `${p.x},${p.y}`;
  const blocked = new Set(occupied.map(key));
  blocked.delete(key(from));
  blocked.delete(key(to));
  const prev = new Map<string, Position | null>([[key(from), null]]);
  const queue: Position[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.x === to.x && cur.y === to.y) break;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const next = { x: cur.x + dx, y: cur.y + dy };
        const k = key(next);
        if (prev.has(k) || !passable(map, next) || blocked.has(k)) continue;
        prev.set(k, cur);
        queue.push(next);
      }
    }
    if (prev.size > maxSteps * 8) break;
  }
  if (!prev.has(key(to))) return null;
  const path: Position[] = [];
  let cur: Position | null = to;
  while (cur && !(cur.x === from.x && cur.y === from.y)) {
    path.unshift(cur);
    cur = prev.get(key(cur)) ?? null;
  }
  return path;
}

/** The square adjacent to `target` that is closest along a path from `from`. */
export function approach(map: TileMap, from: Position, target: Position, occupied: Position[], steps: number): Position[] {
  const path = pathTo(map, from, target, occupied);
  if (!path) return [];
  // Stop one short of the target square itself.
  const trimmed = path.slice(0, Math.max(0, path.length - 1));
  return trimmed.slice(0, steps);
}

export function adjacent(a: Position, b: Position): boolean {
  return chebyshev(a, b) === 1;
}

export function nearest<T extends { pos: Position }>(from: Position, items: T[]): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const it of items) {
    const dd = chebyshev(from, it.pos);
    if (dd < bestD) {
      bestD = dd;
      best = it;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Seating masks

/** Pick the unclaimed sheet whose persona hints best match a mask's persona. */
export function matchSheet(persona: string, name: string, available: Sheet['key'][]): Sheet['key'] | null {
  if (available.length === 0) return null;
  const text = `${name} ${persona}`.toLowerCase();
  let best: Sheet['key'] = available[0];
  let bestScore = -1;
  for (const key of available) {
    const score = PREGENS[key].personaHints.reduce((n, hint) => n + (text.includes(hint) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best;
}

export function fmtRoll(r: D20Result): string {
  const dice = r.rolls.length > 1 ? `[${r.rolls.join(', ')}]` : `${r.rolls[0]}`;
  const advTag = r.adv === 'advantage' ? ' adv' : r.adv === 'disadvantage' ? ' dis' : '';
  const bless = r.blessDie ? ` +${r.blessDie} bless` : '';
  const bonus = r.bonus >= 0 ? `+${r.bonus}` : `${r.bonus}`;
  return `d20${advTag} ${dice} ${bonus}${bless} = ${r.total}`;
}

export function fmtDice(r: RollResult): string {
  const bonus = r.bonus ? (r.bonus > 0 ? `+${r.bonus}` : `${r.bonus}`) : '';
  return r.rolls.length ? `${r.expr} [${r.rolls.join(', ')}]${bonus} = ${r.total}` : `${r.total}`;
}
