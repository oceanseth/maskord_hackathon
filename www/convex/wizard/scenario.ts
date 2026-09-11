import type { CreatureStatBlock, TileMap } from './types';

/**
 * Scene one of Dragons of Stormwreck Isle: the party is rowed ashore at the
 * north harbor and drowned sailors — zombies — come for them on the beach.
 * The layout below is original; the published maps are copyrighted. One
 * square is 5 ft. North (the sea) is at the top.
 */
export const BEACH: TileMap = {
  key: 'beach',
  name: 'North harbor, Stormwreck Isle',
  width: 24,
  height: 16,
  rows: [
    '~~~~~~~~~~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~==~~~~~~~~~~~',
    '~~~~~~~~~~~==~~~~~~~~~~~',
    '##~~~~~~~~~==~~~~~~~~~##',
    '###........==........###',
    '##...................###',
    '#......................#',
    '#......................#',
    '##.....................#',
    '##....................##',
    '###...................##',
    '####.......::.......####',
    '#####......::......#####',
    '######.....::.....######',
    '#######....::....#######',
    '########...::...########',
  ],
  legend: {
    '~': { name: 'sea', passable: false },
    '.': { name: 'sand', passable: true },
    '#': { name: 'rocky crag', passable: false },
    '=': { name: 'rickety dock', passable: true },
    ':': { name: 'stair up to Dragon\'s Rest', passable: true },
  },
  partyStart: [
    { x: 11, y: 5 },
    { x: 12, y: 5 },
    { x: 11, y: 6 },
    { x: 12, y: 6 },
    { x: 10, y: 6 },
  ],
};

/** Where the three drowned sailors rise, about 30 ft from the dock. */
export const BEACH_ZOMBIE_START = [
  { x: 5, y: 7 },
  { x: 18, y: 8 },
  { x: 12, y: 11 },
];

export const MAPS: Record<string, TileMap> = { beach: BEACH };

/** Zombie, SRD 5.1. */
export const ZOMBIE: CreatureStatBlock = {
  key: 'zombie',
  name: 'Zombie',
  size: 'Medium',
  type: 'undead',
  alignment: 'neutral evil',
  ac: 8,
  hpAverage: 22,
  hpDice: '3d8+9',
  speed: 20,
  abilities: { str: 13, dex: 6, con: 16, int: 3, wis: 6, cha: 5 },
  saves: { wis: 0 },
  immunities: ['poison'],
  conditionImmunities: ['poisoned'],
  senses: 'darkvision 60 ft., passive Perception 8',
  languages: 'understands the languages it knew in life but can\'t speak',
  cr: '1/4',
  xp: 50,
  traits: [
    {
      name: 'Undead Fortitude',
      text: 'If damage reduces the zombie to 0 hit points, it must make a Constitution saving throw with a DC of 5 + the damage taken, unless the damage is radiant or from a critical hit. On a success, the zombie drops to 1 hit point instead.',
    },
  ],
  attacks: [
    { key: 'slam', name: 'Slam', kind: 'melee', toHit: 3, damage: '1d6+1', damageType: 'bludgeoning', reach: 5 },
  ],
  glyph: 'Z',
};

export const STAT_BLOCKS: Record<string, CreatureStatBlock> = { zombie: ZOMBIE };

/** Names for the drowned sailors, so the log reads like a table, not a spreadsheet. */
export const ZOMBIE_NAMES = ['Drowned sailor (torn coat)', 'Drowned sailor (no boots)', 'Drowned sailor (barnacled)'];

/**
 * Spells the pregens can actually cast at 1st level, as they appear in the
 * SRD 5.1. Only fields the engine needs. Flavor-only cantrips (light, mage
 * hand, thaumaturgy, prestidigitation) resolve as narration.
 */
export interface SpellDef {
  name: string;
  level: number;
  time: 'action' | 'bonus' | 'reaction';
  range: number; // feet; 0 = self, 5 = touch
  effect:
    | { kind: 'attack'; damage: string; damageType: string; slow?: number; melee?: boolean }
    | { kind: 'save'; ability: 'dex' | 'con' | 'wis'; damage: string; damageType: string; half?: boolean; area?: 'cube15'; push?: number }
    | { kind: 'heal'; dice: string; addMod: boolean; noUndead: true }
    | { kind: 'missiles'; darts: number; damage: string }
    | { kind: 'buff'; condition: 'blessed' | 'mageArmor'; targets: number; durationRounds: number }
    | { kind: 'sleep'; dice: string; radius: number }
    | { kind: 'flavor' };
  text: string;
}

