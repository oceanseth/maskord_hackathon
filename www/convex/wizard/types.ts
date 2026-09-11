/**
 * Shared shapes for the D&D table. Imported by the Convex engine (wizard.ts)
 * and by the client (app/desktop/src/rooms/wizard) so both agree on what a
 * character sheet, a creature and the board look like.
 *
 * Rules are D&D 5th edition, 2014 (SRD 5.1). Numbers on the pregenerated
 * sheets are from the official 2022 Starter Set character PDF.
 */

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_NAMES: Record<Ability, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

export type Skill =
  | 'acrobatics' | 'animalHandling' | 'arcana' | 'athletics' | 'deception' | 'history'
  | 'insight' | 'intimidation' | 'investigation' | 'medicine' | 'nature' | 'perception'
  | 'performance' | 'persuasion' | 'religion' | 'sleightOfHand' | 'stealth' | 'survival';

export const SKILLS: { key: Skill; name: string; ability: Ability }[] = [
  { key: 'acrobatics', name: 'Acrobatics', ability: 'dex' },
  { key: 'animalHandling', name: 'Animal Handling', ability: 'wis' },
  { key: 'arcana', name: 'Arcana', ability: 'int' },
  { key: 'athletics', name: 'Athletics', ability: 'str' },
  { key: 'deception', name: 'Deception', ability: 'cha' },
  { key: 'history', name: 'History', ability: 'int' },
  { key: 'insight', name: 'Insight', ability: 'wis' },
  { key: 'intimidation', name: 'Intimidation', ability: 'cha' },
  { key: 'investigation', name: 'Investigation', ability: 'int' },
  { key: 'medicine', name: 'Medicine', ability: 'wis' },
  { key: 'nature', name: 'Nature', ability: 'int' },
  { key: 'perception', name: 'Perception', ability: 'wis' },
  { key: 'performance', name: 'Performance', ability: 'cha' },
  { key: 'persuasion', name: 'Persuasion', ability: 'cha' },
  { key: 'religion', name: 'Religion', ability: 'int' },
  { key: 'sleightOfHand', name: 'Sleight of Hand', ability: 'dex' },
  { key: 'stealth', name: 'Stealth', ability: 'dex' },
  { key: 'survival', name: 'Survival', ability: 'wis' },
];

export type DamageType =
  | 'bludgeoning' | 'piercing' | 'slashing' | 'fire' | 'cold' | 'lightning'
  | 'thunder' | 'radiant' | 'force' | 'necrotic' | 'poison' | 'acid' | 'psychic';

export interface Attack {
  key: string;
  name: string;
  /** 'melee' uses reach; 'ranged' and 'thrown' use range. Thrown can also be used in melee. */
  kind: 'melee' | 'ranged' | 'thrown';
  toHit: number;
  /** Dice expression, e.g. "1d6+2". */
  damage: string;
  damageType: DamageType;
  reach?: number;
  range?: { normal: number; long: number };
  /** Consumable this attack spends (arrows, javelins, daggers thrown). */
  ammo?: string;
  note?: string;
}

export type SheetKey = 'cleric' | 'fighter' | 'paladin' | 'rogue' | 'wizard';

export interface Spellcasting {
  ability: Ability;
  saveDC: number;
  attackBonus: number;
  cantrips: string[];
  /** Spells the character can cast today (prepared or known). */
  prepared: string[];
  /** Everything in the spellbook / class list on the sheet, for the sheet view. */
  known: string[];
  slots: Record<number, number>;
  note?: string;
}

/** A pregenerated character as printed. Never mutated; live state is CharacterState. */
export interface Sheet {
  key: SheetKey;
  className: string;
  subclass?: string;
  race: string;
  background: string;
  alignment: string;
  size: 'Small' | 'Medium';
  level: number;
  proficiencyBonus: number;
  abilities: Record<Ability, number>;
  saveProficiencies: Ability[];
  skills: Partial<Record<Skill, 'proficient' | 'expertise'>>;
  ac: number;
  acNote: string;
  speed: number;
  hpMax: number;
  hitDie: string;
  attacks: Attack[];
  spellcasting?: Spellcasting;
  features: string[];
  racialTraits: string[];
  languages: string[];
  gold: number;
  gear: string[];
  /** Countable items the engine tracks (oil flasks, arrows, javelins). */
  consumables: Record<string, number>;
  /** Class resources the engine tracks, with their starting values. */
  resources: Record<string, number>;
  backstory: string;
  personalGoal: string;
  personalGoalText: string;
  /** How a mask with no obvious class match should be nudged towards this sheet. */
  personaHints: string[];
  glyph: string;
}

export interface Position {
  x: number;
  y: number;
}

export type Condition =
  | 'prone' | 'unconscious' | 'dead' | 'stable' | 'dodging' | 'oiled' | 'burning'
  | 'blessed' | 'slowed' | 'helped' | 'hidden' | 'disengaged' | 'mageArmor' | 'shieldDown';

export interface CharacterState {
  sheetKey: SheetKey;
  name: string;
  hp: number;
  tempHp: number;
  conditions: Condition[];
  deathSaves: { successes: number; failures: number };
  slotsUsed: Record<number, number>;
  consumables: Record<string, number>;
  resources: Record<string, number>;
  pos: Position;
}

export interface CreatureStatBlock {
  key: string;
  name: string;
  size: string;
  type: string;
  alignment: string;
  ac: number;
  acNote?: string;
  hpAverage: number;
  hpDice: string;
  speed: number;
  abilities: Record<Ability, number>;
  saves?: Partial<Record<Ability, number>>;
  immunities?: DamageType[];
  conditionImmunities?: string[];
  senses: string;
  languages: string;
  cr: string;
  xp: number;
  traits: { name: string; text: string }[];
  attacks: Attack[];
  glyph: string;
}

export interface CreatureState {
  key: string;
  statKey: string;
  name: string;
  hp: number;
  hpMax: number;
  conditions: Condition[];
  pos: Position;
  /** Findings attached by research (source-backed notes the DM can draw on). */
  lore?: string[];
}

export type Tile = '~' | '.' | '#' | '=' | ':' | 'W';
export interface TileMap {
  key: string;
  name: string;
  width: number;
  height: number;
  rows: string[];
  legend: Record<string, { name: string; passable: boolean }>;
  /** Where a party of up to five stands when the scene opens. */
  partyStart: Position[];
  /** Squares with burning oil: pos plus the round it stops burning. */
}

export interface Combatant {
  /** 'pc:<sheetKey>' or 'npc:<creatureKey>'. */
  id: string;
  name: string;
  initiative: number;
  side: 'party' | 'enemy';
}

export type Phase = 'lobby' | 'scene' | 'combat' | 'victory' | 'defeat';

export interface Fire {
  pos: Position;
  /** Burns through the end of this round. */
  untilRound: number;
}

export function mod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function fmtMod(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function chebyshev(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Distance in feet on a 5 ft grid, the simple "every square is 5 ft" rule. */
export function feet(a: Position, b: Position): number {
  return chebyshev(a, b) * 5;
}