export const SPELLS: Record<string, SpellDef> = {
  'sacred flame': {
    name: 'Sacred Flame', level: 0, time: 'action', range: 60,
    effect: { kind: 'save', ability: 'dex', damage: '1d8', damageType: 'radiant' },
    text: 'Flame-like radiance descends on a creature you can see within range. The target must succeed on a Dexterity saving throw or take 1d8 radiant damage. The target gains no benefit from cover.',
  },
  'guiding bolt': {
    name: 'Guiding Bolt', level: 1, time: 'action', range: 120,
    effect: { kind: 'attack', damage: '4d6', damageType: 'radiant' },
    text: 'A flash of light streaks toward a creature. Make a ranged spell attack; on a hit the target takes 4d6 radiant damage and the next attack roll against it before the end of your next turn has advantage.',
  },
  'cure wounds': {
    name: 'Cure Wounds', level: 1, time: 'action', range: 5,
    effect: { kind: 'heal', dice: '1d8', addMod: true, noUndead: true },
    text: 'A creature you touch regains hit points equal to 1d8 + your spellcasting ability modifier. No effect on undead or constructs.',
  },
  'healing word': {
    name: 'Healing Word', level: 1, time: 'bonus', range: 60,
    effect: { kind: 'heal', dice: '1d4', addMod: true, noUndead: true },
    text: 'A creature of your choice that you can see within range regains hit points equal to 1d4 + your spellcasting ability modifier. No effect on undead or constructs.',
  },
  bless: {
    name: 'Bless', level: 1, time: 'action', range: 30,
    effect: { kind: 'buff', condition: 'blessed', targets: 3, durationRounds: 10 },
    text: 'Up to three creatures of your choice within range each add 1d4 to attack rolls and saving throws for 1 minute (concentration).',
  },
  'ray of frost': {
    name: 'Ray of Frost', level: 0, time: 'action', range: 60,
    effect: { kind: 'attack', damage: '1d8', damageType: 'cold', slow: 10 },
    text: 'A frigid beam of blue-white light streaks toward a creature within range. Make a ranged spell attack; on a hit it takes 1d8 cold damage and its speed is reduced by 10 feet until the start of your next turn.',
  },
  'shocking grasp': {
    name: 'Shocking Grasp', level: 0, time: 'action', range: 5,
    effect: { kind: 'attack', damage: '1d8', damageType: 'lightning', melee: true },
    text: 'Lightning springs from your hand. Make a melee spell attack (advantage if the target wears metal armor); on a hit it takes 1d8 lightning damage and can\'t take reactions until the start of its next turn.',
  },
  'magic missile': {
    name: 'Magic Missile', level: 1, time: 'action', range: 120,
    effect: { kind: 'missiles', darts: 3, damage: '1d4+1' },
    text: 'You create three glowing darts of magical force. Each dart hits a creature of your choice that you can see within range and deals 1d4 + 1 force damage. The darts all strike simultaneously.',
  },
  'mage armor': {
    name: 'Mage Armor', level: 1, time: 'action', range: 5,
    effect: { kind: 'buff', condition: 'mageArmor', targets: 1, durationRounds: 4800 },
    text: 'You touch a willing creature who isn\'t wearing armor; its base AC becomes 13 + its Dexterity modifier for 8 hours.',
  },
  sleep: {
    name: 'Sleep', level: 1, time: 'action', range: 90,
    effect: { kind: 'sleep', dice: '5d8', radius: 20 },
    text: 'Roll 5d8; that many hit points of creatures within 20 feet of a point you choose fall unconscious, lowest current HP first. Undead and creatures immune to being charmed aren\'t affected.',
  },
  thunderwave: {
    name: 'Thunderwave', level: 1, time: 'action', range: 0,
    effect: { kind: 'save', ability: 'con', damage: '2d8', damageType: 'thunder', half: true, area: 'cube15', push: 10 },
    text: 'A wave of thunderous force sweeps out from you. Each creature in a 15-foot cube originating from you must make a Constitution saving throw; on a failure it takes 2d8 thunder damage and is pushed 10 feet away from you, half damage and no push on a success.',
  },
  light: { name: 'Light', level: 0, time: 'action', range: 5, effect: { kind: 'flavor' }, text: 'An object you touch sheds bright light in a 20-foot radius for 1 hour.' },
  thaumaturgy: { name: 'Thaumaturgy', level: 0, time: 'action', range: 30, effect: { kind: 'flavor' }, text: 'A minor wonder: your voice booms, flames flicker, the ground trembles harmlessly.' },
  'mage hand': { name: 'Mage Hand', level: 0, time: 'action', range: 30, effect: { kind: 'flavor' }, text: 'A spectral hand appears and can manipulate an object, open a door, or retrieve something up to 10 pounds.' },
  prestidigitation: { name: 'Prestidigitation', level: 0, time: 'action', range: 10, effect: { kind: 'flavor' }, text: 'A minor magical trick: a spark, a puff of wind, a cleaned or soiled object, a small illusion.' },
};

/** The house cast that fills empty seats when the humans bring fewer masks. */
/**
 * The house cast. Shared by every room kind (the debate seats the same three),
 * so these describe the character, not the game: the room's own prompt says
 * what they are doing there. Keep table-specific colour (zombies, the party,
 * spell slots) out of here or it leaks into the other rooms.
 */
export const HOUSE_MASKS: { key: string; name: string; persona: string }[] = [
  {
    key: 'house:blackbeard',
    name: 'Blackbeard',
    persona:
      'Edward Teach, the pirate Blackbeard. Booming, theatrical, greedy, superstitious, braver than he is wise. Speaks in a rolling sailor\'s cadence, swears by the sea, calls everyone "lad" or "lass", covets anything shiny, and respects courage above all. Never breaks character.',
  },
  {
    key: 'house:zeus',
    name: 'Wizard Zeus',
    persona:
      'Zeus, king of the gods, currently passing as a mortal wizard and mildly insulted by the demotion. Grandiose, prone to declaring things, fond of lightning and of reminding everyone who he is, secretly delighted to be among mortals. Protective of his companions in a paternal, overbearing way. Never breaks character.',
  },
  {
    key: 'house:batman',
    name: 'Batman',
    persona:
      'Batman, the Dark Knight, facing whatever is in front of him with total commitment and no sense of humor about it. Terse, tactical, gravel-voiced, always has a plan and a contingency, refuses to kill, treats every problem as a puzzle and every ally as someone to protect. Occasionally mutters "I\'m Batman." Never breaks character.',
  },
];
